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
  for (const file of ['js/storage.js', 'js/transactions.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  return context.window;
}

function testStorageDefaultsAndCorruption() {
  const win = createContext();
  assert.deepStrictEqual(win.BudgetStorage.loadState(), win.BudgetStorage.defaultState());
  win.localStorage.setItem(win.BudgetStorage.STORAGE_KEY, '{bad json');
  assert.deepStrictEqual(win.BudgetStorage.loadState(), win.BudgetStorage.defaultState());
}

function testSaveFailureDoesNotThrow() {
  const win = createContext({ throwOnSet: true });
  const result = win.BudgetStorage.saveState(win.BudgetStorage.defaultState());
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.state.monthlyBudget, 500000);
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
    transactions: [
      { id: 'same', date: '2026-05-01', type: 'expense', category: '식비', amount: 1000, memo: 'ok' },
      { id: 'same', date: '2026-05-02', type: 'income', category: '월급', amount: 2000, memo: 'ok' },
      { id: '2', date: '2026-02-31', type: 'expense', category: '식비', amount: 1000 },
      { id: '3', date: '2026-05-01', type: 'expense', category: '월급', amount: 1000 },
      { id: '4', date: '2026-05-01', type: 'income', category: '월급', amount: -1 }
    ]
  });
  assert.strictEqual(state.monthlyBudget, 700000);
  assert.strictEqual(state.transactions.length, 2);
  assert.strictEqual(new Set(state.transactions.map((tx) => tx.id)).size, 2);
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
    date: '2026-05-02', type: 'expense', category: '식비', amount: 300, memo: ''
  });
  state = result.state;
  assert.strictEqual(
    JSON.stringify(win.BudgetTransactions.summarize(state.transactions, 500000, '2026-05')),
    JSON.stringify({
      income: 1000,
      expense: 300,
      balance: 700,
      budgetUsed: 300,
      budgetRemaining: 499700,
      budgetRate: 0,
      monthlyBudget: 500000,
      count: 2
    })
  );

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
      { id: '1', date: '2026-05-01', type: 'expense', category: '식비', amount: 1000 },
      { id: '2', date: '2026-02-31', type: 'expense', category: '식비', amount: 1000 }
    ]
  }));
  assert.strictEqual(mixed.ok, true);
  assert.strictEqual(mixed.summary.importedCount, 1);
  assert.strictEqual(mixed.summary.skippedCount, 1);
}

const tests = [
  testStorageDefaultsAndCorruption,
  testSaveFailureDoesNotThrow,
  testStrictDateValidation,
  testLocalDateFormatting,
  testNormalizationDropsInvalidRowsAndDeduplicatesIds,
  testSummaryAndSampleReplace,
  testImportExport
];

for (const test of tests) {
  test();
  console.log('PASS', test.name);
}
console.log(`${tests.length} tests passed`);
