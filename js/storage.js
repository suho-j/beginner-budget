/* beginner-budget-app storage.js */
(function (window) {
  'use strict';

  const STORAGE_KEY = 'beginner-budget-app:v1';
  const DEFAULT_BUDGET = 500000;
  const DEFAULT_MONTH_START_DAY = 1;
  const MAX_MEMO_LENGTH = 80;
  const EXPENSE_CATEGORIES = ['생활비', '배달비', '의류비', '비상금'];
  const LEGACY_EXPENSE_CATEGORY_MAP = {
    '식비': '생활비',
    '생활용품': '생활비',
    '교통': '생활비',
    '카페': '배달비',
    '카페/간식': '배달비',
    '쇼핑': '의류비',
    '고정비': '비상금',
    '여가': '비상금',
    '의료': '비상금',
    '기타': '비상금'
  };
  const INCOME_CATEGORIES = ['월급', '용돈', '부수입', '기타'];

  function defaultState() {
    return {
      version: 1,
      monthlyBudget: DEFAULT_BUDGET,
      categoryBudgets: {},
      monthStartDay: DEFAULT_MONTH_START_DAY,
      monthlyBudgets: {},
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

  function isValidMonthString(value) {
    if (!/^\d{4}-\d{2}$/.test(value)) return false;
    const [year, month] = value.split('-').map(Number);
    return year >= 1900 && year <= 2999 && month >= 1 && month <= 12;
  }

  function monthStartDateFor(month, startDay) {
    const [year, monthNumber] = month.split('-').map(Number);
    return new Date(year, monthNumber - 1, Math.min(startDay, new Date(year, monthNumber, 0).getDate()));
  }

  function addMonthsToMonth(month, delta) {
    const [year, monthNumber] = month.split('-').map(Number);
    return localMonthString(new Date(year, monthNumber - 1 + delta, 1));
  }

  function periodRangeForMonth(month, startDay = DEFAULT_MONTH_START_DAY) {
    const normalizedStartDay = normalizeMonthStartDay(startDay);
    const start = monthStartDateFor(month, normalizedStartDay);
    const nextMonth = addMonthsToMonth(month, 1);
    const nextStart = monthStartDateFor(nextMonth, normalizedStartDay);
    const end = new Date(nextStart.getFullYear(), nextStart.getMonth(), nextStart.getDate() - 1);
    return { start: localDateString(start), end: localDateString(end) };
  }

  function monthKeyForDate(dateString, startDay = DEFAULT_MONTH_START_DAY) {
    if (!isValidDateString(dateString)) return '';
    const normalizedStartDay = normalizeMonthStartDay(startDay);
    const [year, month, day] = dateString.split('-').map(Number);
    const currentMonth = `${year}-${pad2(month)}`;
    return day >= normalizedStartDay ? currentMonth : addMonthsToMonth(currentMonth, -1);
  }

  function isDateInBudgetMonth(dateString, month, startDay = DEFAULT_MONTH_START_DAY) {
    if (!isValidDateString(dateString) || !isValidMonthString(month)) return false;
    const range = periodRangeForMonth(month, startDay);
    return dateString >= range.start && dateString <= range.end;
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

  function normalizeExpenseCategory(category) {
    return EXPENSE_CATEGORIES.includes(category) ? category : LEGACY_EXPENSE_CATEGORY_MAP[category] || category;
  }

  function normalizeMonthStartDay(value) {
    const day = Number(value);
    if (!Number.isInteger(day)) return DEFAULT_MONTH_START_DAY;
    return Math.min(31, Math.max(1, day));
  }

  function normalizeTransaction(tx) {
    if (!tx || typeof tx !== 'object') return null;
    const type = tx.type === 'income' ? 'income' : tx.type === 'expense' ? 'expense' : '';
    const date = typeof tx.date === 'string' ? tx.date : '';
    const rawCategory = typeof tx.category === 'string' ? tx.category.trim() : '';
    const category = type === 'expense' ? normalizeExpenseCategory(rawCategory) : rawCategory;
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
    Object.keys(rawBudgets).forEach((rawCategory) => {
      if (String(rawCategory).startsWith('__')) return;
      const category = normalizeExpenseCategory(String(rawCategory).trim());
      if (!EXPENSE_CATEGORIES.includes(category)) return;
      const amount = Number(String(rawBudgets[rawCategory] || '').replaceAll(',', ''));
      if (isPositiveInteger(amount)) budgets[category] = (budgets[category] || 0) + amount;
    });
    return budgets;
  }

  function normalizeMonthlyBudgets(rawBudgets) {
    const monthlyBudgets = {};
    if (!rawBudgets || typeof rawBudgets !== 'object' || Array.isArray(rawBudgets)) return monthlyBudgets;
    Object.keys(rawBudgets).forEach((month) => {
      if (!isValidMonthString(month)) return;
      const raw = rawBudgets[month];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      const entry = {};
      const budget = Number(raw.monthlyBudget);
      if (isPositiveInteger(budget)) entry.monthlyBudget = budget;
      entry.categoryBudgets = normalizeCategoryBudgets(raw.categoryBudgets);
      if (entry.monthlyBudget || Object.keys(entry.categoryBudgets).length) {
        monthlyBudgets[month] = entry;
      }
    });
    return monthlyBudgets;
  }

  function budgetForMonth(state, month) {
    const normalized = normalizeState(state);
    const entry = isValidMonthString(month) ? normalized.monthlyBudgets[month] : null;
    return {
      monthlyBudget: entry && isPositiveInteger(Number(entry.monthlyBudget)) ? Number(entry.monthlyBudget) : normalized.monthlyBudget,
      categoryBudgets: entry && Object.keys(entry.categoryBudgets || {}).length ? entry.categoryBudgets : normalized.categoryBudgets
    };
  }

  function normalizeState(raw) {
    const state = defaultState();
    if (!raw || typeof raw !== 'object') return state;

    const budget = Number(raw.monthlyBudget);
    if (isPositiveInteger(budget)) state.monthlyBudget = budget;

    state.categoryBudgets = normalizeCategoryBudgets(raw.categoryBudgets);
    state.monthStartDay = normalizeMonthStartDay(raw.monthStartDay);
    state.monthlyBudgets = normalizeMonthlyBudgets(raw.monthlyBudgets);

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
    return defaultState();
  }

  function saveState(state) {
    return { ok: true, state: normalizeState(state), error: null };
  }

  function resetState() {
    return { ok: true, state: defaultState(), error: null };
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
    DEFAULT_MONTH_START_DAY,
    MAX_MEMO_LENGTH,
    EXPENSE_CATEGORIES,
    INCOME_CATEGORIES,
    defaultState,
    normalizeState,
    normalizeCategoryBudgets,
    normalizeMonthlyBudgets,
    normalizeExpenseCategory,
    normalizeMonthStartDay,
    budgetForMonth,
    periodRangeForMonth,
    monthKeyForDate,
    isDateInBudgetMonth,
    loadState,
    saveState,
    resetState,
    createId,
    isPositiveInteger,
    isValidDateString,
    isValidMonthString,
    localDateString,
    localMonthString,
    categoriesFor
  };
})(window);
