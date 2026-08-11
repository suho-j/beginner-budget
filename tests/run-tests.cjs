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
      supabase: options.supabase,
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

function createSupabaseFake(options = {}) {
  const calls = [];
  const emptyActions = new Set(options.emptyActions || []);
  function filteredQuery(table, action, payload) {
    const call = { table, action, payload, filters: [], select: null };
    calls.push(call);
    const query = {
      eq(column, value) { call.filters.push([column, value]); return query; },
      select(columns) { call.select = columns; return query; },
      then(resolve, reject) {
        const idFilter = call.filters.find(([column]) => column === 'id');
        const data = call.select
          ? (emptyActions.has(action) ? [] : [{ id: idFilter && idFilter[1] }])
          : null;
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      }
    };
    return query;
  }
  const client = {
    auth: { async getUser() { return { data: { user: { id: 'user-1' } }, error: null }; } },
    from(table) {
      return {
        insert(payload) { calls.push({ table, action: 'insert', payload, filters: [] }); return Promise.resolve({ data: null, error: null }); },
        update(payload) { return filteredQuery(table, 'update', payload); },
        delete() { return filteredQuery(table, 'delete', null); },
        upsert(payload, options) { calls.push({ table, action: 'upsert', payload, options, filters: [] }); return Promise.resolve({ data: null, error: null }); }
      };
    }
  };
  return { calls, supabase: { createClient: () => client } };
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

function testCategoryBudgetDetailShowsSpentBeforeBudget() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js/ui.js'), 'utf8');
  assert.ok(source.includes('`사용 ${formatWon(item.spent)} / 예산 ${formatWon(item.budget)}`'));
  assert.ok(!source.includes('`예산 ${formatWon(item.budget)} / 사용 ${formatWon(item.spent)}`'));
}

function testAppMarkupProvidesTabsCalendarEditDialogAndPreviewWarning() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const startTagById = (id) => {
    const match = source.match(new RegExp(`<([a-z][\\w-]*)\\b[^>]*\\bid="${id}"[^>]*>`, 'i'));
    assert.ok(match, `missing element: ${id}`);
    return { name: match[1].toLowerCase(), source: match[0] };
  };
  const assertAttribute = (tag, name, value) => {
    assert.match(tag.source, new RegExp(`\\b${name}="${value}"(?:\\s|>)`), `${tag.source} missing ${name}="${value}"`);
  };
  const assertBooleanAttribute = (tag, name) => {
    assert.match(tag.source, new RegExp(`(?:\\s)${name}(?:\\s|>)`), `${tag.source} missing ${name}`);
  };

  for (const required of [
    'id="preview-data-warning"', 'role="tablist"', 'id="tab-home"', 'id="tab-history"',
    'id="tab-calendar"', 'id="tab-settings"', 'id="month-previous"', 'id="month-next"',
    'id="filter-category"', 'id="calendar-grid"', 'id="calendar-detail-list"',
    '<dialog id="edit-dialog"', 'id="edit-transaction-form"'
  ]) assert.ok(source.includes(required), `missing markup: ${required}`);

  const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.strictEqual(new Set(ids).size, ids.length, 'all element IDs must be unique');

  for (const [tabId, panelId, selected, inactive] of [
    ['tab-home', 'panel-home', 'true', false],
    ['tab-history', 'panel-history', 'false', true],
    ['tab-calendar', 'panel-calendar', 'false', true],
    ['tab-settings', 'panel-settings', 'false', true]
  ]) {
    const tab = startTagById(tabId);
    assert.strictEqual(tab.name, 'button');
    assertAttribute(tab, 'role', 'tab');
    assertAttribute(tab, 'aria-controls', panelId);
    assertAttribute(tab, 'aria-selected', selected);
    if (inactive) assertAttribute(tab, 'tabindex', '-1');

    const panel = startTagById(panelId);
    assert.strictEqual(panel.name, 'section');
    assertAttribute(panel, 'role', 'tabpanel');
    assertAttribute(panel, 'aria-labelledby', tabId);
    if (inactive) assertBooleanAttribute(panel, 'hidden');
    else assert.doesNotMatch(panel.source, /(?:\s)hidden(?:\s|>)/);
  }

  const dialog = startTagById('edit-dialog');
  assert.strictEqual(dialog.name, 'dialog');
  assertAttribute(dialog, 'aria-labelledby', 'edit-dialog-title');

  const calendar = startTagById('calendar-grid');
  assert.strictEqual(calendar.name, 'div');
  assertAttribute(calendar, 'role', 'group');
  assertAttribute(calendar, 'aria-labelledby', 'calendar-title');

  const listCount = startTagById('list-count');
  assertAttribute(listCount, 'role', 'status');
  assertAttribute(listCount, 'aria-live', 'polite');
  assertAttribute(listCount, 'aria-atomic', 'true');
}

