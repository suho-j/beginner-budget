/* beginner-budget-app storage.js */
(function (window) {
  'use strict';

  const STORAGE_KEY = 'beginner-budget-app:v1';
  const CURRENT_STATE_VERSION = 2;
  const DEFAULT_BUDGET = 500000;
  const DEFAULT_MONTH_START_DAY = 1;
  const MAX_MEMO_LENGTH = 80;
  const MAX_DB_INTEGER = 2147483647;
  const MAX_RECURRING_EXPENSE_TEMPLATES = 100;
  const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
  const RECURRING_TEMPLATE_ID_PATTERN = /^rt-[A-Za-z0-9._:-]+$/;
  const EXPENSE_CATEGORIES = ['생활비', '배달비', '의류비', '비상금', '휴가비'];
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
      version: CURRENT_STATE_VERSION,
      monthlyBudget: DEFAULT_BUDGET,
      categoryBudgets: {},
      monthStartDay: DEFAULT_MONTH_START_DAY,
      monthlyBudgets: {},
      recurringExpenseTemplates: [],
      cashflowPlans: {},
      transactions: []
    };
  }

  function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0 && value <= MAX_DB_INTEGER;
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

  function calendarDaysForBudgetMonth(month, startDay = DEFAULT_MONTH_START_DAY) {
    if (!isValidMonthString(month)) return [];
    const range = periodRangeForMonth(month, startDay);
    const [startYear, startMonth, startDate] = range.start.split('-').map(Number);
    const [endYear, endMonth, endDate] = range.end.split('-').map(Number);
    const first = new Date(startYear, startMonth - 1, startDate);
    const last = new Date(endYear, endMonth - 1, endDate);
    first.setDate(first.getDate() - first.getDay());
    last.setDate(last.getDate() + (6 - last.getDay()));

    const days = [];
    for (const cursor = new Date(first); cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
      const date = localDateString(cursor);
      days.push({ date, day: cursor.getDate(), inPeriod: date >= range.start && date <= range.end });
    }
    return days;
  }

  function monthKeyForDate(dateString, startDay = DEFAULT_MONTH_START_DAY) {
    if (!isValidDateString(dateString)) return '';
    const normalizedStartDay = normalizeMonthStartDay(startDay);
    const [year, month] = dateString.split('-').map(Number);
    const currentMonth = `${year}-${pad2(month)}`;
    const currentMonthStart = localDateString(monthStartDateFor(currentMonth, normalizedStartDay));
    return dateString >= currentMonthStart ? currentMonth : addMonthsToMonth(currentMonth, -1);
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
    const rawId = typeof tx.id === 'string' ? tx.id : '';
    const id = TRANSACTION_ID_PATTERN.test(rawId) ? rawId : '';

    if (!type || !isValidDateString(date) || !categoriesFor(type).includes(category) || !isPositiveInteger(amount)) {
      return null;
    }

    const memo = typeof tx.memo === 'string' ? tx.memo.trim().slice(0, MAX_MEMO_LENGTH) : '';
    const source = tx.source === 'sample' ? 'sample' : 'user';

    return {
      id: id || createId(),
      date,
      type,
      category,
      amount,
      memo,
      source
    };
  }

  function normalizeRecurringExpenseTemplate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = typeof raw.id === 'string' ? raw.id : '';
    const memo = typeof raw.memo === 'string' ? raw.memo.trim() : '';
    const rawCategory = typeof raw.category === 'string' ? raw.category.trim() : '';
    const category = normalizeExpenseCategory(rawCategory);
    const amount = Number(raw.amount);
    const dayOfMonth = raw.dayOfMonth;
    const startsOn = typeof raw.startsOn === 'string' ? raw.startsOn : '';

    if (
      !RECURRING_TEMPLATE_ID_PATTERN.test(id)
      || memo.length < 1
      || memo.length > MAX_MEMO_LENGTH
      || !EXPENSE_CATEGORIES.includes(category)
      || !isPositiveInteger(amount)
      || !Number.isInteger(dayOfMonth)
      || dayOfMonth < 1
      || dayOfMonth > 31
      || !isValidDateString(startsOn)
    ) {
      return null;
    }

    return { id, memo, category, amount, dayOfMonth, startsOn };
  }

  function normalizeRecurringExpenseTemplates(raw) {
    if (!Array.isArray(raw)) return [];
    const templates = [];
    const seenIds = new Set();
    for (const item of raw) {
      const template = normalizeRecurringExpenseTemplate(item);
      if (!template || seenIds.has(template.id)) continue;
      templates.push(template);
      seenIds.add(template.id);
      if (templates.length === MAX_RECURRING_EXPENSE_TEMPLATES) break;
    }
    return templates;
  }

  function normalizeCategoryBudgets(rawBudgets) {
    const budgets = {};
    const overflowedCategories = new Set();
    if (!rawBudgets || typeof rawBudgets !== 'object' || Array.isArray(rawBudgets)) return budgets;
    Object.keys(rawBudgets).forEach((rawCategory) => {
      if (String(rawCategory).startsWith('__')) return;
      const category = normalizeExpenseCategory(String(rawCategory).trim());
      if (!EXPENSE_CATEGORIES.includes(category)) return;
      const amount = Number(String(rawBudgets[rawCategory] || '').replaceAll(',', ''));
      if (!isPositiveInteger(amount) || overflowedCategories.has(category)) return;
      const combined = (budgets[category] || 0) + amount;
      if (!isPositiveInteger(combined)) {
        delete budgets[category];
        overflowedCategories.add(category);
        return;
      }
      budgets[category] = combined;
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
    state.recurringExpenseTemplates = normalizeRecurringExpenseTemplates(raw.recurringExpenseTemplates);
    state.cashflowPlans = normalizeCashflowPlans(raw.cashflowPlans);

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

  const CASHFLOW_KINDS = {income: '수입', fixed: '고정 납부', allowance: '용돈', reserve: '목적 적립', saving: '기존 저축', transfer: '계좌 간 이동'};
  const FIXED_COST_STATUSES = {keep: '유지', review: '검토 중', reduce: '절감 예정'};

  function cashflowAmount(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const text = String(value).trim();
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return null;
    const amount = Number(text.replaceAll(',', ''));
    return Number.isSafeInteger(amount) && amount >= 0 && amount <= MAX_DB_INTEGER ? amount : null;
  }

  function normalizeCashflowPlan(raw) {
    if (!raw || !Array.isArray(raw.items) || raw.items.length > 100) return null;
    const livingBudget = cashflowAmount(raw.livingBudget);
    if (livingBudget === null) return null;
    const items = [];
    for (const item of raw.items) {
      if (!item || typeof item.name !== 'string' || !Object.hasOwn(CASHFLOW_KINDS, item.kind)) return null;
      const name = item.name.trim();
      const amount = cashflowAmount(item.amount);
      if (!name || name.length > 80 || amount === null) return null;
      const normalized = {name, kind: item.kind, amount};
      if (item.schedule !== undefined) {
        const s = item.schedule;
        if (!s || typeof s !== 'object' || Array.isArray(s) ||
          typeof s.day !== 'string' || !/^(?:|last|[1-9]|[12]\d|3[01])$/.test(s.day) ||
          !['previous','next','none'].includes(s.rule) ||
          typeof s.account !== 'string' || s.account.length > 80 ||
          typeof s.note !== 'string' || s.note.length > 200) return null;
        normalized.schedule = {day:s.day,rule:s.rule,account:s.account.trim(),note:s.note.trim()};
      }
      if (item.kind === 'fixed' && item.fixedCost !== undefined) {
        const detail = normalizeFixedCost(item.fixedCost, amount);
        if (!detail) return null;
        normalized.fixedCost = detail;
      }
      items.push(normalized);
    }
    return {items, livingBudget};
  }

  function normalizeFixedCost(raw, currentAmount) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const status = raw.status === undefined ? 'keep' : raw.status;
    if (typeof status !== 'string' || !Object.hasOwn(FIXED_COST_STATUSES, status)) return null;
    const emptyTarget = raw.targetAmount === undefined || raw.targetAmount === null ||
      (typeof raw.targetAmount === 'string' && !raw.targetAmount.trim());
    const targetAmount = emptyTarget ? null : cashflowAmount(raw.targetAmount);
    if (!emptyTarget && targetAmount === null) return null;
    if (status === 'reduce' && (targetAmount === null || targetAmount > currentAmount)) return null;
    const result = {status, targetAmount};
    for (const [field, maxLength] of [['paymentDay',40],['paymentMethod',40],['memo',200]]) {
      const value = raw[field] === undefined ? '' : raw[field];
      if (typeof value !== 'string' || value.trim().length > maxLength) return null;
      result[field] = value.trim();
    }
    return result;
  }

  function normalizeCashflowPlans(raw) {
    const plans = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return plans;
    for (const month of Object.keys(raw)) {
      if (!isValidMonthString(month)) continue;
      const plan = normalizeCashflowPlan(raw[month]);
      if (plan) plans[month] = plan;
    }
    return plans;
  }

  function summarizeCashflow(raw) {
    const plan = normalizeCashflowPlan(raw);
    if (!plan) return null;
    const totals = {income: 0, fixed: 0, allowance: 0, reserve: 0, saving: 0, transfer: 0};
    for (const item of plan.items) totals[item.kind] += item.amount;
    const committed = totals.fixed + totals.allowance + totals.reserve + totals.saving;
    return {...totals, committed, available: totals.income - committed,
      livingBudget: plan.livingBudget, additionalSaving: totals.income - committed - plan.livingBudget};
  }

  function summarizeFixedCosts(raw) {
    const plan = normalizeCashflowPlan(raw);
    if (!plan) return null;
    const totals = summarizeCashflow(plan);
    const monthlySaving = plan.items.reduce((sum, item) => sum +
      (item.kind === 'fixed' && item.fixedCost?.status === 'reduce' ? item.amount - item.fixedCost.targetAmount : 0), 0);
    return {monthly: totals.fixed, incomeRatio: totals.income > 0 ? totals.fixed / totals.income * 100 : null,
      monthlySaving, annualSaving: monthlySaving * 12, afterMonthly: totals.fixed - monthlySaving,
      afterAdditionalSaving: totals.additionalSaving + monthlySaving};
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

  function createId(prefix = 'tx') {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return prefix + '-' + window.crypto.randomUUID();
    }
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function scheduledDateForMonth(month, dayOfMonth) {
    if (!isValidMonthString(month) || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      return '';
    }
    const [year, monthNumber] = month.split('-').map(Number);
    const lastDay = new Date(year, monthNumber, 0).getDate();
    return `${month}-${pad2(Math.min(dayOfMonth, lastDay))}`;
  }

  window.BudgetStorage = {
    CASHFLOW_KINDS,
    FIXED_COST_STATUSES,
    normalizeCashflowPlan,
    normalizeCashflowPlans,
    summarizeCashflow,
    summarizeFixedCosts,
    STORAGE_KEY,
    CURRENT_STATE_VERSION,
    DEFAULT_BUDGET,
    DEFAULT_MONTH_START_DAY,
    MAX_MEMO_LENGTH,
    MAX_DB_INTEGER,
    MAX_RECURRING_EXPENSE_TEMPLATES,
    RECURRING_TEMPLATE_ID_PATTERN,
    EXPENSE_CATEGORIES,
    INCOME_CATEGORIES,
    defaultState,
    normalizeState,
    normalizeRecurringExpenseTemplate,
    normalizeRecurringExpenseTemplates,
    normalizeCategoryBudgets,
    normalizeMonthlyBudgets,
    normalizeExpenseCategory,
    normalizeMonthStartDay,
    budgetForMonth,
    periodRangeForMonth,
    calendarDaysForBudgetMonth,
    addMonthsToMonth,
    monthKeyForDate,
    isDateInBudgetMonth,
    loadState,
    saveState,
    resetState,
    createId,
    scheduledDateForMonth,
    isPositiveInteger,
    isValidDateString,
    isValidMonthString,
    localDateString,
    localMonthString,
    categoriesFor
  };
})(window);
