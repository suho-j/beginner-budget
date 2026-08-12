/* beginner-budget-app transactions.js */
(function (window) {
  'use strict';

  const EXPENSE_CATEGORIES = window.BudgetStorage.EXPENSE_CATEGORIES;
  const INCOME_CATEGORIES = window.BudgetStorage.INCOME_CATEGORIES;
  const TYPES = ['income', 'expense'];
  const SAMPLE_SIGNATURE = '처음 가계부 샘플';

  function categoriesFor(type) {
    return window.BudgetStorage.categoriesFor(type);
  }

  function monthFromDate(date) {
    return typeof date === 'string' ? date.slice(0, 7) : '';
  }

  function budgetMonthFromDate(date, monthStartDay) {
    return window.BudgetStorage.monthKeyForDate(date, monthStartDay);
  }

  function error(field, message) {
    return { field, message };
  }

  function parseMoneyInput(value) {
    if (typeof value === 'number') {
      return window.BudgetStorage.isPositiveInteger(value) ? value : null;
    }
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(trimmed)) return null;
    const amount = Number(trimmed.replaceAll(',', ''));
    return window.BudgetStorage.isPositiveInteger(amount) ? amount : null;
  }

  function canonicalizeTransactionInput(input = {}) {
    const type = input.type;
    return {
      date: String(input.date || '').trim(),
      type,
      category: String(input.category || '').trim(),
      amount: parseMoneyInput(input.amount),
      memo: String(input.memo || '').trim()
    };
  }

  function validateTransaction(input) {
    const errors = [];
    const normalized = canonicalizeTransactionInput(input || {});

    if (!window.BudgetStorage.isValidDateString(normalized.date)) errors.push(error('date', '날짜를 올바르게 선택해 주세요.'));
    if (!TYPES.includes(normalized.type)) errors.push(error('type', '유형은 수입 또는 지출만 선택할 수 있어요.'));
    if (!normalized.category || !categoriesFor(normalized.type).includes(normalized.category)) errors.push(error('category', '선택한 유형에 맞는 카테고리를 골라 주세요.'));
    if (!window.BudgetStorage.isPositiveInteger(normalized.amount)) errors.push(error('amount', '금액은 1원 이상 2,147,483,647원 이하의 숫자로 입력해 주세요. 쉼표(예: 12,000)는 사용할 수 있어요.'));
    if (normalized.memo.length > window.BudgetStorage.MAX_MEMO_LENGTH) errors.push(error('memo', '메모는 80자 이내로 입력해 주세요.'));

    return { valid: errors.length === 0, errors, value: normalized };
  }

  function canonicalizeRecurringExpenseTemplateInput(input = {}) {
    const value = input && typeof input === 'object' ? input : {};
    const rawDayOfMonth = value.dayOfMonth;
    const dayOfMonth = (
      typeof rawDayOfMonth === 'number'
      || (typeof rawDayOfMonth === 'string' && rawDayOfMonth.trim() !== '')
    ) ? Number(rawDayOfMonth) : NaN;
    return {
      memo: String(value.memo || '').trim(),
      category: String(value.category || '').trim(),
      amount: parseMoneyInput(value.amount),
      dayOfMonth
    };
  }

  function validateRecurringExpenseTemplate(input) {
    const errors = [];
    const normalized = canonicalizeRecurringExpenseTemplateInput(input);

    if (!normalized.memo || normalized.memo.length > window.BudgetStorage.MAX_MEMO_LENGTH) {
      errors.push(error('memo', '메모는 1자 이상 80자 이내로 입력해 주세요.'));
    }
    if (!EXPENSE_CATEGORIES.includes(normalized.category)) {
      errors.push(error('category', '지출 카테고리를 골라 주세요.'));
    }
    if (!window.BudgetStorage.isPositiveInteger(normalized.amount)) {
      errors.push(error('amount', '금액은 1원 이상 2,147,483,647원 이하의 숫자로 입력해 주세요. 쉼표(예: 12,000)도 사용할 수 있어요.'));
    }
    if (!Number.isInteger(normalized.dayOfMonth) || normalized.dayOfMonth < 1 || normalized.dayOfMonth > 31) {
      errors.push(error('dayOfMonth', '발생일은 1일부터 31일 사이로 입력해 주세요.'));
    }

    return { valid: errors.length === 0, errors, value: normalized };
  }

  function addRecurringExpenseTemplate(state, input, today = new Date()) {
    const validation = validateRecurringExpenseTemplate(input);
    if (!validation.valid) {
      return { state, ok: false, template: null, errors: validation.errors };
    }

    const templates = Array.isArray(state.recurringExpenseTemplates) ? state.recurringExpenseTemplates : [];
    if (templates.length >= window.BudgetStorage.MAX_RECURRING_EXPENSE_TEMPLATES) {
      return {
        state,
        ok: false,
        template: null,
        errors: [error('recurringExpenseTemplates', '반복 지출은 최대 100개까지 등록할 수 있어요.')]
      };
    }

    const template = {
      id: window.BudgetStorage.createId('rt'),
      ...validation.value,
      startsOn: window.BudgetStorage.localDateString(today)
    };
    return {
      state: { ...state, recurringExpenseTemplates: [...templates, template] },
      ok: true,
      template,
      errors: []
    };
  }

  function updateRecurringExpenseTemplate(state, id, input) {
    const templates = Array.isArray(state.recurringExpenseTemplates) ? state.recurringExpenseTemplates : [];
    const index = templates.findIndex((template) => template.id === id);
    if (index < 0) {
      return {
        state,
        ok: false,
        template: null,
        errors: [error('recurringExpenseTemplate', '수정할 반복 지출을 찾지 못했어요.')]
      };
    }

    const validation = validateRecurringExpenseTemplate(input);
    if (!validation.valid) {
      return { state, ok: false, template: null, errors: validation.errors };
    }

    const previous = templates[index];
    const template = {
      id: previous.id,
      ...validation.value,
      startsOn: previous.startsOn
    };
    const recurringExpenseTemplates = templates.slice();
    recurringExpenseTemplates[index] = template;
    return {
      state: { ...state, recurringExpenseTemplates },
      ok: true,
      template,
      errors: []
    };
  }

  function deleteRecurringExpenseTemplate(state, id) {
    const templates = Array.isArray(state.recurringExpenseTemplates) ? state.recurringExpenseTemplates : [];
    return {
      ...state,
      recurringExpenseTemplates: templates.filter((template) => template.id !== id)
    };
  }

  function recurringTransactionId(templateId, scheduledMonth) {
    if (
      typeof templateId !== 'string'
      || !window.BudgetStorage.RECURRING_TEMPLATE_ID_PATTERN.test(templateId)
      || !window.BudgetStorage.isValidMonthString(scheduledMonth)
    ) {
      return '';
    }
    return `tx-recurring-${templateId}-${scheduledMonth}`;
  }

  function deriveRecurringExpenseOccurrences(state, budgetMonth, today = new Date()) {
    if (!window.BudgetStorage.isValidMonthString(budgetMonth)) return [];

    const normalized = window.BudgetStorage.normalizeState(state);
    const range = window.BudgetStorage.periodRangeForMonth(budgetMonth, normalized.monthStartDay);
    const firstMonth = range.start.slice(0, 7);
    const lastMonth = range.end.slice(0, 7);
    const todayString = window.BudgetStorage.localDateString(today);
    const transactionsById = new Map(normalized.transactions.map((transaction) => [transaction.id, transaction]));
    const occurrences = [];

    for (
      let scheduledMonth = firstMonth;
      ;
      scheduledMonth = window.BudgetStorage.addMonthsToMonth(scheduledMonth, 1)
    ) {
      normalized.recurringExpenseTemplates.forEach((template) => {
        const scheduledDate = window.BudgetStorage.scheduledDateForMonth(scheduledMonth, template.dayOfMonth);
        if (!scheduledDate || scheduledDate < range.start || scheduledDate > range.end || scheduledDate < template.startsOn) {
          return;
        }

        const transactionId = recurringTransactionId(template.id, scheduledMonth);
        const transaction = transactionsById.get(transactionId) || null;
        const status = transaction
          ? 'recorded'
          : scheduledDate < todayString
            ? 'overdue'
            : scheduledDate === todayString
              ? 'today'
              : 'upcoming';
        occurrences.push({
          templateId: template.id,
          scheduledMonth,
          scheduledDate,
          transactionId,
          memo: template.memo,
          category: template.category,
          amount: template.amount,
          status,
          transaction
        });
      });

      if (scheduledMonth === lastMonth) break;
    }

    const statusOrder = { overdue: 0, today: 1, upcoming: 2, recorded: 3 };
    return occurrences.sort((a, b) => (
      statusOrder[a.status] - statusOrder[b.status]
      || a.scheduledDate.localeCompare(b.scheduledDate)
      || a.memo.localeCompare(b.memo, 'ko-KR')
      || a.templateId.localeCompare(b.templateId)
    ));
  }

  function recurringOccurrenceIdentity(state, occurrence) {
    if (!occurrence || typeof occurrence !== 'object') return null;
    const normalized = window.BudgetStorage.normalizeState(state);
    const template = normalized.recurringExpenseTemplates.find((item) => item.id === occurrence.templateId);
    if (!template || !window.BudgetStorage.isValidMonthString(occurrence.scheduledMonth)) return null;

    const scheduledDate = window.BudgetStorage.scheduledDateForMonth(
      occurrence.scheduledMonth,
      template.dayOfMonth
    );
    const transactionId = recurringTransactionId(template.id, occurrence.scheduledMonth);
    if (
      !scheduledDate
      || scheduledDate < template.startsOn
      || occurrence.scheduledDate !== scheduledDate
      || occurrence.transactionId !== transactionId
    ) {
      return null;
    }
    return { normalized, template, scheduledDate, transactionId };
  }

  function addRecurringExpenseTransaction(state, occurrence, input) {
    const identity = recurringOccurrenceIdentity(state, occurrence);
    if (!identity) {
      return {
        state,
        ok: false,
        transaction: null,
        errors: [error('recurringExpenseOccurrence', '확정할 반복 지출 일정을 다시 확인해 주세요.')]
      };
    }

    const validation = validateTransaction({ ...(input || {}), type: 'expense' });
    if (!validation.valid) {
      return { state, ok: false, transaction: null, errors: validation.errors };
    }
    if (identity.normalized.transactions.some((transaction) => transaction.id === identity.transactionId)) {
      return {
        state,
        ok: false,
        transaction: null,
        errors: [error('transaction', '이미 확정한 반복 지출이에요.')]
      };
    }

    const value = validation.value;
    const transaction = {
      id: identity.transactionId,
      date: value.date,
      type: 'expense',
      category: value.category,
      amount: value.amount,
      memo: value.memo,
      source: 'user'
    };
    const transactions = Array.isArray(state.transactions) ? state.transactions : [];
    return {
      state: { ...state, transactions: [transaction, ...transactions] },
      ok: true,
      transaction,
      errors: []
    };
  }

  function addTransaction(state, input) {
    const validation = validateTransaction(input);
    if (!validation.valid) {
      return { state, ok: false, errors: validation.errors };
    }
    const value = validation.value;

    const transaction = {
      id: window.BudgetStorage.createId(),
      date: value.date,
      type: value.type,
      category: value.category,
      amount: value.amount,
      memo: value.memo,
      source: 'user'
    };

    const nextState = {
      ...state,
      transactions: [transaction, ...state.transactions]
    };
    return { state: nextState, ok: true, transaction, errors: [] };
  }

  function updateTransaction(state, id, input) {
    const index = state.transactions.findIndex((tx) => tx.id === id);
    if (index < 0) {
      return { state, ok: false, transaction: null, errors: [error('transaction', '수정할 거래를 찾지 못했어요.')] };
    }

    const validation = validateTransaction(input);
    if (!validation.valid) {
      return { state, ok: false, transaction: null, errors: validation.errors };
    }

    const previous = state.transactions[index];
    const transaction = {
      ...previous,
      ...validation.value,
      id: previous.id,
      source: previous.source
    };
    const transactions = state.transactions.slice();
    transactions[index] = transaction;
    return { state: { ...state, transactions }, ok: true, transaction, errors: [] };
  }

  function deleteTransaction(state, id) {
    return {
      ...state,
      transactions: state.transactions.filter((tx) => tx.id !== id)
    };
  }

  function setMonthlyBudget(state, amount, month) {
    const budget = Number(amount);
    if (!window.BudgetStorage.isPositiveInteger(budget)) {
      return { state, ok: false, errors: [error('monthlyBudget', '예산은 쉼표 없이 1원 이상 2,147,483,647원 이하의 양의 정수로 입력해 주세요.')] };
    }
    if (!month) return { state: { ...state, monthlyBudget: budget }, ok: true, errors: [] };
    const currentMonthBudget = window.BudgetStorage.budgetForMonth(state, month);
    return {
      state: {
        ...state,
        monthlyBudgets: {
          ...(state.monthlyBudgets || {}),
          [month]: {
            monthlyBudget: budget,
            categoryBudgets: currentMonthBudget.categoryBudgets || {}
          }
        }
      },
      ok: true,
      errors: []
    };
  }

  function setMonthStartDay(state, day) {
    const normalizedDay = window.BudgetStorage.normalizeMonthStartDay(day);
    if (String(day || '').trim() === '' || Number(day) !== normalizedDay) {
      return { state, ok: false, errors: [error('monthStartDay', '월 시작일은 1일부터 31일 사이로 입력해 주세요.')] };
    }
    return { state: { ...state, monthStartDay: normalizedDay }, ok: true, errors: [] };
  }

  function setCategoryBudgets(state, inputBudgets = {}, month) {
    const errors = [];
    const categoryBudgets = {};
    EXPENSE_CATEGORIES.forEach((category) => {
      const rawValue = inputBudgets[category];
      if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') return;
      const amount = parseMoneyInput(rawValue);
      if (!amount) {
        errors.push(error('categoryBudgets', `${category} 예산은 1원 이상 2,147,483,647원 이하의 숫자로 입력해 주세요.`));
        return;
      }
      categoryBudgets[category] = amount;
    });
    if (errors.length) return { state, ok: false, errors };
    if (!month) return { state: { ...state, categoryBudgets }, ok: true, errors: [] };
    const currentMonthBudget = window.BudgetStorage.budgetForMonth(state, month);
    return {
      state: {
        ...state,
        monthlyBudgets: {
          ...(state.monthlyBudgets || {}),
          [month]: {
            monthlyBudget: currentMonthBudget.monthlyBudget,
            categoryBudgets
          }
        }
      },
      ok: true,
      errors: []
    };
  }

  function filterTransactions(transactions, filters) {
    const month = filters.month || '';
    const monthStartDay = window.BudgetStorage.normalizeMonthStartDay(filters.monthStartDay || 1);
    const type = filters.type || 'all';
    const category = filters.category || 'all';
    const query = String(filters.query || '').trim().toLocaleLowerCase('ko-KR');
    return transactions
      .filter((tx) => !month || window.BudgetStorage.isDateInBudgetMonth(tx.date, month, monthStartDay))
      .filter((tx) => type === 'all' || tx.type === type)
      .filter((tx) => category === 'all' || tx.category === category)
      .filter((tx) => {
        if (!query) return true;
        return [tx.date, typeLabelsForSearch(tx.type), tx.category, tx.memo]
          .join(' ')
          .toLocaleLowerCase('ko-KR')
          .includes(query);
      })
      .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  }

  function summarizeTransactionsByDate(transactions, month, monthStartDay = 1) {
    if (!window.BudgetStorage.isValidMonthString(month)) return {};
    const rows = filterTransactions(transactions, {
      month,
      monthStartDay,
      type: 'all',
      category: 'all',
      query: ''
    });
    const byDate = {};
    rows.forEach((tx) => {
      if (!byDate[tx.date]) {
        byDate[tx.date] = { date: tx.date, expense: 0, income: 0, count: 0, transactions: [] };
      }
      const day = byDate[tx.date];
      day[tx.type] += tx.amount;
      day.count += 1;
      day.transactions.push(tx);
    });
    return Object.keys(byDate).sort().reduce((sorted, date) => {
      sorted[date] = byDate[date];
      return sorted;
    }, {});
  }

  function typeLabelsForSearch(type) {
    return type === 'income' ? '수입 income' : type === 'expense' ? '지출 expense' : '';
  }

  function categoryBreakdownFor(transactions, expenseTotal) {
    const totals = new Map();
    transactions
      .filter((tx) => tx.type === 'expense')
      .forEach((tx) => totals.set(tx.category, (totals.get(tx.category) || 0) + tx.amount));
    return Array.from(totals, ([category, amount]) => ({
      category,
      amount,
      rate: expenseTotal > 0 ? Math.round((amount / expenseTotal) * 100) : 0
    })).sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, 'ko-KR'));
  }

  function categoryBudgetStatusFor(categoryBreakdown, categoryBudgets = {}) {
    const spentByCategory = new Map(categoryBreakdown.map((item) => [item.category, item.amount]));
    return EXPENSE_CATEGORIES
      .filter((category) => window.BudgetStorage.isPositiveInteger(Number(categoryBudgets[category])) || spentByCategory.has(category))
      .map((category) => {
        const budget = Number(categoryBudgets[category]) || 0;
        const spent = spentByCategory.get(category) || 0;
        const remaining = budget - spent;
        const rate = budget > 0 ? Math.min(999, Math.round((spent / budget) * 100)) : 0;
        return { category, budget, spent, remaining, rate };
      })
      .sort((a, b) => (b.budget > 0) - (a.budget > 0) || b.spent - a.spent || a.category.localeCompare(b.category, 'ko-KR'));
  }

  function daysRemainingInMonth(month, today = new Date(), monthStartDay = 1) {
    if (!/^\d{4}-\d{2}$/.test(month)) return 0;
    const range = window.BudgetStorage.periodRangeForMonth(month, monthStartDay);
    const todayString = window.BudgetStorage.localDateString(today);
    const startString = todayString >= range.start && todayString <= range.end ? todayString : range.start;
    const [startYear, startMonth, startDay] = startString.split('-').map(Number);
    const [endYear, endMonth, endDay] = range.end.split('-').map(Number);
    const startDate = new Date(startYear, startMonth - 1, startDay);
    const endDate = new Date(endYear, endMonth - 1, endDay);
    return Math.max(1, Math.floor((endDate - startDate) / 86400000) + 1);
  }

  function summarize(transactions, monthlyBudget, month, today = new Date(), categoryBudgets = {}, monthStartDay = 1) {
    const target = filterTransactions(transactions, { month, type: 'all', monthStartDay });
    const income = target.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + tx.amount, 0);
    const expense = target.filter((tx) => tx.type === 'expense').reduce((sum, tx) => sum + tx.amount, 0);
    const balance = income - expense;
    const budgetUsed = expense;
    const budgetRemaining = Number(monthlyBudget) - expense;
    const budgetRate = Number(monthlyBudget) > 0 ? Math.min(999, Math.round((expense / Number(monthlyBudget)) * 100)) : 0;
    const categoryBreakdown = categoryBreakdownFor(target, expense);
    const dailyAllowance = Math.max(0, Math.floor(budgetRemaining / daysRemainingInMonth(month, today, monthStartDay)));
    return {
      income,
      expense,
      balance,
      budgetUsed,
      budgetRemaining,
      budgetRate,
      monthlyBudget: Number(monthlyBudget),
      count: target.length,
      categoryBreakdown,
      categoryBudgetStatus: categoryBudgetStatusFor(categoryBreakdown, categoryBudgets),
      topExpenseCategory: categoryBreakdown[0] || null,
      dailyAllowance
    };
  }

  function hasSampleForMonth(transactions, month, monthStartDay = 1) {
    return transactions.some((tx) => tx.source === 'sample' && budgetMonthFromDate(tx.date, monthStartDay) === month);
  }

  function createSampleState(currentState, month, options = {}) {
    const targetMonth = month || window.BudgetStorage.localMonthString();
    const startDay = window.BudgetStorage.normalizeMonthStartDay(
      options.monthStartDay || currentState.monthStartDay || 1
    );
    const baseTransactions = options.replace
      ? currentState.transactions.filter((tx) => !(
        tx.source === 'sample'
        && window.BudgetStorage.isDateInBudgetMonth(tx.date, targetMonth, startDay)
      ))
      : currentState.transactions;
    const period = window.BudgetStorage.periodRangeForMonth(targetMonth, startDay);
    const [startYear, startMonth, startDate] = period.start.split('-').map(Number);
    const dateAtOffset = (offset) => window.BudgetStorage.localDateString(
      new Date(startYear, startMonth - 1, startDate + offset)
    );
    const samples = [
      { offset: 0, type: 'income', category: '월급', amount: 2500000, memo: `${SAMPLE_SIGNATURE}: 이번 달 월급` },
      { offset: 2, type: 'expense', category: '생활비', amount: 32000, memo: `${SAMPLE_SIGNATURE}: 장보기` },
      { offset: 4, type: 'expense', category: '배달비', amount: 62000, memo: `${SAMPLE_SIGNATURE}: 배달 음식` },
      { offset: 8, type: 'expense', category: '의류비', amount: 68000, memo: `${SAMPLE_SIGNATURE}: 옷 구매` },
      { offset: 11, type: 'expense', category: '비상금', amount: 120000, memo: `${SAMPLE_SIGNATURE}: 예비 지출` },
      { offset: 14, type: 'income', category: '부수입', amount: 80000, memo: `${SAMPLE_SIGNATURE}: 중고 거래` }
    ].map(({ offset, ...tx }) => ({
      ...tx,
      date: dateAtOffset(offset),
      id: window.BudgetStorage.createId(),
      source: 'sample'
    }));

    return {
      ...currentState,
      monthlyBudget: currentState.monthlyBudget || window.BudgetStorage.DEFAULT_BUDGET,
      transactions: [...samples, ...baseTransactions]
    };
  }

  function exportState(state) {
    return JSON.stringify(window.BudgetStorage.normalizeState(state), null, 2);
  }

  function importState(jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, state: null, errors: [error('importData', '가계부 백업 JSON 객체가 아니에요.')] };
      }
      const hasSourceVersion = Object.prototype.hasOwnProperty.call(parsed, 'version');
      const sourceVersion = hasSourceVersion ? parsed.version : 1;
      if (
        (hasSourceVersion && typeof sourceVersion !== 'number')
        || !Number.isInteger(sourceVersion)
        || sourceVersion < 1
      ) {
        return { ok: false, state: null, errors: [error('importData', '백업 버전이 올바르지 않아요.')] };
      }
      if (sourceVersion > window.BudgetStorage.CURRENT_STATE_VERSION) {
        return { ok: false, state: null, errors: [error('importData', '더 새로운 버전의 백업이에요. 앱을 업데이트해 주세요.')] };
      }

      const hasTransactions = Object.prototype.hasOwnProperty.call(parsed, 'transactions');
      if (hasTransactions && !Array.isArray(parsed.transactions)) {
        return { ok: false, state: null, errors: [error('importData', '백업 거래 내역 형식이 올바르지 않아요.')] };
      }
      const hasTemplates = Object.prototype.hasOwnProperty.call(parsed, 'recurringExpenseTemplates');
      if (hasTemplates && !Array.isArray(parsed.recurringExpenseTemplates)) {
        return { ok: false, state: null, errors: [error('importData', '백업 반복 지출 형식이 올바르지 않아요.')] };
      }

      const rawTransactions = Array.isArray(parsed.transactions) ? parsed.transactions : [];
      const rawTemplates = Array.isArray(parsed.recurringExpenseTemplates)
        ? parsed.recurringExpenseTemplates
        : [];
      const eligibleTemplates = sourceVersion >= 2 ? rawTemplates : [];
      if (rawTransactions.length === 0 && eligibleTemplates.length === 0) {
        return { ok: false, state: null, errors: [error('importData', '가져올 거래나 반복 지출이 없어요. 현재 데이터는 그대로 둡니다.')] };
      }
      const normalized = window.BudgetStorage.normalizeState({
        ...parsed,
        recurringExpenseTemplates: eligibleTemplates
      });
      if (normalized.transactions.length === 0 && normalized.recurringExpenseTemplates.length === 0) {
        return { ok: false, state: null, errors: [error('importData', '유효한 거래나 반복 지출이 없어 가져오기를 중단했어요.')] };
      }
      const sourceTransactionCount = rawTransactions.length;
      const importedTransactionCount = normalized.transactions.length;
      const skippedTransactionCount = sourceTransactionCount - importedTransactionCount;
      const sourceTemplateCount = rawTemplates.length;
      const importedTemplateCount = normalized.recurringExpenseTemplates.length;
      const skippedTemplateCount = sourceTemplateCount - importedTemplateCount;
      return {
        ok: true,
        state: normalized,
        errors: [],
        summary: {
          sourceTransactionCount,
          importedTransactionCount,
          skippedTransactionCount,
          sourceTemplateCount,
          importedTemplateCount,
          skippedTemplateCount,
          sourceCount: sourceTransactionCount,
          importedCount: importedTransactionCount,
          skippedCount: skippedTransactionCount
        }
      };
    } catch (err) {
      return { ok: false, state: null, errors: [error('importData', 'JSON 형식이 올바르지 않아요.')] };
    }
  }

  window.BudgetTransactions = {
    EXPENSE_CATEGORIES,
    INCOME_CATEGORIES,
    SAMPLE_SIGNATURE,
    categoriesFor,
    parseMoneyInput,
    canonicalizeTransactionInput,
    validateTransaction,
    canonicalizeRecurringExpenseTemplateInput,
    validateRecurringExpenseTemplate,
    addRecurringExpenseTemplate,
    updateRecurringExpenseTemplate,
    deleteRecurringExpenseTemplate,
    recurringTransactionId,
    deriveRecurringExpenseOccurrences,
    addRecurringExpenseTransaction,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    setMonthlyBudget,
    setMonthStartDay,
    setCategoryBudgets,
    filterTransactions,
    summarizeTransactionsByDate,
    summarize,
    hasSampleForMonth,
    createSampleState,
    exportState,
    importState,
    monthFromDate
  };
})(window);
