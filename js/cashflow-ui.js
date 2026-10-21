(function (window, document) {
  'use strict';
  const S = window.BudgetStorage;
  let api, month = '', source = '', dirty = false, saving = false;
  const el = id => document.getElementById(id);
  const money = n => new Intl.NumberFormat('ko-KR').format(n) + '원';
  function message(text) { el('cashflow-message').textContent = text; }
  function read() {
    return {livingBudget: el('cashflow-living').value, items: Array.from(el('cashflow-rows').children).map(row => ({
      name: row.querySelector('[data-field="name"]').value,
      kind: row.querySelector('select').value,
      amount: row.querySelector('[data-field="amount"]').value
    }))};
  }
  function summary() {
    const totals = S.summarizeCashflow(read());
    for (const key of ['income', 'committed', 'available', 'additionalSaving']) {
      el('cashflow-' + key).textContent = totals ? money(totals[key]) : '입력 확인';
    }
    el('cashflow-shortfall').textContent = totals && totals.additionalSaving < 0
      ? '예산이 수입을 넘었어요. 생활비나 다른 배분액을 줄여 주세요.' : '';
  }
  function changed() { dirty = true; message('수정 중 · 저장하면 선택한 달의 계획에 반영돼요.'); summary(); }
  function row(item) {
    const container = document.createElement('div'); container.className = 'cashflow-row';
    for (const [field, label] of [['kind','구분'], ['name','항목'], ['amount','월 금액']]) {
      const wrapper = document.createElement('label');
      const caption = document.createElement('span'); caption.textContent = label;
      const input = document.createElement(field === 'kind' ? 'select' : 'input'); input.dataset.field = field;
      if (field === 'kind') {
        for (const [value, text] of Object.entries(S.CASHFLOW_KINDS)) {
          const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option);
        }
      } else {
        input.type = 'text'; input.required = true;
        if (field === 'amount') input.inputMode = 'numeric'; else input.maxLength = 80;
      }
      input.value = item[field]; wrapper.append(caption, input); container.append(wrapper);
    }
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'secondary'; remove.textContent = '삭제';
    remove.setAttribute('aria-label', (item.name || '새 항목') + ' 삭제');
    remove.addEventListener('click', () => {container.remove(); changed(); el('cashflow-add').focus();});
    container.append(remove); el('cashflow-rows').append(container);
  }
  function fill(plan) {
    el('cashflow-rows').replaceChildren(); plan.items.forEach(row);
    el('cashflow-living').value = plan.livingBudget; summary();
  }
  function render(state, selectedMonth) {
    const plan = state.cashflowPlans[selectedMonth] || {items: [], livingBudget: 0};
    const nextSource = JSON.stringify(plan);
    if (month !== selectedMonth || source !== nextSource) {
      month = selectedMonth; source = nextSource; dirty = false;
      el('cashflow-month').textContent = selectedMonth + ' 월 현금흐름'; fill(plan); message('');
    }
  }
  function init(callbacks) {
    api = callbacks;
    el('cashflow-rows').addEventListener('input', changed);
    el('cashflow-living').addEventListener('input', changed);
    el('cashflow-add').addEventListener('click', () => {
      if (el('cashflow-rows').children.length >= 100) { message('항목은 100개까지 입력할 수 있어요.'); return; }
      row({kind:'fixed',name:'',amount:0}); changed();
      el('cashflow-rows').lastElementChild.querySelector('[data-field="name"]').focus();
    });
    el('cashflow-undo').addEventListener('click', () => {fill(JSON.parse(source)); dirty = false; message('저장된 계획으로 되돌렸어요.');});
    el('cashflow-copy').addEventListener('click', () => {
      const plan = api.getState().cashflowPlans[S.addMonthsToMonth(month, -1)];
      if (!plan) {message('이전 달에 저장된 계획이 없어요.'); return;}
      if (!window.confirm('현재 입력을 이전 달 계획으로 바꿀까요? 저장 전까지 확정되지 않아요.')) return;
      fill(plan); changed();
    });
    el('cashflow-import').addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      const importMonth = month;
      try {
        if (file.size > 100000) throw new Error('파일은 100KB 이하로 선택해 주세요.');
        const plan = S.normalizeCashflowPlan(JSON.parse(await file.text()));
        if (month !== importMonth || saving) return;
        if (!plan) throw new Error('항목명·구분·0 이상의 정수 금액을 확인해 주세요.');
        if (el('cashflow-rows').children.length && !window.confirm('현재 입력을 파일의 계획으로 바꿀까요? 실제 거래는 변경되지 않아요.')) return;
        fill(plan); changed();
      } catch (error) {message('불러오기 실패: ' + error.message);}
      event.target.value = '';
    });
    el('cashflow-form').addEventListener('submit', async event => {
      event.preventDefault(); if (saving) return;
      const plan = S.normalizeCashflowPlan(read());
      if (!plan) {message('항목명과 금액을 확인해 주세요. 금액은 쉼표를 포함한 0 이상의 정수로 입력해 주세요.'); return;}
      saving = true; el('cashflow-editor').disabled = true;
      el('cashflow-save').setAttribute('aria-busy', 'true');
      try {
        const saved = await api.save(month, plan);
        if (saved) {dirty = false; source = JSON.stringify(plan); message(month + ' 계획을 저장했어요. 실제 거래는 변경하지 않았어요.');}
      } finally {
        saving = false; el('cashflow-editor').disabled = false;
        el('cashflow-save').removeAttribute('aria-busy');
      }
    });
    window.addEventListener('beforeunload', event => {if (dirty) {event.preventDefault(); event.returnValue = '';}});
    for (const id of ['month-previous','month-next','month-current','filter-month','cloud-download-button','cloud-logout-button']) {
      const target = el(id); if (!target) continue;
      target.addEventListener(id === 'filter-month' ? 'change' : 'click', event => {
        if (saving) {
          event.stopImmediatePropagation(); event.preventDefault();
          if (id === 'filter-month') target.value = month;
          return;
        }
        if (dirty && !window.confirm('저장하지 않은 현금흐름 수정 내용을 버리고 이동할까요?')) {
          event.stopImmediatePropagation(); event.preventDefault(); if (id === 'filter-month') target.value = month;
        }
      }, true);
    }
  }
  window.BudgetCashflowUI = {init, render};
})(window, document);
