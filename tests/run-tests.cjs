const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

function createContext(options = {}) {
  const store = new Map();
  const localStorage = {
    getItem(key) {
      if (options.throwOnGet) throw new Error('get blocked');
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      if (options.throwOnSet) throw new Error('set blocked');
      store.set(key, String(value));
    },
    removeItem(key) {
      if (options.throwOnRemove) throw new Error('remove blocked');
      store.delete(key);
    }
  };
  const testConsole = { ...console, warn() {}, error() {} };
  const context = {
    window: {
      localStorage,
      crypto: { randomUUID: () => 'test-uuid-' + Math.random().toString(16).slice(2) },
      console: testConsole
    },
    console: testConsole
  };
  context.window.window = context.window;
  vm.createContext(context);
  for (const file of ['js/storage.js', 'js/transactions.js', 'js/cloud.js']) {
    const filePath = path.join(__dirname, '..', file);
    if (!fs.existsSync(filePath)) continue;
    const source = fs.readFileSync(filePath, 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  return context.window;
}

function testStorageDefaultsAndIgnoresLocalStorage() {
  const win = createContext();
  assert.deepStrictEqual(win.BudgetStorage.loadState(), win.BudgetStorage.defaultState());
  win.localStorage.setItem(win.BudgetStorage.STORAGE_KEY, JSON.stringify({ monthlyBudget: 900000 }));
  assert.deepStrictEqual(win.BudgetStorage.loadState(), win.BudgetStorage.defaultState());
}

function testSaveDoesNotUseLocalStorage() {
  const win = createContext({ throwOnSet: true });
  const result = win.BudgetStorage.saveState({ monthlyBudget: 700000, transactions: [] });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state.monthlyBudget, 700000);
}

function testStrictDateValidation() {
  const win = createContext();
  assert.strictEqual(win.BudgetStorage.isValidDateString('2026-02-28'), true);
  assert.strictEqual(win.BudgetStorage.isValidDateString('2026-02-31'), false);
  assert.strictEqual(win.BudgetStorage.isValidDateString('2026-13-01'), false);
}

function testLocalDateFormatting() {
  const win = createContext();
  const date = new Date(2026, 4, 1, 0, 30, 0);
  assert.strictEqual(win.BudgetStorage.localDateString(date), '2026-05-01');
  assert.strictEqual(win.BudgetStorage.localMonthString(date), '2026-05');
}

function testNormalizationDropsInvalidRowsAndDeduplicatesIds() {
  const win = createContext();
  const state = win.BudgetStorage.normalizeState({
    monthlyBudget: 700000,
    categoryBudgets: { 생활비: 200000, 배달비: '90000', 월급: 1000, 기타: 0, 잘못된값: 5000 },
    monthStartDay: 25,
    monthlyBudgets: {
      '2026-05': { monthlyBudget: 800000, categoryBudgets: { 생활비: 300000 } },
      'bad': { monthlyBudget: 100000 }
    },
    transactions: [
      { id: 'same', date: '2026-05-01', type: 'expense', category: '생활비', amount: 1000, memo: 'ok' },
      { id: 'same', date: '2026-05-02', type: 'income', category: '월급', amount: 2000, memo: 'ok' },
      { id: '2', date: '2026-02-31', type: 'expense', category: '생활비', amount: 1000 },
      { id: '3', date: '2026-05-01', type: 'expense', category: '월급', amount: 1000 },
      { id: '4', date: '2026-05-01', type: 'income', category: '월급', amount: -1 }
    ]
  });
  assert.strictEqual(state.monthlyBudget, 700000);
  assert.strictEqual(state.monthStartDay, 25);
  assert.strictEqual(JSON.stringify(state.categoryBudgets), JSON.stringify({ 생활비: 200000, 배달비: 90000 }));
  assert.strictEqual(JSON.stringify(state.monthlyBudgets), JSON.stringify({ '2026-05': { monthlyBudget: 800000, categoryBudgets: { 생활비: 300000 } } }));
  assert.strictEqual(state.transactions.length, 2);
  assert.strictEqual(new Set(state.transactions.map((tx) => tx.id)).size, 2);
}

function testCategoryBudgetSaveAndSummary() {
  const win = createContext();
  let state = win.BudgetStorage.defaultState();
  const budgetResult = win.BudgetTransactions.setCategoryBudgets(state, { 생활비: '200,000', 배달비: '90000', 의류비: '' });
  assert.strictEqual(budgetResult.ok, true);
  assert.strictEqual(JSON.stringify(budgetResult.state.categoryBudgets), JSON.stringify({ 생활비: 200000, 배달비: 90000 }));
  state = budgetResult.state;

  state = win.BudgetTransactions.addTransaction(state, {
    date: '2026-05-02', type: 'expense', category: '생활비', amount: 120000, memo: '마트'
  }).state;
  state = win.BudgetTransactions.addTransaction(state, {
    date: '2026-05-03', type: 'expense', category: '배달비', amount: 95000, memo: '택시'
  }).state;

  const summary = win.BudgetTransactions.summarize(state.transactions, state.monthlyBudget, '2026-05', new Date(2026, 4, 20), state.categoryBudgets);
  assert.strictEqual(JSON.stringify(summary.categoryBudgetStatus.slice(0, 2)), JSON.stringify([
    { category: '생활비', budget: 200000, spent: 120000, remaining: 80000, rate: 60 },
    { category: '배달비', budget: 90000, spent: 95000, remaining: -5000, rate: 106 }
  ]));

  const invalid = win.BudgetTransactions.setCategoryBudgets(state, { 생활비: '-1' });
  assert.strictEqual(invalid.ok, false);
}


function testBudgetMonthStartAndMonthlyBudgets() {
  const win = createContext();
  let state = win.BudgetStorage.defaultState();
  let result = win.BudgetTransactions.setMonthStartDay(state, 25);
  assert.strictEqual(result.ok, true);
  state = result.state;
  result = win.BudgetTransactions.setMonthlyBudget(state, 700000, '2026-05');
  assert.strictEqual(result.ok, true);
  state = result.state;
  result = win.BudgetTransactions.setCategoryBudgets(state, { 생활비: '300,000', 배달비: '100000' }, '2026-05');
  assert.strictEqual(result.ok, true);
  state = result.state;

  assert.strictEqual(win.BudgetStorage.monthKeyForDate('2026-05-24', state.monthStartDay), '2026-04');
  assert.strictEqual(win.BudgetStorage.monthKeyForDate('2026-05-25', state.monthStartDay), '2026-05');
  assert.strictEqual(JSON.stringify(win.BudgetStorage.periodRangeForMonth('2026-05', state.monthStartDay)), JSON.stringify({ start: '2026-05-25', end: '2026-06-24' }));
  assert.strictEqual(win.BudgetStorage.budgetForMonth(state, '2026-05').monthlyBudget, 700000);
  assert.strictEqual(JSON.stringify(win.BudgetStorage.budgetForMonth(state, '2026-05').categoryBudgets), JSON.stringify({ 생활비: 300000, 배달비: 100000 }));

  state = win.BudgetTransactions.addTransaction(state, { date: '2026-05-24', type: 'expense', category: '생활비', amount: 1000, memo: '' }).state;
  state = win.BudgetTransactions.addTransaction(state, { date: '2026-05-25', type: 'expense', category: '생활비', amount: 2000, memo: '' }).state;
  state = win.BudgetTransactions.addTransaction(state, { date: '2026-06-24', type: 'expense', category: '배달비', amount: 3000, memo: '' }).state;
  state = win.BudgetTransactions.addTransaction(state, { date: '2026-06-25', type: 'expense', category: '배달비', amount: 4000, memo: '' }).state;
  const filtered = win.BudgetTransactions.filterTransactions(state.transactions, { month: '2026-05', type: 'expense', monthStartDay: state.monthStartDay });
  assert.strictEqual(filtered.length, 2);
  const monthBudget = win.BudgetStorage.budgetForMonth(state, '2026-05');
  const summary = win.BudgetTransactions.summarize(state.transactions, monthBudget.monthlyBudget, '2026-05', new Date(2026, 5, 1), monthBudget.categoryBudgets, state.monthStartDay);
  assert.strictEqual(summary.expense, 5000);
  assert.strictEqual(summary.budgetRemaining, 695000);
}

function testAddTransactionCanonicalizesBeginnerMoneyInput() {
  const win = createContext();
  const state = win.BudgetStorage.defaultState();
  const result = win.BudgetTransactions.addTransaction(state, {
    date: '2026-05-01', type: 'expense', category: '생활비', amount: '12,000', memo: '  점심  '
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.transaction.amount, 12000);
  assert.strictEqual(result.transaction.memo, '점심');
  assert.strictEqual(win.BudgetTransactions.parseMoneyInput('5만원'), null);
  assert.strictEqual(win.BudgetTransactions.parseMoneyInput(true), null);
}

function testSummaryInsightsAndSearchFilter() {
  const win = createContext();
  let state = win.BudgetStorage.defaultState();
  for (const input of [
    { date: '2026-05-01', type: 'income', category: '월급', amount: 1000000, memo: '' },
    { date: '2026-05-02', type: 'expense', category: '생활비', amount: 120000, memo: '마트 장보기' },
    { date: '2026-05-03', type: 'expense', category: '배달비', amount: 30000, memo: '버스' },
    { date: '2026-05-04', type: 'expense', category: '생활비', amount: 50000, memo: '점심' }
  ]) {
    const result = win.BudgetTransactions.addTransaction(state, input);
    assert.strictEqual(result.ok, true);
    state = result.state;
  }

  const summary = win.BudgetTransactions.summarize(state.transactions, 500000, '2026-05', new Date(2026, 4, 20));
  assert.strictEqual(summary.income, 1000000);
  assert.strictEqual(summary.expense, 200000);
  assert.strictEqual(summary.balance, 800000);
  assert.strictEqual(summary.budgetRemaining, 300000);
  assert.strictEqual(summary.dailyAllowance, 25000);
  assert.strictEqual(JSON.stringify(summary.topExpenseCategory), JSON.stringify({ category: '생활비', amount: 170000, rate: 85 }));
  assert.strictEqual(JSON.stringify(summary.categoryBreakdown), JSON.stringify([
    { category: '생활비', amount: 170000, rate: 85 },
    { category: '배달비', amount: 30000, rate: 15 }
  ]));

  const filtered = win.BudgetTransactions.filterTransactions(state.transactions, { month: '2026-05', type: 'all', query: '마트' });
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].memo, '마트 장보기');
}