function testCategoryFilterCombinesWithMonthTypeAndQuery() {
  const win = createContext();
  const transactions = [
    { id: 'a', date: '2026-05-02', type: 'expense', category: '생활비', amount: 1000, memo: '마트' },
    { id: 'b', date: '2026-05-03', type: 'expense', category: '배달비', amount: 2000, memo: '저녁' },
    { id: 'c', date: '2026-05-04', type: 'expense', category: '생활비', amount: 3000, memo: '점심' },
    { id: 'd', date: '2026-05-05', type: 'income', category: '급여', amount: 500000, memo: '' },
    { id: 'e', date: '2026-06-02', type: 'expense', category: '생활비', amount: 4000, memo: '마트' }
  ];

  const filtered = win.BudgetTransactions.filterTransactions(transactions, {
    month: '2026-05',
    monthStartDay: 1,
    type: 'expense',
    category: '생활비',
    query: ''
  });
  assert.strictEqual(JSON.stringify(filtered.map((tx) => tx.id)), JSON.stringify(['c', 'a']));

  const allCategories = win.BudgetTransactions.filterTransactions(transactions, {
    month: '2026-05', monthStartDay: 1, type: 'expense', category: 'all', query: '저녁'
  });
  assert.strictEqual(JSON.stringify(allCategories.map((tx) => tx.id)), JSON.stringify(['b']));
}

function testUpdateTransactionValidatesAndPreservesIdentity() {
  const win = createContext();
  const original = win.BudgetStorage.normalizeState({
    transactions: [
      { id: 'tx-a', date: '2026-05-02', type: 'expense', category: '생활비', amount: 12000, memo: '마트', source: 'user' }
    ]
  });

  const updated = win.BudgetTransactions.updateTransaction(original, 'tx-a', {
    date: '2026-04-30', type: 'expense', category: '배달비', amount: '25,000', memo: '  저녁 배달  '
  });
  assert.strictEqual(updated.ok, true);
  assert.notStrictEqual(updated.state, original);
  assert.notStrictEqual(updated.state.transactions, original.transactions);
  assert.strictEqual(updated.state.transactions[0], updated.transaction);
  assert.strictEqual(updated.transaction.id, 'tx-a');
  assert.strictEqual(updated.transaction.amount, 25000);
  assert.strictEqual(updated.transaction.memo, '저녁 배달');
  assert.strictEqual(updated.transaction.source, 'user');
  assert.strictEqual(updated.state.transactions[0].id, 'tx-a');
  assert.strictEqual(updated.state.transactions[0].amount, 25000);
  assert.strictEqual(updated.state.transactions[0].memo, '저녁 배달');
  assert.strictEqual(updated.state.transactions[0].source, 'user');
  assert.strictEqual(original.transactions[0].amount, 12000);

  const invalid = win.BudgetTransactions.updateTransaction(original, 'tx-a', {
    date: '2026-04-30', type: 'expense', category: '배달비', amount: '0', memo: ''
  });
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.state, original);
  assert.strictEqual(invalid.transaction, null);
  assert.strictEqual(invalid.errors[0].field, 'amount');

  const missing = win.BudgetTransactions.updateTransaction(original, 'tx-missing', {
    date: '2026-04-30', type: 'expense', category: '배달비', amount: '1000', memo: ''
  });
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.state, original);
  assert.strictEqual(missing.transaction, null);
  assert.strictEqual(missing.errors[0].field, 'transaction');
}

function testCalendarDaysCoverBudgetPeriodByWholeWeeks() {
  const win = createContext();
  const days = win.BudgetStorage.calendarDaysForBudgetMonth('2026-05', 25);
  assert.strictEqual(days[0].date, '2026-05-24');
  assert.strictEqual(days[days.length - 1].date, '2026-06-27');
  assert.strictEqual(days.length % 7, 0);
  assert.strictEqual(days.filter((day) => day.inPeriod).length, 31);
  assert.strictEqual(days.find((day) => day.date === '2026-05-25').inPeriod, true);
  assert.strictEqual(days.find((day) => day.date === '2026-06-25').inPeriod, false);
}

