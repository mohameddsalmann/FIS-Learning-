import { test, expect } from "@playwright/test";

test("guest sample retrieves a real source and records a prepared quiz", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"Study from your own materials."})).toBeVisible();
  await page.getByRole("link",{name:"Explore the pre-authored example lesson"}).click();
  await expect(page.getByRole("heading",{name:"Light and color",exact:true})).toBeVisible();
  await page.getByLabel("Question about the lesson").fill("Why does a prism separate colors?");
  await page.getByRole("button",{name:"Find sources"}).click();
  await page.getByRole("link",{name:"Source 3 · Dispersion"}).click();
  await expect(page).toHaveURL(/#dispersion$/);
  await page.getByRole("link",{name:"Take the sample quiz"}).click();
  await page.getByRole("radio",{name:"The normal"}).check();
  await page.getByRole("radio",{name:"False"}).check();
  await page.getByLabel("Your answer",{exact:true}).fill("Dispersion");
  await page.getByRole("button",{name:"Check answers"}).click();
  await expect(page.getByText("Sample result · 3 / 3")).toBeVisible();
  await page.getByRole("link",{name:"View progress"}).last().click();
  await expect(page.getByText("3 / 3",{exact:true})).toBeVisible();
});

test("study room layout stays within five viewport widths", async ({ page }) => {
  for(const width of [360,390,768,1024,1440]) {
    await page.setViewportSize({width,height:850});
    await page.goto("/");
    await expect(page.getByRole("link",{name:"Study a document"})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByLabel("Open navigation").click();
  await page.getByRole("navigation",{name:"Mobile navigation"}).getByRole("link",{name:"Settings"}).click();
  await expect(page.getByRole("heading",{name:"Settings",exact:true})).toBeVisible();
});

test("document-first intake keeps the file and reuses a new course after an upload failure", async ({ page }) => {
  let coursesCreated = 0;
  let uploads = 0;
  const course = { id: "intake-course", title: "Optics handout", description: null };
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: { user: { id: "intake-guest" } } }));
  await page.route("**/api/workspace/courses", (route) => {
    expect(++coursesCreated).toBe(1);
    expect(route.request().postDataJSON().title).toBe(course.title);
    return route.fulfill({ status: 201, json: { course } });
  });
  const document = { id: "intake-document", title: "Optics handout.pdf", status: "PENDING" };
  let reservations = 0;
  await page.route("**/api/documents/uploads", (route) => {
    expect(++reservations).toBe(1);
    return route.fulfill({ status: 201, json: { document: { ...document, status: "UPLOADING" }, pathname: "fixture/Optics handout.pdf" } });
  });
  await page.route("**/api/documents/intake-document/finalize", (route) => route.fulfill({ status: 409, json: { error: "Upload not found" } }));
  await page.route("**/api/documents", (route) => {
    expect(route.request().postDataBuffer()?.toString()).toContain(course.id);
    if (++uploads === 1) return route.fulfill({ status: 503, json: { error: "Upload storage is temporarily unavailable." } });
    return route.fulfill({ status: 201, json: { document } });
  });
  await page.route("**/api/workspace/courses/intake-course", (route) => route.fulfill({ json: { course, topics: [], progress: [], documents: [document] } }));
  await page.route("**/api/documents/intake-document/process", (route) => route.fulfill({ json: { document: { ...document, pageCount: 1, status: "READY" }, job: { processedChunks: 1, totalChunks: 1 } } }));

  await page.goto("/");
  await page.getByRole("link", { name: "Study a document" }).click();
  const file = page.locator('input[type="file"]');
  await file.setInputFiles({ name: "not-a-pdf.txt", mimeType: "text/plain", buffer: Buffer.from("unsupported") });
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Choose one valid PDF up to 20 MB.");
  await file.setInputFiles({ name: document.title, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") });
  const submit = page.getByRole("button", { name: "Upload and open course" });
  await submit.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page.getByText("Optics handout.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry upload" }).click();
  await expect(page).toHaveURL(/\/courses\/intake-course\?document=intake-document$/);
  await expect(page.getByRole("button", { name: /Summarize the document.*Optics handout.pdf/ })).toBeVisible();
  expect(uploads).toBe(2);
});

test("course load retries and a keyboard suggestion preserves the current draft", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/workspace/courses/retry-course", (route) => {
    if (++reads === 1) return route.fulfill({ status: 503, json: { error: "Course temporarily unavailable." } });
    return route.fulfill({ json: {
      course: { id: "retry-course", title: "Recovery laboratory" }, topics: [], progress: [],
      documents: [{ id: "reading", status: "READY", title: "Spring notes.pdf", learningOutline: { suggestions: [
        { kind: "explain", topics: ["Elasticity"], page: 1 }, { kind: "compare", topics: ["1 N", "2 N"], page: 2 },
        { kind: "quiz", topics: ["Elasticity"], page: 1 },
      ] } }],
    } });
  });
  let sends = 0;
  await page.route("**/api/learning/chat", async (route) => { sends++; await route.abort(); });
  await page.goto("/courses/retry-course");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("temporarily unavailable");
  await page.getByRole("button", { name: "Retry loading course" }).press("Enter");
  const starters = page.getByRole("region", { name: "Start with your PDF" });
  await expect(starters.getByRole("button")).toHaveCount(3);
  const draft = page.getByRole("textbox", { name: "Message FIS" });
  await draft.fill("My own question");
  await starters.getByRole("button", { name: /Compare 1 N and 2 N.*Page 2/ }).press("Enter");
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue(/^My own question\n\nCompare 1 N and 2 N\. Start with page 2/);
  expect(sends).toBe(0);
});