function testSummaryAndSampleReplace() {
  const win = createContext();
  let state = win.BudgetStorage.defaultState();
  let result = win.BudgetTransactions.addTransaction(state, {
    date: '2026-05-01', type: 'income', category: '월급', amount: 1000, memo: ''
  });
  assert.strictEqual(result.ok, true);
  state = result.state;
  result = win.BudgetTransactions.addTransaction(state, {
    date: '2026-05-02', type: 'expense', category: '생활비', amount: 300, memo: ''
  });
  state = result.state;
  const summary = win.BudgetTransactions.summarize(state.transactions, 500000, '2026-05', new Date(2026, 4, 2));
  assert.strictEqual(summary.income, 1000);
  assert.strictEqual(summary.expense, 300);
  assert.strictEqual(summary.balance, 700);
  assert.strictEqual(summary.budgetRemaining, 499700);
  assert.strictEqual(summary.dailyAllowance, 16656);
  assert.strictEqual(summary.count, 2);

  state = win.BudgetTransactions.createSampleState(state, '2026-05');
  assert.strictEqual(win.BudgetTransactions.hasSampleForMonth(state.transactions, '2026-05'), true);
  const countAfterFirst = state.transactions.length;
  state = win.BudgetTransactions.createSampleState(state, '2026-05', { replace: true });
  assert.strictEqual(state.transactions.length, countAfterFirst);
}

