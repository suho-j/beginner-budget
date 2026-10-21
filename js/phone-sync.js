/* Phone pairing and inbox. No financial data or device keys in localStorage. */
(function (window, document) {
  'use strict';
  let userId = null;
  let ready = false;
  let busy = false;
  let generation = 0;
  const byId = id => document.getElementById(id);
  const cloud = () => window.BudgetCloud;
  const environment = () => cloud().ENVIRONMENT.name;
  function message(text) { byId('phone-message').textContent = text; }
  function updateButtons() {
    const panel = byId('phone-panel');
    if (panel) panel.querySelectorAll('button, input, select').forEach(control => {
      control.disabled = !ready || busy;
    });
  }
  function setSession(user, readiness) {
    const nextId = user && user.id || null;
    if (nextId !== userId) {
      generation += 1;
      userId = nextId;
      if (byId('phone-config')) {
        byId('phone-config').value = '';
        byId('phone-config-wrap').hidden = true;
        byId('phone-inbox').replaceChildren();
        message('');
      }
    }
    ready = Boolean(userId) && readiness === 'ready';
    updateButtons();
  }
  function explainError(error) {
    if (['PGRST202', '42P01'].includes(error && error.code)) {
      return '휴대폰 연결 준비가 아직 끝나지 않았어요. 설정 안내를 확인해 주세요.';
    }
    return '처리하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.';
  }
  async function operation(action) {
    if (!ready || busy) return;
    const ownGeneration = generation;
    busy = true;
    updateButtons();
    message('처리 중이에요…');
    try {
      await action(() => ownGeneration === generation && Boolean(userId));
    } catch (error) {
      if (ownGeneration === generation) message(explainError(error));
    } finally {
      busy = false;
      updateButtons();
    }
  }
  async function rpc(name, args) {
    const result = await cloud().getClient().rpc(name, args);
    if (result.error) throw result.error;
    return result.data;
  }
  function hex(bytes) { return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''); }
  function connect() {
    return operation(async active => {
      const token = hex(window.crypto.getRandomValues(new Uint8Array(32)));
      const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      await rpc('register_phone_device', {p_token_hash:hex(new Uint8Array(digest)), p_environment:environment()});
      if (!active()) return;
      byId('phone-config').value = JSON.stringify({
        version:1, endpoint:cloud().SUPABASE_URL + '/rest/v1/rpc/receive_phone_event',
        public_key:cloud().SUPABASE_ANON_KEY, device_token:token, connection_id:hex(new Uint8Array(digest)), environment:environment()
      }, null, 2);
      byId('phone-config-wrap').hidden = false;
      message('연결 설정을 만들었어요. Tasker 설정에 복사해 주세요. 이전 연결키는 사용할 수 없어요.');
      byId('phone-config').focus();
    });
  }
  function revoke() {
    return operation(async active => {
      await rpc('revoke_phone_device', {p_environment:environment()});
      if (!active()) return;
      byId('phone-config').value = '';
      byId('phone-config-wrap').hidden = true;
      message('휴대폰 연결을 해제했어요. 이미 받은 알림은 남아 있어요.');
    });
  }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function renderInbox(rows) {
    const list = byId('phone-inbox');
    list.replaceChildren();
    if (!rows.length) {
      list.append(element('p', '아직 받은 알림이 없어요. Tasker의 시험 전송부터 해보세요.'));
      return;
    }
    rows.forEach(row => {
      const card = element('article', undefined, 'phone-event');
      card.append(element('h3', row.status === 'pending' ? '검토할 알림' : '처리한 알림'));
      card.append(element('p', '폰 수집 시각: ' + new Date(row.captured_at).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'}), 'muted'));
      card.append(element('pre', row.text, 'phone-raw'));
      const review = element('button', '분류 탭에서 검토', 'secondary');
      review.type = 'button';
      review.addEventListener('click', () => byId('tab-review').click());
      card.append(review);list.append(card);
    });
    updateButtons();
  }
  async function fetchInbox(active) {
    const result = await cloud().getClient().from('phone_inbox')
      .select('event_id, kind, captured_at, text, status')
      .eq('user_id', userId).eq('environment', environment())
      .order('received_at', {ascending:false}).limit(50);
    if (result.error) throw result.error;
    if (active()) renderInbox(result.data || []);
  }
  document.addEventListener('DOMContentLoaded', () => {
    byId('phone-connect').addEventListener('click', connect);
    byId('phone-revoke').addEventListener('click', revoke);
    byId('phone-refresh').addEventListener('click', () => operation(async active => {
      await fetchInbox(active);
      if (active()) message('최근 알림 최대 50건을 불러왔어요. 분류 탭에서 반영 방법과 내용을 선택해 주세요.');
    }));
    updateButtons();
  });
  window.BudgetPhoneSync = {setSession};
})(window, document);
