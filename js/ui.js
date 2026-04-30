/* beginner-budget-app ui.js */
(function (window, document) {
  'use strict';

  const typeLabels = { income: '수입', expense: '지출', all: '전체' };
  const fieldSelectors = {
    monthlyBudget: '#monthly-budget',
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

  function showValidationErrors(scope, messageElement, errors) {
    clearFieldErrors(scope);
    const messages = errors.map((item) => item.message || String(item));
    setMessage(messageElement, messages.join(' '), 'error');
    errors.forEach((item) => {
      if (!item.field || !fieldSelectors[item.field]) return;
      const target = document.querySelector(fieldSelectors[item.field]);
      if (target) target.setAttribute('aria-invalid', 'true');
    });
    const first = errors.find((item) => item.field && fieldSelectors[item.field]);
    if (first) {
      const target = document.querySelector(fieldSelectors[first.field]);
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

  function initDefaults(elements, state) {
    elements.dateInput.value = window.BudgetStorage.localDateString();
    elements.monthInput.value = window.BudgetStorage.localMonthString();
    elements.budgetInput.value = state.monthlyBudget;
    fillCategoryOptions(elements.categorySelect, elements.typeSelect.value);
  }

  function renderSummary(elements, summary, month) {
    const meterValue = Math.min(summary.budgetRate, 100);
    elements.selectedMonthLabel.textContent = `${month} 기준`;
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
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'danger delete-button';
      deleteButton.dataset.id = tx.id;
      deleteButton.textContent = '삭제';
      deleteButton.setAttribute('aria-label', `${tx.date} ${tx.category} ${formatWon(tx.amount)} 삭제`);
      actions.append(deleteButton);

      item.append(main, amount, actions);
      elements.list.append(item);
    });
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
      budgetForm: $('#budget-form'),
      budgetInput: $('#monthly-budget'),
      budgetMessage: $('#budget-message'),
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
      categoryBreakdownList: $('#category-breakdown-list')
    };
  }

  window.BudgetUI = {
    typeLabels,
    formatWon,
    setMessage,
    clearFieldErrors,
    showValidationErrors,
    fillCategoryOptions,
    initDefaults,
    renderSummary,
    renderCategoryBreakdown,
    renderList,
    downloadText,
    getElements
  };
})(window, document);
