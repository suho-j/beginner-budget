/* Web Push UI 스모크: 로컬 정적 서버 + 헤드리스 크롬(CDP)으로
   매니페스트·서비스워커 등록·푸시 버튼 표시·콘솔 에러 없음을 확인한다.
   실제 권한 팝업과 실구독은 헤드리스에서 완료할 수 없어 범위에서 제외한다. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const CHROMIUM = process.env.NOTIF_CHROMIUM_PATH
  || (fs.existsSync('/home/hatch/workspace/hermes-agent-test/data/tools/chromium-1208/chrome-linux64/chrome')
    ? '/home/hatch/workspace/hermes-agent-test/data/tools/chromium-1208/chrome-linux64/chrome'
    : '/tmp/budget-chromium');

const TYPES = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.json': 'application/json'
};

function serveStatic() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html');
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(filename, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', TYPES[path.extname(filename)] || 'text/html');
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function freePort() {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('timeout: ' + label);
    await new Promise((r) => setTimeout(r, 200));
  }
}

(async () => {
  const server = await serveStatic();
  const appUrl = 'http://127.0.0.1:' + server.address().port + '/';
  const debugPort = await freePort();
  const chrome = spawn(CHROMIUM, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-proxy-server',
    '--remote-debugging-port=' + debugPort, '--remote-debugging-address=127.0.0.1',
    '--user-data-dir=' + fs.mkdtempSync('/tmp/push-smoke-'), 'about:blank'
  ], { stdio: 'ignore' });
  try {
    const targets = await waitFor(async () => {
      try {
        const res = await fetch('http://127.0.0.1:' + debugPort + '/json/list');
        const list = await res.json();
        return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null;
      } catch (_) { return null; }
    }, 15000, 'devtools target');

    const ws = new WebSocket(targets.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let seq = 0;
    const pending = new Map();
    const errors = [];
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text || 'exception');
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
      }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (res.result && res.result.exceptionDetails) {
        throw new Error('evaluate failed: ' + (res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text));
      }
      return res.result.result.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://cdn.jsdelivr.net/*', requestStage: 'Request' }] });
    ws.addEventListener('message', async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Fetch.requestPaused') {
        await send('Fetch.fulfillRequest', {
          requestId: msg.params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }],
          body: Buffer.from('').toString('base64')
        });
      }
    });

    await send('Page.navigate', { url: appUrl });
    await waitFor(() => evaluate("document.readyState === 'complete' && !!window.BudgetPush"),
      15000, 'page load');

    // 매니페스트 link와 실제 매니페스트 내용
    assert.equal(await evaluate("document.querySelector('link[rel=\"manifest\"]').getAttribute('href')"), 'manifest.webmanifest');
    const manifest = await evaluate("fetch('manifest.webmanifest').then((r) => r.json())");
    assert.equal(manifest.name, '처음 가계부');
    assert.equal(manifest.display, 'standalone');

    // 서비스워커가 등록된다 (push.js init)
    const registered = await waitFor(() => evaluate(
      "navigator.serviceWorker.getRegistration().then((r) => Boolean(r && r.active || r && (r.installing || r.waiting)))"
    ), 15000, 'service worker registration').catch(() => null);
    assert.ok(registered, '서비스워커가 등록돼야 해요');
    assert.equal(await evaluate(
      "navigator.serviceWorker.getRegistration().then((r) => new URL(r.active ? r.active.scriptURL : r.installing.scriptURL).pathname)"
    ), '/sw.js');

    // 푸시 컨트롤은 알림 패널 상단과 설정 탭, 두 곳에 있다
    assert.equal(await evaluate("document.querySelectorAll('[data-push-control]').length"), 2);
    assert.equal(await evaluate("!!document.querySelector('#notification-panel [data-push-toggle]')"), true);
    assert.equal(await evaluate("!!document.querySelector('#panel-settings [data-push-toggle]')"), true);
    // 알림 패널에서는 목록보다 위에 있다
    assert.equal(await evaluate(
      "(document.getElementById('notification-list').compareDocumentPosition("
      + "document.querySelector('#notification-panel [data-push-control]'))"
      + " & Node.DOCUMENT_POSITION_PRECEDING) !== 0"
    ), true, '패널 푸시 컨트롤은 알림 목록보다 위에 있어야 해요');

    // 알림 패널을 열면 상태 문구가 채워진다
    await evaluate("document.getElementById('notification-button').click()");
    assert.equal(await evaluate("document.getElementById('notification-panel').hidden"), false);
    const statusText = await waitFor(async () => {
      const text = await evaluate("document.querySelector('#notification-panel [data-push-status]').textContent");
      return text && !text.includes('확인하고 있어요') ? text : null;
    }, 15000, 'push status text');
    assert.match(statusText, /폰 푸시/, '상태 문구가 채워져야 해요: ' + statusText);
    assert.equal(await evaluate("(async () => Boolean((await navigator.serviceWorker.getRegistration()).pushManager))()"), true);

    // 설정 탭에서도 보이고, 두 인스턴스의 표시가 항상 같다(동기화)
    await evaluate("document.getElementById('tab-settings').click()");
    assert.equal(await evaluate("document.getElementById('panel-settings').hidden"), false);
    const readInstances = "() => [...document.querySelectorAll('[data-push-control]')].map((root) => ({"
      + " status: root.querySelector('[data-push-status]').textContent,"
      + " label: root.querySelector('[data-push-toggle]').textContent,"
      + " disabled: root.querySelector('[data-push-toggle]').disabled }))";
    const sameInstances = (list) => list.length === 2
      && list.every((item) => item.status === list[0].status && item.label === list[0].label
        && item.disabled === list[0].disabled && !item.status.includes('확인하고 있어요'));
    assert.equal(await evaluate(`(${readInstances})().length`), 2);
    assert.ok(sameInstances(await evaluate(`(${readInstances})()`)), '두 인스턴스 표시가 같아야 해요');
    // 한쪽 버튼을 눌러도(가능한 경우) 다른 쪽 표시가 함께 갱신된다
    if (await evaluate("!document.querySelector('#panel-settings [data-push-toggle]').disabled")) {
      await evaluate("document.querySelector('#panel-settings [data-push-toggle]').click()");
      const synced = await waitFor(async () => {
        const list = await evaluate(`(${readInstances})()`);
        return sameInstances(list) ? list : null;
      }, 15000, 'push instances sync after click').catch(() => null);
      assert.ok(synced, '클릭 뒤에도 두 인스턴스 표시가 같아야 해요');
    }

    // 모바일 360px에서 가로 넘침 없음
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, '360px 가로 넘침 없음');

    assert.deepEqual(errors, [], '콘솔/페이지 에러가 없어야 해요: ' + errors.join(' | '));
    ws.close();
    console.log('PASS: manifest, service worker registration, push toggle/status, 360px, no console errors');
  } finally {
    chrome.kill('SIGKILL');
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
