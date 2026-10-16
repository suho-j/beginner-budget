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
  const browser = await chromium.launch({ channel:'chrome', headless:true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({body:''}));
    await page.route('**/js/cloud.js*', route => route.fulfill({contentType:'application/javascript', body: '(' + function () {
      const event = { event_id:'test-event', kind:'kbank_notification', status:'pending',
        captured_at:'2026-10-16T01:30:00.000Z', text:'체크카드 승인\n테스트 상점 18,900원' };
      const heldEvents = [
        '플러스박스 빼기 완료 100,000원',
        '계좌이체 완료 100,000원',
        '출금 18,900원 쿠팡 주식회사',
        '쿠팡 주식회사 18,900원'
      ].map((text, index) => ({...event, event_id:'held-' + index, text}));
      let transactions = [];
      let user = {id:'test-user'};
      const fixture=window.reviewFixture={fail:false,calls:0,downloads:0,next:()=>{event.event_id='next-event';event.status='pending';}};
      window.BudgetCloud = {
        ENVIRONMENT:{name:'preview-v2', isPreview:true,transactionsTable:'preview_v2_transactions'},
        SUPABASE_URL:'https://example.invalid', SUPABASE_ANON_KEY:'public-test-key',
        isConfigured:() => true, currentUser:async () => user, signOut:async () => { user = null; },
        downloadState:async () => {fixture.downloads++;return window.BudgetStorage.normalizeState({transactions});},
        saveSettings:async () => {}, isDuplicateTransactionError:() => false,
        getClient:() => ({
          rpc:async (name, args) => {
            if (name === 'record_phone_event') {
              fixture.calls++;
              if(fixture.fail)return {data:null,error:{code:'503'}};
              if (args.p_event_id !== event.event_id) throw new Error('Held notification must not be recorded');
              transactions.push({id:'phone-test', type:'expense', source:'user', ...args.p_transaction});
              event.status = 'recorded';
              return {data:{id:'phone-test', already_recorded:false}, error:null};
            }
            return {data:null, error:null};
          },
          from:table => {
            const query = {select:() => query, eq:() => query, order:() => query,
              limit:async () => ({data:table==='phone_inbox'?[{...event}, ...heldEvents]:transactions, error:null})};
            return query;
          }
        })
      };
    } + ')();'}));
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.locator('#filter-month').fill('2026-10');
    await page.getByRole('tab', {name:'설정', exact:true}).click();
    await page.getByRole('button', {name:'연결 설정 만들기', exact:true}).click({timeout:5000});
    const config = JSON.parse(await page.locator('#phone-config').inputValue());
    assert.match(config.device_token, /^[0-9a-f]{64}$/);

    await page.getByRole('tab', {name:/분류/}).click({timeout:3000});
    await page.locator('#review-list .review-card').waitFor();
    assert.equal(await page.locator('#review-list .review-card').count(),1);
    assert.equal(await page.locator('#review-count').innerText(),'1');
    assert.equal(await page.locator('#review-held-wrap').isVisible(),true);
    assert.equal(await page.locator('#review-held').isVisible(),false);
    assert.equal(await page.locator('#summary-expense').textContent(),'₩0');
    await page.setViewportSize({width:360,height:800});
    await page.evaluate(()=>scrollTo(0,0));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(root,'.tmp/phone-tests/review-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'테스트 상점 생활비로 기록',exact:true}).click();
    await page.waitForFunction(()=>/18,900/.test(document.querySelector('#summary-expense').textContent));
    assert.equal(await page.locator('#review-list .review-card').count(),0);
    assert.equal(await page.locator('#review-count').isVisible(),false);
    assert.ok((await page.locator('#review-message').innerText()).includes('생활비로 기록'));
    await page.waitForFunction(()=>!document.querySelector('#phone-connect').disabled);
    assert.equal(await page.evaluate(()=>window.reviewFixture.downloads),2,'Only initial load and post-save reload may advance the shared cloud snapshot');
    await page.evaluate(()=>window.reviewFixture.next());
    await page.getByRole('button',{name:'새로고침',exact:true}).click();
    await page.getByRole('button',{name:'확인하고 분류',exact:true}).waitFor();
    assert.equal(await page.locator('.review-choices').count(),0);
    assert.equal(await page.evaluate(()=>window.reviewFixture.calls),1);
    await page.getByRole('button',{name:'확인하고 분류',exact:true}).click();
    await page.locator('#review-list').getByLabel('내용',{exact:true}).fill('수정 중인 내용');
    await page.getByRole('button',{name:'새로고침',exact:true}).click();
    assert.equal(await page.locator('#review-list').getByLabel('내용',{exact:true}).inputValue(),'수정 중인 내용');
    await page.getByLabel('금액·날짜와 중복 여부를 확인했어요.').check();
    await page.evaluate(()=>window.reviewFixture.fail=true);
    await page.getByRole('button',{name:'분류해서 기록',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#review-message').textContent.includes('기록 여부를 확인하지 못'));
    assert.equal(await page.locator('#review-list').getByLabel('내용',{exact:true}).inputValue(),'수정 중인 내용');
    assert.equal(await page.locator('#review-list .review-card').count(),1);
    for(const width of [320,360,1080]){
      await page.setViewportSize({width,height:800});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
    await page.getByRole('button', {name:'로그아웃', exact:true}).click();
    assert.equal(await page.locator('#phone-config').inputValue(), '');
    assert.equal(await page.locator('#phone-inbox').textContent(), '');
    assert.equal(await page.locator('#review-list').textContent(),'');
    assert.equal(await page.locator('#review-held').textContent(),'');
    assert.deepEqual(errors, []);
    console.log('PASS: auto load, one-touch save, duplicate gate, retained edits on refresh/failure, 320/360/1080px, logout cleanup');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
