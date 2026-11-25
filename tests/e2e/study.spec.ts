import { expect, test } from "@playwright/test";

const source = {
  id: "fixture-chunk", documentId: "fixture", title: "Physics notes", page: 1,
  text: "A spring returns to its initial shape.",
};

function onePagePdf() {
  const stream = `BT /F1 18 Tf 45 160 Td (${source.text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 530 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let file = "%PDF-1.4\n";
  const offsets = objects.map((entry, index) => {
    const offset = file.length;
    file += `${index + 1} 0 obj\n${entry}\nendobj\n`;
    return offset.toString().padStart(10, "0") + " 00000 n \n";
  });
  const xref = file.length;
  file += `xref\n0 6\n0000000000 65535 f \n${offsets.join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(file);
}

test("fixture tutor recovers the draft and navigates a streamed source to PDF.js", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/learning/chat", async (route) => {
    expect(route.request().postDataJSON().messages.at(-1).content).toBe("Explain a spring");
    if (++attempts === 1) {
      await route.fulfill({ status: 503, json: { error: "The free tutor is temporarily unavailable." } });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ content: "### Elasticity\n\nThe force is proportional to displacement, $F=kx$." })}\n\ndata: ${JSON.stringify({ citations: [source] })}\n\ndata: [DONE]\n\n`,
    });
  });
  await page.route("**/api/documents/fixture/file", (route) => route.fulfill({ contentType: "application/pdf", body: onePagePdf() }));
  await page.route("**/api/documents/fixture/chunks/fixture-chunk", (route) => route.fulfill({ json: { chunk: source, document: { title: source.title } } }));

  await page.goto("/chat");
  const message = page.getByRole("textbox", { name: "Message FIS" });
  await message.fill("Explain a spring");
  const send = page.getByRole("button", { name: "Send", exact: true });
  await send.click();
  await expect(page.getByRole("region", { name: "Study chat" }).getByRole("alert")).toContainText("temporarily unavailable");
  await expect(message).toHaveValue("Explain a spring");
  await send.click();
  await expect(page.getByRole("heading", { name: "Elasticity" })).toBeVisible();
  await expect(page.locator(".katex")).toBeVisible();
  await page.getByRole("link", { name: "Physics notes Page 1" }).click();
  await expect(page.getByRole("heading", { name: "Physics notes" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Document page 1" })).toBeVisible();
  await expect(page.locator(".card mark").first()).toBeVisible();
  await page.getByRole("searchbox", { name: "Search document" }).fill("initial shape");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("button", { name: "Page 1", exact: true })).toBeVisible();
});

test("fixture PDF upload advances a resumable indexing status", async ({ page }) => {
  const document = { id: "fixture", title: source.title, status: "PENDING", pageCount: null, sizeBytes: onePagePdf().length, error: null };
  await page.route("**/api/workspace/courses/fixture", (route) => route.fulfill({
    json: { course: { id: "fixture", title: "Physics laboratory", description: "Fixture course" }, topics: [], progress: [], documents: [] },
  }));
  await page.route("**/api/documents/uploads", (route) => route.fulfill({ status: 201, json: { document: { ...document, status: "UPLOADING" }, pathname: "fixture/Physics notes.pdf" } }));
  await page.route("**/api/documents", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataBuffer()?.toString()).toContain("%PDF-1.4");
    expect(route.request().postDataBuffer()?.toString()).toContain('name="uploadId"');
    await route.fulfill({ status: 201, json: { document } });
  });
  let checkpoints = 0;
  await page.route("**/api/documents/fixture/process", (route) => {
    const processedChunks = ++checkpoints;
    return route.fulfill({ json: {
      document: { ...document, pageCount: 1, status: processedChunks === 1 ? "EMBEDDING" : "READY", learningOutline: { title: source.title, suggestions: [{ kind: "explain", topics: ["Spring elasticity"], page: 1 }] } },
      job: { processedChunks, totalChunks: 2 },
    } });
  });
  await page.goto("/courses/fixture");
  await expect(page.getByRole("heading", { name: "Course materials" })).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload PDF", exact: true }).click();
  await (await chooser).setFiles({ name: "Physics notes.pdf", mimeType: "application/pdf", buffer: onePagePdf() });
  await page.getByRole("button", { name: "Add PDF to course", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explain Spring elasticity Page 1", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View PDF" })).toBeVisible();
  expect(checkpoints).toBe(2);
});
