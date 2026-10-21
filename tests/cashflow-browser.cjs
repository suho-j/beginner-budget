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
  let browser;
  try {
    browser = await chromium.launch({headless:true, executablePath:process.env.CASHFLOW_CHROMIUM_PATH || undefined, args:['--no-sandbox']});
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({body:''}));
    await page.route('**/js/cloud.js*', r => r.fulfill({contentType:'application/javascript',body:'(' + function () {
      let state = window.BudgetStorage.defaultState();
      let user = {id:'test-user'};
      const fixture = window.cashflowFixture = {fail:false, calls:0, delay:0, state:()=>state};
      window.BudgetCloud = {
        ENVIRONMENT:{name:'preview-v2',isPreview:true}, isConfigured:()=>true,
        currentUser:async()=>user, signOut:async()=>{user=null;},
        downloadState:async()=>structuredClone(state),
        saveSettings:async next=>{
          fixture.calls++; if(fixture.hold) await new Promise(r=>{fixture.release=r;});
          if(fixture.fail)throw new Error('test failure');
          state = window.BudgetStorage.normalizeState({...state,...next,transactions:state.transactions});
        }
      };
    } + ')();'}));
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.locator('#cashflow-save').waitFor({state:'attached'});
    await page.waitForFunction(()=>!document.querySelector('#cashflow-save').disabled);
    await page.locator('#filter-month').fill('2026-10');
    await page.locator('#tab-cashflow').click();
    await page.locator('.cashflow-plan-editor > summary').click();
    const plan = {items:[{kind:'income',name:'테스트 급여',amount:5000000},{kind:'fixed',name:'테스트 납부',amount:1000000}],livingBudget:1500000};
    await page.locator('.cashflow-import-area summary').click();
    await page.locator('#cashflow-import').setInputFiles({name:'plan.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(plan))});
    await page.waitForFunction(()=>document.querySelectorAll('.cashflow-row').length===2);
    assert.equal(await page.locator('#cashflow-additionalSaving').textContent(),'2,500,000원');
    const incomeRow=page.locator('.cashflow-row').nth(0);
    await incomeRow.locator('[data-field="day"]').selectOption('10');
    await incomeRow.locator('[data-field="rule"]').selectOption('previous');
    assert.match(await page.locator('#cashflow-table-view').textContent(),/10-08/);
    await page.locator('#cashflow-view-calendar').click();
    assert.equal(await page.locator('#cashflow-table-view').isVisible(),false);
    assert.equal(await page.locator('#cashflow-calendar-view').isVisible(),true);
    const payday=page.locator('.cashflow-day[aria-label="2026-10-08"]');
    assert.match(await payday.textContent(),/테스트 급여/);
    assert.match(await payday.textContent(),/5,000,000원/);
    await page.locator('#cashflow-view-table').click();
    assert.equal(await page.locator('#cashflow-calendar-view').isVisible(),false);
    const fixedRow = page.locator('.cashflow-row').nth(1);
    await fixedRow.locator('summary').click();
    await fixedRow.locator('[data-field="paymentDay"]').fill('25일~말일');
    await fixedRow.locator('[data-field="paymentMethod"]').fill('테스트 카드');
    await fixedRow.locator('[data-field="memo"]').fill('약정 확인 후 변경');
    await fixedRow.locator('[data-field="targetAmount"]').fill('900,000');
    await fixedRow.locator('[data-field="status"]').selectOption('review');
    assert.equal(await page.locator('#fixed-cost-monthlySaving').textContent(),'0원');
    await fixedRow.locator('[data-field="status"]').selectOption('reduce');
    assert.equal(await page.locator('#fixed-cost-monthlySaving').textContent(),'100,000원');
    assert.equal(await page.locator('#fixed-cost-annualSaving').textContent(),'1,200,000원');
    assert.equal(await page.locator('#fixed-cost-afterAdditionalSaving').textContent(),'2,600,000원');
    assert.equal(await page.locator('#cashflow-additionalSaving').textContent(),'2,500,000원');
    await page.locator('#cashflow-fixed-only').check();
    assert.equal(await page.locator('.cashflow-row:visible').count(),1);
    await page.locator('#cashflow-save').click();
    await page.waitForFunction(()=>document.querySelector('#cashflow-message').textContent.includes('저장했어요'));
    assert.equal(await page.evaluate(()=>window.cashflowFixture.state().transactions.length),0);
    assert.equal(await page.evaluate(()=>window.cashflowFixture.state().cashflowPlans['2026-10'].items.length),2);
    assert.equal(await page.evaluate(()=>window.cashflowFixture.state().cashflowPlans['2026-10'].items[0].schedule.rule),'previous');
    assert.equal(await page.evaluate(()=>window.cashflowFixture.state().cashflowPlans['2026-10'].items[1].fixedCost.paymentDay),'25일~말일');
    await page.locator('#cashflow-living').fill('9,000,000');
    assert.equal(await page.locator('#cashflow-additionalSaving').textContent(),'-5,000,000원');
    assert.match(await page.locator('#cashflow-shortfall').textContent(),/넘었어요/);
    await page.evaluate(()=>window.cashflowFixture.fail=true);
    await page.locator('#cashflow-save').click();
    await page.waitForFunction(()=>document.querySelector('#cashflow-message').textContent.includes('test failure'));
    assert.equal(await page.locator('#cashflow-living').inputValue(),'9,000,000');
    assert.equal(await page.evaluate(()=>window.cashflowFixture.state().cashflowPlans['2026-10'].livingBudget),1500000);
    await page.locator('#cashflow-living').fill('-1');
    await page.locator('#cashflow-save').click();
    assert.equal(await page.evaluate(()=>window.cashflowFixture.calls),2);
    await page.locator('#cashflow-undo').click();
    assert.equal(await page.locator('#cashflow-living').inputValue(),'1500000');
    assert.equal(await page.locator('#fixed-cost-monthlySaving').textContent(),'100,000원');
    await page.locator('#month-next').click();
    assert.equal(await page.locator('.cashflow-row').count(),0);
    await page.locator('#cashflow-copy').click();
    assert.equal(await page.locator('.cashflow-row').count(),2);
    assert.equal(await page.locator('[data-field="paymentMethod"]').inputValue(),'테스트 카드');
    await page.evaluate(()=>{window.cashflowFixture.fail=false;window.cashflowFixture.hold=true;});
    await page.locator('#cashflow-save').click();
    assert.equal(await page.locator('#cashflow-living').isDisabled(),true);
    await page.locator('#month-next').click();
    assert.equal(await page.locator('#filter-month').inputValue(),'2026-11');
    await page.evaluate(()=>window.cashflowFixture.release());
    await page.waitForFunction(()=>document.querySelector('#cashflow-message').textContent.includes('저장했어요'));
    assert.equal(await page.evaluate(()=>Object.keys(window.cashflowFixture.state().cashflowPlans).length),2);
    await page.locator('#cashflow-import').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"items":[]}')});
    await page.waitForFunction(()=>document.querySelector('#cashflow-message').textContent.includes('불러오기 실패'));
    assert.equal(await page.locator('.cashflow-row').count(),2);
    await page.locator('#cashflow-fixed-only').uncheck();
    const copiedFixed = page.locator('.cashflow-row').nth(1);
    if (!(await copiedFixed.locator('details').evaluate(el=>el.open))) await copiedFixed.locator('summary').click();
    await copiedFixed.locator('[data-field="targetAmount"]').fill('1,100,000');
    await page.locator('#cashflow-save').click();
    assert.match(await page.locator('#cashflow-message').textContent(),/목표/);
    await page.locator('#cashflow-undo').click();
    await page.locator('.cashflow-row').nth(1).locator('summary').click();
    await copiedFixed.locator('[data-field="kind"]').selectOption('allowance');
    assert.equal(await copiedFixed.locator('details').isVisible(),false);
    assert.equal(await page.locator('#fixed-cost-monthlySaving').textContent(),'0원');
    await copiedFixed.locator('[data-field="kind"]').selectOption('fixed');
    assert.equal(await copiedFixed.locator('details').isVisible(),true);
    assert.equal(await page.locator('#fixed-cost-monthlySaving').textContent(),'100,000원');
    fs.mkdirSync(path.join(root,'.tmp/cashflow-tests'),{recursive:true});
    for(const width of [1280,360]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:path.join(root,`.tmp/cashflow-tests/${width}.png`),fullPage:true});
    }
    await page.locator('#cloud-logout-button').click();
    assert.equal(await page.locator('#cashflow-save').isDisabled(),true);
    assert.equal(await page.locator('.cashflow-row').count(),0);
    assert.deepEqual(errors,[]);
    console.log('Cashflow browser smoke passed: fixed-cost estimates/details/filter, import, save, failure, validation, months, copy, busy state, mobile, logout');
  } finally {if (browser) await browser.close(); await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
