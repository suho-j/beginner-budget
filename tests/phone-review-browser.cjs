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
    await page.locator('#review-list .review-focus-card').waitFor();
    const card=()=>page.locator('#review-list .review-focus-card');
    const form=()=>page.locator('#review-list form');
    const open=async id=>{
      if(await page.locator('#review-filter-main').getAttribute('aria-pressed')!=='true')await page.locator('#review-filter-main').click();
      for(let i=0;i<20&&await page.locator('#review-prev').isEnabled();i++)await page.locator('#review-prev').click();
      for(let i=0;i<20;i++){if(await card().getAttribute('data-event-id')===id)return;if(await page.locator('#review-next').isDisabled())break;await page.locator('#review-next').click();}
      throw Error('Missing card '+id);
    };
    const save=async()=>{const id=await card().getAttribute('data-event-id');await form().locator('.review-submit').click();await page.waitForFunction(id=>!document.querySelector('[data-event-id="'+id+'"]'),id);};
    assert.equal(await card().count(),1,'one visible decision');
    assert.equal(await page.locator('#summary-expense').textContent(),'₩0');
    await open('event-3');
    assert.equal(await form().getByLabel('금액',{exact:true}).inputValue(),'18,900');
    assert.equal(await form().locator('[data-action="expense"]').getAttribute('aria-pressed'),'true');
    await form().getByLabel('항목명 / 내용',{exact:true}).fill('생필품 · 수정한 항목');
    await card().evaluate(el=>el.dispatchEvent(new TouchEvent('touchstart',{touches:[new Touch({identifier:1,target:el,clientX:290,clientY:200})]})));
    await card().evaluate(el=>el.dispatchEvent(new TouchEvent('touchend',{changedTouches:[new Touch({identifier:1,target:el,clientX:90,clientY:205})]})));
    assert.equal(await card().getAttribute('data-event-id'),'event-4');
    assert.equal(await page.evaluate(()=>reviewFixture.calls.length),0,'swiping never writes');
    await page.locator('#review-prev').click();
    assert.equal(await form().getByLabel('항목명 / 내용',{exact:true}).inputValue(),'생필품 · 수정한 항목','draft survives swipe');
    await form().locator('.review-extras summary').click();
    await form().getByLabel('리마크 / 메모',{exact:true}).fill('주방용품 구매\n캡처 참조');
    await form().getByLabel('캡처 첨부 (선택)',{exact:true}).setInputFiles({name:'capture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Jx8AAAAASUVORK5CYII=','base64')});
    for(const width of [320,360,1080]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile overflow at '+width);}
    await page.setViewportSize({width:360,height:900});
    await form().locator('.review-extras summary').click();await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(200);await page.screenshot({path:path.join(root,'.tmp/phone-tests/review-deck-mobile.png'),fullPage:true});await form().locator('.review-extras summary').click();
    await page.getByRole('button',{name:'새로고침',exact:true}).click();
    assert.equal(await form().getByLabel('항목명 / 내용',{exact:true}).inputValue(),'생필품 · 수정한 항목');
    await page.evaluate(()=>window.reviewFixture.fail=true);
    await form().locator('.review-submit').click();
    await page.waitForFunction(()=>document.querySelector('#review-message').textContent.includes('반영을 확인하지 못'));
    assert.equal(await form().getByLabel('리마크 / 메모',{exact:true}).inputValue(),'주방용품 구매\n캡처 참조');
    await page.evaluate(()=>window.reviewFixture.fail=false);await save();
    await page.waitForFunction(()=>/18,900/.test(document.querySelector('#summary-expense').textContent));
    assert.equal(await page.evaluate(()=>window.reviewFixture.uploads.length),1,'retry reuses private attachment');
    assert.match(await page.locator('#review-balances').textContent(),/50,000/);
    assert.match(await page.locator('#account-observed-amount').textContent(),/50,000/);
    assert.equal(await page.evaluate(()=>reviewFixture.calls.find(c=>c.p_event_id==='event-3').p_decision.account_label),'생활비 계좌');
    await page.locator('#review-held-title').click();await page.getByRole('button',{name:'첨부 캡처 1장 보기'}).click();await page.locator('#review-held img').waitFor();
    for(const [id,action] of [['event-5','income'],['event-2','transfer'],['event-1','balance'],['event-4','ignore']]){
      await open(id);if(!await form().locator('.review-methods').evaluate(el=>el.open))await form().locator('.review-methods summary').click();await form().locator('[data-action="'+action+'"]').click();
      if(action==='balance'){await form().locator('.review-extras summary').click();await form().getByLabel('확인한 계좌 잔액',{exact:true}).fill('0');}
      await save();
    }
    await page.waitForFunction(()=>/1,000/.test(document.querySelector('#summary-income').textContent));
    await open('order-7');
    assert.equal(await form().getByLabel('금액',{exact:true}).inputValue(),'26,000');
    assert.equal(await form().getByLabel('날짜',{exact:true}).inputValue(),'2026-10-20');
    assert.equal(await form().getByLabel('연결할 결제',{exact:true}).inputValue(),'0');
    await page.locator('#review-held').evaluate(el=>el.parentElement.open=false);await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(200);await page.screenshot({path:path.join(root,'.tmp/phone-tests/review-order-mobile.png'),fullPage:true});
    await save();await page.waitForFunction(()=>/44,900/.test(document.querySelector('#summary-expense').textContent));
    assert.equal(await page.evaluate(()=>reviewFixture.rows.find(r=>r.event_id==='bank-8').status),'recorded');
    await page.locator('#review-filter-notice').click();assert.equal(await card().getAttribute('data-event-id'),'notice-9');
    page.once('dialog',d=>d.accept());await page.locator('#review-dismiss-notices').click();
    await page.waitForFunction(()=>document.querySelector('#review-empty').textContent.includes('정리할 안내'));
    await page.locator('#review-held-title').click();await page.locator('#review-held').getByRole('button',{name:'다시 검토',exact:true}).first().click();
    await page.waitForFunction(()=>window.reviewFixture.rows.some(r=>r.status==='pending'&&r.decision?.action==='ignore'));
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
    console.log('PASS: swipe deck, prefill, preserved drafts, order-to-payment linking, single account balance, private captures/retry, notice grouping, keyboard buttons, mobile, reopening and logout');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
