const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {buildStatusProject,buildRepairProject} = require('../tasker/build-project.cjs');

(async () => {
  const html=fs.readFileSync(path.resolve(__dirname,'../artifacts/tasker-guide/diagnose.html'));
  const repairHtml=fs.readFileSync(path.resolve(__dirname,'../artifacts/tasker-guide/repair.html'));
  const project=buildStatusProject();
  const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(req.url==='/repair.html'?repairHtml:html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=process.env.TASKER_STATUS_BASE_URL||'http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:360,height:800},acceptDownloads:true});
    const errors=[], requests=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    page.on('request',request=>requests.push({url:request.url(),type:request.resourceType()}));
    await page.goto(base);
    assert.ok(await page.locator('#install').isVisible());
    assert.ok(!await page.locator('#result').isVisible());
    assert.equal(await page.locator('#import-status').getAttribute('href'),project.uri);
    const downloadPromise=page.waitForEvent('download');
    await page.locator('#download-status').click();
    const download=await downloadPromise;
    assert.equal(download.suggestedFilename(),'Budget-Status.prj.xml');
    assert.equal(fs.readFileSync(await download.path(),'utf8'),project.xml);
    for(const width of [800,360,320]){
      await page.setViewportSize({width,height:800});
      await page.locator('details').evaluateAll(nodes=>nodes.forEach(node=>{node.open=true;}));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    const output=path.resolve(__dirname,'../.tmp/phone-tests');fs.mkdirSync(output,{recursive:true});
    await page.setViewportSize({width:360,height:800});
    await page.locator('details').evaluateAll(nodes=>nodes.forEach(node=>{node.open=false;}));
    await page.screenshot({path:path.join(output,'status-install.png'),fullPage:true});
    const report=async values=>{
      const hash=new URLSearchParams({v:'2',connection:'ready',queue:'0',last:'unknown',at:'',...values});
      // A new navigation executes the page script even when only the fragment changes.
      await page.goto(base+'#'+hash);await page.reload();
      assert.ok(await page.locator('#result').isVisible());
      assert.ok(!await page.locator('#install').isVisible());
    };
    await report({last:'sent',at:'2026-10-16T13:57:39.000Z'});
    assert.equal(await page.locator('#version').innerText(),'진단 수정판 2');
    assert.equal(await page.locator('#connection').innerText(),'통과 기록 있음');
    assert.equal(await page.locator('#queue').innerText(),'0개');
    assert.equal(await page.locator('#last').innerText(),'마지막 전송 성공');
    assert.ok((await page.locator('#sent-at').innerText()).includes('한국 시간'));
    assert.ok((await page.locator('#next').innerText()).includes('알림 읽기 권한'));
    await page.screenshot({path:path.join(output,'status-result.png'),fullPage:true});
    await report({queue:'3',last:'send_wait'});
    assert.ok((await page.locator('#next').innerText()).includes('BB 보내기'));
    await report({connection:'waiting'});
    assert.ok((await page.locator('#next').innerText()).includes('BB 시작'));
    await report({last:'capture_error'});
    assert.ok((await page.locator('#next').innerText()).includes('보관하는 단계'));
    await report({connection:'script_error',queue:'invalid'});
    assert.ok((await page.locator('#next').innerText()).includes('JavaScriptlet'));
    await report({v:'1',connection:'script_error',queue:'invalid'});
    assert.ok(await page.locator('#repair-link').isVisible());
    assert.ok((await page.locator('#next').innerText()).includes('초기값'));
    await report({queue:'invalid'});
    assert.ok((await page.locator('#next').innerText()).includes('지우기 전에'));
    for(const values of [{connection:'<img src=x onerror="window.injected=true">'},
      {queue:'201'},{last:'__proto__'},{at:'2026-02-31T00:00:00.000Z'},
      {raw:'PRIVATE-NOTIFICATION'}]){
      await report(values);
      assert.equal(await page.locator('#result-title').innerText(),'진단 결과를 읽지 못했어요.');
      assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE-NOTIFICATION'));
      assert.equal(await page.locator('img').count(),0);
      assert.equal(await page.evaluate(()=>Boolean(window.injected)),false);
    }
    await report({last:'sent',at:'2026-10-16T13:57:39.000Z'});
    for(const width of [800,360,320]){
      await page.setViewportSize({width,height:800});
      await page.locator('details').evaluateAll(nodes=>nodes.forEach(node=>{node.open=true;}));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(()=>document.activeElement!==document.body));
    await page.goto(new URL('./repair.html',base).href);
    const repair=buildRepairProject();
    assert.equal(await page.locator('#import-repair').getAttribute('href'),repair.uri);
    const repairDownloadPromise=page.waitForEvent('download');
    await page.locator('#download-repair').click();
    const repairDownload=await repairDownloadPromise;
    assert.equal(repairDownload.suggestedFilename(),'Budget-Repair.prj.xml');
    assert.equal(fs.readFileSync(await repairDownload.path(),'utf8'),repair.xml);
    assert.ok((await page.locator('body').innerText()).includes('BB 보내기'));
    for(const width of [800,360,320]){
      await page.setViewportSize({width,height:800});
      await page.locator('details').evaluateAll(nodes=>nodes.forEach(node=>{node.open=true;}));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    await page.setViewportSize({width:360,height:800});
    await page.locator('details').evaluateAll(nodes=>nodes.forEach(node=>{node.open=false;}));
    await page.screenshot({path:path.join(output,'status-repair.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    assert.ok(requests.every(request=>request.type==='document'&&new URL(request.url).origin===new URL(base).origin),
      'The status page must not send status or notification data through a background request');
    console.log('PASS: status and repair pages, exact imports/downloads, v1/v2 failure states, no reflected data or background requests, 800/360/320px, keyboard, no console errors. Android repair import remains untested.');
  } finally {
    await browser.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
