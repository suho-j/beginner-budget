/* 알림 UI 스모크: 로컬 정적 서버 + 헤드리스 크롬(CDP)으로
   종 버튼·패널·리포트 카드 DOM과 콘솔 에러 없음을 확인한다. (로그인 없는 범위) */
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

function serveStatic() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html');
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(filename, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', filename.endsWith('.js') ? 'application/javascript'
        : filename.endsWith('.css') ? 'text/css' : 'text/html');
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
    '--user-data-dir=' + fs.mkdtempSync('/tmp/notif-smoke-'), 'about:blank'
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
    await waitFor(() => evaluate("document.readyState === 'complete' && !!document.getElementById('notification-button')"),
      15000, 'page load');

    // 헤더 종 버튼과 배지, 패널, 리포트 카드 존재
    assert.equal(await evaluate("!!document.getElementById('notification-button')"), true);
    assert.equal(await evaluate("document.getElementById('notification-panel').hidden"), true, '패널은 처음에 숨김');
    assert.equal(await evaluate("!!document.getElementById('daily-report-card')"), true);
    assert.match(await evaluate("document.getElementById('daily-report-period').textContent"), /^기간 \d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/,
      '리포트 카드 기간이 채워져야 해요');
    // 로그인 전에도 오늘 리포트 알림 1건이 목록에 있고 배지가 보인다
    assert.equal(await evaluate("document.querySelectorAll('#notification-list .notification-item').length"), 1);
    assert.match(await evaluate("document.querySelector('#notification-list .notification-item').textContent"), /리포트/);
    assert.equal(await evaluate("document.getElementById('notification-count').hidden"), false);

    // 종 버튼을 누르면 패널이 열리고, 모두 읽음을 누르면 배지가 사라진다
    await evaluate("document.getElementById('notification-button').click()");
    assert.equal(await evaluate("document.getElementById('notification-panel').hidden"), false);
    assert.equal(await evaluate("document.getElementById('notification-button').getAttribute('aria-expanded')"), 'true');
    await evaluate("document.getElementById('notification-mark-all').click()");
    assert.equal(await evaluate("document.getElementById('notification-count').hidden"), true, '모두 읽음 뒤 배지 숨김');
    // 읽음 상태는 id만 localStorage에 남는다 (금액·메모 저장 없음)
    const stored = await evaluate("localStorage.getItem('beginner-budget.notification-seen.v1') || ''");
    assert.match(stored, /report:/);
    assert.doesNotMatch(stored, /원|금액|메모/);

    // 모바일 360px에서 가로 넘침 없음
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, '360px 가로 넘침 없음');

    assert.deepEqual(errors, [], '콘솔/페이지 에러가 없어야 해요: ' + errors.join(' | '));
    ws.close();
    console.log('PASS: notification bell, panel, mark-all, seen-id storage, report card, 360px, no console errors');
  } finally {
    chrome.kill('SIGKILL');
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