function testImportExport() {
  const win = createContext();
  const state = win.BudgetTransactions.createSampleState(win.BudgetStorage.defaultState(), '2026-05');
  const exported = win.BudgetTransactions.exportState(state);
  const imported = win.BudgetTransactions.importState(exported);
  assert.strictEqual(imported.ok, true);
  assert.strictEqual(imported.state.transactions.length, 6);
  assert.strictEqual(imported.summary.importedCount, 6);
  assert.strictEqual(win.BudgetTransactions.importState('{bad').ok, false);
  assert.strictEqual(win.BudgetTransactions.importState('{}').ok, false);
  assert.strictEqual(win.BudgetTransactions.importState(JSON.stringify({ transactions: [] })).ok, false);
  const mixed = win.BudgetTransactions.importState(JSON.stringify({
    monthlyBudget: 500000,
    transactions: [
      { id: '1', date: '2026-05-01', type: 'expense', category: '생활비', amount: 1000 },
      { id: '2', date: '2026-02-31', type: 'expense', category: '생활비', amount: 1000 }
    ]
  }));
  assert.strictEqual(mixed.ok, true);
  assert.strictEqual(mixed.summary.importedCount, 1);
  assert.strictEqual(mixed.summary.skippedCount, 1);
}

function testLegacyExpenseCategoriesMapToFourBudgets() {
  const win = createContext();
  const state = win.BudgetStorage.normalizeState({
    categoryBudgets: { 식비: 100000, 카페: 20000, 쇼핑: 50000, 의료: 30000 },
    transactions: [
      { id: 'legacy-1', date: '2026-05-01', type: 'expense', category: '식비', amount: 1000 },
      { id: 'legacy-2', date: '2026-05-02', type: 'expense', category: '카페/간식', amount: 2000 },
      { id: 'legacy-3', date: '2026-05-03', type: 'expense', category: '쇼핑', amount: 3000 },
      { id: 'legacy-4', date: '2026-05-04', type: 'expense', category: '의료', amount: 4000 }
    ]
  });
  assert.strictEqual(JSON.stringify(state.categoryBudgets), JSON.stringify({ 생활비: 100000, 배달비: 20000, 의류비: 50000, 비상금: 30000 }));
  assert.strictEqual(JSON.stringify(state.transactions.map((tx) => tx.category)), JSON.stringify(['생활비', '배달비', '의류비', '비상금']));
}

