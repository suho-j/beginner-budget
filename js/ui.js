/* beginner-budget-app ui.js */
(function (window, document) {
  'use strict';

  const typeLabels = { income: '수입', expense: '지출', all: '전체' };
  const fieldSelectors = {
    monthlyBudget: '#monthly-budget',
    monthStartDay: '#month-start-day',
    date: '#tx-date',
    type: '#tx-type',
    category: '#tx-category',
    amount: '#tx-amount',
    memo: '#tx-memo',
    importData: '#import-file'
  };

  function $(selector) {
    return document.querySelector(selector);
  }

  function formatWon(amount) {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(amount);
  }

  function setMessage(element, text, kind) {
    element.textContent = text || '';
    element.classList.remove('ok', 'error');
    if (kind) element.classList.add(kind);
  }

  function clearFieldErrors(scope) {
    scope.querySelectorAll('[aria-invalid="true"]').forEach((field) => field.setAttribute('aria-invalid', 'false'));
  }

  function fieldForError(scope, field) {
    if (!field) return null;
    const scoped = scope.querySelector(`[name="${field}"]`);
    if (scoped) return scoped;
    return fieldSelectors[field] ? document.querySelector(fieldSelectors[field]) : null;
  }

  function showValidationErrors(scope, messageElement, errors) {
    clearFieldErrors(scope);
    const messages = errors.map((item) => item.message || String(item));
    setMessage(messageElement, messages.join(' '), 'error');
    errors.forEach((item) => {
      if (item.field === 'categoryBudgets') {
        scope.querySelectorAll('input').forEach((field) => field.setAttribute('aria-invalid', 'true'));
        return;
      }
      if (!item.field) return;
      const target = fieldForError(scope, item.field);
      if (target) target.setAttribute('aria-invalid', 'true');
    });
    const first = errors.find((item) => fieldForError(scope, item.field));
    if (first) {
      const target = fieldForError(scope, first.field);
      if (target) {
        target.focus();
      }
    }
  }

  function fillCategoryOptions(select, type) {
    const categories = window.BudgetTransactions.categoriesFor(type);
    select.innerHTML = '';
    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      select.append(option);
    });
  }

  function setActiveTab(elements, tabName, focus = false) {
    elements.tabs.forEach((tab) => {
      const active = tab.dataset.tab === tabName;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (focus && active) tab.focus();
    });
    elements.tabPanels.forEach((panel) => {
      panel.hidden = panel.id !== `panel-${tabName}`;
    });
  }

  function fillFilterCategoryOptions(select, type, selected = 'all') {
    const categories = type === 'all'
      ? [...window.BudgetTransactions.EXPENSE_CATEGORIES, ...window.BudgetTransactions.INCOME_CATEGORIES]
      : window.BudgetTransactions.categoriesFor(type);
    select.innerHTML = '';
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = '전체';
    select.append(all);
    Array.from(new Set(categories)).forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      select.append(option);
    });
    select.value = categories.includes(selected) ? selected : 'all';
  }

  function initDefaults(elements, state) {
    const month = window.BudgetStorage.monthKeyForDate(window.BudgetStorage.localDateString(), state.monthStartDay || 1) || window.BudgetStorage.localMonthString();
    const monthBudget = window.BudgetStorage.budgetForMonth(state, month);
    elements.dateInput.value = window.BudgetStorage.localDateString();
    elements.monthInput.value = month;
    elements.monthInput.dataset.autoMonth = 'true';
    elements.monthStartInput.value = state.monthStartDay || 1;
    elements.budgetInput.value = monthBudget.monthlyBudget;
    renderCategoryBudgetFields(elements.categoryBudgetFields, monthBudget.categoryBudgets || {});
    fillCategoryOptions(elements.categorySelect, elements.typeSelect.value);
    syncCategoryBudgetInputs(elements, monthBudget.categoryBudgets);
  }

  function renderCategoryBudgetFields(container, categoryBudgets) {
    if (!container || container.children.length) return;
    window.BudgetTransactions.EXPENSE_CATEGORIES.forEach((category) => {
      const id = `category-budget-${category}`;
      const field = document.createElement('div');
      field.className = 'field';
      const label = document.createElement('label');
      label.setAttribute('for', id);
      label.textContent = `${category} 예산`;
      const input = document.createElement('input');
      input.id = id;
      input.name = category;
      input.type = 'text';
      input.inputMode = 'numeric';
      input.pattern = '[0-9,]*';
      input.placeholder = '예: 200,000';
      input.value = categoryBudgets[category] ? String(categoryBudgets[category]) : '';
      input.setAttribute('aria-describedby', 'category-budget-help category-budget-message');
      field.append(label, input);
      container.append(field);
    });
  }

  function syncCategoryBudgetInputs(elements, categoryBudgets = {}) {
    if (!elements.categoryBudgetFields || !elements.categoryBudgetFields.children.length) return;
    elements.categoryBudgetFields.querySelectorAll('input').forEach((input) => {
      if (document.activeElement === input) return;
      input.value = categoryBudgets[input.name] ? String(categoryBudgets[input.name]) : '';
    });
  }

  function readCategoryBudgetInputs(elements) {
    const budgets = {};
    elements.categoryBudgetFields.querySelectorAll('input').forEach((input) => {
      budgets[input.name] = input.value;
    });
    return budgets;
  }

  function renderSummary(elements, summary, month, periodRange) {
    const meterValue = Math.min(summary.budgetRate, 100);
    elements.selectedMonthLabel.textContent = periodRange ? `${month} 예산 기간: ${periodRange.start} ~ ${periodRange.end}` : `${month} 기준`;
    elements.summaryIncome.textContent = formatWon(summary.income);
    elements.summaryExpense.textContent = formatWon(summary.expense);
    elements.summaryBalance.textContent = formatWon(summary.balance);
    elements.summaryBudgetRemaining.textContent = formatWon(summary.budgetRemaining);
    elements.budgetRateLabel.textContent = `${summary.budgetRate}%`;
    elements.budgetMeterFill.style.width = `${meterValue}%`;
    elements.budgetMeter.setAttribute('aria-valuenow', String(meterValue));
    elements.budgetMeter.setAttribute('aria-valuetext', `예산 사용률 ${summary.budgetRate}%. ${summary.budgetRemaining < 0 ? '예산 초과' : '예산 범위 내'}`);

    elements.balanceCard.classList.toggle('negative', summary.balance < 0);
    elements.budgetCard.classList.toggle('over', summary.budgetRemaining < 0);
    elements.budgetMeter.classList.toggle('over', summary.budgetRemaining < 0);
    elements.budgetMeter.classList.toggle('warn', summary.budgetRemaining >= 0 && summary.budgetRate >= 80);
    elements.balanceHelp.textContent = summary.balance < 0 ? '잔액이 마이너스예요: 수입보다 지출이 많아요' : '수입 - 지출';
    elements.budgetStatusText.textContent = summary.budgetRemaining < 0
      ? `예산을 ${formatWon(Math.abs(summary.budgetRemaining))} 초과했어요`
      : `월 예산 ${formatWon(summary.monthlyBudget)} 중 남은 금액`;

    elements.dailyAllowance.textContent = formatWon(summary.dailyAllowance);
    elements.dailyAllowanceHelp.textContent = summary.budgetRemaining < 0
      ? '예산을 초과해 하루 사용 가능액을 0원으로 표시합니다'
      : '남은 예산을 이번 달 남은 날짜로 나눴어요';
    elements.topCategory.textContent = summary.topExpenseCategory
      ? `${summary.topExpenseCategory.category} ${formatWon(summary.topExpenseCategory.amount)}`
      : '아직 없음';
    elements.topCategoryHelp.textContent = summary.topExpenseCategory
      ? `선택한 달 지출의 ${summary.topExpenseCategory.rate}%`
      : '선택한 달에 지출을 추가하면 표시됩니다';
    renderCategoryBreakdown(elements, summary.categoryBreakdown);
    renderCategoryBudgetStatus(elements, summary.categoryBudgetStatus);
  }

  function renderCategoryBudgetStatus(elements, rows) {
    elements.categoryBudgetStatusList.innerHTML = '';
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '항목별 예산을 저장하면 여기에서 남은 금액을 볼 수 있어요.';
      elements.categoryBudgetStatusList.append(empty);
      return;
    }
    rows.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'category-budget-row';
      row.classList.toggle('over', item.remaining < 0);
      const label = document.createElement('span');
      label.textContent = item.budget > 0 ? `${item.category} · ${item.rate}% 사용` : `${item.category} · 예산 미설정`;
      const amount = document.createElement('strong');
      amount.textContent = item.budget > 0
        ? `${formatWon(item.remaining)} 남음`
        : `${formatWon(item.spent)} 사용`;
      const detail = document.createElement('small');
      detail.textContent = item.budget > 0
        ? `사용 ${formatWon(item.spent)} / 예산 ${formatWon(item.budget)}`
        : '항목별 예산을 입력하면 남은 금액을 계산합니다';
      const bar = document.createElement('span');
      bar.className = 'category-budget-bar';
      bar.style.width = `${Math.min(item.rate, 100)}%`;
      row.append(label, amount, detail, bar);
      elements.categoryBudgetStatusList.append(row);
    });
  }

  function renderCategoryBreakdown(elements, breakdown) {
    elements.categoryBreakdownList.innerHTML = '';
    if (!breakdown.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '선택한 달의 지출 카테고리 분석이 아직 없어요.';
      elements.categoryBreakdownList.append(empty);
      return;
    }
    breakdown.slice(0, 5).forEach((item) => {
      const row = document.createElement('div');
      row.className = 'category-row';
      const label = document.createElement('span');
      label.textContent = `${item.category} · ${item.rate}%`;
      const amount = document.createElement('strong');
      amount.textContent = formatWon(item.amount);
      const bar = document.createElement('span');
      bar.className = 'category-bar';
      bar.style.width = `${Math.min(item.rate, 100)}%`;
      row.append(label, amount, bar);
      elements.categoryBreakdownList.append(row);
    });
  }

  function renderList(elements, transactions) {
    elements.list.innerHTML = '';
    elements.listCount.textContent = `${transactions.length}건`;
    elements.emptyState.hidden = transactions.length > 0;

    transactions.forEach((tx) => {
      const item = document.createElement('li');
      item.className = 'transaction-item';

      const main = document.createElement('div');
      main.className = 'transaction-main';

      const title = document.createElement('div');
      title.className = 'transaction-title';
      title.textContent = `${typeLabels[tx.type]} · ${tx.category}`;

      const meta = document.createElement('div');
      meta.className = 'transaction-meta';
      meta.textContent = tx.source === 'sample' ? `${tx.date} · 샘플` : tx.date;

      main.append(title, meta);
      if (tx.memo) {
        const memo = document.createElement('div');
        memo.className = 'transaction-memo';
        memo.textContent = `메모: ${tx.memo}`;
        main.append(memo);
      }

      const amount = document.createElement('div');
      amount.className = `transaction-amount ${tx.type}`;
      amount.textContent = `${tx.type === 'income' ? '수입 +' : '지출 -'}${formatWon(tx.amount)}`;

      const actions = document.createElement('div');
      actions.className = 'transaction-actions';
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'secondary edit-button';
      editButton.dataset.id = tx.id;
      editButton.dataset.action = 'edit';
      editButton.textContent = '수정';
      editButton.setAttribute('aria-label', `${tx.date} ${tx.category} ${formatWon(tx.amount)} 수정`);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'danger delete-button';
      deleteButton.dataset.id = tx.id;
      deleteButton.dataset.action = 'delete';
      deleteButton.textContent = '삭제';
      deleteButton.setAttribute('aria-label', `${tx.date} ${tx.category} ${formatWon(tx.amount)} 삭제`);
      actions.append(editButton, deleteButton);

      item.append(main, amount, actions);
      elements.list.append(item);
    });
  }

  function openEditDialog(elements, transaction, trigger) {
    elements.editId.value = transaction.id;
    elements.editDate.value = transaction.date;
    elements.editType.value = transaction.type;
    fillCategoryOptions(elements.editCategory, transaction.type);
    elements.editCategory.value = transaction.category;
    elements.editAmount.value = String(transaction.amount);
    elements.editMemo.value = transaction.memo || '';
    elements.editDialog.returnFocus = trigger || null;
    const ownerPanel = trigger ? trigger.closest('[role="tabpanel"]') : null;
    elements.editDialog.returnTab = ownerPanel ? ownerPanel.id.replace('panel-', '') : 'history';
    setMessage(elements.editMessage, '', null);
    clearFieldErrors(elements.editForm);
    elements.editDialog.showModal();
    elements.editDate.focus();
  }

  function closeEditDialog(elements) {
    const returnFocus = elements.editDialog.returnFocus;
    const transactionId = elements.editId.value;
    const returnTab = elements.editDialog.returnTab || 'history';
    elements.editDialog.close();
    elements.editDialog.returnFocus = null;
    elements.editDialog.returnTab = null;
    const replacement = Array.from(document.querySelectorAll('[data-action="edit"]'))
      .find((button) => button.dataset.id === transactionId && !button.closest('[hidden]'));
    const target = returnFocus && document.contains(returnFocus)
      ? returnFocus
      : replacement || elements.tabs.find((tab) => tab.dataset.tab === returnTab);
    if (target) target.focus();
  }

  function renderCalendar(elements, days, byDate, selectedDate) {
    elements.calendarGrid.innerHTML = '';
    days.forEach((day) => {
      const summary = byDate[day.date];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'calendar-day';
      button.dataset.date = day.date;
      button.dataset.action = 'select-date';
      button.disabled = !day.inPeriod;
      button.classList.toggle('outside-period', !day.inPeriod);
      button.classList.toggle('is-selected', day.date === selectedDate);
      button.setAttribute('aria-pressed', String(day.date === selectedDate));

      const date = document.createElement('span');
      date.className = 'calendar-date';
      date.textContent = String(day.day);
      button.append(date);

      if (summary && summary.expense) {
        const expense = document.createElement('span');
        expense.className = 'calendar-expense';
        expense.textContent = `지출 ${formatWon(summary.expense)}`;
        button.append(expense);
      }
      if (summary && summary.income) {
        const income = document.createElement('span');
        income.className = 'calendar-income';
        income.textContent = `수입 ${formatWon(summary.income)}`;
        button.append(income);
      }
      if (summary) {
        const count = document.createElement('span');
        count.className = 'calendar-count';
        count.textContent = `${summary.count}건`;
        button.append(count);
      }
      const accessible = summary
        ? `${day.date}, 지출 ${formatWon(summary.expense)}, 수입 ${formatWon(summary.income)}, ${summary.count}건`
        : `${day.date}, 거래 없음`;
      button.setAttribute('aria-label', accessible);
      elements.calendarGrid.append(button);
    });
  }

  function renderCalendarDetails(elements, selectedDate, transactions) {
    elements.calendarDetailList.innerHTML = '';
    elements.calendarDetailEmpty.hidden = transactions.length > 0;
    elements.calendarDetailCount.textContent = selectedDate ? `${selectedDate} · ${transactions.length}건` : '날짜를 선택해 주세요.';
    if (!transactions.length) return;
    const proxy = {
      list: elements.calendarDetailList,
      listCount: elements.calendarDetailCount,
      emptyState: elements.calendarDetailEmpty
    };
    renderList(proxy, transactions);
    elements.calendarDetailCount.textContent = `${selectedDate} · ${transactions.length}건`;
  }

  function updateCloudStatus(elements, user) {
    if (!window.BudgetCloud || !window.BudgetCloud.isConfigured()) {
      elements.cloudStatus.textContent = 'Supabase 클라이언트를 불러오지 못했어요. 네트워크를 확인해 주세요.';
      elements.cloudPanel.hidden = false;
      elements.cloudLoginForm.hidden = true;
      elements.cloudUploadButton.disabled = true;
      elements.cloudDownloadButton.hidden = true;
      elements.cloudDownloadButton.disabled = true;
      elements.cloudLogoutButton.hidden = true;
      elements.cloudLogoutButton.disabled = true;
      return;
    }
    const signedIn = Boolean(user);
    elements.cloudStatus.textContent = signedIn ? '' : '공용 비밀번호로 로그인해 주세요.';
    elements.cloudPanel.hidden = signedIn;
    elements.cloudLoginForm.hidden = signedIn;
    elements.cloudUploadButton.disabled = !signedIn;
    elements.cloudDownloadButton.hidden = true;
    elements.cloudDownloadButton.disabled = true;
    elements.cloudLogoutButton.hidden = !signedIn;
    elements.cloudLogoutButton.disabled = !signedIn;
  }

  function downloadText(filename, content) {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function getElements() {
    return {
      tabs: Array.from(document.querySelectorAll('[role="tab"]')),
      tabPanels: Array.from(document.querySelectorAll('[role="tabpanel"]')),
      previousMonthButton: $('#month-previous'),
      currentMonthButton: $('#month-current'),
      nextMonthButton: $('#month-next'),
      filterCategory: $('#filter-category'),
      calendarPeriodLabel: $('#calendar-period-label'),
      calendarGrid: $('#calendar-grid'),
      calendarDetailList: $('#calendar-detail-list'),
      calendarDetailEmpty: $('#calendar-detail-empty'),
      calendarDetailCount: $('#calendar-detail-count'),
      previewDataWarning: $('#preview-data-warning'),
      editDialog: $('#edit-dialog'),
      editForm: $('#edit-transaction-form'),
      editId: $('#edit-id'),
      editDate: $('#edit-date'),
      editType: $('#edit-type'),
      editCategory: $('#edit-category'),
      editAmount: $('#edit-amount'),
      editMemo: $('#edit-memo'),
      editMessage: $('#edit-message'),
      editClose: $('#edit-close'),
      editCancel: $('#edit-cancel'),
      editSave: $('#edit-save'),
      monthStartForm: $('#month-start-form'),
      monthStartInput: $('#month-start-day'),
      monthStartMessage: $('#month-start-message'),
      budgetForm: $('#budget-form'),
      budgetInput: $('#monthly-budget'),
      budgetMessage: $('#budget-message'),
      categoryBudgetForm: $('#category-budget-form'),
      categoryBudgetFields: $('#category-budget-fields'),
      categoryBudgetMessage: $('#category-budget-message'),
      cloudPanel: $('#cloud-panel'),
      cloudLoginForm: $('#cloud-login-form'),
      cloudPassword: $('#cloud-password'),
      cloudUploadButton: $('#cloud-upload-button'),
      cloudDownloadButton: $('#cloud-download-button'),
      cloudLogoutButton: $('#cloud-logout-button'),
      cloudStatus: $('#cloud-status'),
      cloudMessage: $('#cloud-message'),
      transactionForm: $('#transaction-form'),
      dateInput: $('#tx-date'),
      typeSelect: $('#tx-type'),
      categorySelect: $('#tx-category'),
      amountInput: $('#tx-amount'),
      memoInput: $('#tx-memo'),
      formMessage: $('#form-message'),
      monthInput: $('#filter-month'),
      filterType: $('#filter-type'),
      filterQuery: $('#filter-query'),
      toolMessage: $('#tool-message'),
      sampleButton: $('#sample-button'),
      exportButton: $('#export-button'),
      importButton: $('#import-button'),
      importFile: $('#import-file'),
      resetButton: $('#reset-button'),
      list: $('#transaction-list'),
      emptyState: $('#empty-state'),
      listCount: $('#list-count'),
      selectedMonthLabel: $('#selected-month-label'),
      summaryIncome: $('#summary-income'),
      summaryExpense: $('#summary-expense'),
      summaryBalance: $('#summary-balance'),
      summaryBudgetRemaining: $('#summary-budget-remaining'),
      budgetStatusText: $('#budget-status-text'),
      balanceHelp: $('#balance-help'),
      budgetCard: $('.budget-card'),
      balanceCard: $('.balance-card'),
      budgetRateLabel: $('#budget-rate-label'),
      budgetMeter: $('.meter-track'),
      budgetMeterFill: $('#budget-meter-fill'),
      dailyAllowance: $('#daily-allowance'),
      dailyAllowanceHelp: $('#daily-allowance-help'),
      topCategory: $('#top-category'),
      topCategoryHelp: $('#top-category-help'),
      categoryBreakdownList: $('#category-breakdown-list'),
      categoryBudgetStatusList: $('#category-budget-status-list')
    };
  }

  window.BudgetUI = {
    typeLabels,
    formatWon,
    setMessage,
    clearFieldErrors,
    showValidationErrors,
    fillCategoryOptions,
    setActiveTab,
    fillFilterCategoryOptions,
    openEditDialog,
    closeEditDialog,
    renderCalendar,
    renderCalendarDetails,
    initDefaults,
    renderCategoryBudgetFields,
    syncCategoryBudgetInputs,
    readCategoryBudgetInputs,
    renderSummary,
    renderCategoryBudgetStatus,
    renderCategoryBreakdown,
    renderList,
    updateCloudStatus,
    downloadText,
    getElements
  };
})(window, document);
