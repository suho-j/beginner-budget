const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {buildProject} = require('../tasker/build-project.cjs');

(async () => {
  const output = path.resolve(__dirname,'../artifacts/tasker-guide/install.html');
  const html=fs.readFileSync(output);
  const project=buildProject();
  const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:800,height:1000},acceptDownloads:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port);
    assert.equal(await page.locator('#import').getAttribute('href'),project.uri);
    for(const width of [800,360,320]) {
      await page.setViewportSize({width,height:1000});
      await page.locator('details').evaluateAll(nodes=>nodes.forEach(n=>{n.open=true;}));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    const downloadPromise=page.waitForEvent('download');
    await page.locator('#download').click();
    const download=await downloadPromise;
    assert.equal(download.suggestedFilename(),'Budget-Auto.prj.xml');
    assert.equal(fs.readFileSync(await download.path(),'utf8'),project.xml);
    assert.ok(await page.getByText('가계부 서버 연결 준비 완료',{exact:true}).isVisible());
    assert.ok(await page.getByText('실제 갤럭시 알림 수신은 폰에서 확인해야 합니다.',{exact:false}).isVisible());
    assert.deepEqual(errors,[]);
    console.log('PASS: installer 800/360/320px, native import URI, exact XML download, no script errors. Android launch is not tested.');
  } finally {
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
