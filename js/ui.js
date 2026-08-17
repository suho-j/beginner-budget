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
  let recurringConfirmFocusState = null;
  let recurringTemplateFocusState = null;

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
    fillBudgetTransferCategoryOptions(elements);
    fillCategoryOptions(elements.categorySelect, elements.typeSelect.value);
    fillRecurringExpenseCategoryOptions(elements);
    syncCategoryBudgetInputs(elements, monthBudget.categoryBudgets);
    renderBudgetTransferAvailability(elements, state, month);
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

  function fillBudgetTransferCategoryOptions(elements) {
    const categories = window.BudgetTransactions.EXPENSE_CATEGORIES;
    const selectedFrom = elements.budgetTransferFrom.value;
    const selectedTo = elements.budgetTransferTo.value;

    [elements.budgetTransferFrom, elements.budgetTransferTo].forEach((select) => {
      select.innerHTML = '';
      categories.forEach((category) => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        select.append(option);
      });
    });

    elements.budgetTransferFrom.value = categories.includes(selectedFrom)
      ? selectedFrom
      : (categories.includes('비상금') ? '비상금' : categories[0]);
    const availableTargets = categories.filter((category) => category !== elements.budgetTransferFrom.value);
    elements.budgetTransferTo.value = availableTargets.includes(selectedTo)
      ? selectedTo
      : (availableTargets.includes('생활비') ? '생활비' : availableTargets[0]);
  }

  function renderBudgetTransferAvailability(elements, state, month) {
    const category = elements.budgetTransferFrom.value;
    const source = window.BudgetTransactions.categoryBudgetAvailability(state, month, category);
    elements.budgetTransferAvailable.textContent = source.budget > 0
      ? `${category} 예산 ${formatWon(source.budget)} 중 ${formatWon(source.spent)}을 사용했고, ${formatWon(source.available)}까지 옮길 수 있어요.`
      : `${category} 예산이 설정되지 않았어요.`;
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
      editButton.setAttribute('data-cloud-write', '');
      editButton.setAttribute('aria-label', `${tx.date} ${typeLabels[tx.type]} ${tx.category} ${formatWon(tx.amount)} 수정`);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'danger delete-button';
      deleteButton.dataset.id = tx.id;
      deleteButton.dataset.action = 'delete';
      deleteButton.textContent = '삭제';
      deleteButton.setAttribute('data-cloud-write', '');
      deleteButton.setAttribute('aria-label', `${tx.date} ${typeLabels[tx.type]} ${tx.category} ${formatWon(tx.amount)} 삭제`);
      actions.append(editButton, deleteButton);

      item.append(main, amount, actions);
      elements.list.append(item);
    });
  }

  function formatRecurringWon(amount) {
    return `${new Intl.NumberFormat('ko-KR').format(Number(amount) || 0)}원`;
  }

  function fillRecurringExpenseCategoryOptions(elements) {
    const categories = window.BudgetStorage.EXPENSE_CATEGORIES;
    [elements.recurringTemplateCategory, elements.recurringConfirmCategory].forEach((select) => {
      if (!select) return;
      const selected = select.value;
      const options = categories.map((category) => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        return option;
      });
      select.replaceChildren(...options);
      select.value = categories.includes(selected) ? selected : (categories[0] || '');
    });
  }

  function renderUpcomingRecurringExpenses(elements, occurrences) {
    const statusLabels = { overdue: '지남', today: '오늘', upcoming: '예정', recorded: '기록됨' };
    const statusOrder = { overdue: 0, today: 1, upcoming: 2, recorded: 3 };
    const rows = Array.isArray(occurrences) ? occurrences.slice().sort((a, b) => (
      (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4)
      || String(a.scheduledDate || '').localeCompare(String(b.scheduledDate || ''))
      || String(a.memo || '').localeCompare(String(b.memo || ''), 'ko-KR')
    )) : [];
    const unrecorded = rows.filter((occurrence) => occurrence.status !== 'recorded');
    const expectedTotal = unrecorded.reduce((total, occurrence) => total + (Number(occurrence.amount) || 0), 0);

    const nextSummary = unrecorded.length
      ? `미기록 ${unrecorded.length}건 · 예상 합계 ${formatRecurringWon(expectedTotal)}`
      : '미기록 예정 없음';
    if (elements.recurringUpcomingSummary.textContent !== nextSummary) {
      elements.recurringUpcomingSummary.textContent = nextSummary;
    }
    elements.recurringUpcomingEmpty.hidden = rows.length > 0;
    elements.recurringUpcomingList.hidden = rows.length === 0;
    elements.recurringUpcomingList.replaceChildren();

    rows.forEach((occurrence) => {
      const item = document.createElement('li');
      item.className = 'recurring-card';

      const heading = document.createElement('div');
      heading.className = 'recurring-card-heading';
      const title = document.createElement('strong');
      title.className = 'recurring-card-title';
      title.textContent = occurrence.memo || '';
      const status = document.createElement('span');
      status.className = `recurring-status is-${occurrence.status}`;
      status.textContent = statusLabels[occurrence.status] || '예정';
      heading.append(title, status);

      const isRecorded = occurrence.status === 'recorded';
      const recordedTransaction = isRecorded ? occurrence.transaction : null;
      const shownDate = recordedTransaction ? recordedTransaction.date : occurrence.scheduledDate;
      const shownAmount = recordedTransaction ? recordedTransaction.amount : occurrence.amount;
      const shownCategory = recordedTransaction ? recordedTransaction.category : occurrence.category;
      const meta = document.createElement('p');
      meta.className = 'recurring-card-meta';
      meta.textContent = `${isRecorded ? '기록일' : '예정일'} ${shownDate} · ${shownCategory} · ${formatRecurringWon(shownAmount)}`;
      item.append(heading, meta);

      if (!isRecorded) {
        const actions = document.createElement('div');
        actions.className = 'recurring-card-actions';
        const recordButton = document.createElement('button');
        recordButton.type = 'button';
        recordButton.dataset.action = 'record-recurring-expense';
        recordButton.dataset.recurringTransactionId = occurrence.transactionId;
        recordButton.textContent = '기록하기';
        recordButton.setAttribute('data-cloud-write', '');
        recordButton.setAttribute(
          'aria-label',
          `${occurrence.scheduledDate} ${occurrence.memo || ''} ${formatRecurringWon(occurrence.amount)} 기록하기`
        );
        actions.append(recordButton);
        item.append(actions);
      }

      elements.recurringUpcomingList.append(item);
    });
  }

  function renderRecurringExpenseTemplates(elements, templates) {
    const rows = Array.isArray(templates) ? templates : [];
    elements.recurringTemplateEmpty.hidden = rows.length > 0;
    elements.recurringTemplateList.hidden = rows.length === 0;
    elements.recurringTemplateList.replaceChildren();

    rows.forEach((template) => {
      const item = document.createElement('li');
      item.className = 'recurring-card';
      const heading = document.createElement('div');
      heading.className = 'recurring-card-heading';
      const title = document.createElement('strong');
      title.className = 'recurring-card-title';
      title.textContent = template.memo || '';
      heading.append(title);

      const meta = document.createElement('p');
      meta.className = 'recurring-card-meta';
      meta.textContent = `${template.category} · 매월 ${template.dayOfMonth}일 · 예상 ${formatRecurringWon(template.amount)}`;

      const actions = document.createElement('div');
      actions.className = 'recurring-card-actions';
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'secondary';
      editButton.dataset.action = 'edit-recurring-template';
      editButton.dataset.templateId = template.id;
      editButton.textContent = '수정';
      editButton.setAttribute('data-cloud-write', '');
      editButton.setAttribute('aria-label', `${template.memo || ''} 반복지출 수정`);
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'danger';
      deleteButton.dataset.action = 'delete-recurring-template';
      deleteButton.dataset.templateId = template.id;
      deleteButton.textContent = '삭제';
      deleteButton.setAttribute('data-cloud-write', '');
      deleteButton.setAttribute('aria-label', `${template.memo || ''} 반복지출 삭제`);
      actions.append(editButton, deleteButton);
      item.append(heading, meta, actions);
      elements.recurringTemplateList.append(item);
    });
  }

  function recurringRecordActions(elements) {
    return Array.from(elements.recurringUpcomingList.querySelectorAll('[data-action="record-recurring-expense"]'));
  }

  function isEligibleFocusTarget(target) {
    if (
      !target
      || typeof target.focus !== 'function'
      || !document.contains(target)
      || target.disabled
    ) return false;

    let current = target;
    while (current) {
      if (
        current.hidden
        || current.inert
        || (
          typeof current.getAttribute === 'function'
          && (
            current.getAttribute('hidden') !== null
            || current.getAttribute('inert') !== null
            || current.getAttribute('aria-hidden') === 'true'
          )
        )
      ) return false;
      current = current.parentElement;
    }
    return true;
  }

  function focusFirstEligible(candidates) {
    const seen = new Set();
    for (const target of candidates) {
      if (seen.has(target) || !isEligibleFocusTarget(target)) continue;
      seen.add(target);
      target.focus();
      if (document.activeElement === target) return true;
    }
    return false;
  }

  function beginRecurringTemplateEdit(elements, template, returnFocus) {
    fillRecurringExpenseCategoryOptions(elements);
    elements.recurringTemplateMemo.value = template.memo || '';
    elements.recurringTemplateCategory.value = template.category || '';
    elements.recurringTemplateAmount.value = String(template.amount || '');
    elements.recurringTemplateDay.value = String(template.dayOfMonth || '');
    elements.recurringTemplateForm.dataset.templateId = template.id;
    elements.recurringTemplateSave.textContent = '반복지출 수정 저장';
    elements.recurringTemplateCancel.hidden = false;
    setMessage(elements.recurringTemplateMessage, '', null);
    clearFieldErrors(elements.recurringTemplateForm);
    recurringTemplateFocusState = {
      element: returnFocus || null,
      templateId: template.id
    };
    elements.recurringTemplateMemo.focus();
  }

  function clearRecurringTemplateEdit(elements, focusTargetOrOptions) {
    const directTarget = focusTargetOrOptions && typeof focusTargetOrOptions.focus === 'function'
      ? focusTargetOrOptions
      : null;
    const options = directTarget ? {} : (focusTargetOrOptions || {});
    const focusState = recurringTemplateFocusState;

    elements.recurringTemplateMemo.value = '';
    elements.recurringTemplateCategory.value = '';
    elements.recurringTemplateAmount.value = '';
    elements.recurringTemplateDay.value = '';
    delete elements.recurringTemplateForm.dataset.templateId;
    elements.recurringTemplateSave.textContent = '반복지출 등록';
    elements.recurringTemplateCancel.hidden = true;
    setMessage(elements.recurringTemplateMessage, '', null);
    clearFieldErrors(elements.recurringTemplateForm);
    recurringTemplateFocusState = null;

    const candidates = [directTarget, options.focusTarget];
    if (options.reason === 'delete') {
      const editButtons = Array.from(
        elements.recurringTemplateList.querySelectorAll('[data-action="edit-recurring-template"]')
      );
      const deletedIndex = Number.isInteger(options.deletedIndex) ? options.deletedIndex : 0;
      candidates.push(editButtons[deletedIndex], editButtons[deletedIndex - 1]);
    } else if (focusState) {
      candidates.push(focusState.element);
      candidates.push(...Array.from(elements.recurringTemplateList.querySelectorAll('[data-template-id]'))
        .filter((button) => button.dataset.templateId === focusState.templateId));
    }
    candidates.push(elements.recurringTemplateHeading);
    focusFirstEligible(candidates);
  }

  function openRecurringConfirmDialog(elements, occurrence, returnFocus) {
    fillRecurringExpenseCategoryOptions(elements);
    const actions = recurringRecordActions(elements);
    const returnIndex = actions.indexOf(returnFocus);
    const nextAction = returnIndex >= 0 ? actions[returnIndex + 1] : null;
    recurringConfirmFocusState = {
      element: returnFocus || null,
      transactionId: occurrence.transactionId,
      nextTransactionId: nextAction ? nextAction.dataset.recurringTransactionId : ''
    };
    elements.recurringConfirmScheduledDate.textContent = occurrence.scheduledDate || '';
    elements.recurringConfirmDate.value = occurrence.scheduledDate || '';
    elements.recurringConfirmAmount.value = String(occurrence.amount || '');
    elements.recurringConfirmCategory.value = occurrence.category || '';
    elements.recurringConfirmMemo.value = occurrence.memo || '';
    elements.recurringConfirmDialog.dataset.transactionId = occurrence.transactionId;
    setMessage(elements.recurringConfirmMessage, '', null);
    clearFieldErrors(elements.recurringConfirmForm);
    elements.recurringConfirmDialog.showModal();
    elements.recurringConfirmDate.focus();
  }

  // Native dialog cancel and the explicit cancel button both call this function with reason "cancel".
  // A successful save calls it with { reason: "saved" } so focus always returns to the section heading.
  function closeRecurringConfirmDialog(elements, options = {}) {
    const focusState = recurringConfirmFocusState;
    const transactionId = elements.recurringConfirmDialog.dataset.transactionId
      || (focusState && focusState.transactionId)
      || '';
    const saved = options.reason === 'saved' || options.saved === true;

    elements.recurringConfirmScheduledDate.textContent = '';
    elements.recurringConfirmDate.value = '';
    elements.recurringConfirmAmount.value = '';
    elements.recurringConfirmCategory.value = '';
    elements.recurringConfirmMemo.value = '';
    delete elements.recurringConfirmDialog.dataset.transactionId;
    setMessage(elements.recurringConfirmMessage, '', null);
    clearFieldErrors(elements.recurringConfirmForm);
    elements.recurringConfirmDialog.close();
    recurringConfirmFocusState = null;

    const actions = recurringRecordActions(elements);
    if (saved) {
      focusFirstEligible([elements.recurringUpcomingHeading]);
      return;
    }
    const sameOccurrenceAction = transactionId
      ? actions.find((button) => button.dataset.recurringTransactionId === transactionId)
      : null;
    const nextOccurrenceAction = focusState && focusState.nextTransactionId
      ? actions.find((button) => button.dataset.recurringTransactionId === focusState.nextTransactionId)
      : null;
    focusFirstEligible([
      focusState && focusState.element,
      sameOccurrenceAction,
      nextOccurrenceAction,
      elements.recurringUpcomingHeading
    ]);
  }

  function resetRecurringExpenseUi(elements) {
    recurringTemplateFocusState = null;
    recurringConfirmFocusState = null;
    fillRecurringExpenseCategoryOptions(elements);
    const defaultCategory = window.BudgetStorage.EXPENSE_CATEGORIES[0] || '';

    elements.recurringTemplateMemo.value = '';
    elements.recurringTemplateCategory.value = defaultCategory;
    elements.recurringTemplateAmount.value = '';
    elements.recurringTemplateDay.value = '';
    delete elements.recurringTemplateForm.dataset.templateId;
    elements.recurringTemplateSave.textContent = '반복지출 등록';
    elements.recurringTemplateCancel.hidden = true;
    setMessage(elements.recurringTemplateMessage, '', null);
    clearFieldErrors(elements.recurringTemplateForm);

    elements.recurringConfirmScheduledDate.textContent = '';
    elements.recurringConfirmDate.value = '';
    elements.recurringConfirmAmount.value = '';
    elements.recurringConfirmCategory.value = defaultCategory;
    elements.recurringConfirmMemo.value = '';
    delete elements.recurringConfirmDialog.dataset.transactionId;
    setMessage(elements.recurringConfirmMessage, '', null);
    clearFieldErrors(elements.recurringConfirmForm);
    if (elements.recurringConfirmDialog.open) elements.recurringConfirmDialog.close();
  }

  function openEditDialog(elements, transaction, trigger, options = {}) {
    const lockType = Boolean(options.lockType);
    elements.editId.value = transaction.id;
    elements.editDate.value = transaction.date;
    elements.editType.disabled = lockType;
    elements.editType.value = lockType ? 'expense' : transaction.type;
    fillCategoryOptions(elements.editCategory, elements.editType.value);
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
    const focusedButton = document.activeElement;
    const calendarOwnedFocus = Boolean(
      focusedButton
      && focusedButton.tagName === 'BUTTON'
      && focusedButton.dataset.action === 'select-date'
      && elements.calendarGrid.contains(focusedButton)
    );
    const focusedDate = calendarOwnedFocus ? focusedButton.dataset.date : '';
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
    if (calendarOwnedFocus) {
      const buttons = Array.from(elements.calendarGrid.querySelectorAll('[data-action="select-date"]'));
      const focusDates = Array.from(new Set([selectedDate, focusedDate].filter(Boolean)));
      const replacement = focusDates
        .map((date) => buttons.find((button) => button.dataset.date === date && !button.disabled))
        .find(Boolean);
      if (replacement) replacement.focus();
    }
  }

  function renderCalendarDetails(elements, selectedDate, transactions) {
    elements.calendarDetailList.innerHTML = '';
    elements.calendarDetailEmpty.hidden = transactions.length > 0;
    elements.calendarDetailEmpty.textContent = selectedDate
      ? '선택한 날짜에 거래가 없어요.'
      : '날짜를 누르면 거래 내역을 보여드려요.';
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

  function updateCloudStatus(elements, user, readiness = 'signed-out') {
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
    const status = signedIn ? readiness : 'signed-out';
    const statusMessages = {
      'signed-out': '공용 비밀번호로 로그인해 주세요.',
      loading: '클라우드 데이터를 불러오는 중이에요.',
      ready: '',
      'load-error': '클라우드 데이터를 불러오지 못했어요. 다시 불러오거나 로그아웃할 수 있어요.'
    };
    elements.cloudStatus.textContent = statusMessages[status] || statusMessages['signed-out'];
    elements.cloudPanel.hidden = status === 'ready';
    elements.cloudLoginForm.hidden = signedIn;
    elements.cloudUploadButton.disabled = status !== 'ready';
    elements.cloudDownloadButton.hidden = status !== 'load-error';
    elements.cloudDownloadButton.disabled = status !== 'load-error';
    elements.cloudLogoutButton.hidden = !signedIn;
    elements.cloudLogoutButton.disabled = !signedIn || status === 'loading';
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
      recurringUpcomingSection: $('#recurring-upcoming-section'),
      recurringUpcomingHeading: $('#recurring-upcoming-heading'),
      recurringUpcomingSummary: $('#recurring-upcoming-summary'),
      recurringUpcomingList: $('#recurring-upcoming-list'),
      recurringUpcomingEmpty: $('#recurring-upcoming-empty'),
      recurringTemplateSection: $('#recurring-template-section'),
      recurringTemplateForm: $('#recurring-template-form'),
      recurringTemplateMemo: $('#recurring-template-memo'),
      recurringTemplateCategory: $('#recurring-template-category'),
      recurringTemplateAmount: $('#recurring-template-amount'),
      recurringTemplateDay: $('#recurring-template-day'),
      recurringTemplateSave: $('#recurring-template-save'),
      recurringTemplateCancel: $('#recurring-template-cancel'),
      recurringTemplateMessage: $('#recurring-template-message'),
      recurringTemplateList: $('#recurring-template-list'),
      recurringTemplateEmpty: $('#recurring-template-empty'),
      recurringTemplateHeading: $('#recurring-template-heading'),
      recurringTemplateHelp: $('#recurring-template-help'),
      recurringConfirmDialog: $('#recurring-confirm-dialog'),
      recurringConfirmForm: $('#recurring-confirm-form'),
      recurringConfirmHeading: $('#recurring-confirm-heading'),
      recurringConfirmScheduledDate: $('#recurring-confirm-scheduled-date'),
      recurringConfirmDate: $('#recurring-confirm-date'),
      recurringConfirmAmount: $('#recurring-confirm-amount'),
      recurringConfirmCategory: $('#recurring-confirm-category'),
      recurringConfirmMemo: $('#recurring-confirm-memo'),
      recurringConfirmMessage: $('#recurring-confirm-message'),
      recurringConfirmSave: $('#recurring-confirm-save'),
      recurringConfirmCancel: $('#recurring-confirm-cancel'),
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
      budgetTransferForm: $('#budget-transfer-form'),
      budgetTransferFrom: $('#budget-transfer-from'),
      budgetTransferTo: $('#budget-transfer-to'),
      budgetTransferAmount: $('#budget-transfer-amount'),
      budgetTransferAvailable: $('#budget-transfer-available'),
      budgetTransferMessage: $('#budget-transfer-message'),
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
      globalMessage: $('#global-message'),
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
    renderUpcomingRecurringExpenses,
    renderRecurringExpenseTemplates,
    fillRecurringExpenseCategoryOptions,
    beginRecurringTemplateEdit,
    clearRecurringTemplateEdit,
    openRecurringConfirmDialog,
    closeRecurringConfirmDialog,
    resetRecurringExpenseUi,
    initDefaults,
    renderCategoryBudgetFields,
    syncCategoryBudgetInputs,
    readCategoryBudgetInputs,
    fillBudgetTransferCategoryOptions,
    renderBudgetTransferAvailability,
    renderSummary,
    renderCategoryBudgetStatus,
    renderCategoryBreakdown,
    renderList,
    updateCloudStatus,
    downloadText,
    getElements
  };
})(window, document);
