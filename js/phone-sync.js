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
  function field(form, label, name, type, index) {
    const wrapper = element('div', undefined, 'field');
    const input = document.createElement(type === 'select' ? 'select' : 'input');
    if (type !== 'select') input.type = type;
    input.id = 'phone-' + index + '-' + name;
    input.name = name;
    const title = element('label', label);
    title.htmlFor = input.id;
    wrapper.append(title, input);
    form.append(wrapper);
    return input;
  }
  function renderInbox(rows) {
    const list = byId('phone-inbox');
    list.replaceChildren();
    if (!rows.length) {
      list.append(element('p', '아직 받은 알림이 없어요. Tasker의 시험 전송부터 해보세요.'));
      return;
    }
    rows.forEach((row, index) => {
      const card = element('article', undefined, 'phone-event');
      const names = {kbank_notification:'케이뱅크 알림', eats_notification:'쿠팡이츠 알림', eats_screen:'쿠팡이츠 주문 화면'};
      card.append(element('h3', row.status === 'recorded' ? '기록한 알림' : names[row.kind] || '받은 알림'));
      card.append(element('p', '폰 수집 시각: ' + new Date(row.captured_at).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'}), 'muted'));
      card.append(element('pre', row.text, 'phone-raw'));
      const draft = window.BudgetPhoneImport.paymentDraft(row);
      card.append(element('p', draft.reason, 'hint'));
      if (row.status === 'pending' && draft.canRecordExpense) {
        const form = element('form', undefined, 'phone-record-form');
        const date = field(form, '결제일', 'date', 'date', index); date.required = true;
        const amount = field(form, '결제금액', 'amount', 'text', index);
        amount.required = true; amount.inputMode = 'numeric'; amount.pattern = '[0-9,]+';
        const category = field(form, '분류', 'category', 'select', index);
        window.BudgetStorage.EXPENSE_CATEGORIES.forEach(name => {
          const option = element('option', name); option.value = name; category.append(option);
        });
        const memo = field(form, '내용', 'memo', 'text', index); memo.maxLength = 80;
        const checkLabel = element('label', undefined, 'phone-duplicate-check');
        const check = document.createElement('input'); check.type = 'checkbox'; check.required = true;
        checkLabel.append(check, document.createTextNode('이 결제가 아직 가계부에 없는 것을 확인했어요.'));
        form.append(checkLabel);
        const save = element('button', '확인한 지출 기록'); save.type = 'submit';
        form.append(save);
        form.addEventListener('submit', event => {
          event.preventDefault();
          if (!form.reportValidity()) return;
          const value = Number(amount.value.replace(/,/g, ''));
          if (!Number.isInteger(value) || value < 1 || value > 2147483647
            || !window.BudgetStorage.isValidDateString(date.value)) {
            message('결제일과 금액을 확인해 주세요.'); return;
          }
          operation(async active => {
            await rpc('record_phone_event', {
              p_environment:environment(), p_event_id:row.event_id,
              p_transaction:{date:date.value, amount:value, category:category.value, memo:memo.value.trim()}
            });
            if (!active()) return;
            await fetchInbox(active);
            message('지출을 기록했어요.');
            byId('phone-message').focus();
            document.dispatchEvent(new Event('budget:phone-recorded'));
          });
        });
        card.append(form);
      }
      list.append(card);
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
      if (active()) message('최근 알림 최대 50건을 불러왔어요. 이체·출금·미확인 알림은 보관만 하고, 확인한 카드 결제만 기록해요.');
    }));
    updateButtons();
  });
  window.BudgetPhoneSync = {setSession};
})(window, document);
