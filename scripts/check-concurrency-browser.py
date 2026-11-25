"""Arabic mobile journey through a test instance's actual app routes."""

import base64
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


def assert_mobile(page):
    expect(page.locator("html")).to_have_attribute("dir", "rtl")
    expect(page.locator("html")).to_have_attribute("lang", "ar")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")


def screenshot(page, name):
    destination = os.environ.get("FIS_TEST_SCREENSHOTS")
    if destination:
        folder = Path(destination)
        folder.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=folder / name, animations="disabled")


def audit_accessibility(page):
    script = os.environ.get("FIS_TEST_AXE_JS")
    if script:
        page.add_script_tag(path=script)
        return page.evaluate("""async () => (await axe.run({runOnly: {
          type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
        }})).violations.map(({id, nodes}) => ({ id, nodes: nodes.map(({target}) => target) }))""")
    return None


def run():
    origin = os.environ["FIS_TEST_BROWSER_ORIGIN"]
    parsed = urlsplit(origin)
    assert parsed.scheme == "http" and parsed.hostname == "127.0.0.1" and parsed.port
    pdf = base64.b64decode(os.environ["FIS_TEST_BROWSER_PDF"])
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            channel=os.environ.get("FIS_TEST_BROWSER_CHANNEL"), args=["--disable-background-networking"]
        )
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            is_mobile=True,
            has_touch=True,
            locale="ar",
            extra_http_headers={"X-Forwarded-For": os.environ["FIS_TEST_BROWSER_IP"]},
        )
        context.add_cookies([{"name": "fis_language", "value": "ar", "url": origin + "/"}])
        page = context.new_page()
        errors = []
        accessibility = {}
        completed = False
        page.on("pageerror", lambda _error: errors.append("pageerror"))
        try:
            page.goto(origin)
            assert_mobile(page)
            page.get_by_role("link", name="ادرس مستنداً", exact=True).click()
            expect(page.get_by_role("heading", name="ادرس مستنداً", exact=True)).to_be_visible()
            page.locator('input[type="file"]').set_input_files({
                "name": "ملاحظات المرونة.pdf", "mimeType": "application/pdf", "buffer": pdf
            })
            page.get_by_role("button", name="ارفع الملف وافتح الدورة").click()
            expect(page).to_have_url(re.compile(r"/courses/[^/?]+\?document="))
            assert_mobile(page)
            expect(page.locator(".study-desk")).to_have_attribute("data-ready", "true", timeout=30_000)
            suggestions = page.get_by_role("region", name="محادثة الدراسة").get_by_role("button", name=re.compile(r"(?:Spring elasticity|ملاحظات المرونة)"))
            expect(suggestions.first).to_be_visible()
            accessibility["course"] = audit_accessibility(page)
            screenshot(page, "01-mobile-course-suggestions.png")
            suggestions.first.click()
            message = page.get_by_label("اكتب إلى FIS")
            expect(message).not_to_have_value("")
            message.fill("ما مرونة النابض؟")
            page.get_by_role("button", name="إرسال", exact=True).click()
            source = page.get_by_role("link", name=re.compile(r"ملاحظات المرونة\.pdf\s+صفحة 1")).first
            expect(source).to_be_visible(timeout=20_000)
            expect(page.get_by_role("article", name="رد المعلّم").first).to_contain_text("يعود النابض إلى شكله الأصلي")
            course_url = page.url
            source.focus()
            source.press("Enter")
            viewer = page.get_by_role("dialog", name="المصدر المشار إليه")
            expect(viewer.get_by_role("img", name="صفحة المستند 1")).to_be_visible(timeout=20_000)
            expect(viewer.get_by_text("Spring elasticity:", exact=False).first).to_be_visible()
            expect(viewer.locator("mark").first).to_be_visible()
            assert_mobile(page)
            accessibility["sourceDrawer"] = audit_accessibility(page)
            screenshot(page, "02-mobile-original-source.png")
            page.keyboard.press("Escape")
            expect(viewer).not_to_be_visible()
            expect(source).to_be_focused()
            assert page.url == course_url

            with page.expect_response(lambda response: urlsplit(response.url).path == "/api/learning/chat") as visual_request:
                page.get_by_role("button", name="اشرح بصرياً", exact=True).click()
            assert visual_request.value.ok, f"Visual request returned HTTP {visual_request.value.status} ({visual_request.value.json().get('code')})."
            assert visual_request.value.request.post_data_json.get("mode") == "visual"
            expect(page.get_by_text("دورة مرونة النابض", exact=True).first).to_be_visible(timeout=20_000)
            page.set_viewport_size({"width": 1440, "height": 960})
            page.get_by_role("link", name="عرض المصدر", exact=True).click()
            side_source = page.get_by_role("complementary", name="المصدر المشار إليه")
            expect(side_source.get_by_role("img", name="صفحة المستند 1")).to_be_visible(timeout=20_000)
            screenshot(page, "03-desktop-tutor-and-source.png")
            side_source.get_by_role("button", name="العودة إلى الإجابة").click()
            for width in (360, 390, 768, 1024, 1440):
                page.set_viewport_size({"width": width, "height": 900})
                assert_mobile(page)

            page.set_viewport_size({"width": 390, "height": 844})
            page.get_by_role("link", name="اختبار سريع", exact=True).click()
            expect(page.get_by_role("heading", name="اختبار سريع")).to_be_visible()
            expect(page.get_by_label("عدد الأسئلة")).not_to_be_visible()
            page.get_by_text("خيارات الاختبار", exact=True).click()
            page.get_by_label("عدد الأسئلة").fill("1")
            page.get_by_role("button", name="ابدأ اختباراً سريعاً", exact=True).click()
            page.get_by_role("radio", name="يعود النابض إلى شكله الأصلي", exact=True).check()
            page.get_by_role("button", name="احفظ المحاولة وراجعها", exact=True).click()
            expect(page.get_by_role("heading", name="الملاحظات · 1 / 1", exact=True)).to_be_visible()
            page.get_by_role("link", name="عرض التقدّم المحفوظ", exact=True).click()
            expect(page.get_by_role("heading", name="تقدّم التعلّم", exact=True)).to_be_visible()
            expect(page.get_by_text("1 / 1", exact=True).first).to_be_visible()
            page.reload()
            expect(page.get_by_text("1 / 1", exact=True).first).to_be_visible()
            assert_mobile(page)
            screenshot(page, "04-mobile-saved-progress.png")
            page.goto(origin + "/help")
            restart = page.get_by_role("button", name="ابدأ الجولة الإرشادية")
            restart.press("Enter")
            tour = page.get_by_role("dialog")
            expect(tour.get_by_role("heading", name="أضف مستنداً")).to_be_visible()
            tour.get_by_role("button", name="التالي", exact=True).press("Enter")
            expect(tour.get_by_role("heading", name="ادرس مع المعلّم")).to_be_focused()
            accessibility["guidedTour"] = audit_accessibility(page)
            screenshot(page, "05-mobile-guided-tour.png")
            page.keyboard.press("Escape")
            expect(restart).to_be_focused()
            expect(page.get_by_text("تمّت", exact=True)).to_have_count(5)
            page.goto(origin + "/history")
            expect(page.get_by_role("heading", name="سجل الدراسة", exact=True)).to_be_visible()
            page.get_by_role("link", name="ما مرونة النابض؟", exact=False).click()
            expect(page.get_by_role("article", name="رد المعلّم").first).to_contain_text("يعود النابض إلى شكله الأصلي")
            expect(page.get_by_role("link", name=re.compile(r"ملاحظات المرونة\.pdf\s+صفحة 1")).first).to_be_visible()
            assert not errors, "A browser page error occurred during the Arabic mobile journey."
            completed = True
        finally:
            try:
                cleanup = context.request.delete(
                    origin + "/api/workspace/account", headers={"Origin": origin}, data={"confirmation": "DELETE"}
                )
                if completed:
                    assert cleanup.ok, "Browser fixture account cleanup did not return success."
            finally:
                context.close()
                browser.close()
    print(json.dumps({"arabicMobile390": True, "viewportWidths": [360, 390, 768, 1024, 1440], "browserPageErrors": len(errors), "sourcePage": 1, "highlightAndFocusReturn": True, "structuredVisual": True, "persistedQuizScore": 1, "resumedCitedHistory": True, "completedChecklist": 5, "automatedAccessibility": accessibility}))
    assert not any(accessibility.values()), "Automated accessibility violations occurred."


if __name__ == "__main__":
    run()