function testSummarizeTransactionsByDateHonorsBudgetPeriod() {
  const win = createContext();
  const transactions = [
    { id: 'a', date: '2026-05-25', type: 'expense', category: '생활비', amount: 1000, memo: '' },
    { id: 'b', date: '2026-05-25', type: 'income', category: '급여', amount: 5000, memo: '' },
    { id: 'c', date: '2026-06-24', type: 'expense', category: '배달비', amount: 2000, memo: '' },
    { id: 'd', date: '2026-06-25', type: 'expense', category: '생활비', amount: 9000, memo: '' }
  ];
  assert.strictEqual(JSON.stringify(win.BudgetTransactions.summarizeTransactionsByDate(transactions, '', 25)), '{}');
  assert.strictEqual(JSON.stringify(win.BudgetTransactions.summarizeTransactionsByDate(transactions, '2026-13', 25)), '{}');
  const byDate = win.BudgetTransactions.summarizeTransactionsByDate(transactions, '2026-05', 25);
  assert.strictEqual(JSON.stringify(Object.keys(byDate)), JSON.stringify(['2026-05-25', '2026-06-24']));
  assert.strictEqual(byDate['2026-05-25'].expense, 1000);
  assert.strictEqual(byDate['2026-05-25'].income, 5000);
  assert.strictEqual(byDate['2026-05-25'].count, 2);
  assert.strictEqual(JSON.stringify(byDate['2026-05-25'].transactions.map((tx) => tx.id)), JSON.stringify(['b', 'a']));
}

async function testCloudMutatesOnlyRequestedTransactionRow() {
  const fake = createSupabaseFake();
  const win = createContext({ supabase: fake.supabase });
  const transaction = { id: 'tx-a', date: '2026-05-02', type: 'expense', category: '생활비', amount: 12000, memo: '마트', source: 'user' };
  await win.BudgetCloud.insertTransaction(transaction);
  await win.BudgetCloud.updateTransaction({ ...transaction, amount: 15000 });
  await win.BudgetCloud.deleteTransaction('tx-a');
  await win.BudgetCloud.saveSettings(win.BudgetStorage.defaultState());
  assert.strictEqual(fake.calls[0].table, 'transactions');
  assert.strictEqual(fake.calls[0].action, 'insert');
  assert.strictEqual(fake.calls[0].payload.user_id, 'user-1');
  assert.strictEqual(fake.calls[1].action, 'update');
  assert.strictEqual(JSON.stringify(fake.calls[1].filters), JSON.stringify([['id', 'tx-a'], ['user_id', 'user-1']]));
  assert.strictEqual(fake.calls[1].select, 'id');
  assert.strictEqual(fake.calls[2].action, 'delete');
  assert.strictEqual(JSON.stringify(fake.calls[2].filters), JSON.stringify([['id', 'tx-a'], ['user_id', 'user-1']]));
  assert.strictEqual(fake.calls[2].select, 'id');
  assert.strictEqual(fake.calls[3].table, 'budget_settings');
  assert.strictEqual(fake.calls[3].action, 'upsert');
  assert.strictEqual(fake.calls[3].payload.user_id, 'user-1');
  assert.strictEqual(fake.calls[3].options.onConflict, 'user_id');
}

async function testCloudRejectsInvalidOrStaleTransactionMutations() {
  const transaction = { id: 'tx-a', date: '2026-05-02', type: 'expense', category: '생활비', amount: 12000, memo: '마트', source: 'user' };

  const invalidFake = createSupabaseFake();
  const invalidWin = createContext({ supabase: invalidFake.supabase });
  await assert.rejects(
    invalidWin.BudgetCloud.updateTransaction({ ...transaction, id: '   ' }),
    /거래 ID가 올바르지 않아요/
  );
  assert.strictEqual(invalidFake.calls.filter((call) => call.action === 'update').length, 0);

  const staleFake = createSupabaseFake({ emptyActions: ['update', 'delete'] });
  const staleWin = createContext({ supabase: staleFake.supabase });
  await assert.rejects(
    staleWin.BudgetCloud.updateTransaction(transaction),
    /거래가 이미 변경되었거나 삭제되었어요/
  );
  await assert.rejects(
    staleWin.BudgetCloud.deleteTransaction('tx-a'),
    /거래가 이미 변경되었거나 삭제되었어요/
  );
  assert.strictEqual(staleFake.calls[0].select, 'id');
  assert.strictEqual(staleFake.calls[1].select, 'id');
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
  testCloudUsesSharedLoginEmail,
  testCategoryBudgetDetailShowsSpentBeforeBudget,
  testAppMarkupProvidesTabsCalendarEditDialogAndPreviewWarning,
  testCategoryFilterCombinesWithMonthTypeAndQuery,
  testUpdateTransactionValidatesAndPreservesIdentity,
  testCalendarDaysCoverBudgetPeriodByWholeWeeks,
  testSummarizeTransactionsByDateHonorsBudgetPeriod,
  testCloudRejectsInvalidOrStaleTransactionMutations,
  testCloudMutatesOnlyRequestedTransactionRow
];

async function run() {
  for (const test of tests) {
    await test();
    console.log('PASS', test.name);
  }
  console.log(`${tests.length} tests passed`);
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
