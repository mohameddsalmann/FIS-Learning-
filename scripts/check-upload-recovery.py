import hashlib
import json
import os
import re
from urllib.parse import urlsplit
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
def pdf(large):
    lines = ['Spring Elasticity Laboratory',
        'Elasticity: A spring returns to its original length when a small force is removed.',
        'Study data for spring force and extension:',
        '0 N: 0 cm, 1 N: 2 cm, 2 N: 4 cm',
        'Within the elastic limit, doubling the force doubles the extension.',
        'If a spring is stretched beyond its elastic limit, it can remain permanently deformed.']
    draw = ('BT /F1 15 Tf 35 490 Td 24 TL ' + ' T* '.join(f'({line}) Tj' for line in lines) + ' ET').encode()
    content = b'x' * (4 * 1024 * 1024 + 14000) if large else b'x'
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 520] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        b'<< /Length %d >>\nstream\n%s\nendstream' % (len(draw), draw),
        b'<< /Length %d >>\nstream\n%s\nendstream' % (len(content), content)]
    data = bytearray(b'%PDF-1.4\n')
    offsets = []
    for number, value in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f'{number} 0 obj\n'.encode() + value + b'\nendobj\n')
    xref = len(data)
    data.extend(('xref\n0 7\n0000000000 65535 f \n' + ''.join(f'{offset:010d} 00000 n \n' for offset in offsets) + f'trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n').encode())
    return bytes(data)




origin = os.environ['FIS_RECOVERY_ORIGIN']
parsed = urlsplit(origin)
assert parsed.scheme == 'http' and parsed.hostname == '127.0.0.1' and parsed.port
original = pdf(True)
report = {}
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    context = browser.new_context(viewport={'width':390,'height':844}, reduced_motion='reduce')
    page = context.new_page()
    page.set_default_timeout(20000)
    cleanup = False
    try:
        page.goto(origin + '/study')
        page.locator('input[type=file]').set_input_files({'name':'Recovery laboratory.pdf','mimeType':'application/pdf','buffer':original})
        session = context.new_cdp_session(page)
        session.send('Network.emulateNetworkConditions', {'offline':False,'latency':35,'downloadThroughput':1200000,'uploadThroughput':180000})
        cleanup = True
        page.get_by_role('button',name='Upload and open course').click()
        progress = page.get_by_role('progressbar', name='PDF upload progress')
        expect(progress).to_be_visible()
        page.wait_for_function("[...document.querySelectorAll('progress')].some(x => x.value > 0 && x.value < x.max)")
        report['observedPartialBytes'] = True
        session.send('Network.emulateNetworkConditions', {'offline':True,'latency':0,'downloadThroughput':0,'uploadThroughput':0})
        expect(page.get_by_role('main').get_by_role('alert')).to_be_visible(timeout=30000)
        session.send('Network.emulateNetworkConditions', {'offline':False,'latency':0,'downloadThroughput':-1,'uploadThroughput':-1})
        page.reload()
        expect(page).to_have_url(re.compile('/courses/[^/?]+$'))
        course_id = urlsplit(page.url).path.rsplit('/',1)[1]
        course_url = origin + '/api/workspace/courses/' + course_id
        course = context.request.get(course_url).json()
        assert len(course['documents']) == 1
        document_id = course['documents'][0]['id']
        report['statusAfterReload'] = course['documents'][0]['status']
        resume = page.get_by_role('button',name='Resume upload')
        page.wait_for_function("document.querySelector('.study-desk')?.dataset.ready === 'true' || [...document.querySelectorAll('button')].some(x => x.textContent.trim() === 'Resume upload')",timeout=90000)
        if resume.is_visible():
            report['recovery'] = 'restarted original PDF'
            resume.click()
            page.locator('input[type=file]').first.set_input_files({'name':'Recovery laboratory.pdf','mimeType':'application/pdf','buffer':original})
            page.get_by_role('button',name='Add PDF to course').click()
        else:
            report['recovery'] = 'server finalized committed upload'
        expect(page.locator('.study-desk')).to_have_attribute('data-ready','true',timeout=120000)
        course = context.request.get(course_url).json()
        assert len(course['documents']) == 1 and course['documents'][0]['id'] == document_id
        fetched = context.request.get(origin + '/api/documents/' + document_id + '/file')
        assert fetched.ok
        original_hash = hashlib.sha256(original).hexdigest()
        assert hashlib.sha256(fetched.body()).hexdigest() == original_hash
        report.update({'sameDocument':True,'documents':1,'sha256':original_hash,'bytes':len(original),'ready':True})
        folder = os.environ.get('FIS_RECOVERY_SCREENSHOTS')
        if folder:
            Path(folder).mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(Path(folder)/'recovered-mobile.png'),animations='disabled')
    finally:
        if cleanup:
            result = context.request.delete(origin + '/api/workspace/account',headers={'Origin':origin},data={'confirmation':'DELETE'})
            report['cleaned'] = result.ok
        browser.close()
        print(json.dumps(report))
