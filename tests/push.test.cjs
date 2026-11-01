const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ctx = vm.createContext({ window: {}, console, atob, btoa, URL });
ctx.window.window = ctx.window;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'push.js'), 'utf8'), ctx, { filename: 'js/push.js' });
const P = ctx.window.BudgetPush;
assert.ok(P, 'BudgetPush 모듈이 있어야 해요');
assert.equal(typeof P.subscriptionToRow, 'function');
assert.equal(typeof P.urlBase64ToUint8Array, 'function');
assert.equal(typeof P.describePushState, 'function');
assert.equal(typeof P.isMissingTableError, 'function');

// --- VAPID 공개키 상수: url-safe base64, 65바이트(0x04 시작) P-256 공개키 ---
{
  assert.equal(typeof P.VAPID_PUBLIC_KEY, 'string');
  assert.match(P.VAPID_PUBLIC_KEY, /^[A-Za-z0-9_-]+$/);
  const bytes = P.urlBase64ToUint8Array(P.VAPID_PUBLIC_KEY);
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 0x04);
}

// --- urlBase64ToUint8Array: 패딩 없는 입력과 라운드트립 ---
{
  const original = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const encoded = Buffer.from(original).toString('base64url');
  assert.deepEqual([...P.urlBase64ToUint8Array(encoded)], [...original]);
  assert.deepEqual([...P.urlBase64ToUint8Array('')], []);
  assert.equal(P.urlBase64ToUint8Array(null), null);
  assert.equal(P.urlBase64ToUint8Array(42), null);
}

// --- subscriptionToRow: PushSubscription JSON -> DB 행 ---
{
  const sub = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    expirationTime: null,
    keys: { p256dh: 'BExampleP256dhKey', auth: 'exampleAuthSecret' }
  };
  const row = P.subscriptionToRow(sub, { userId: 'user-1', userAgent: 'Android Chrome', now: '2026-11-01T00:00:00.000Z' });
  assert.deepEqual(JSON.parse(JSON.stringify(row)), {
    user_id: 'user-1',
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    p256dh: 'BExampleP256dhKey',
    auth: 'exampleAuthSecret',
    user_agent: 'Android Chrome',
    updated_at: '2026-11-01T00:00:00.000Z'
  });
  // toJSON() 형태도 받는다
  const viaJson = P.subscriptionToRow({ toJSON: () => sub }, { userId: 'user-1', userAgent: '', now: '2026-11-01T00:00:00.000Z' });
  assert.equal(viaJson.endpoint, sub.endpoint);
  assert.equal(viaJson.user_agent, null, '빈 userAgent는 null');
  // 잘못된 입력은 null
  assert.equal(P.subscriptionToRow(null, { userId: 'user-1' }), null);
  assert.equal(P.subscriptionToRow({ endpoint: 'https://x' }, { userId: 'user-1' }), null, '키가 없으면 null');
  assert.equal(P.subscriptionToRow(sub, { userId: '' }), null, 'userId가 없으면 null');
  assert.equal(P.subscriptionToRow({ endpoint: 'not-a-url', keys: sub.keys }, { userId: 'user-1' }), null, 'endpoint는 https URL');
}

// --- describePushState: 상태별 문구·버튼 ---
{
  const unsupported = P.describePushState({ supported: false, permission: 'default', subscribed: false });
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.buttonDisabled, true);
  assert.match(unsupported.message, /쓸 수 없어요/);

  const denied = P.describePushState({ supported: true, permission: 'denied', subscribed: false });
  assert.equal(denied.status, 'denied');
  assert.match(denied.message, /권한/);

  const on = P.describePushState({ supported: true, permission: 'granted', subscribed: true });
  assert.equal(on.status, 'on');
  assert.equal(on.buttonLabel, '폰 푸시 끄기');
  assert.equal(on.buttonDisabled, false);

  const off = P.describePushState({ supported: true, permission: 'default', subscribed: false });
  assert.equal(off.status, 'off');
  assert.equal(off.buttonLabel, '폰 푸시 켜기');
  assert.equal(off.buttonDisabled, false);
}

// --- isMissingTableError: SQL 미실행(테이블 없음) 판별 ---
{
  assert.equal(P.isMissingTableError({ code: '42P01', message: 'relation "public.push_subscriptions" does not exist' }), true);
  assert.equal(P.isMissingTableError({ code: 'PGRST205', message: "Could not find the table 'public.push_subscriptions' in the schema cache" }), true);
  assert.equal(P.isMissingTableError({ code: '42501', message: 'permission denied' }), false);
  assert.equal(P.isMissingTableError(null), false);
  assert.equal(P.isMissingTableError(new Error('network')), false);
}

console.log('Push: subscription/state/error helpers passed');
