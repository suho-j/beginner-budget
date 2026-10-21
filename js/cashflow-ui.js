(function (window, document) {
  'use strict';
  const S = window.BudgetStorage;
  let api, month = '', source = '', dirty = false, saving = false, plans = {}, view = 'table';
  const el = id => document.getElementById(id);
  const money = n => new Intl.NumberFormat('ko-KR').format(n) + '원';
  function message(text) { el('cashflow-message').textContent = text; }
  function read() {
    return {livingBudget: el('cashflow-living').value, items: Array.from(el('cashflow-rows').children).map(row => {
      const value = field => row.querySelector('[data-field="' + field + '"]')?.value;
      const item = {name: value('name'), kind: value('kind'), amount: value('amount')};
      item.schedule = Object.fromEntries(['day','rule','account','note'].map(field => [field,value(field)]));
      if (item.kind === 'fixed') item.fixedCost = Object.fromEntries(
        ['status','targetAmount','paymentDay','paymentMethod','memo'].map(field => [field, value(field)]));
      return item;
    })};
  }
  function summary() {
    const plan = read();
    const totals = S.summarizeCashflow(plan);
    for (const key of ['income', 'committed', 'available', 'additionalSaving']) {
      el('cashflow-' + key).textContent = totals ? money(totals[key]) : '입력 확인';
    }
    el('cashflow-shortfall').textContent = totals && totals.additionalSaving < 0
      ? '예산이 수입을 넘었어요. 생활비나 다른 배분액을 줄여 주세요.' : '';
    const fixed = S.summarizeFixedCosts(plan);
    for (const key of ['monthly','monthlySaving','annualSaving','afterAdditionalSaving']) {
      el('fixed-cost-' + key).textContent = fixed ? money(fixed[key]) : '입력 확인';
    }
    el('fixed-cost-ratio').textContent = fixed?.incomeRatio != null ? '수입 대비 ' + fixed.incomeRatio.toFixed(1) + '%' : '수입을 입력하면 비율을 볼 수 있어요.';
    el('fixed-cost-after').textContent = fixed ? '절감 적용 후 고정 납부 예상액 ' + money(fixed.afterMonthly) : '절감 예정 항목의 목표금액은 현재 월 금액 이하로 입력하세요.';
    schedule(plan);
  }
  function node(tag,text,className) {
    const n=document.createElement(tag); if(text!==undefined)n.textContent=text;
    if(className)n.className=className; return n;
  }
  function amountLabel(item) {
    const prefix=item.kind==='income'?'+':item.kind==='transfer'?'↔':'−';
    return prefix+money(item.amount);
  }
  function schedule(raw) {
    const plan=S.normalizeCashflowPlan(raw);
    const tableHost=el('cashflow-table-view'), calendarHost=el('cashflow-calendar-view');
    tableHost.hidden=view!=='table'; calendarHost.hidden=view!=='calendar';
    for(const key of ['table','calendar']) el('cashflow-view-'+key).setAttribute('aria-pressed',String(view===key));
    for(const id of ['cashflow-table-view','cashflow-calendar-view','cashflow-unscheduled','cashflow-shifted']) el(id).replaceChildren();
    el('cashflow-date-warning').textContent=month.startsWith('2026-')
      ? '2026년 대한민국 공휴일·은행 휴무일 기준 · 월 합계는 계획 귀속월, 아래 일정은 조정된 입출금일 기준이에요.'
      : '이 연도의 공휴일 자료는 아직 없어요. 주말만 조정되므로 공휴일과 예정일을 확인해 주세요.';
    if(!plan) {el('cashflow-date-totals').textContent='항목명과 금액을 확인하면 일정을 볼 수 있어요.';return;}
    const data=window.BudgetCashflowSchedule.events({...plans,[month]:plan},month);
    const sum=kind=>data.dated.filter(i=>kind==='income'?i.kind==='income':!['income','transfer'].includes(i.kind)).reduce((n,i)=>n+i.amount,0);
    el('cashflow-date-totals').textContent='날짜 지정분 · 수입 '+money(sum('income'))+' · 지출·배분 '+money(sum('out'))+' · 계좌 이동은 합계 제외';
    const table=node('table'); table.append(node('caption',month+' 예정 입출금'));
    const head=node('thead'), hr=node('tr');
    for(const title of ['예정일','항목 / 구분','금액','계좌·메모']) {const th=node('th',title);th.scope='col';hr.append(th);}
    head.append(hr);table.append(head);const body=node('tbody');
    for(const item of data.dated) {
      const tr=node('tr');tr.append(node('td',item.date.slice(5)));
      const name=node('td');name.append(node('strong',item.name),node('small',S.CASHFLOW_KINDS[item.kind]+(item.planMonth!==month?' · '+item.planMonth+'분':'')));
      tr.append(name,node('td',amountLabel(item),'cashflow-money '+item.kind),node('td',[item.schedule.account,item.schedule.note].filter(Boolean).join(' · ')||'—'));body.append(tr);
    }
    table.append(body);tableHost.append(table);
    if(!data.dated.length)tableHost.append(node('p','날짜가 지정된 항목이 없어요. 아래 항목·금액·예정일 수정에서 입력하세요.','hint'));
    const grid=node('div',undefined,'cashflow-calendar');
    for(const day of ['일','월','화','수','목','금','토']) grid.append(node('div',day,'cashflow-weekday'));
    const [y,m]=month.split('-').map(Number), start=new Date(Date.UTC(y,m-1,1)).getUTCDay(), last=new Date(Date.UTC(y,m,0)).getUTCDate();
    for(let i=0;i<start;i++) {const blank=node('div',undefined,'cashflow-day blank');blank.setAttribute('aria-hidden','true');grid.append(blank);}
    for(let d=1;d<=last;d++) {
      const date=month+'-'+String(d).padStart(2,'0'), box=node('section',undefined,'cashflow-day');
      box.setAttribute('aria-label',date);box.append(node('h4',String(d)));
      if(window.BudgetCashflowSchedule.holidays.has(date))box.classList.add('holiday');
      for(const item of data.dated.filter(i=>i.date===date)) {
        const card=node('div',undefined,'cashflow-event '+item.kind);
        card.append(node('span',item.name),node('strong',amountLabel(item)));
        if(item.planMonth!==month)card.append(node('small',item.planMonth+'분'));
        card.title=[S.CASHFLOW_KINDS[item.kind],item.schedule.account,item.schedule.note].filter(Boolean).join(' · ');box.append(card);
      }
      grid.append(box);
    }
    calendarHost.append(node('p','수입 + / 지출·배분 − / 계좌 이동 ↔ · 모바일에서는 달력을 좌우로 움직여 보세요.','hint'),grid);
    for(const [id,title,items] of [['cashflow-unscheduled','날짜 미정 · 월 합계에는 포함',data.undated],['cashflow-shifted','다른 달로 이동한 이달 계획',data.shifted]]) {
      if(!items.length)continue;
      el(id).append(node('h4',title));const list=node('ul');
      for(const item of items) list.append(node('li',(item.date?item.date+' · ':'')+item.name+' · '+amountLabel(item)+(item.schedule?.note?' · '+item.schedule.note:'')));
      el(id).append(list);
    }
  }
  function scheduleFields(s={}) {
    const grid=node('div',undefined,'cashflow-date-fields');
    for(const [field,label] of [['day','기준일'],['rule','휴일 처리'],['account','계좌 / 결제수단'],['note','일정 메모']]) {
      const wrap=node('label');wrap.append(node('span',label));
      const input=document.createElement(['day','rule'].includes(field)?'select':'input');input.dataset.field=field;
      if(field==='day'||field==='rule') {
        const choices=field==='day'?[['','날짜 미정'],...Array.from({length:31},(_,i)=>[String(i+1),(i+1)+'일']),['last','말일']]:[['next','다음 영업일'],['previous','이전 영업일 (급여)'],['none','조정 안 함']];
        for(const [value,text] of choices){const option=node('option',text);option.value=value;input.append(option);}
      }else{input.type='text';input.maxLength=field==='note'?200:80;}
      input.value=s[field]??(field==='rule'?'next':'');wrap.append(input);grid.append(wrap);
    }
    return grid;
  }
  function fixedDetails(detail = {}) {
    const details = document.createElement('details'); details.className = 'fixed-cost-details';
    const title = document.createElement('summary'); details.append(title);
    const grid = document.createElement('div'); grid.className = 'fixed-cost-fields';
    for (const [field, label, placeholder, maxLength] of [
      ['status','점검 상태','',''], ['targetAmount','목표 월 금액','미정이면 비워 두세요',''],
      ['paymentDay','납부일','예: 25일~말일',40], ['paymentMethod','결제수단','예: 카드 또는 계좌',40],
      ['memo','점검 메모','예: 약정 만료 후 요금제 변경',200]
    ]) {
      const wrapper = document.createElement('label');
      const caption = document.createElement('span'); caption.textContent = label;
      const input = document.createElement(field === 'status' ? 'select' : 'input'); input.dataset.field = field;
      if (field === 'status') {
        for (const [value, text] of Object.entries(S.FIXED_COST_STATUSES)) {
          const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option);
        }
      } else {
        input.type = 'text'; input.placeholder = placeholder;
        if (field === 'targetAmount') input.inputMode = 'numeric'; else input.maxLength = maxLength;
      }
      input.value = detail[field] ?? (field === 'status' ? 'keep' : '');
      if (field === 'memo') wrapper.className = 'fixed-cost-memo';
      wrapper.append(caption,input); grid.append(wrapper);
    }
    const hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = '유지·검토 중은 절감액에서 제외해요. 절감 예정은 목표금액을 입력하세요(해지 예정은 0원). 변경이 적용되면 월 금액을 수정하고 유지로 바꿔 주세요.';
    details.append(grid,hint); return details;
  }
  function syncRows() {
    let visible = 0;
    for (const row of el('cashflow-rows').children) {
      const fixed = row.querySelector('[data-field="kind"]').value === 'fixed';
      let details = row.querySelector('details');
      if (fixed && !details) {details = fixedDetails(); row.append(details);}
      if (details) {
        details.hidden = !fixed;
        const name = row.querySelector('[data-field="name"]').value.trim() || '새 항목';
        const status = details.querySelector('[data-field="status"]').value;
        details.querySelector('summary').textContent = name + ' 고정비 상세 · ' + S.FIXED_COST_STATUSES[status];
      }
      row.hidden = el('cashflow-fixed-only').checked && !fixed;
      if (!row.hidden) visible++;
      if (row.hidden && row.contains(document.activeElement)) el('cashflow-add').focus();
    }
    el('cashflow-empty').hidden = visible > 0;
    el('cashflow-empty').textContent = el('cashflow-fixed-only').checked ? '고정 납부 항목이 없어요. 항목 추가로 시작하세요.' : '수입과 지출 항목을 추가하거나 계획 파일을 불러오세요.';
  }
  function changed() { dirty = true; syncRows(); message('수정 중 · 저장하면 선택한 달의 계획에 반영돼요.'); summary(); }
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
    container.append(remove);
    container.append(scheduleFields(item.schedule));
    if (item.kind === 'fixed') container.append(fixedDetails(item.fixedCost));
    el('cashflow-rows').append(container);
  }
  function fill(plan) {
    el('cashflow-rows').replaceChildren(); plan.items.forEach(row);
    el('cashflow-living').value = plan.livingBudget; syncRows(); summary();
  }
  function render(state, selectedMonth) {
    plans=state.cashflowPlans;
    const plan = state.cashflowPlans[selectedMonth] || {items: [], livingBudget: 0};
    const nextSource = JSON.stringify(plan);
    if (month !== selectedMonth || source !== nextSource) {
      month = selectedMonth; source = nextSource; dirty = false;
      el('cashflow-month').textContent = selectedMonth + ' 월 현금흐름'; fill(plan); message('');
    }
    else schedule(read());
  }
  function init(callbacks) {
    api = callbacks;
    for(const mode of ['table','calendar']) el('cashflow-view-'+mode).addEventListener('click',()=>{view=mode;schedule(read());});
    el('cashflow-fixed-only').addEventListener('change', syncRows);
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
      if (!plan) {message('항목명과 금액을 확인해 주세요. 금액은 0 이상의 정수이며, 절감 예정은 현재 월 금액 이하의 목표금액이 필요해요.'); return;}
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
