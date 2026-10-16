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
        captured_at:'2026-10-16T01:30:00.000Z', text:'합성 테스트: 카드 승인 18,900원\n<script>throw Error("XSS")</script>' };
      const heldEvents = [
        '플러스박스 빼기 완료 100,000원',
        '계좌이체 완료 100,000원',
        '출금 18,900원 쿠팡 주식회사',
        '쿠팡 주식회사 18,900원'
      ].map((text, index) => ({...event, event_id:'held-' + index, text}));
      let transactions = [];
      let user = {id:'test-user'};
      window.BudgetCloud = {
        ENVIRONMENT:{name:'preview-v2', isPreview:true},
        SUPABASE_URL:'https://example.invalid', SUPABASE_ANON_KEY:'public-test-key',
        isConfigured:() => true, currentUser:async () => user, signOut:async () => { user = null; },
        downloadState:async () => window.BudgetStorage.normalizeState({transactions}),
        saveSettings:async () => {}, isDuplicateTransactionError:() => false,
        getClient:() => ({
          rpc:async (name, args) => {
            if (name === 'record_phone_event') {
              if (args.p_event_id !== event.event_id) throw new Error('Held notification must not be recorded');
              transactions.push({id:'phone-test', type:'expense', source:'user', ...args.p_transaction});
              event.status = 'recorded';
              return {data:{id:'phone-test', already_recorded:false}, error:null};
            }
            return {data:null, error:null};
          },
          from:() => {
            const query = {select:() => query, eq:() => query, order:() => query,
              limit:async () => ({data:[{...event}, ...heldEvents], error:null})};
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
    await page.getByRole('button', {name:'받은 알림 불러오기', exact:true}).click();
    await page.locator('#phone-panel').getByText('합성 테스트: 카드 승인 18,900원', {exact:false}).waitFor();
    assert.equal(await page.locator('.phone-event').count(), 5);
    assert.equal(await page.locator('.phone-record-form').count(), 1);
    assert.equal(await page.locator('#summary-expense').textContent(), '₩0');
    await page.locator('#phone-panel').getByText('플러스박스의 원금 이동은 내 돈을 옮기는 것이에요.', {exact:false}).waitFor();
    await page.getByLabel('결제일', {exact:true}).fill('2026-10-16');
    await page.getByLabel('결제금액', {exact:true}).fill('18,900');
    await page.getByLabel('내용', {exact:true}).fill('쿠팡이츠 · 비빔밥');
    await page.getByLabel('이 결제가 아직 가계부에 없는 것을 확인했어요.').check();
    await page.getByRole('button', {name:'확인한 지출 기록', exact:true}).click();
    await page.getByText('기록한 알림').waitFor();
    assert.equal(await page.locator('.phone-record-form').count(), 0);
    await page.waitForFunction(() => /18,900/.test(document.querySelector('#summary-expense').textContent), null, {timeout:5000});
    assert.equal(await page.evaluate(() => document.activeElement.id), 'phone-message');
    await page.waitForFunction(() => !document.querySelector('#phone-connect').disabled);
    await page.setViewportSize({width:360, height:800});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({path:path.join(root, '.tmp/phone-tests/phone-mobile.png'), fullPage:true});
    await page.getByRole('button', {name:'로그아웃', exact:true}).click();
    assert.equal(await page.locator('#phone-config').inputValue(), '');
    assert.equal(await page.locator('#phone-inbox').textContent(), '');
    assert.deepEqual(errors, []);
    console.log('PASS: browser fixture pairing, safe text, comma amount, record, transfer exclusion, unchanged sums for held events, 360px, logout cleanup');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