test("refresh during an intake upload reopens the existing course reservation", async ({ page }) => {
  const course = { id: "recovery-course", title: "Recovery", description: null };
  const document = { id: "recovery-document", title: "Recovery.pdf", status: "UPLOADING", sizeBytes: 9 };
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: { user: { id: "guest" } } }));
  await page.route("**/api/workspace/courses", (route) => route.fulfill({ status: 201, json: { course } }));
  await page.route("**/api/documents/uploads", (route) => route.fulfill({ status: 201, json: { document, pathname: "fixture/recovery.pdf" } }));
  await page.route("**/api/documents", async (route) => { await route.abort("connectionreset"); });
  await page.route("**/api/workspace/courses/recovery-course", (route) => route.fulfill({ json: { course, topics: [], progress: [], documents: [document] } }));
  await page.route("**/api/documents/recovery-document/finalize", (route) => route.fulfill({ status: 409, json: { error: "Upload not found" } }));
  await page.goto("/study");
  await page.locator('input[type="file"]').setInputFiles({ name: "Recovery.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") });
  await page.getByRole("button", { name: "Upload and open course" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/courses\/recovery-course$/);
  await expect(page.getByRole("heading", { name: "Recovery", exact: true })).toBeVisible();
});

test("language picker updates Arabic RTL", async ({ page }) => {
  await page.goto("/settings");
  const picker=page.getByRole("combobox",{name:"Language"});
  await picker.click();
  await picker.fill("العربية");
  await picker.press("ArrowDown");
  await picker.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("dir","rtl");
  await page.goto("/courses/sample");
  await expect(page.getByRole("heading",{name:"الضوء والألوان",exact:true})).toBeVisible();
  await page.getByLabel("سؤال عن الدرس").fill("كيف يفصل المنشور الضوء الأبيض؟");
  await page.getByRole("button",{name:"اعثر على المصادر"}).click();
  await expect(page.getByRole("link",{name:/المصدر 3/})).toBeVisible();
});

test("study intake shows the guest sign-in retry window and keeps the PDF selected", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: null }));
  await page.route("**/api/auth/sign-in/anonymous", (route) => route.fulfill({
    status: 429, headers: { "x-retry-after": "125" }, json: { message: "Too many requests. Please try again later." },
  }));
  await page.goto("/study");
  await page.locator('input[type="file"]').setInputFiles({
    name: "Optics.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n"),
  });
  await page.getByRole("button", { name: "Upload and open course" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Guest sign-in is temporarily limited. Try again in about 3 min.");
  await expect(page.getByText("Optics.pdf", { exact: true })).toBeVisible();
});

test("optional intro can be dismissed and the tour manually reopened", async ({ page }) => {
  await page.setViewportSize({width: 360, height: 740});
  await page.goto("/");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Don’t show again" }).click();
  await page.reload();
  await expect(page.getByRole("link", { name: "Take the tour" })).toHaveCount(0);
  await page.getByRole("link", { name: "Help", exact: true }).click();
  const start = page.getByRole("button", {name: "Start guided tour"});
  await start.press("Enter");
  const tour = page.getByRole("dialog");
  await expect(tour.getByRole("heading", {name: "Add a document"})).toBeVisible();
  await tour.getByRole("button", {name: "Next"}).press("Enter");
  await expect(tour.getByRole("heading", {name: "Study with the tutor"})).toBeFocused();
  await tour.getByRole("button", {name: "Previous"}).press("Enter");
  await expect(tour.getByRole("heading", {name: "Add a document"})).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(start).toBeFocused();
  await expect(tour).not.toBeVisible();
});

test("private routes reject unauthenticated access", async ({ request }) => {
  const status = (await request.get("/api/workspace/dashboard")).status();
  expect([401,503]).toContain(status);
  expect((await request.post("/api/learning/chat",{data:{messages:[{role:"user",content:"Explain light."}]}})).ok()).toBe(false);
  expect((await request.get("/api/documents/11111111-1111-4111-8111-111111111111/file")).ok()).toBe(false);
  expect((await request.get("/engineering/docs/SECURITY")).status()).toBe(200);
});

test("guest course persists and is isolated from a second guest", async ({ page, browser }) => {
  test.skip(process.env.FIS_TEST_DB !== "1","Requires isolated migrated PostgreSQL and an auth secret.");
  await page.goto("/dashboard?new=1");
  await page.getByLabel("Course title").fill("Optics integration");
  await page.getByLabel("Description").fill("Disposable test course");
  await page.getByRole("button",{name:"Create course",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Optics integration"})).toBeVisible({timeout:15000});
  const href=new URL(page.url()).pathname;
  const id=href.split("/").at(-1);
  await page.getByText("Topics and progress", { exact: true }).click();
  await page.getByLabel("Topic title").fill("Mirror angles");
  await page.getByRole("button",{name:"Add topic"}).click();
  await expect(page.getByText("Mirror angles",{exact:true})).toBeVisible();
  await page.reload();
  await page.getByText("Topics and progress", { exact: true }).click();
  await expect(page.getByText("Mirror angles",{exact:true})).toBeVisible();
  const isolated=await browser.newContext({baseURL:new URL(page.url()).origin});
  try {
    const unauth=await isolated.request.post("/api/auth/sign-in/anonymous",{data:{}});
    expect(unauth.ok()).toBe(true);
    const denied=await isolated.request.get("/api/workspace/courses/"+id);
    expect([403,404]).toContain(denied.status());
  } finally { await isolated.close(); }
});
