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

  function error(field, message) {
    return { field, message };
  }

  function validateTransaction(input) {
    const errors = [];
    const type = input.type;
    const amount = Number(input.amount);
    const category = String(input.category || '').trim();
    const date = String(input.date || '').trim();
    const memo = String(input.memo || '').trim();

    if (!window.BudgetStorage.isValidDateString(date)) errors.push(error('date', '날짜를 올바르게 선택해 주세요.'));
    if (!TYPES.includes(type)) errors.push(error('type', '유형은 수입 또는 지출만 선택할 수 있어요.'));
    if (!category || !categoriesFor(type).includes(category)) errors.push(error('category', '선택한 유형에 맞는 카테고리를 골라 주세요.'));
    if (!window.BudgetStorage.isPositiveInteger(amount)) errors.push(error('amount', '금액은 쉼표 없이 1원 이상의 양의 정수로 입력해 주세요.'));
    if (memo.length > window.BudgetStorage.MAX_MEMO_LENGTH) errors.push(error('memo', '메모는 80자 이내로 입력해 주세요.'));

    return { valid: errors.length === 0, errors };
  }

  function addTransaction(state, input) {
    const validation = validateTransaction(input);
    if (!validation.valid) {
      return { state, ok: false, errors: validation.errors };
    }

    const transaction = {
      id: window.BudgetStorage.createId(),
      date: input.date,
      type: input.type,
      category: input.category,
      amount: Number(input.amount),
      memo: String(input.memo || '').trim(),
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

  function setMonthlyBudget(state, amount) {
    const budget = Number(amount);
    if (!window.BudgetStorage.isPositiveInteger(budget)) {
      return { state, ok: false, errors: [error('monthlyBudget', '예산은 쉼표 없이 1원 이상의 양의 정수로 입력해 주세요.')] };
    }
    return { state: { ...state, monthlyBudget: budget }, ok: true, errors: [] };
  }

  function filterTransactions(transactions, filters) {
    const month = filters.month || '';
    const type = filters.type || 'all';
    return transactions
      .filter((tx) => !month || monthFromDate(tx.date) === month)
      .filter((tx) => type === 'all' || tx.type === type)
      .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  }

  function summarize(transactions, monthlyBudget, month) {
    const target = filterTransactions(transactions, { month, type: 'all' });
    const income = target.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + tx.amount, 0);
    const expense = target.filter((tx) => tx.type === 'expense').reduce((sum, tx) => sum + tx.amount, 0);
    const balance = income - expense;
    const budgetUsed = expense;
    const budgetRemaining = Number(monthlyBudget) - expense;
    const budgetRate = Number(monthlyBudget) > 0 ? Math.min(999, Math.round((expense / Number(monthlyBudget)) * 100)) : 0;
    return { income, expense, balance, budgetUsed, budgetRemaining, budgetRate, monthlyBudget: Number(monthlyBudget), count: target.length };
  }

  function hasSampleForMonth(transactions, month) {
    return transactions.some((tx) => tx.source === 'sample' && monthFromDate(tx.date) === month);
  }

  function createSampleState(currentState, month, options = {}) {
    const targetMonth = month || window.BudgetStorage.localMonthString();
    const baseTransactions = options.replace
      ? currentState.transactions.filter((tx) => !(tx.source === 'sample' && monthFromDate(tx.date) === targetMonth))
      : currentState.transactions;
    const samples = [
      { date: `${targetMonth}-01`, type: 'income', category: '월급', amount: 2500000, memo: `${SAMPLE_SIGNATURE}: 이번 달 월급` },
      { date: `${targetMonth}-03`, type: 'expense', category: '식비', amount: 32000, memo: `${SAMPLE_SIGNATURE}: 장보기` },
      { date: `${targetMonth}-05`, type: 'expense', category: '교통', amount: 62000, memo: `${SAMPLE_SIGNATURE}: 교통카드 충전` },
      { date: `${targetMonth}-09`, type: 'expense', category: '카페/간식', amount: 6800, memo: `${SAMPLE_SIGNATURE}: 커피` },
      { date: `${targetMonth}-12`, type: 'expense', category: '고정비', amount: 120000, memo: `${SAMPLE_SIGNATURE}: 통신비와 구독` },
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
    validateTransaction,
    addTransaction,
    deleteTransaction,
    setMonthlyBudget,
    filterTransactions,
    summarize,
    hasSampleForMonth,
    createSampleState,
    exportState,
    importState,
    monthFromDate
  };
})(window);
