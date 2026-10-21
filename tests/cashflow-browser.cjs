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
    const plan = {items:[{kind:'income',name:'테스트 급여',amount:5000000},{kind:'fixed',name:'테스트 납부',amount:1000000}],livingBudget:1500000};
    await page.locator('.cashflow-import-area summary').click();
    await page.locator('#cashflow-import').setInputFiles({name:'plan.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(plan))});
    await page.waitForFunction(()=>document.querySelectorAll('.cashflow-row').length===2);
    assert.equal(await page.locator('#cashflow-additionalSaving').textContent(),'2,500,000원');
    await page.locator('#cashflow-save').click();
    await page.waitForFunction(()=>document.querySelector('#cashflow-message').textContent.includes('저장했어요'));
    assert.equal(await page.evaluate(()=>window.cashflowFixture.state().transactions.length),0);
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
    await page.locator('#month-next').click();
    assert.equal(await page.locator('.cashflow-row').count(),0);
    await page.locator('#cashflow-copy').click();
    assert.equal(await page.locator('.cashflow-row').count(),2);
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
    console.log('Cashflow browser smoke passed: import, save, failure, validation, months, copy, busy state, mobile, logout');
  } finally {if (browser) await browser.close(); await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
