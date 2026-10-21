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
    page.on('pageerror', error => {errors.push(error.message);console.error(error.message);});
    await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({body:''}));
    await page.route('**/js/cloud.js*', route => route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(__dirname,'helpers/phone-cloud-fixture.js'),'utf8')}));
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.locator('#filter-month').fill('2026-10');
    await page.getByRole('tab', {name:'설정', exact:true}).click();
    await page.getByRole('button', {name:'연결 설정 만들기', exact:true}).click({timeout:5000});
    const config = JSON.parse(await page.locator('#phone-config').inputValue());
    assert.match(config.device_token, /^[0-9a-f]{64}$/);

    await page.getByRole('tab', {name:/분류/}).click();
    await page.waitForFunction(()=>document.querySelectorAll('#review-list .review-card').length===7);
    assert.equal(await page.locator('#summary-expense').textContent(),'₩0');
    assert.equal(await page.locator('#review-held-wrap').isVisible(),false);
    const card=id=>page.locator('[data-event-id="event-'+id+'"]');
    const form=()=>page.locator('#review-list form');
    const open=async id=>card(id).getByRole('button',{name:'검토하고 반영'}).click();
    const save=async()=>{await form().getByRole('button',{name:'선택한 방법으로 반영'}).click();await page.waitForFunction(()=>!document.querySelector('#review-list form'));};
    await open(3);
    assert.equal(await form().getByLabel('반영 방법',{exact:true}).inputValue(),'');
    await form().getByLabel('반영 방법',{exact:true}).selectOption('expense');
    await form().getByLabel('항목명 / 내용',{exact:true}).fill('생필품 · 수정한 항목');
    await form().getByLabel('리마크 / 메모',{exact:true}).fill('주방용품 구매\n캡처 참조');
    await form().getByLabel('금액',{exact:true}).fill('18,900');
    await form().getByLabel('계좌 잔액도 반영',{exact:true}).check();
    await form().getByLabel('잔액을 반영할 계좌 이름',{exact:true}).fill('생활비 계좌');
    await form().getByLabel('캡처 첨부 (선택)',{exact:true}).setInputFiles({name:'capture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Jx8AAAAASUVORK5CYII=','base64')});
    for(const width of [320,360,1080]){await page.setViewportSize({width,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
    await page.setViewportSize({width:360,height:800});
    await page.screenshot({path:path.join(root,'.tmp/phone-tests/review-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'새로고침',exact:true}).click();
    assert.equal(await form().getByLabel('항목명 / 내용',{exact:true}).inputValue(),'생필품 · 수정한 항목');
    await page.evaluate(()=>window.reviewFixture.fail=true);
    await form().getByRole('button',{name:'선택한 방법으로 반영'}).click();
    await page.waitForFunction(()=>document.querySelector('#review-message').textContent.includes('반영을 확인하지 못'));
    assert.equal(await form().getByLabel('리마크 / 메모',{exact:true}).inputValue(),'주방용품 구매\n캡처 참조');
    await page.evaluate(()=>window.reviewFixture.fail=false);
    await save();
    await page.waitForFunction(()=>/18,900/.test(document.querySelector('#summary-expense').textContent));
    assert.equal(await page.evaluate(()=>window.reviewFixture.uploads.length),1,'retry reuses the uploaded private attachment');
    assert.match(await page.locator('#review-balances').textContent(),/50,000/);
    await page.locator('#review-held-title').click();
    await page.getByRole('button',{name:'첨부 캡처 1장 보기'}).click();
    await page.locator('#review-held img').waitFor();
    assert.match(await page.locator('#review-held').textContent(),/주방용품 구매/);
    for(const [id,action] of [[5,'income'],[2,'transfer'],[1,'balance'],[4,'ignore']]){
      await open(id);await form().getByLabel('반영 방법',{exact:true}).selectOption(action);
      if(action==='balance'){await form().getByLabel('잔액을 반영할 계좌 이름',{exact:true}).fill('생활비 계좌');await form().getByLabel('확인한 계좌 잔액',{exact:true}).fill('0');}
      await save();
      await page.waitForFunction(id=>!document.querySelector('[data-event-id="event-'+id+'"]'),id);
    }
    await page.waitForFunction(()=>/1,000/.test(document.querySelector('#summary-income').textContent));
    assert.match(await page.locator('#review-balances').textContent(),/0원/);
    assert.equal(await page.locator('#summary-expense').textContent(),'₩18,900');
    await page.getByRole('button',{name:'다시 검토',exact:true}).click();
    await card(4).waitFor();
    await page.getByRole('tab',{name:'설정',exact:true}).click();
    await page.getByRole('button',{name:'받은 알림 불러오기'}).click();
    await page.locator('#phone-inbox .phone-event').first().waitFor();
    assert.equal(await page.locator('#phone-inbox form').count(),0);
    await page.locator('#phone-inbox').getByRole('button',{name:'분류 탭에서 검토'}).first().click();
    assert.equal(await page.getByRole('tab',{name:/분류/}).getAttribute('aria-selected'),'true');
    await page.getByRole('button', {name:'로그아웃', exact:true}).click();
    assert.equal(await page.locator('#phone-config').inputValue(), '');
    assert.equal(await page.locator('#phone-inbox').textContent(), '');
    assert.equal(await page.locator('#review-list').textContent(),'');
    assert.equal(await page.locator('#review-held').textContent(),'');
    assert.deepEqual(errors, []);
    console.log('PASS: all pending notifications, explicit actions, edits, remarks, private captures, retry, balances, reopening, settings route, mobile and logout');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
