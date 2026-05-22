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
    if (!window.BudgetStorage.isPositiveInteger(normalized.amount)) errors.push(error('amount', '금액은 1원 이상의 숫자로 입력해 주세요. 쉼표(예: 12,000)는 사용할 수 있어요.'));
    if (normalized.memo.length > window.BudgetStorage.MAX_MEMO_LENGTH) errors.push(error('memo', '메모는 80자 이내로 입력해 주세요.'));

    return { valid: errors.length === 0, errors, value: normalized };
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

  function deleteTransaction(state, id) {
    return {
      ...state,
      transactions: state.transactions.filter((tx) => tx.id !== id)
    };
  }

  function setMonthlyBudget(state, amount, month) {
    const budget = Number(amount);
    if (!window.BudgetStorage.isPositiveInteger(budget)) {
      return { state, ok: false, errors: [error('monthlyBudget', '예산은 쉼표 없이 1원 이상의 양의 정수로 입력해 주세요.')] };
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
        errors.push(error('categoryBudgets', `${category} 예산은 1원 이상의 숫자로 입력해 주세요.`));
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
    const query = String(filters.query || '').trim().toLocaleLowerCase('ko-KR');
    return transactions
      .filter((tx) => !month || window.BudgetStorage.isDateInBudgetMonth(tx.date, month, monthStartDay))
      .filter((tx) => type === 'all' || tx.type === type)
      .filter((tx) => {
        if (!query) return true;
        return [tx.date, typeLabelsForSearch(tx.type), tx.category, tx.memo]
          .join(' ')
          .toLocaleLowerCase('ko-KR')
          .includes(query);
      })
      .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
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
    const baseTransactions = options.replace
      ? currentState.transactions.filter((tx) => !(tx.source === 'sample' && monthFromDate(tx.date) === targetMonth))
      : currentState.transactions;
    const samples = [
      { date: `${targetMonth}-01`, type: 'income', category: '월급', amount: 2500000, memo: `${SAMPLE_SIGNATURE}: 이번 달 월급` },
      { date: `${targetMonth}-03`, type: 'expense', category: '생활비', amount: 32000, memo: `${SAMPLE_SIGNATURE}: 장보기` },
      { date: `${targetMonth}-05`, type: 'expense', category: '배달비', amount: 62000, memo: `${SAMPLE_SIGNATURE}: 배달 음식` },
      { date: `${targetMonth}-09`, type: 'expense', category: '의류비', amount: 68000, memo: `${SAMPLE_SIGNATURE}: 옷 구매` },
      { date: `${targetMonth}-12`, type: 'expense', category: '비상금', amount: 120000, memo: `${SAMPLE_SIGNATURE}: 예비 지출` },
      { date: `${targetMonth}-15`, type: 'income', category: '부수입', amount: 80000, memo: `${SAMPLE_SIGNATURE}: 중고 거래` }
    ].map((tx) => ({ ...tx, id: window.BudgetStorage.createId(), source: 'sample' }));

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
      if (!Array.isArray(parsed.transactions) || parsed.transactions.length === 0) {
        return { ok: false, state: null, errors: [error('importData', '가져올 거래 내역이 없어요. 빈 백업으로 현재 데이터를 교체하지 않습니다.')] };
      }
      const normalized = window.BudgetStorage.normalizeState(parsed);
      if (normalized.transactions.length === 0) {
        return { ok: false, state: null, errors: [error('importData', '유효한 거래가 없어 가져오기를 중단했어요.')] };
      }
      return {
        ok: true,
        state: normalized,
        errors: [],
        summary: {
          sourceCount: parsed.transactions.length,
          importedCount: normalized.transactions.length,
          skippedCount: parsed.transactions.length - normalized.transactions.length
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
    addTransaction,
    deleteTransaction,
    setMonthlyBudget,
    setMonthStartDay,
    setCategoryBudgets,
    filterTransactions,
    summarize,
    hasSampleForMonth,
    createSampleState,
    exportState,
    importState,
    monthFromDate
  };
})(window);
