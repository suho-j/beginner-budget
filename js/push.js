/* beginner-budget-app push.js
   Web Push(알림 2차): 이 기기의 푸시 구독을 켜고 끄는 UI와 순수 변환 로직.
   구독 정보는 Supabase push_subscriptions 테이블(본인 행만, RLS)에 저장한다.
   실제 발송은 서버 쪽 스크립트가 보안 정의자 RPC로 구독을 조회해 보낸다. */
(function (window, document) {
  'use strict';

  // VAPID 공개키 (공개돼도 되는 값). 개인키는 서버 발송 스크립트에만 있다.
  const VAPID_PUBLIC_KEY = 'BDCaWUK3gE-_ZLalN0fs7wEjjqrHXjRuWE8DHb_qcoeUVYXYCh5ZX2kUR1YV_qwIlfJgNlOsGzAKylTuWCy4l3A';
  const TABLE = 'push_subscriptions';

  function urlBase64ToUint8Array(base64String) {
    if (typeof base64String !== 'string') return null;
    if (base64String === '') return new Uint8Array(0);
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const decode = typeof atob === 'function' ? atob
      : (window && typeof window.atob === 'function' ? window.atob : null);
    if (!decode) return null;
    let raw;
    try { raw = decode(base64); } catch (_) { return null; }
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
    return output;
  }

  function subscriptionToRow(subscription, options = {}) {
    let json = subscription;
    if (json && typeof json.toJSON === 'function') {
      try { json = json.toJSON(); } catch (_) { return null; }
    }
    if (!json || typeof json !== 'object') return null;
    const endpoint = typeof json.endpoint === 'string' ? json.endpoint : '';
    const keys = json.keys && typeof json.keys === 'object' ? json.keys : {};
    const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : '';
    const auth = typeof keys.auth === 'string' ? keys.auth : '';
    const userId = typeof options.userId === 'string' ? options.userId : '';
    if (!userId || !p256dh || !auth) return null;
    try {
      if (new URL(endpoint).protocol !== 'https:') return null;
    } catch (_) { return null; }
    const ua = typeof options.userAgent === 'string' ? options.userAgent.trim() : '';
    return {
      user_id: userId,
      endpoint,
      p256dh,
      auth,
      user_agent: ua ? ua.slice(0, 300) : null,
      updated_at: typeof options.now === 'string' && options.now ? options.now : new Date().toISOString()
    };
  }

  function describePushState(state = {}) {
    if (!state.supported) {
      return {
        status: 'unsupported',
        message: '이 브라우저에서는 폰 푸시를 쓸 수 없어요.',
        buttonLabel: '폰 푸시 켜기',
        buttonDisabled: true
      };
    }
    if (state.permission === 'denied') {
      return {
        status: 'denied',
        message: '알림 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 알림을 허용해 주세요.',
        buttonLabel: '폰 푸시 켜기',
        buttonDisabled: true
      };
    }
    if (state.subscribed) {
      return {
        status: 'on',
        message: '폰 푸시가 켜져 있어요. 새 사용이 생기면 이 기기로 알려드려요.',
        buttonLabel: '폰 푸시 끄기',
        buttonDisabled: false
      };
    }
    return {
      status: 'off',
      message: '폰 푸시가 꺼져 있어요. 켜면 새 사용 알림을 이 기기로 받을 수 있어요.',
      buttonLabel: '폰 푸시 켜기',
      buttonDisabled: false
    };
  }

  function isMissingTableError(error) {
    if (!error) return false;
    if (String(error.code || '') === '42P01') return true;
    const message = String(error.message || '');
    return /push_subscriptions/.test(message)
      && /(does not exist|could not find|not find|schema cache)/i.test(message);
  }

  const api = { VAPID_PUBLIC_KEY, urlBase64ToUint8Array, subscriptionToRow, describePushState, isMissingTableError };
  window.BudgetPush = api;

  /* ---------- 브라우저 UI (Node 테스트 환경에서는 건너뜀) ---------- */
  if (!document || typeof document.getElementById !== 'function') return;

  const $ = (id) => document.getElementById(id);
  const navigatorRef = typeof navigator !== 'undefined' ? navigator : null;
  let lastState = { supported: false, permission: 'default', subscribed: false };
  let busy = false;

  function isSupported() {
    return Boolean(navigatorRef && 'serviceWorker' in navigatorRef
      && window && 'PushManager' in window && 'Notification' in window);
  }

  // 푸시 컨트롤은 알림 패널 상단과 설정 탭 두 곳에 있다. 모두 같은 상태를 그린다.
  function pushControls() {
    if (typeof document.querySelectorAll !== 'function') return [];
    return Array.from(document.querySelectorAll('[data-push-control]'))
      .map((root) => ({
        status: root.querySelector('[data-push-status]'),
        button: root.querySelector('[data-push-toggle]')
      }))
      .filter((control) => control.status && control.button);
  }

  function render(messageOverride) {
    const controls = pushControls();
    if (!controls.length) return;
    const described = describePushState(lastState);
    const message = typeof messageOverride === 'string' && messageOverride
      ? messageOverride : described.message;
    for (const control of controls) {
      control.status.textContent = message;
      control.button.textContent = described.buttonLabel;
      control.button.disabled = busy || described.buttonDisabled;
    }
  }

  async function readState() {
    if (!isSupported()) return { supported: false, permission: 'default', subscribed: false };
    let subscribed = false;
    try {
      const registration = await navigatorRef.serviceWorker.getRegistration();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      subscribed = Boolean(subscription);
    } catch (_) { /* 구독 조회 실패는 꺼짐으로 본다 */ }
    return { supported: true, permission: window.Notification.permission, subscribed };
  }

  async function refresh(messageOverride) {
    lastState = await readState();
    render(messageOverride);
  }

  function failMessage(error) {
    if (isMissingTableError(error)) return '아직 푸시 준비가 끝나지 않았어요. 잠시 뒤 다시 시도해 주세요.';
    return '폰 푸시를 바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  }

  async function enable() {
    busy = true;
    render();
    try {
      const permission = await window.Notification.requestPermission();
      if (permission !== 'granted') {
        busy = false;
        await refresh(permission === 'denied'
          ? '알림 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 알림을 허용해 주세요.'
          : '알림 권한을 허용해야 폰 푸시를 켤 수 있어요.');
        return;
      }
      const registration = await navigatorRef.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }
      const cloud = window.BudgetCloud;
      const user = cloud && typeof cloud.currentUser === 'function' ? await cloud.currentUser() : null;
      if (!user) {
        busy = false;
        await refresh('먼저 로그인해 주세요.');
        return;
      }
      const row = subscriptionToRow(subscription, { userId: user.id, userAgent: navigatorRef.userAgent });
      if (!row) throw new Error('invalid subscription');
      const result = await cloud.getClient().from(TABLE).upsert(row, { onConflict: 'endpoint' });
      if (result.error) throw result.error;
      busy = false;
      await refresh('폰 푸시가 켜졌어요.');
    } catch (error) {
      busy = false;
      render(failMessage(error));
    }
  }

  async function disable() {
    busy = true;
    render();
    try {
      const registration = await navigatorRef.serviceWorker.getRegistration();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) {
        const cloud = window.BudgetCloud;
        if (cloud && typeof cloud.getClient === 'function' && cloud.getClient()) {
          await cloud.getClient().from(TABLE).delete().eq('endpoint', subscription.endpoint);
        }
        await subscription.unsubscribe();
      }
      busy = false;
      await refresh('폰 푸시가 꺼졌어요.');
    } catch (_) {
      busy = false;
      render('폰 푸시를 끄지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    }
  }

  function init() {
    const controls = pushControls();
    if (!controls.length) return;
    if (isSupported()) {
      // 푸시 수신용 서비스워커 등록. 캐시는 하지 않는다(sw.js는 네트워크 기본).
      navigatorRef.serviceWorker.register('sw.js').catch(() => {});
    }
    for (const control of controls) {
      control.button.addEventListener('click', () => {
        if (busy) return;
        if (lastState.subscribed) disable();
        else enable();
      });
    }
    const bell = $('notification-button');
    if (bell) bell.addEventListener('click', () => { refresh(); });
    refresh();
  }

  document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : undefined);