function testCloudStateMappingKeepsBudgetAndTransactions() {
  const win = createContext();
  let state = win.BudgetStorage.normalizeState({
    monthlyBudget: 800000,
    categoryBudgets: { 생활비: 200000 },
    transactions: [
      { id: 'tx-a', date: '2026-05-02', type: 'expense', category: '생활비', amount: 120000, memo: '마트', source: 'user' }
    ]
  });
  state = win.BudgetTransactions.setMonthStartDay(state, 25).state;
  state = win.BudgetTransactions.setMonthlyBudget(state, 900000, '2026-06').state;
  const mapped = win.BudgetCloud.stateToRemote(state, 'user-1');
  assert.strictEqual(JSON.stringify(mapped.settings), JSON.stringify({
    user_id: 'user-1', monthly_budget: 800000, category_budgets: { 생활비: 200000, __month_start_day: 25, __monthly_budgets: { '2026-06': { monthlyBudget: 900000, categoryBudgets: { 생활비: 200000 } } } }
  }));
  assert.strictEqual(JSON.stringify(mapped.transactions), JSON.stringify([
    { id: 'tx-a', user_id: 'user-1', date: '2026-05-02', type: 'expense', category: '생활비', amount: 120000, memo: '마트', source: 'user' }
  ]));

  const restored = win.BudgetCloud.remoteToState(mapped.settings, mapped.transactions);
  assert.strictEqual(restored.monthlyBudget, 800000);
  assert.strictEqual(restored.monthStartDay, 25);
  assert.strictEqual(JSON.stringify(restored.categoryBudgets), JSON.stringify({ 생활비: 200000 }));
  assert.strictEqual(restored.monthlyBudgets['2026-06'].monthlyBudget, 900000);
  assert.strictEqual(restored.transactions.length, 1);
  assert.strictEqual(restored.transactions[0].id, 'tx-a');
}

function testCloudUsesSharedLoginEmail() {
  const win = createContext();
  assert.strictEqual(win.BudgetCloud.LOGIN_EMAIL, 'ho910728@naver.com');
}

const tests = [
  testStorageDefaultsAndIgnoresLocalStorage,
  testSaveDoesNotUseLocalStorage,
  testStrictDateValidation,
  testLocalDateFormatting,
  testNormalizationDropsInvalidRowsAndDeduplicatesIds,
  testCategoryBudgetSaveAndSummary,
  testBudgetMonthStartAndMonthlyBudgets,
  testAddTransactionCanonicalizesBeginnerMoneyInput,
  testSummaryInsightsAndSearchFilter,
  testSummaryAndSampleReplace,
  testImportExport,
  testLegacyExpenseCategoriesMapToFourBudgets,
  testCloudStateMappingKeepsBudgetAndTransactions,
  testCloudUsesSharedLoginEmail
];

for (const test of tests) {
  test();
  console.log('PASS', test.name);
}
console.log(`${tests.length} tests passed`);
