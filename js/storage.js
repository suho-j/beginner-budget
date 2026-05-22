/* beginner-budget-app storage.js */
(function (window) {
  'use strict';

  const STORAGE_KEY = 'beginner-budget-app:v1';
  const DEFAULT_BUDGET = 500000;
  const MAX_MEMO_LENGTH = 80;
  const EXPENSE_CATEGORIES = ['식비', '카페/간식', '교통', '생활용품', '쇼핑', '고정비', '여가', '의료', '기타'];
  const INCOME_CATEGORIES = ['월급', '용돈', '부수입', '기타'];

  function defaultState() {
    return {
      version: 1,
      monthlyBudget: DEFAULT_BUDGET,
      categoryBudgets: {},
      transactions: []
    };
  }

  function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function localDateString(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function localMonthString(date = new Date()) {
    return localDateString(date).slice(0, 7);
  }

  function isValidDateString(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function categoriesFor(type) {
    return type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  }

  function normalizeTransaction(tx) {
    if (!tx || typeof tx !== 'object') return null;
    const type = tx.type === 'income' ? 'income' : tx.type === 'expense' ? 'expense' : '';
    const date = typeof tx.date === 'string' ? tx.date : '';
    const category = typeof tx.category === 'string' ? tx.category.trim() : '';
    const amount = Number(tx.amount);

    if (!type || !isValidDateString(date) || !categoriesFor(type).includes(category) || !isPositiveInteger(amount)) {
      return null;
    }

    const memo = typeof tx.memo === 'string' ? tx.memo.trim().slice(0, MAX_MEMO_LENGTH) : '';
    const source = tx.source === 'sample' ? 'sample' : 'user';

    return {
      id: typeof tx.id === 'string' && tx.id ? tx.id : createId(),
      date,
      type,
      category,
      amount,
      memo,
      source
    };
  }

  function normalizeCategoryBudgets(rawBudgets) {
    const budgets = {};
    if (!rawBudgets || typeof rawBudgets !== 'object' || Array.isArray(rawBudgets)) return budgets;
    EXPENSE_CATEGORIES.forEach((category) => {
      const amount = Number(String(rawBudgets[category] || '').replaceAll(',', ''));
      if (isPositiveInteger(amount)) budgets[category] = amount;
    });
    return budgets;
  }

  function normalizeState(raw) {
    const state = defaultState();
    if (!raw || typeof raw !== 'object') return state;

    const budget = Number(raw.monthlyBudget);
    if (isPositiveInteger(budget)) state.monthlyBudget = budget;

    state.categoryBudgets = normalizeCategoryBudgets(raw.categoryBudgets);

    if (Array.isArray(raw.transactions)) {
      const seenIds = new Set();
      state.transactions = raw.transactions.map(normalizeTransaction).filter(Boolean).map((tx) => {
        if (seenIds.has(tx.id)) {
          tx.id = createId();
        }
        seenIds.add(tx.id);
        return tx;
      });
    }

    return state;
  }

  function loadState() {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) return defaultState();
      return normalizeState(JSON.parse(saved));
    } catch (error) {
      console.warn('저장된 가계부 데이터를 읽을 수 없어 기본값으로 시작합니다.', error);
      return defaultState();
    }
  }

  function saveState(state) {
    const normalized = normalizeState(state);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      return { ok: true, state: normalized, error: null };
    } catch (error) {
      console.error('가계부 데이터를 저장하지 못했습니다.', error);
      return { ok: false, state: normalized, error };
    }
  }

  function resetState() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      return { ok: true, state: defaultState(), error: null };
    } catch (error) {
      console.error('가계부 데이터를 초기화하지 못했습니다.', error);
      return { ok: false, state: loadState(), error };
    }
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return 'tx-' + window.crypto.randomUUID();
    }
    return 'tx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  window.BudgetStorage = {
    STORAGE_KEY,
    DEFAULT_BUDGET,
    MAX_MEMO_LENGTH,
    EXPENSE_CATEGORIES,
    INCOME_CATEGORIES,
    defaultState,
    normalizeState,
    normalizeCategoryBudgets,
    loadState,
    saveState,
    resetState,
    createId,
    isPositiveInteger,
    isValidDateString,
    localDateString,
    localMonthString,
    categoriesFor
  };
})(window);
