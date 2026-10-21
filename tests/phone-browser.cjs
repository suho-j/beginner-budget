const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const server = http.createServer((req, res) => {
    const filename = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(filename, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', filename.endsWith('.js') ? 'application/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath:process.env.PHONE_CHROMIUM_PATH||'/tmp/budget-chromium', headless:true, args:['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({body:''}));
    await page.route('**/js/cloud.js*',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(__dirname,'helpers/phone-cloud-fixture.js'),'utf8')}));
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.locator('#filter-month').fill('2026-10');
    await page.getByRole('tab', {name:'설정', exact:true}).click();
    await page.getByRole('button', {name:'연결 설정 만들기', exact:true}).click({timeout:5000});
    const config = JSON.parse(await page.locator('#phone-config').inputValue());
    assert.match(config.device_token, /^[0-9a-f]{64}$/);
    await page.getByRole('button', {name:'받은 알림 불러오기', exact:true}).click();
    await page.locator('#phone-inbox .phone-event').first().waitFor();
    assert.equal(await page.locator('.phone-event').count(),7);
    assert.equal(await page.locator('#phone-inbox form').count(),0);
    assert.equal(await page.locator('#summary-expense').textContent(),'₩0');
    assert.match(await page.locator('#phone-inbox').textContent(),/<script>throw Error/);
    await page.locator('#phone-inbox').getByRole('button',{name:'분류 탭에서 검토'}).nth(3).click();
    assert.equal(await page.locator('#tab-review').getAttribute('aria-selected'),'true');
    await page.locator('[data-event-id="event-3"]').getByRole('button',{name:'검토하고 반영'}).click();
    assert.equal(await page.locator('#review-edit-action option').count(),6);
    await page.getByRole('button',{name:'취소',exact:true}).click();
    await page.setViewportSize({width:360, height:800});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({path:path.join(root, '.tmp/phone-tests/phone-mobile.png'), fullPage:true});
    await page.getByRole('button', {name:'로그아웃', exact:true}).click();
    assert.equal(await page.locator('#phone-config').inputValue(), '');
    assert.equal(await page.locator('#phone-inbox').textContent(), '');
    assert.deepEqual(errors, []);
    console.log('PASS: pairing, all notifications route to unified review, safe text, unchanged sums, 360px and logout cleanup');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
