const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

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
      location: options.location || { hostname: 'suho-j.github.io', pathname: '/beginner-budget/' },
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

function createUiContext() {
  let document;

  class FakeClassList {
    constructor(element) {
      this.element = element;
    }

    values() {
      return new Set(this.element.className.split(/\s+/).filter(Boolean));
    }

    write(values) {
      this.element.className = Array.from(values).join(' ');
    }

    add(...names) {
      const values = this.values();
      names.forEach((name) => values.add(name));
      this.write(values);
    }

    remove(...names) {
      const values = this.values();
      names.forEach((name) => values.delete(name));
      this.write(values);
    }

    toggle(name, force) {
      const values = this.values();
      const enabled = force === undefined ? !values.has(name) : Boolean(force);
      if (enabled) values.add(name);
      else values.delete(name);
      this.write(values);
      return enabled;
    }

    contains(name) {
      return this.values().has(name);
    }
  }

  class FakeElement {
    constructor(tagName) {
      this.tagName = String(tagName).toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.ownerDocument = document;
      this.attributes = new Map();
      this.dataset = {};
      this.className = '';
      this.classList = new FakeClassList(this);
      this.hidden = false;
      this.disabled = false;
      this.value = '';
      this.id = '';
      this.name = '';
      this.tabIndex = 0;
      this._textContent = '';
      this._innerHTML = '';
      this.focusCount = 0;
      this.open = false;
    }

    set textContent(value) {
      this._textContent = String(value);
    }

    get textContent() {
      return this._textContent;
    }

    set innerHTML(value) {
      this._innerHTML = String(value);
      if (value === '') {
        this.children.forEach((child) => { child.parentNode = null; });
        this.children = [];
      }
    }

    get innerHTML() {
      return this._innerHTML;
    }

    append(...children) {
      children.forEach((child) => {
        child.parentNode = this;
        child.ownerDocument = this.ownerDocument;
        this.children.push(child);
      });
    }

    remove() {
      if (!this.parentNode) return;
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
      this.parentNode = null;
    }

    setAttribute(name, value) {
      const normalized = String(value);
      this.attributes.set(name, normalized);
      if (name === 'id') this.id = normalized;
      if (name === 'name') this.name = normalized;
      if (name === 'class') this.className = normalized;
      if (name === 'tabindex') this.tabIndex = Number(normalized);
      if (name === 'hidden') this.hidden = true;
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        this.dataset[key] = normalized;
      }
    }

    getAttribute(name) {
      if (name === 'id' && this.id) return this.id;
      if (name === 'name' && this.name) return this.name;
      if (name === 'class' && this.className) return this.className;
      if (name === 'hidden') return this.hidden ? '' : null;
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        return Object.prototype.hasOwnProperty.call(this.dataset, key) ? String(this.dataset[key]) : null;
      }
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    matches(selector) {
      const tag = selector.match(/^[a-z][\w-]*/i);
      if (tag && this.tagName !== tag[0].toUpperCase()) return false;
      const id = selector.match(/#([\w-]+)/);
      if (id && this.id !== id[1]) return false;
      const attributes = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
      return attributes.every((match) => {
        const actual = this.getAttribute(match[1]);
        return match[2] === undefined ? actual !== null : actual === match[2];
      });
    }

    querySelectorAll(selector) {
      const matches = [];
      const visit = (node) => {
        node.children.forEach((child) => {
          if (child.matches(selector)) matches.push(child);
          visit(child);
        });
      };
      visit(this);
      return matches;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    closest(selector) {
      let current = this;
      while (current) {
        if (current.matches(selector)) return current;
        current = current.parentNode;
      }
      return null;
    }

    contains(node) {
      if (node === this) return true;
      return this.children.some((child) => child.contains(node));
    }

    focus() {
      this.ownerDocument.activeElement = this;
      this.focusCount += 1;
    }

    showModal() {
      this.open = true;
    }

    close() {
      this.open = false;
    }
  }

  document = {
    activeElement: null,
    createElement(tagName) {
      const element = new FakeElement(tagName);
      element.ownerDocument = document;
      return element;
    },
    querySelectorAll(selector) {
      return document.body.querySelectorAll(selector);
    },
    querySelector(selector) {
      return document.body.querySelector(selector);
    },
    contains(node) {
      return document.body.contains(node);
    }
  };
  document.body = document.createElement('body');

  const window = {
    BudgetTransactions: {
      EXPENSE_CATEGORIES: ['생활비', '배달비', '공통'],
      INCOME_CATEGORIES: ['급여', '공통'],
      categoriesFor(type) {
        return type === 'income' ? this.INCOME_CATEGORIES : this.EXPENSE_CATEGORIES;
      }
    }
  };
  window.window = window;
  window.document = document;
  const context = { window, document, console };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'js/ui.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'js/ui.js' });
  return { window, document };
}

function createSupabaseFake(options = {}) {
  const calls = [];
  const settingsTables = new Set(['budget_settings', 'preview_budget_settings']);
  const emptyActions = new Set(options.emptyActions || []);
  const rpcErrors = options.rpcErrors || {};
  const rpcData = options.rpcData || {};
  const queryErrors = options.queryErrors || {};
  const settingsRow = Object.prototype.hasOwnProperty.call(options, 'settingsRow')
    ? options.settingsRow
    : null;
  const transactionRows = options.transactionRows || [];
  let settingsWriteIndex = 0;
  function queryResult(call) {
    const key = `${call.table}:${call.action}`;
    const configured = queryErrors[key];
    const configuredError = typeof configured === 'function' ? configured(call, calls) : configured;
    if (configuredError) {
      return {
        data: null,
        error: configuredError instanceof Error || typeof configuredError === 'object'
          ? configuredError
          : new Error(String(configuredError))
      };
    }
    if (call.action === 'select') {
      const rows = settingsTables.has(call.table)
        ? (settingsRow ? [settingsRow] : [])
        : transactionRows;
      return { data: call.maybeSingle ? (rows[0] || null) : rows, error: null };
    }
    const isEmpty = emptyActions.has(call.action) || emptyActions.has(key);
    if (call.select) {
      if (isEmpty) return { data: [], error: null };
      if (settingsTables.has(call.table)) {
        const configuredVersions = options.settingsWriteVersions || [];
        const updatedAt = configuredVersions[settingsWriteIndex]
          || options.settingsWriteUpdatedAt
          || new Date(Date.parse('2026-08-12T00:00:00.000Z') + settingsWriteIndex * 1000).toISOString();
        settingsWriteIndex += 1;
        return { data: [{ updated_at: updatedAt }], error: null };
      }
      const idFilter = call.filters.find(([column]) => column === 'id');
      return { data: [{ id: idFilter ? idFilter[1] : call.payload && call.payload.id }], error: null };
    }
    return { data: null, error: null };
  }
  function filteredQuery(table, action, payload) {
    const call = { table, action, payload, filters: [], select: null, order: null, maybeSingle: false };
    calls.push(call);
    const query = {
      eq(column, value) { call.filters.push([column, value]); return query; },
      select(columns) { call.select = columns; return query; },
      order(column, optionsValue) { call.order = [column, optionsValue]; return query; },
      maybeSingle() { call.maybeSingle = true; return Promise.resolve(queryResult(call)); },
      then(resolve, reject) {
        return Promise.resolve(queryResult(call)).then(resolve, reject);
      }
    };
    return query;
  }
  const client = {
    auth: {
      async getUser() { return { data: { user: { id: 'user-1' } }, error: null }; },
      async signOut() { return { error: null }; }
    },
    rpc(name, args) {
      calls.push({ action: 'rpc', name, args });
      const configuredError = rpcErrors[name];
      const error = configuredError
        ? (configuredError instanceof Error ? configuredError : new Error(String(configuredError)))
        : null;
      let data = rpcData[name];
      if (data === undefined && ['replace_budget_state', 'replace_preview_budget_state'].includes(name)) {
        data = [{
          uploaded_count: Array.isArray(args.p_transactions) ? args.p_transactions.length : 0,
          updated_at: options.rpcUpdatedAt || '2026-08-12T00:00:00.000Z'
        }];
      }
      return Promise.resolve({ data: error ? null : data, error });
    },
    from(table) {
      return {
        select(columns) { return filteredQuery(table, 'select', null).select(columns); },
        insert(payload) { return filteredQuery(table, 'insert', payload); },
        update(payload) { return filteredQuery(table, 'update', payload); },
        delete() { return filteredQuery(table, 'delete', null); },
        upsert(payload, optionsValue) {
          const query = filteredQuery(table, 'upsert', payload);
          calls[calls.length - 1].options = optionsValue;
          return query;
        }
      };
    }
  };
  return { calls, supabase: { createClient: () => client } };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createAppHarness(options = {}) {
  let document;
  const documentListeners = new Map();
  const writeControls = [];
  const dynamicControls = [];

  function createElement(tagName = 'div') {
    const listeners = new Map();
    const attributes = new Map();
    const classes = new Set();
    const element = {
      tagName: String(tagName).toUpperCase(),
      id: '',
      name: '',
      value: '',
      valueAsNumber: NaN,
      textContent: '',
      hidden: false,
      disabled: false,
      open: false,
      checked: false,
      dataset: {},
      style: {},
      children: [],
      focusCount: 0,
      clickCount: 0,
      classList: {
        add(...names) { names.forEach((name) => classes.add(name)); },
        remove(...names) { names.forEach((name) => classes.delete(name)); },
        toggle(name, force) {
          const enabled = force === undefined ? !classes.has(name) : Boolean(force);
          if (enabled) classes.add(name);
          else classes.delete(name);
          return enabled;
        },
        contains(name) { return classes.has(name); }
      },
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(listener);
      },
      async dispatch(type, extras = {}) {
        const event = {
          type,
          target: element,
          currentTarget: element,
          submitter: null,
          key: '',
          defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; },
          ...extras
        };
        const results = (listeners.get(type) || []).map((listener) => listener(event));
        await Promise.all(results);
        return event;
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
        if (name === 'data-cloud-write' && !writeControls.includes(element)) writeControls.push(element);
        if (name.startsWith('data-')) {
          const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
          element.dataset[key] = String(value);
        }
      },
      getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
      removeAttribute(name) { attributes.delete(name); },
      querySelectorAll() { return []; },
      querySelector() { return null; },
      append(...children) { element.children.push(...children); },
      contains(target) { return target === element || element.children.includes(target); },
      closest() { return null; },
      focus() { element.focusCount += 1; document.activeElement = element; },
      click() { element.clickCount += 1; return element.dispatch('click'); },
      reset() { return element.dispatch('reset'); },
      showModal() { element.open = true; },
      close() { element.open = false; }
    };
    Object.defineProperty(element, 'innerHTML', {
      get() { return ''; },
      set(value) { if (value === '') element.children = []; }
    });
    return element;
  }

  document = {
    activeElement: null,
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(listener);
    },
    async dispatch(type) {
      const results = (documentListeners.get(type) || []).map((listener) => listener());
      await Promise.all(results);
    },
    querySelectorAll(selector) {
      if (selector === '[data-cloud-write]') return writeControls.slice();
      if (selector === '[data-action="edit"]') {
        return dynamicControls.filter((control) => control.dataset.action === 'edit');
      }
      return [];
    },
    querySelector() { return null; },
    createElement,
    contains() { return true; }
  };
  document.body = createElement('body');

  const window = {
    document,
    console: { ...console, error() {}, warn() {} },
    crypto: { randomUUID: () => `harness-${Math.random().toString(16).slice(2)}` },
    location: { pathname: '/' },
    confirm: () => true,
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {}
  };
  window.window = window;
  const context = { window, document, console: window.console, FileReader: function FileReader() {} };
  vm.createContext(context);
  for (const file of ['js/storage.js', 'js/transactions.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }

  const elements = {};
  for (const name of [
    'previousMonthButton', 'currentMonthButton', 'nextMonthButton', 'filterCategory',
    'calendarPeriodLabel', 'calendarGrid', 'calendarDetailList', 'calendarDetailEmpty',
    'calendarDetailCount', 'previewDataWarning', 'editDialog', 'editForm', 'editId',
    'editDate', 'editType', 'editCategory', 'editAmount', 'editMemo', 'editMessage',
    'editClose', 'editCancel', 'editSave', 'monthStartForm', 'monthStartInput',
    'monthStartMessage', 'budgetForm', 'budgetInput', 'budgetMessage', 'categoryBudgetForm',
    'categoryBudgetFields', 'categoryBudgetMessage', 'cloudPanel', 'cloudLoginForm',
    'cloudPassword', 'cloudUploadButton', 'cloudDownloadButton', 'cloudLogoutButton',
    'cloudStatus', 'cloudMessage', 'transactionForm', 'dateInput', 'typeSelect',
    'categorySelect', 'amountInput', 'memoInput', 'formMessage', 'monthInput',
    'filterType', 'filterQuery', 'globalMessage', 'toolMessage', 'sampleButton',
    'exportButton', 'importButton', 'importFile', 'resetButton', 'list', 'emptyState',
    'listCount', 'selectedMonthLabel', 'summaryIncome', 'summaryExpense', 'summaryBalance',
    'summaryBudgetRemaining', 'budgetStatusText', 'balanceHelp', 'budgetCard', 'balanceCard',
    'budgetRateLabel', 'budgetMeter', 'budgetMeterFill', 'dailyAllowance',
    'dailyAllowanceHelp', 'topCategory', 'topCategoryHelp', 'categoryBreakdownList',
    'categoryBudgetStatusList'
  ]) elements[name] = createElement(name.includes('Form') ? 'form' : 'div');

  for (const name of ['monthStartSave', 'budgetSave', 'categoryBudgetSave', 'transactionSave']) {
    elements[name] = createElement('button');
  }

  elements.tabs = ['home', 'history', 'calendar', 'settings'].map((tabName) => {
    const tab = createElement('button');
    tab.dataset.tab = tabName;
    return tab;
  });
  elements.tabPanels = ['home', 'history', 'calendar', 'settings'].map((tabName) => {
    const panel = createElement('section');
    panel.id = `panel-${tabName}`;
    return panel;
  });
  elements.filterType.value = 'all';
  elements.filterCategory.value = 'all';
  elements.filterQuery.value = '';
  elements.typeSelect.value = 'expense';
  elements.categorySelect.value = '생활비';
  elements.editType.value = 'expense';
  elements.editCategory.value = '생활비';
  elements.cloudPassword.value = 'secret';
  for (const control of [
    elements.monthStartSave, elements.budgetSave, elements.categoryBudgetSave, elements.transactionSave,
    elements.sampleButton, elements.importButton, elements.resetButton,
    elements.cloudUploadButton, elements.editSave
  ]) control.setAttribute('data-cloud-write', '');

  const records = {
    cloudStatuses: [],
    renderedLists: [],
    renderedSummaries: [],
    activeTabs: [],
    downloads: [],
    closeEditCount: 0
  };
  window.BudgetUI = {
    getElements: () => elements,
    initDefaults(target, state) {
      const month = window.BudgetStorage.monthKeyForDate(
        window.BudgetStorage.localDateString(),
        state.monthStartDay || 1
      ) || window.BudgetStorage.localMonthString();
      const budget = window.BudgetStorage.budgetForMonth(state, month);
      target.dateInput.value = window.BudgetStorage.localDateString();
      target.monthInput.value = month;
      target.monthStartInput.value = String(state.monthStartDay || 1);
      target.monthStartInput.valueAsNumber = state.monthStartDay || 1;
      target.budgetInput.value = String(budget.monthlyBudget);
      target.budgetInput.valueAsNumber = budget.monthlyBudget;
      target.typeSelect.value = 'expense';
      target.categorySelect.value = '생활비';
    },
    fillFilterCategoryOptions(select) { select.value = 'all'; },
    fillCategoryOptions(select, type) { select.value = type === 'income' ? '월급' : '생활비'; },
    syncCategoryBudgetInputs() {},
    readCategoryBudgetInputs() { return {}; },
    renderSummary(target, summary) { records.renderedSummaries.push(summary); },
    renderList(target, transactions) { records.renderedLists.push(JSON.parse(JSON.stringify(transactions))); },
    renderCalendar() {},
    renderCalendarDetails() {},
    setActiveTab(target, tab) { records.activeTabs.push(tab); },
    clearFieldErrors() {},
    showValidationErrors(scope, messageElement, errors) {
      this.setMessage(messageElement, errors.map((item) => item.message).join(' '), 'error');
    },
    setMessage(element, text, kind) {
      element.textContent = text || '';
      element.messageKind = kind || null;
    },
    openEditDialog() {},
    closeEditDialog() { records.closeEditCount += 1; elements.editDialog.open = false; },
    formatWon(amount) { return `${amount}원`; },
    downloadText(filename, content) { records.downloads.push({ filename, content }); },
    updateCloudStatus(target, user, readiness) {
      records.cloudStatuses.push({ user, readiness });
      const signedIn = Boolean(user);
      target.cloudPanel.hidden = readiness === 'ready';
      target.cloudLoginForm.hidden = signedIn;
      target.cloudDownloadButton.hidden = readiness !== 'load-error';
      target.cloudLogoutButton.hidden = !signedIn;
      target.cloudStatus.textContent = readiness || '';
    }
  };

  const cloudCalls = {
    currentUser: [], downloadState: [], signInWithPassword: [], signOut: [],
    saveSettings: [], insertTransaction: [], updateTransaction: [], deleteTransaction: [],
    uploadState: []
  };
  const cloudBehaviors = options.cloud || {};
  async function runCloudBehavior(name, args, fallback) {
    cloudCalls[name].push(args);
    const behavior = cloudBehaviors[name];
    if (typeof behavior === 'function') return behavior(...args);
    if (behavior instanceof Error) throw behavior;
    if (behavior !== undefined) return behavior;
    return fallback;
  }
  const defaultUser = Object.prototype.hasOwnProperty.call(options, 'user') ? options.user : { id: 'user-1' };
  window.BudgetCloud = {
    ENVIRONMENT: Object.freeze({ isPreview: Boolean(options.isPreview) }),
    isConfigured: () => true,
    currentUser: () => runCloudBehavior('currentUser', [], defaultUser),
    downloadState: () => runCloudBehavior('downloadState', [], options.cloudState || window.BudgetStorage.defaultState()),
    signInWithPassword: (password) => runCloudBehavior('signInWithPassword', [password], { ok: true }),
    signOut: () => runCloudBehavior('signOut', [], { ok: true }),
    saveSettings: (nextState) => runCloudBehavior('saveSettings', [nextState], { ok: true }),
    insertTransaction: (transaction) => runCloudBehavior('insertTransaction', [transaction], { ok: true }),
    updateTransaction: (transaction, expected) => runCloudBehavior('updateTransaction', [transaction, expected], { ok: true }),
    deleteTransaction: (id, expected) => runCloudBehavior('deleteTransaction', [id, expected], { ok: true }),
    uploadState: (nextState, expectedState) => runCloudBehavior(
      'uploadState',
      [nextState, expectedState],
      { ok: true, uploadedCount: nextState.transactions.length }
    )
  };

  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8'), context, { filename: 'js/app.js' });
  return {
    window,
    document,
    elements,
    records,
    cloudCalls,
    writeControls,
    dynamicControls,
    createElement,
    init: () => document.dispatch('DOMContentLoaded')
  };
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

function testTransactionIdsUseSafeOpaqueAsciiContract() {
  const win = createContext();
  const invalidIds = [
    ' tx-space ',
    'tx\tid',
    'tx-newline\n',
    'tx\u00a0id',
    'tx-😀',
    '거래-1',
    ''
  ];
  const validId = 'AZaz09._:-';
  const state = win.BudgetStorage.normalizeState({
    transactions: [
      ...invalidIds.map((id, index) => ({
        id,
        date: `2026-05-${String(index + 1).padStart(2, '0')}`,
        type: 'expense',
        category: '생활비',
        amount: 1000 + index
      })),
      { id: validId, date: '2026-05-08', type: 'expense', category: '생활비', amount: 2000 },
      { id: validId, date: '2026-05-09', type: 'expense', category: '생활비', amount: 3000 },
      { id: validId, date: '2026-05-10', type: 'expense', category: '생활비', amount: 4000 }
    ]
  });
  const ids = state.transactions.map((transaction) => transaction.id);
  const generatedIds = ids.slice(0, invalidIds.length);

  assert.strictEqual(state.transactions.length, invalidIds.length + 3);
  assert.strictEqual(generatedIds.every((id, index) => id !== invalidIds[index]), true);
  assert.strictEqual(generatedIds.every((id) => /^tx-[A-Za-z0-9._:-]+$/.test(id)), true);
  assert.strictEqual(ids[invalidIds.length], validId);
  assert.strictEqual(ids[invalidIds.length + 1] !== validId, true);
  assert.strictEqual(ids[invalidIds.length + 2] !== validId, true);
  assert.strictEqual(ids.every((id) => /^[A-Za-z0-9._:-]+$/.test(id)), true);
  assert.strictEqual(new Set(ids).size, ids.length);
}

function testDatabaseIntegerBoundsAreEnforced() {
  const win = createContext();
  const max = 2147483647;
  const overflow = max + 1;
  const base = win.BudgetStorage.defaultState();

  assert.strictEqual(win.BudgetStorage.MAX_DB_INTEGER, max);
  assert.strictEqual(win.BudgetStorage.isPositiveInteger(max), true);
  assert.strictEqual(win.BudgetStorage.isPositiveInteger(overflow), false);

  const acceptedTransaction = win.BudgetTransactions.addTransaction(base, {
    date: '2026-05-01', type: 'expense', category: '생활비', amount: String(max), memo: ''
  });
  const rejectedTransaction = win.BudgetTransactions.addTransaction(base, {
    date: '2026-05-01', type: 'expense', category: '생활비', amount: String(overflow), memo: ''
  });
  assert.strictEqual(acceptedTransaction.ok, true);
  assert.strictEqual(acceptedTransaction.transaction.amount, max);
  assert.strictEqual(rejectedTransaction.ok, false);
  assert.strictEqual(rejectedTransaction.errors[0].field, 'amount');
  assert.match(rejectedTransaction.errors[0].message, /2,147,483,647원 이하/);

  assert.strictEqual(win.BudgetTransactions.setMonthlyBudget(base, max, '2026-05').ok, true);
  const rejectedBudget = win.BudgetTransactions.setMonthlyBudget(base, overflow, '2026-05');
  assert.strictEqual(rejectedBudget.ok, false);
  assert.strictEqual(rejectedBudget.errors[0].field, 'monthlyBudget');
  assert.match(rejectedBudget.errors[0].message, /2,147,483,647원 이하/);
  const rejectedCategoryBudget = win.BudgetTransactions.setCategoryBudgets(base, { 생활비: String(overflow) });
  assert.strictEqual(rejectedCategoryBudget.ok, false);
  assert.match(rejectedCategoryBudget.errors[0].message, /2,147,483,647원 이하/);

  const normalized = win.BudgetStorage.normalizeState({
    monthlyBudget: overflow,
    categoryBudgets: { 생활비: overflow },
    monthlyBudgets: { '2026-05': { monthlyBudget: overflow, categoryBudgets: { 생활비: overflow } } },
    transactions: [
      { id: 'max', date: '2026-05-01', type: 'expense', category: '생활비', amount: max },
      { id: 'overflow', date: '2026-05-02', type: 'expense', category: '생활비', amount: overflow }
    ]
  });
  assert.strictEqual(normalized.monthlyBudget, win.BudgetStorage.DEFAULT_BUDGET);
  assert.strictEqual(JSON.stringify(normalized.categoryBudgets), '{}');
  assert.strictEqual(JSON.stringify(normalized.monthlyBudgets), '{}');
  assert.strictEqual(JSON.stringify(normalized.transactions.map((transaction) => transaction.id)), JSON.stringify(['max']));
  assert.strictEqual(
    JSON.stringify(win.BudgetStorage.normalizeCategoryBudgets({ 생활비: max, 식비: 1 })),
    '{}'
  );

  const imported = win.BudgetTransactions.importState(JSON.stringify({
    monthlyBudget: max,
    transactions: [
      { id: 'max', date: '2026-05-01', type: 'expense', category: '생활비', amount: max },
      { id: 'overflow', date: '2026-05-02', type: 'expense', category: '생활비', amount: overflow }
    ]
  }));
  assert.strictEqual(imported.ok, true);
  assert.strictEqual(imported.state.monthlyBudget, max);
  assert.strictEqual(imported.summary.importedCount, 1);
  assert.strictEqual(imported.summary.skippedCount, 1);
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

function testMonthKeyUsesClampedFebruaryStartBoundary() {
  const win = createContext();
  for (const startDay of [29, 30, 31]) {
    assert.strictEqual(win.BudgetStorage.monthKeyForDate('2026-02-27', startDay), '2026-01');
    assert.strictEqual(win.BudgetStorage.monthKeyForDate('2026-02-28', startDay), '2026-02');
    assert.strictEqual(win.BudgetStorage.monthKeyForDate('2028-02-28', startDay), '2028-01');
    assert.strictEqual(win.BudgetStorage.monthKeyForDate('2028-02-29', startDay), '2028-02');
  }
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

function testSampleReplaceHonorsCustomBudgetMonthStart() {
  const win = createContext();
  const state = win.BudgetStorage.normalizeState({
    monthStartDay: 25,
    transactions: [
      { id: 'sample-prior', date: '2026-05-01', type: 'expense', category: '생활비', amount: 1000, memo: '이전 예산월', source: 'sample' },
      { id: 'sample-selected', date: '2026-05-25', type: 'expense', category: '배달비', amount: 2000, memo: '선택 예산월', source: 'sample' }
    ]
  });

  const replaced = win.BudgetTransactions.createSampleState(state, '2026-05', { replace: true });
  const newSamples = replaced.transactions.filter((transaction) => (
    transaction.source === 'sample'
    && !['sample-prior', 'sample-selected'].includes(transaction.id)
  ));

  assert.strictEqual(replaced.transactions.some((transaction) => transaction.id === 'sample-prior'), true);
  assert.strictEqual(replaced.transactions.some((transaction) => transaction.id === 'sample-selected'), false);
  assert.strictEqual(newSamples.length, 6);
  assert.strictEqual(
    newSamples.every((transaction) => win.BudgetStorage.isDateInBudgetMonth(transaction.date, '2026-05', 25)),
    true
  );
  assert.strictEqual(
    JSON.stringify(newSamples.map((transaction) => transaction.date)),
    JSON.stringify(['2026-05-25', '2026-05-27', '2026-05-29', '2026-06-02', '2026-06-05', '2026-06-08'])
  );
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

async function testCloudRoutesEveryOperationByRuntimeEnvironment() {
  const previewCase = (location) => ({
    location,
    name: 'preview',
    isPreview: true,
    settingsTable: 'preview_budget_settings',
    transactionsTable: 'preview_transactions',
    stateRpc: 'replace_preview_budget_state'
  });
  const cases = [
    previewCase({ protocol: 'file:', hostname: '', pathname: '/C:/budget/index.html' }),
    previewCase({ hostname: 'localhost', pathname: '/' }),
    previewCase({ hostname: '127.0.0.1', pathname: '/anything/' }),
    previewCase({ hostname: '0.0.0.0', pathname: '/beginner-budget/' }),
    previewCase({ hostname: '::1', pathname: '/beginner-budget/' }),
    previewCase({ hostname: '192.168.0.25', pathname: '/beginner-budget/' }),
    previewCase({ hostname: 'budget-staging.internal', pathname: '/beginner-budget/' }),
    previewCase({ hostname: 'budget.example.com', pathname: '/beginner-budget/' }),
    previewCase({ hostname: 'suho-j.github.io.evil.example', pathname: '/beginner-budget/' }),
    previewCase({ hostname: 'suho-j.github.io', pathname: '/beginner-budget' }),
    previewCase({ hostname: 'suho-j.github.io', pathname: '/beginner-budget/v1/' }),
    previewCase({ hostname: 'suho-j.github.io', pathname: '/beginner-budget-preview' }),
    previewCase({ hostname: 'suho-j.github.io', pathname: '/beginner-budget-preview/v1/' }),
    {
      location: { hostname: 'suho-j.github.io', pathname: '/beginner-budget/' },
      name: 'production',
      isPreview: false,
      settingsTable: 'budget_settings',
      transactionsTable: 'transactions',
      stateRpc: 'replace_budget_state'
    }
  ];

  for (const expected of cases) {
    const fake = createSupabaseFake({
      settingsRow: {
        monthly_budget: 600000,
        category_budgets: {},
        updated_at: '2026-08-12T00:00:00.000Z'
      }
    });
    const win = createContext({ supabase: fake.supabase, location: expected.location });
    const state = win.BudgetStorage.normalizeState({
      transactions: [
        { id: 'tx-a', date: '2026-08-12', type: 'expense', category: '생활비', amount: 1000, memo: '환경 확인', source: 'user' }
      ]
    });

    assert.strictEqual(win.BudgetCloud.ENVIRONMENT.name, expected.name);
    assert.strictEqual(win.BudgetCloud.ENVIRONMENT.isPreview, expected.isPreview);
    assert.strictEqual(win.BudgetCloud.ENVIRONMENT.settingsTable, expected.settingsTable);
    assert.strictEqual(win.BudgetCloud.ENVIRONMENT.transactionsTable, expected.transactionsTable);
    assert.strictEqual(win.BudgetCloud.ENVIRONMENT.stateRpc, expected.stateRpc);
    assert.strictEqual(Object.isFrozen(win.BudgetCloud.ENVIRONMENT), true);

    await win.BudgetCloud.downloadState();
    await win.BudgetCloud.saveSettings(state);
    await win.BudgetCloud.insertTransaction(state.transactions[0]);
    await win.BudgetCloud.updateTransaction(state.transactions[0], state.transactions[0]);
    await win.BudgetCloud.deleteTransaction(state.transactions[0].id, state.transactions[0]);
    await win.BudgetCloud.uploadState(state, state);
    await win.BudgetCloud.signOut();
    await win.BudgetCloud.saveSettings(state);

    const tableCalls = fake.calls.filter((call) => call.table);
    assert.deepStrictEqual(
      tableCalls.map((call) => call.table),
      [
        expected.settingsTable,
        expected.transactionsTable,
        expected.settingsTable,
        expected.transactionsTable,
        expected.transactionsTable,
        expected.transactionsTable,
        expected.settingsTable
      ]
    );
    const rpcCalls = fake.calls.filter((call) => call.action === 'rpc');
    assert.strictEqual(rpcCalls.length, 1);
    assert.strictEqual(rpcCalls[0].name, expected.stateRpc);

    const app = createAppHarness({ isPreview: win.BudgetCloud.ENVIRONMENT.isPreview });
    await app.init();
    assert.strictEqual(app.elements.previewDataWarning.hidden, !expected.isPreview);
    assert.strictEqual(app.document.body.classList.contains('has-preview-warning'), expected.isPreview);
  }
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
    '<dialog id="edit-dialog"', 'id="edit-transaction-form"', 'id="global-message"'
  ]) assert.ok(source.includes(required), `missing markup: ${required}`);

  assert.match(source, /개발 화면 · 운영 데이터 복사본/);
  assert.match(source, /변경[^<]*운영[^<]*반영되지 않아요/);
  assert.doesNotMatch(source, /개발 화면 · 운영 데이터 사용 중/);

  const globalMessage = startTagById('global-message');
  assert.strictEqual(globalMessage.name, 'p');
  assertAttribute(globalMessage, 'role', 'status');
  assertAttribute(globalMessage, 'aria-live', 'polite');
  assertAttribute(globalMessage, 'aria-atomic', 'true');
  assert.ok(source.indexOf(globalMessage.source) < source.indexOf('<main'), 'global feedback must stay outside tab panels');

  for (const id of [
    'month-start-save', 'budget-save', 'category-budget-save', 'transaction-save',
    'sample-button', 'import-button', 'reset-button', 'cloud-upload-button', 'edit-save'
  ]) {
    assertBooleanAttribute(startTagById(id), 'data-cloud-write');
  }

  const stickyChromeMatches = [...source.matchAll(/<div\b(?=[^>]*\bclass="[^"]*\bapp-sticky-chrome\b[^"]*")(?=[^>]*\brole="region")(?=[^>]*\baria-label="가계부 상태와 주요 메뉴")[^>]*>[\s\S]*?<\/nav>\s*<\/div>/g)];
  assert.strictEqual(stickyChromeMatches.length, 1, 'preview warning and tabs need one named sticky region');
  assert.strictEqual((source.match(/\bapp-sticky-chrome\b/g) || []).length, 1, 'app-sticky-chrome must be unique');
  const stickyChrome = stickyChromeMatches[0][0];
  assert.match(stickyChrome, /id="preview-data-warning"/, 'sticky region must contain the preview warning');
  assert.match(stickyChrome, /<nav\b[^>]*\bclass="[^"]*\bapp-tabs\b/, 'sticky region must contain the app tabs');
  assert.ok(stickyChrome.indexOf('preview-data-warning') < stickyChrome.indexOf('app-tabs'), 'preview warning must precede the tabs');
  const stickyChromeEnd = stickyChromeMatches[0].index + stickyChrome.length;
  assert.ok(stickyChromeEnd < source.indexOf('<section class="container month-toolbar"'), 'month toolbar must stay below the sticky region');

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

  const calendarPanelByLabel = (label) => {
    const match = source.match(new RegExp(`<section\\b[^>]*\\baria-labelledby="${label}"[^>]*>`, 'i'));
    assert.ok(match, `missing calendar panel: ${label}`);
    return match[0];
  };
  const overviewPanel = calendarPanelByLabel('calendar-title');
  const detailPanel = calendarPanelByLabel('calendar-detail-title');
  assert.match(overviewPanel, /\bclass="[^"]*\bcalendar-overview-panel\b[^"]*"/, 'only the calendar overview panel should be compact on mobile');
  assert.doesNotMatch(detailPanel, /\bcalendar-overview-panel\b/, 'calendar details must retain normal panel padding');
  assert.strictEqual((source.match(/\bcalendar-overview-panel\b/g) || []).length, 1, 'calendar-overview-panel must be unique');

  const listCount = startTagById('list-count');
  assertAttribute(listCount, 'role', 'status');
  assertAttribute(listCount, 'aria-live', 'polite');
  assertAttribute(listCount, 'aria-atomic', 'true');

  const calendarDetailCount = startTagById('calendar-detail-count');
  assertAttribute(calendarDetailCount, 'role', 'status');
  assertAttribute(calendarDetailCount, 'aria-live', 'polite');
  assertAttribute(calendarDetailCount, 'aria-atomic', 'true');

  const cloudDownload = startTagById('cloud-download-button');
  assert.doesNotMatch(cloudDownload.source, /\bvisually-hidden\b/, 'load-error retry must be visibly available');
}

function testAppStylesCoverTabsCalendarDialogAndMobile() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'css/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declarations = (selector, scope = source) => {
    const match = scope.match(new RegExp(`(?:^|})\\s*${escapeRegex(selector)}\\s*\\{([^}]*)\\}`, 'm'));
    assert.ok(match, `missing style rule: ${selector}`);
    return match[1];
  };

  const stickyChrome = declarations('.app-sticky-chrome');
  assert.match(stickyChrome, /(?:^|;)\s*position\s*:\s*sticky\s*;/);
  assert.match(stickyChrome, /(?:^|;)\s*top\s*:\s*0\s*;/);
  assert.match(stickyChrome, /(?:^|;)\s*z-index\s*:\s*30\s*;/);

  for (const selector of ['.preview-data-warning', '.app-tabs']) {
    const block = declarations(selector);
    assert.match(block, /(?:^|;)\s*position\s*:\s*static\s*;/, `${selector} must rely on the shared sticky wrapper`);
    assert.doesNotMatch(block, /(?:^|;)\s*position\s*:\s*sticky\s*;/);
  }
  assert.doesNotMatch(source, /\.has-preview-warning\s+\.app-tabs\s*\{[^}]*\btop\s*:\s*44px\s*;/, 'tab offset must not depend on a hard-coded warning height');

  assert.match(declarations('.global-message:empty'), /(?:^|;)\s*display\s*:\s*none\s*;/);
  const visibleGlobalMessage = declarations('.global-message:not(:empty)');
  assert.match(visibleGlobalMessage, /(?:^|;)\s*padding\s*:\s*[^;]+;/);
  assert.match(visibleGlobalMessage, /(?:^|;)\s*background\s*:\s*[^;]+;/);

  for (const selector of ['.app-tabs [role="tab"]:hover', '.app-tabs [role="tab"][aria-selected="true"]:hover']) {
    const block = declarations(selector);
    assert.match(block, /(?:^|;)\s*background\s*:\s*[^;]+;/, `${selector} needs hover feedback`);
    assert.match(block, /(?:^|;)\s*color\s*:\s*[^;]+;/, `${selector} needs readable hover text`);
  }

  const calendarHover = declarations('.calendar-day:hover');
  assert.match(calendarHover, /(?:^|;)\s*background\s*:\s*[^;]+;/);
  assert.match(calendarHover, /(?:^|;)\s*color\s*:\s*[^;]+;/);
  const calendarFocus = declarations('.calendar-day:focus-visible');
  assert.match(calendarFocus, /(?:^|;)\s*background\s*:\s*[^;]+;/);
  assert.match(calendarFocus, /(?:^|;)\s*color\s*:\s*[^;]+;/);
  assert.match(calendarFocus, /(?:^|;)\s*outline\s*:\s*3px\s+solid\s+[^;]+;/);
  assert.match(calendarFocus, /(?:^|;)\s*outline-offset\s*:\s*2px\s*;/);
  const calendarSelected = declarations('.calendar-day.is-selected');
  assert.match(calendarSelected, /(?:^|;)\s*box-shadow\s*:\s*inset\s+[^;]+;/);
  assert.match(calendarSelected, /(?:^|;)\s*border-color\s*:\s*[^;]+;/);
  assert.doesNotMatch(calendarSelected, /(?:^|;)\s*outline\s*:/, 'selection must not replace the focus outline');

  const calendarCount = declarations('.calendar-count');
  const calendarCountColor = calendarCount.match(/(?:^|;)\s*color\s*:\s*#([0-9a-f]{6})\s*;/i);
  assert.ok(calendarCountColor, '.calendar-count needs an explicit testable text color');
  const relativeLuminance = (hex) => {
    const channels = hex.match(/../g).map((part) => parseInt(part, 16) / 255).map((channel) => (
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    ));
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
  };
  const contrastRatio = (foreground, background) => {
    const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
    const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
    return (lighter + 0.05) / (darker + 0.05);
  };
  for (const background of ['ffffff', 'eef2ff']) {
    assert.ok(contrastRatio(calendarCountColor[1], background) >= 4.5, `.calendar-count needs 4.5:1 contrast on #${background}`);
  }

  const dialog = declarations('dialog');
  assert.match(dialog, /max-height\s*:\s*calc\(100vh - 2rem\)\s*;[\s\S]*max-height\s*:\s*calc\(100dvh - 2rem\)\s*;/);
  assert.match(dialog, /(?:^|;)\s*overscroll-behavior\s*:\s*contain\s*;/);

  const mobileMarker = '@media (max-width: 559px)';
  const mobileMarkerIndex = source.indexOf(mobileMarker);
  assert.ok(mobileMarkerIndex >= 0, `missing style: ${mobileMarker}`);
  const mobile = source.slice(source.indexOf('{', mobileMarkerIndex) + 1);
  assert.match(declarations('.calendar-overview-panel', mobile), /(?:^|;)\s*padding\s*:\s*0\.25rem\s*;/);
  assert.doesNotMatch(mobile, /#panel-calendar\s*>\s*\.panel\s*\{[^}]*\bpadding\s*:/, 'calendar details must not inherit compact mobile padding');
  assert.match(declarations('.calendar-weekdays, .calendar-grid', mobile), /(?:^|;)\s*gap\s*:\s*0\.1rem\s*;/);
  const mobileDay = declarations('.calendar-day', mobile);
  assert.match(mobileDay, /(?:^|;)\s*min-width\s*:\s*44px\s*;/);
  assert.match(mobileDay, /(?:^|;)\s*min-height\s*:\s*68px\s*;/);
  const mobileAmounts = declarations('.calendar-expense, .calendar-income', mobile);
  assert.match(mobileAmounts, /(?:^|;)\s*font-size\s*:\s*0\.75rem\s*;/);
  assert.match(mobileAmounts, /(?:^|;)\s*overflow-wrap\s*:\s*anywhere\s*;/);
  assert.match(declarations('.calendar-count', mobile), /(?:^|;)\s*font-size\s*:\s*0\.75rem\s*;/);
  assert.match(declarations('dialog', mobile), /max-height\s*:\s*calc\(100vh - 1rem\)\s*;[\s\S]*max-height\s*:\s*calc\(100dvh - 1rem\)\s*;/);

  const calendarContentWidth = 360 - 24 - 2 - (2 * 4);
  const calendarMinimumWidth = (7 * 44) + (6 * 1.6);
  assert.ok(calendarMinimumWidth <= calendarContentWidth, 'seven 44px targets must fit the 360px calendar panel');
}

function testUiExportsTabEditAndCalendarRenderers() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js/ui.js'), 'utf8');
  for (const name of [
    'setActiveTab',
    'fillFilterCategoryOptions',
    'openEditDialog',
    'closeEditDialog',
    'renderCalendar',
    'renderCalendarDetails'
  ]) {
    assert.ok(source.includes(`function ${name}`), `missing UI function: ${name}`);
    assert.ok(source.includes(`${name},`), `missing UI export: ${name}`);
  }
}

function testUiTabsAndFilterOptionsBehave() {
  const { window, document } = createUiContext();
  const homeTab = document.createElement('button');
  homeTab.dataset.tab = 'home';
  const historyTab = document.createElement('button');
  historyTab.dataset.tab = 'history';
  const homePanel = document.createElement('section');
  homePanel.id = 'panel-home';
  const historyPanel = document.createElement('section');
  historyPanel.id = 'panel-history';

  window.BudgetUI.setActiveTab({
    tabs: [homeTab, historyTab],
    tabPanels: [homePanel, historyPanel]
  }, 'history', true);

  assert.strictEqual(homeTab.getAttribute('aria-selected'), 'false');
  assert.strictEqual(homeTab.tabIndex, -1);
  assert.strictEqual(historyTab.getAttribute('aria-selected'), 'true');
  assert.strictEqual(historyTab.tabIndex, 0);
  assert.strictEqual(homePanel.hidden, true);
  assert.strictEqual(historyPanel.hidden, false);
  assert.strictEqual(document.activeElement, historyTab);

  const select = document.createElement('select');
  window.BudgetUI.fillFilterCategoryOptions(select, 'all', '공통');
  assert.strictEqual(JSON.stringify(select.children.map((option) => option.value)), JSON.stringify(['all', '생활비', '배달비', '공통', '급여']));
  assert.strictEqual(select.value, '공통');

  window.BudgetUI.fillFilterCategoryOptions(select, 'income', '생활비');
  assert.strictEqual(JSON.stringify(select.children.map((option) => option.value)), JSON.stringify(['all', '급여', '공통']));
  assert.strictEqual(select.value, 'all');
}

function testUiValidationAndEditDialogFocusFlow() {
  const { window, document } = createUiContext();
  const globalAmount = document.createElement('input');
  globalAmount.id = 'tx-amount';
  const form = document.createElement('form');
  const scopedAmount = document.createElement('input');
  scopedAmount.name = 'amount';
  const message = document.createElement('p');
  form.append(scopedAmount);
  document.body.append(globalAmount, form, message);

  window.BudgetUI.showValidationErrors(form, message, [{ field: 'amount', message: '금액을 확인해 주세요.' }]);
  assert.strictEqual(scopedAmount.getAttribute('aria-invalid'), 'true');
  assert.strictEqual(globalAmount.getAttribute('aria-invalid'), null);
  assert.strictEqual(document.activeElement, scopedAmount);

  const dialog = document.createElement('dialog');
  const editForm = document.createElement('form');
  const editId = document.createElement('input');
  const editDate = document.createElement('input');
  editDate.name = 'date';
  const editType = document.createElement('select');
  editType.name = 'type';
  const editCategory = document.createElement('select');
  editCategory.name = 'category';
  const editAmount = document.createElement('input');
  editAmount.name = 'amount';
  const editMemo = document.createElement('input');
  editMemo.name = 'memo';
  const editMessage = document.createElement('p');
  editForm.append(editId, editDate, editType, editCategory, editAmount, editMemo, editMessage);
  dialog.append(editForm);

  const panel = document.createElement('section');
  panel.id = 'panel-calendar';
  panel.setAttribute('role', 'tabpanel');
  const trigger = document.createElement('button');
  trigger.dataset.action = 'edit';
  trigger.dataset.id = 'tx-a';
  panel.append(trigger);
  const historyTab = document.createElement('button');
  historyTab.dataset.tab = 'history';
  const calendarTab = document.createElement('button');
  calendarTab.dataset.tab = 'calendar';
  document.body.append(dialog, panel, historyTab, calendarTab);

  const elements = {
    editDialog: dialog,
    editForm,
    editId,
    editDate,
    editType,
    editCategory,
    editAmount,
    editMemo,
    editMessage,
    tabs: [historyTab, calendarTab]
  };
  const transaction = {
    id: 'tx-a', date: '2026-05-02', type: 'expense', category: '배달비', amount: 25000, memo: '저녁'
  };

  window.BudgetUI.openEditDialog(elements, transaction, trigger);
  assert.strictEqual(editId.value, 'tx-a');
  assert.strictEqual(editDate.value, '2026-05-02');
  assert.strictEqual(editType.value, 'expense');
  assert.strictEqual(editCategory.value, '배달비');
  assert.strictEqual(editAmount.value, '25000');
  assert.strictEqual(editMemo.value, '저녁');
  assert.strictEqual(dialog.open, true);
  assert.strictEqual(document.activeElement, editDate);
  assert.strictEqual(dialog.returnTab, 'calendar');
  window.BudgetUI.closeEditDialog(elements);
  assert.strictEqual(document.activeElement, trigger);

  window.BudgetUI.openEditDialog(elements, transaction, trigger);
  trigger.remove();
  const replacement = document.createElement('button');
  replacement.dataset.action = 'edit';
  replacement.dataset.id = 'tx-a';
  panel.append(replacement);
  window.BudgetUI.closeEditDialog(elements);
  assert.strictEqual(document.activeElement, replacement);

  window.BudgetUI.openEditDialog(elements, transaction, replacement);
  replacement.remove();
  window.BudgetUI.closeEditDialog(elements);
  assert.strictEqual(document.activeElement, calendarTab);
}

function testUiCalendarRenderingPreservesFocusAndExplainsEmptyDates() {
  const { window, document } = createUiContext();
  const calendarGrid = document.createElement('div');
  document.body.append(calendarGrid);
  const previous = document.createElement('button');
  previous.dataset.action = 'select-date';
  previous.dataset.date = '2026-05-01';
  calendarGrid.append(previous);
  previous.focus();

  const days = [
    { date: '2026-04-30', day: 30, inPeriod: false },
    { date: '2026-05-01', day: 1, inPeriod: true },
    { date: '2026-05-02', day: 2, inPeriod: true }
  ];
  const byDate = {
    '2026-05-02': { expense: 12000, income: 50000, count: 2 }
  };
  window.BudgetUI.renderCalendar({ calendarGrid }, days, byDate, '2026-05-02');

  assert.strictEqual(calendarGrid.children.every((button) => button.tagName === 'BUTTON'), true);
  const outside = calendarGrid.children.find((button) => button.dataset.date === '2026-04-30');
  const selected = calendarGrid.children.find((button) => button.dataset.date === '2026-05-02');
  assert.strictEqual(outside.disabled, true);
  assert.strictEqual(outside.getAttribute('role'), null);
  assert.strictEqual(selected.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(selected.getAttribute('aria-label'), `2026-05-02, 지출 ${window.BudgetUI.formatWon(12000)}, 수입 ${window.BudgetUI.formatWon(50000)}, 2건`);
  assert.strictEqual(document.activeElement, selected);

  const elsewhere = document.createElement('button');
  document.body.append(elsewhere);
  elsewhere.focus();
  window.BudgetUI.renderCalendar({ calendarGrid }, days, byDate, '2026-05-01');
  assert.strictEqual(document.activeElement, elsewhere);

  const detailElements = {
    calendarDetailList: document.createElement('ul'),
    calendarDetailEmpty: document.createElement('p'),
    calendarDetailCount: document.createElement('p')
  };
  window.BudgetUI.renderCalendarDetails(detailElements, '', []);
  assert.strictEqual(detailElements.calendarDetailEmpty.hidden, false);
  assert.strictEqual(detailElements.calendarDetailEmpty.textContent, '날짜를 누르면 거래 내역을 보여드려요.');
  assert.strictEqual(detailElements.calendarDetailCount.textContent, '날짜를 선택해 주세요.');

  window.BudgetUI.renderCalendarDetails(detailElements, '2026-05-03', []);
  assert.strictEqual(detailElements.calendarDetailEmpty.textContent, '선택한 날짜에 거래가 없어요.');
  assert.strictEqual(detailElements.calendarDetailCount.textContent, '2026-05-03 · 0건');
}

function testUiTransactionActionLabelsIncludeType() {
  const { window, document } = createUiContext();
  const elements = {
    list: document.createElement('ul'),
    listCount: document.createElement('p'),
    emptyState: document.createElement('p')
  };
  window.BudgetUI.renderList(elements, [
    { id: 'expense-a', date: '2026-05-02', type: 'expense', category: '생활비', amount: 1000, memo: '' },
    { id: 'income-a', date: '2026-05-02', type: 'income', category: '급여', amount: 1000, memo: '' }
  ]);

  const editButtons = elements.list.querySelectorAll('[data-action="edit"]');
  const deleteButtons = elements.list.querySelectorAll('[data-action="delete"]');
  assert.strictEqual(editButtons[0].getAttribute('aria-label'), `2026-05-02 지출 생활비 ${window.BudgetUI.formatWon(1000)} 수정`);
  assert.strictEqual(deleteButtons[0].getAttribute('aria-label'), `2026-05-02 지출 생활비 ${window.BudgetUI.formatWon(1000)} 삭제`);
  assert.strictEqual(editButtons[1].getAttribute('aria-label'), `2026-05-02 수입 급여 ${window.BudgetUI.formatWon(1000)} 수정`);
  assert.strictEqual(deleteButtons[1].getAttribute('aria-label'), `2026-05-02 수입 급여 ${window.BudgetUI.formatWon(1000)} 삭제`);
  assert.strictEqual(editButtons.every((button) => button.getAttribute('data-cloud-write') === ''), true);
  assert.strictEqual(deleteButtons.every((button) => button.getAttribute('data-cloud-write') === ''), true);
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

function testAppIntegratesTabsCalendarAndRemoteFirstMutations() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  [
    'BudgetCloud.insertTransaction',
    'BudgetCloud.updateTransaction',
    'BudgetCloud.deleteTransaction',
    'BudgetCloud.saveSettings',
    'BudgetUI.setActiveTab',
    'BudgetUI.renderCalendar',
    'filterCategory'
  ].forEach((token) => assert.ok(source.includes(token), `app.js must integrate ${token}`));
  assert.ok(
    !source.includes('persist(window.BudgetTransactions.deleteTransaction'),
    'transaction deletion must not update local state before Supabase succeeds'
  );
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
  assert.strictEqual(fake.calls[3].action, 'insert');
  assert.strictEqual(fake.calls[3].payload.user_id, 'user-1');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(fake.calls[3].payload, 'updated_at'), false);
  assert.strictEqual(fake.calls[3].select, 'updated_at');
}

async function testCloudSettingsUpdateUsesDownloadedVersion() {
  const initialVersion = '2026-08-12T01:02:03.000Z';
  const firstDatabaseVersion = '2026-08-12T01:02:04.000Z';
  const secondDatabaseVersion = '2026-08-12T01:02:05.000Z';
  const fake = createSupabaseFake({
    settingsRow: {
      monthly_budget: 600000,
      category_budgets: {},
      updated_at: initialVersion
    },
    settingsWriteVersions: [firstDatabaseVersion, secondDatabaseVersion]
  });
  const win = createContext({ supabase: fake.supabase });
  await win.BudgetCloud.downloadState();

  const firstState = win.BudgetStorage.normalizeState({ monthlyBudget: 700000 });
  await win.BudgetCloud.saveSettings(firstState);
  const firstUpdate = fake.calls.filter((call) => call.table === 'budget_settings' && call.action === 'update')[0];
  assert.ok(firstUpdate, 'settings save must update the downloaded row');
  assert.deepStrictEqual(firstUpdate.filters, [
    ['user_id', 'user-1'],
    ['updated_at', initialVersion]
  ]);
  assert.strictEqual(firstUpdate.select, 'updated_at');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(firstUpdate.payload, 'updated_at'), false);

  const secondState = win.BudgetStorage.normalizeState({ monthlyBudget: 800000 });
  await win.BudgetCloud.saveSettings(secondState);
  const updates = fake.calls.filter((call) => call.table === 'budget_settings' && call.action === 'update');
  assert.strictEqual(updates.length, 2);
  assert.deepStrictEqual(updates[1].filters, [
    ['user_id', 'user-1'],
    ['updated_at', firstDatabaseVersion]
  ]);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(updates[1].payload, 'updated_at'), false);
}

async function testCloudSettingsConflictKeepsExpectedVersionAndInput() {
  const initialVersion = '2026-08-12T01:02:03.000Z';
  const fake = createSupabaseFake({
    settingsRow: {
      monthly_budget: 600000,
      category_budgets: {},
      updated_at: initialVersion
    },
    emptyActions: ['budget_settings:update']
  });
  const win = createContext({ supabase: fake.supabase });
  await win.BudgetCloud.downloadState();
  const state = win.BudgetStorage.normalizeState({ monthlyBudget: 700000 });
  const before = JSON.stringify(state);
  const conflictMessage = '다른 브라우저에서 예산 설정이 변경됐어요. 클라우드 데이터를 다시 불러와 주세요.';

  await assert.rejects(win.BudgetCloud.saveSettings(state), new RegExp(conflictMessage));
  await assert.rejects(win.BudgetCloud.saveSettings(state), new RegExp(conflictMessage));

  assert.strictEqual(JSON.stringify(state), before);
  const updates = fake.calls.filter((call) => call.table === 'budget_settings' && call.action === 'update');
  assert.strictEqual(updates.length, 2);
  assert.strictEqual(updates[0].filters.find(([column]) => column === 'updated_at')[1], initialVersion);
  assert.strictEqual(updates[1].filters.find(([column]) => column === 'updated_at')[1], initialVersion);
}

async function testCloudSettingsInsertDuplicateUsesFriendlyConflict() {
  const fake = createSupabaseFake({
    settingsRow: null,
    queryErrors: {
      'budget_settings:insert': { code: '23505', message: 'duplicate key value violates unique constraint' }
    }
  });
  const win = createContext({ supabase: fake.supabase });
  await win.BudgetCloud.downloadState();

  await assert.rejects(
    win.BudgetCloud.saveSettings(win.BudgetStorage.defaultState()),
    /다른 브라우저에서 예산 설정이 변경됐어요. 클라우드 데이터를 다시 불러와 주세요./
  );
  assert.strictEqual(fake.calls.filter((call) => call.action === 'insert').length, 1);
  assert.strictEqual(fake.calls.filter((call) => call.action === 'update').length, 0);
}

async function testCloudSettingsVersionChangesOnlyAfterCompleteDownloadAndClearsOnLogout() {
  const firstVersion = '2026-08-12T01:02:03.000Z';
  const secondVersion = '2026-08-12T02:03:04.000Z';
  const settingsRow = { monthly_budget: 600000, category_budgets: {}, updated_at: firstVersion };
  let transactionReads = 0;
  const failedDownloadFake = createSupabaseFake({
    settingsRow,
    queryErrors: {
      'transactions:select': () => {
        transactionReads += 1;
        return transactionReads === 2 ? new Error('transaction download failed') : null;
      }
    }
  });
  const failedDownloadWin = createContext({ supabase: failedDownloadFake.supabase });
  await failedDownloadWin.BudgetCloud.downloadState();
  settingsRow.updated_at = secondVersion;
  await assert.rejects(failedDownloadWin.BudgetCloud.downloadState(), /transaction download failed/);
  await failedDownloadWin.BudgetCloud.saveSettings(failedDownloadWin.BudgetStorage.defaultState());
  const update = failedDownloadFake.calls.find((call) => call.table === 'budget_settings' && call.action === 'update');
  assert.strictEqual(update.filters.find(([column]) => column === 'updated_at')[1], firstVersion);

  const logoutFake = createSupabaseFake({
    settingsRow: { monthly_budget: 600000, category_budgets: {}, updated_at: firstVersion }
  });
  const logoutWin = createContext({ supabase: logoutFake.supabase });
  await logoutWin.BudgetCloud.downloadState();
  await logoutWin.BudgetCloud.signOut();
  await logoutWin.BudgetCloud.saveSettings(logoutWin.BudgetStorage.defaultState());
  assert.strictEqual(logoutFake.calls.some((call) => call.table === 'budget_settings' && call.action === 'insert'), true);
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
    staleWin.BudgetCloud.updateTransaction(transaction, transaction),
    /거래가 이미 변경되었거나 삭제되었어요/
  );
  await assert.rejects(
    staleWin.BudgetCloud.deleteTransaction('tx-a', transaction),
    /거래가 이미 변경되었거나 삭제되었어요/
  );
  assert.strictEqual(staleFake.calls[0].select, 'id');
  assert.strictEqual(staleFake.calls[1].select, 'id');
}

async function testCloudTransactionMutationsFilterExpectedPriorRow() {
  const fake = createSupabaseFake();
  const win = createContext({ supabase: fake.supabase });
  const expected = {
    id: 'tx-a', date: '2026-05-02', type: 'expense', category: '생활비',
    amount: 12000, memo: '마트', source: 'user'
  };
  const updated = { ...expected, category: '배달비', amount: 15000, memo: '배달' };

  await win.BudgetCloud.updateTransaction(updated, expected);
  await win.BudgetCloud.deleteTransaction(expected.id, expected);

  const expectedFilters = [
    ['id', 'tx-a'],
    ['user_id', 'user-1'],
    ['date', '2026-05-02'],
    ['type', 'expense'],
    ['category', '생활비'],
    ['amount', 12000],
    ['memo', '마트'],
    ['source', 'user']
  ];
  assert.deepStrictEqual(fake.calls[0].filters, expectedFilters);
  assert.deepStrictEqual(fake.calls[1].filters, expectedFilters);
}

async function testCloudReplacesWholeStateWithOneRpc() {
  const fake = createSupabaseFake();
  const win = createContext({ supabase: fake.supabase });
  const state = win.BudgetStorage.normalizeState({
    monthlyBudget: 900000,
    categoryBudgets: { 생활비: 300000 },
    monthStartDay: 25,
    monthlyBudgets: {
      '2026-05': { monthlyBudget: 800000, categoryBudgets: { 배달비: 100000 } }
    },
    transactions: [
      { id: 'tx-a', date: '2026-05-25', type: 'expense', category: '생활비', amount: 12000, memo: '마트', source: 'user' }
    ]
  });
  const before = JSON.stringify(state);

  const result = await win.BudgetCloud.uploadState(state, state);

  assert.strictEqual(result.uploadedCount, 1);
  assert.strictEqual(JSON.stringify(state), before);
  assert.strictEqual(fake.calls.length, 1);
  assert.strictEqual(fake.calls[0].action, 'rpc');
  assert.strictEqual(fake.calls[0].name, 'replace_budget_state');
  assert.strictEqual(JSON.stringify(fake.calls[0].args), JSON.stringify({
    p_monthly_budget: 900000,
    p_category_budgets: {
      생활비: 300000,
      __month_start_day: 25,
      __monthly_budgets: {
        '2026-05': { monthlyBudget: 800000, categoryBudgets: { 배달비: 100000 } }
      }
    },
    p_transactions: [
      { id: 'tx-a', date: '2026-05-25', type: 'expense', category: '생활비', amount: 12000, memo: '마트', source: 'user' }
    ],
    p_expected_updated_at: null,
    p_expected_transactions: [
      { id: 'tx-a', date: '2026-05-25', type: 'expense', category: '생활비', amount: 12000, memo: '마트', source: 'user' }
    ]
  }));
  assert.strictEqual(fake.calls.some((call) => ['delete', 'insert', 'upsert'].includes(call.action)), false);
}

async function testCloudWholeStateReplacementUsesExpectedSnapshotAndAdvancesVersion() {
  const initialVersion = '2026-08-12T01:02:03.000Z';
  const replacementVersion = '2026-08-12T02:03:04.000Z';
  const fake = createSupabaseFake({
    settingsRow: { monthly_budget: 600000, category_budgets: {}, updated_at: initialVersion },
    transactionRows: [],
    rpcData: {
      replace_budget_state: [{ uploaded_count: 1, updated_at: replacementVersion }]
    }
  });
  const win = createContext({ supabase: fake.supabase });
  await win.BudgetCloud.downloadState();
  const expectedState = win.BudgetStorage.normalizeState({
    transactions: [
      { id: 'tx-z', date: '2026-05-02', type: 'expense', category: '생활비', amount: 2000, memo: 'z', source: 'user' },
      { id: 'tx-a', date: '2026-05-01', type: 'income', category: '월급', amount: 1000, memo: 'a', source: 'user' }
    ]
  });
  const nextState = win.BudgetStorage.normalizeState({
    monthlyBudget: 900000,
    transactions: [
      { id: 'tx-new', date: '2026-06-01', type: 'expense', category: '생활비', amount: 3000, memo: '', source: 'user' }
    ]
  });

  await win.BudgetCloud.uploadState(nextState, expectedState);
  const rpc = fake.calls.find((call) => call.action === 'rpc' && call.name === 'replace_budget_state');
  assert.strictEqual(rpc.args.p_expected_updated_at, initialVersion);
  assert.strictEqual(JSON.stringify(rpc.args.p_expected_transactions), JSON.stringify([
    { id: 'tx-a', date: '2026-05-01', type: 'income', category: '월급', amount: 1000, memo: 'a', source: 'user' },
    { id: 'tx-z', date: '2026-05-02', type: 'expense', category: '생활비', amount: 2000, memo: 'z', source: 'user' }
  ]));
  assert.strictEqual(rpc.args.p_expected_transactions.some((row) => 'user_id' in row), false);

  await win.BudgetCloud.saveSettings(nextState);
  const update = fake.calls.find((call) => call.table === 'budget_settings' && call.action === 'update');
  assert.strictEqual(update.filters.find(([column]) => column === 'updated_at')[1], replacementVersion);
}

async function testCloudWholeStateRpcErrorsBeforeAnyDirectWrite() {
  const rpcError = new Error('replace_budget_state 함수를 찾지 못했어요.');
  const fake = createSupabaseFake({ rpcErrors: { replace_budget_state: rpcError } });
  const win = createContext({ supabase: fake.supabase });
  const state = win.BudgetStorage.normalizeState({
    transactions: [
      { id: 'tx-a', date: '2026-05-01', type: 'expense', category: '생활비', amount: 1000 }
    ]
  });
  const before = JSON.stringify(state);

  await assert.rejects(win.BudgetCloud.uploadState(state, state), /replace_budget_state 함수를 찾지 못했어요/);

  assert.strictEqual(JSON.stringify(state), before);
  assert.strictEqual(fake.calls.length, 1);
  assert.strictEqual(fake.calls[0].action, 'rpc');
  assert.strictEqual(fake.calls[0].name, 'replace_budget_state');
}

function testSupabaseSetupDefinesTransactionalWholeStateRpc() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'supabase-setup.sql'), 'utf8');
  const start = source.search(/create or replace function public\.replace_budget_state\s*\(/i);
  const end = source.search(/drop function if exists public\.replace_budget_samples/i);
  const rpc = source.slice(start, end);
  assert.match(source, /create or replace function public\.replace_budget_state\s*\(/i);
  assert.match(source, /drop function if exists public\.replace_budget_state\s*\(integer,\s*jsonb,\s*jsonb\)/i);
  assert.match(rpc, /p_expected_updated_at\s+timestamptz/i);
  assert.match(rpc, /p_expected_transactions\s+jsonb/i);
  assert.match(rpc, /returns table\s*\(uploaded_count integer,\s*updated_at timestamptz\)/i);
  assert.match(rpc, /security invoker/i);
  assert.match(rpc, /auth\.uid\(\)/i);
  assert.match(rpc, /jsonb_typeof\(p_expected_transactions\)\s*<>\s*'array'/i);
  assert.match(rpc, /duplicate transaction ids/i);
  assert.match(rpc, /v_current_updated_at\s+is distinct from\s+p_expected_updated_at/i);
  assert.match(rpc, /where settings\.user_id\s*=\s*v_user_id\s+for update/i);
  assert.match(rpc, /jsonb_agg\s*\([\s\S]*jsonb_build_object[\s\S]*order by[\s\S]*\.id/i);
  assert.match(rpc, /v_current_transactions\s+is distinct from\s+v_expected_transactions/i);
  assert.match(rpc, /update public\.budget_settings[\s\S]*updated_at\s*=\s*p_expected_updated_at[\s\S]*returning settings\.updated_at\s+into\s+v_new_updated_at/i);
  assert.match(rpc, /insert into public\.budget_settings[\s\S]*on conflict\s*\(user_id\)\s*do nothing/i);
  assert.match(rpc, /errcode\s*=\s*'40001'/i);
  const versionCheck = rpc.indexOf('v_current_updated_at is distinct from p_expected_updated_at');
  const transactionCheck = rpc.indexOf('v_current_transactions is distinct from v_expected_transactions');
  const firstWrite = Math.min(...[
    rpc.indexOf('update public.budget_settings'),
    rpc.indexOf('insert into public.budget_settings'),
    rpc.indexOf('delete from public.transactions')
  ].filter((index) => index >= 0));
  assert.ok(versionCheck >= 0 && versionCheck < firstWrite, 'settings CAS must run before the first write');
  assert.ok(transactionCheck >= 0 && transactionCheck < firstWrite, 'transaction CAS must run before the first write');
  assert.match(source, /revoke all on function public\.replace_budget_state\(integer,\s*jsonb,\s*jsonb,\s*timestamptz,\s*jsonb\) from public/i);
  assert.match(source, /revoke all on function public\.replace_budget_state\(integer,\s*jsonb,\s*jsonb,\s*timestamptz,\s*jsonb\) from anon/i);
  assert.match(source, /grant execute on function public\.replace_budget_state\(integer,\s*jsonb,\s*jsonb,\s*timestamptz,\s*jsonb\) to authenticated/i);
}

function testSupabaseSettingsVersionIsDatabaseOwnedAndMonotonic() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'supabase-setup.sql'), 'utf8');
  assert.match(source, /create or replace function public\.set_budget_settings_updated_at\s*\(\s*\)/i);
  assert.match(source, /returns trigger[\s\S]*if tg_op\s*=\s*'INSERT'[\s\S]*new\.updated_at\s*:=\s*clock_timestamp\(\)/i);
  assert.match(source, /new\.updated_at\s*:=\s*greatest\s*\(\s*clock_timestamp\(\),\s*old\.updated_at\s*\+\s*interval\s*'1 microsecond'\s*\)/i);
  assert.match(source, /drop trigger if exists set_budget_settings_updated_at on public\.budget_settings/i);
  assert.match(source, /create trigger set_budget_settings_updated_at\s+before insert or update on public\.budget_settings[\s\S]*execute function public\.set_budget_settings_updated_at\s*\(\s*\)/i);

  const rpcStart = source.search(/create or replace function public\.replace_budget_state\s*\(/i);
  const rpcEnd = source.search(/drop function if exists public\.replace_budget_samples/i);
  const rpc = source.slice(rpcStart, rpcEnd);
  assert.match(rpc, /v_new_updated_at\s+timestamptz\s*;/i);
  assert.doesNotMatch(rpc, /v_new_updated_at\s+timestamptz\s*:=\s*clock_timestamp/i);

  const updateStart = rpc.indexOf('update public.budget_settings');
  const updateWhere = rpc.indexOf('where settings.user_id', updateStart);
  const updateSet = rpc.slice(updateStart, updateWhere);
  assert.doesNotMatch(updateSet, /updated_at\s*=/i, 'whole-state RPC must let the trigger own update tokens');
  assert.match(rpc.slice(updateStart), /returning settings\.updated_at\s+into\s+v_new_updated_at/i);

  const insertStart = rpc.indexOf('insert into public.budget_settings');
  const insertConflict = rpc.indexOf('on conflict', insertStart);
  const insertPayload = rpc.slice(insertStart, insertConflict);
  assert.doesNotMatch(insertPayload, /updated_at/i, 'whole-state RPC must omit client-owned insert tokens');
  assert.match(rpc.slice(insertConflict), /on conflict\s*\(user_id\)\s*do nothing[\s\S]*returning (?:settings\.)?updated_at\s+into\s+v_new_updated_at/i);
  assert.match(rpc, /return query select jsonb_array_length\(p_transactions\)::integer,\s*v_new_updated_at/i);
}

function testSupabaseEnforcesSafeOpaqueTransactionIdsBeforeRpcUse() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'supabase-setup.sql'), 'utf8');
  const safeOpaqueIdSql = "'^[A-Za-z0-9._:-]+$'";
  const deterministicIdSql = "'tx-migrated-' || md5(user_id::text || ':' || id)";
  const preflightStart = source.search(/select\s+user_id,\s+id as old_id/i);
  const migrationStart = source.search(/update public\.transactions\s+set id\s*=/i);
  const constraintDrop = source.search(/drop constraint if exists transactions_id_canonical/i);
  const constraintAdd = source.search(/add constraint transactions_id_canonical/i);
  const rpcStart = source.search(/create or replace function public\.replace_budget_state\s*\(/i);

  assert.ok(preflightStart >= 0 && preflightStart < migrationStart, 'exact legacy ID mapping must be visible before the update');
  assert.ok(migrationStart >= 0 && migrationStart < constraintDrop, 'legacy IDs must be repaired before the check constraint');
  assert.ok(constraintDrop < constraintAdd && constraintAdd < rpcStart, 'canonical ID constraint must be installed before RPC use');
  const preflight = source.slice(preflightStart, migrationStart);
  const migration = source.slice(migrationStart, constraintDrop);
  assert.strictEqual(preflight.includes(`${deterministicIdSql} as new_id`), true);
  assert.strictEqual(migration.includes(`set id = ${deterministicIdSql}`), true);
  assert.strictEqual(source.split(deterministicIdSql).length - 1, 2, 'preflight and update must use the same deterministic expression');
  assert.doesNotMatch(migration, /gen_random_uuid/i);
  assert.strictEqual(migration.includes(`where id !~ ${safeOpaqueIdSql}`), true);
  assert.doesNotMatch(migration, /btrim\(id\)/i, 'SQL must not model opaque IDs with PostgreSQL btrim');
  assert.strictEqual(source.includes(`check (id ~ ${safeOpaqueIdSql})`), true);
  assert.strictEqual(source.split(safeOpaqueIdSql).length - 1, 4, 'preflight, migration, CHECK, and RPC must share one exact ID regex');

  const safeOpaqueId = /^[A-Za-z0-9._:-]+$/;
  const legacyIdFixture = [
    'collision',
    'valid._:-09AZaz',
    ' collision ',
    '\tcollision\t',
    '\ncollision\n',
    'collision\u00a0',
    'collision-😀',
    '충돌-1'
  ];
  let generated = 0;
  const migratedIds = legacyIdFixture.map((id) => (
    safeOpaqueId.test(id) ? id : `tx-fixture-${++generated}`
  ));
  assert.strictEqual(JSON.stringify(migratedIds.slice(0, 2)), JSON.stringify(legacyIdFixture.slice(0, 2)));
  assert.strictEqual(new Set(migratedIds).size, legacyIdFixture.length);
  assert.strictEqual(migratedIds.slice(2).every((id) => id.startsWith('tx-fixture-')), true);

  const userId = '00000000-0000-4000-8000-000000000001';
  const migratedIdFor = (oldId) => (
    `tx-migrated-${crypto.createHash('md5').update(`${userId}:${oldId}`).digest('hex')}`
  );
  const trimCollisionIds = [' collision ', '\tcollision\t', '\ncollision\n', 'collision\u00a0'];
  assert.strictEqual(migratedIdFor(trimCollisionIds[0]), migratedIdFor(trimCollisionIds[0]));
  assert.strictEqual(new Set(trimCollisionIds.map(migratedIdFor)).size, trimCollisionIds.length);
  assert.strictEqual(trimCollisionIds.map(migratedIdFor).every((id) => safeOpaqueId.test(id)), true);
}

function testSupabaseWholeStateRpcRejectsUnsafeOpaqueTransactionIds() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'supabase-setup.sql'), 'utf8');
  const wholeStart = source.search(/create or replace function public\.replace_budget_state\s*\(/i);
  const sampleDrop = source.search(/drop function if exists public\.replace_budget_samples/i);
  const wholeRpc = source.slice(wholeStart, sampleDrop);
  const safeOpaqueIdGuard = /\(transaction_row\s*->>\s*'id'\)\s*!~\s*'\^\[A-Za-z0-9\._:-\]\+\$'/;

  assert.match(wholeRpc, safeOpaqueIdGuard, 'whole-state proposed and expected IDs must use the safe opaque-ID contract');
  assert.doesNotMatch(wholeRpc, /btrim\(transaction_row\s*->>\s*'id'\)/i);
}

function testSupabaseWholeStateRpcLocksTransactionsBeforeSnapshotAndReplacement() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'supabase-setup.sql'), 'utf8');
  const start = source.search(/create or replace function public\.replace_budget_state\s*\(/i);
  const end = source.search(/drop function if exists public\.replace_budget_samples/i);
  const rpc = source.slice(start, end).toLowerCase();
  const lock = rpc.indexOf('lock table public.transactions in share row exclusive mode');
  const snapshotRead = rpc.indexOf('into v_current_transactions');
  const snapshotCompare = rpc.indexOf('v_current_transactions is distinct from');
  const transactionDelete = rpc.indexOf('delete from public.transactions');
  const transactionInsert = rpc.indexOf('insert into public.transactions');

  assert.ok(lock >= 0, 'whole-state replacement must lock transactions against direct DML');
  assert.ok(lock < snapshotRead, 'transaction lock must precede the current snapshot read');
  assert.ok(lock < snapshotCompare, 'transaction lock must cover the snapshot comparison');
  assert.ok(lock < transactionDelete, 'transaction lock must precede replacement delete');
  assert.ok(lock < transactionInsert, 'transaction lock must precede replacement insert');
}

function testSupabaseWholeStateRpcCanonicalizesExpectedTransactionsWithDatabaseOrdering() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'supabase-setup.sql'), 'utf8');
  const start = source.search(/create or replace function public\.replace_budget_state\s*\(/i);
  const end = source.search(/drop function if exists public\.replace_budget_samples/i);
  const rpc = source.slice(start, end);

  // A supplementary character and a BMP private-use character sort differently
  // under JavaScript UTF-16 ordering and PostgreSQL UTF-8 COLLATE "C" ordering.
  const ids = ['id-\uE000', 'id-\u{1F600}'];
  const javascriptOrder = [...ids].sort();
  const databaseCOrder = [...ids].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  assert.notDeepStrictEqual(javascriptOrder, databaseCOrder, 'regression fixture must expose the cross-runtime ordering difference');

  const expectedInto = rpc.indexOf('into v_expected_transactions');
  assert.ok(expectedInto >= 0, 'expected snapshot must be canonicalized into its own variable');
  const canonicalizeStart = rpc.lastIndexOf('select coalesce(', expectedInto);
  const canonicalizeEnd = rpc.indexOf(';', expectedInto);
  const canonicalization = rpc.slice(canonicalizeStart, canonicalizeEnd);
  assert.match(canonicalization, /from jsonb_to_recordset\(p_expected_transactions\)/i);
  assert.match(canonicalization, /jsonb_build_object[\s\S]*'id'[\s\S]*'date'[\s\S]*'type'[\s\S]*'category'[\s\S]*'amount'[\s\S]*'memo'[\s\S]*'source'/i);
  assert.match(canonicalization, /order by transaction_row\.id collate "C"/i);
  assert.match(rpc, /v_current_transactions\s+is distinct from\s+v_expected_transactions/i);
  assert.doesNotMatch(rpc, /v_current_transactions\s+is distinct from\s+p_expected_transactions/i);
}

function testAppReplacesSamplesThroughWholeStateCas() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const start = source.indexOf('async function handleSampleClick');
  const end = source.indexOf('function handleExportClick', start);
  assert.ok(start >= 0 && end > start, 'sample handler source must be present');
  const handler = source.slice(start, end);

  assert.match(handler, /replaceAllRemoteFirst\(\s*preparedState/);
  assert.doesNotMatch(handler, /BudgetCloud\.replaceSampleTransactions/);

  const importStart = source.indexOf('function handleImportFile');
  const resetStart = source.indexOf('async function handleResetClick');
  const importHandler = source.slice(importStart, resetStart);
  const resetHandler = source.slice(resetStart, source.indexOf('function applyDownloadedState', resetStart));
  assert.match(importHandler, /replaceAllRemoteFirst\(result\.state/);
  assert.match(resetHandler, /replaceAllRemoteFirst\(result\.state/);
}

function testCloudDoesNotExposeUnsafeSampleReplacement() {
  const win = createContext();
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud.js'), 'utf8');

  assert.strictEqual(typeof win.BudgetCloud.replaceSampleTransactions, 'undefined');
  assert.doesNotMatch(source, /replaceSampleTransactions|replace_budget_samples/);
}

function testSupabaseSetupDropsUnsafeSampleRpcOverloads() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'supabase-setup.sql'), 'utf8');
  assert.match(source, /drop function if exists public\.replace_budget_samples\(date,\s*date,\s*jsonb\)/i);
  assert.match(source, /drop function if exists public\.replace_budget_samples\(date,\s*date,\s*jsonb,\s*jsonb\)/i);
  assert.doesNotMatch(source, /create or replace function public\.replace_budget_samples\s*\(/i);
  assert.doesNotMatch(source, /grant execute on function public\.replace_budget_samples/i);
}

function testPreviewSupabaseSetupCreatesIsolatedTablesRlsAndPermissions() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'supabase-preview-setup.sql'), 'utf8');

  assert.match(source, /create table if not exists public\.preview_budget_settings\s*\(/i);
  assert.match(source, /user_id uuid primary key references auth\.users\(id\) on delete cascade/i);
  assert.match(source, /monthly_budget integer not null default 500000 check \(monthly_budget > 0\)/i);
  assert.match(source, /category_budgets jsonb not null default '\{\}'::jsonb/i);
  assert.match(source, /updated_at timestamptz not null default now\(\)/i);
  assert.match(source, /create table if not exists public\.preview_transactions\s*\(/i);
  assert.match(source, /id text primary key/i);
  assert.match(source, /user_id uuid not null references auth\.users\(id\) on delete cascade/i);
  assert.match(source, /type text not null check \(type in \('income', 'expense'\)\)/i);
  assert.match(source, /amount integer not null check \(amount > 0\)/i);
  assert.match(source, /constraint preview_transactions_id_canonical\s+check \(id ~ '\^\[A-Za-z0-9\._:-\]\+\$'\)/i);

  assert.match(source, /create or replace function public\.set_preview_budget_settings_updated_at\(\)[\s\S]*security invoker/i);
  assert.match(source, /greatest\(\s*clock_timestamp\(\),\s*old\.updated_at \+ interval '1 microsecond'\s*\)/i);
  assert.match(source, /create trigger set_preview_budget_settings_updated_at[\s\S]*on public\.preview_budget_settings/i);
  assert.match(source, /revoke all on function public\.set_preview_budget_settings_updated_at\(\) from public/i);
  assert.match(source, /revoke all on function public\.set_preview_budget_settings_updated_at\(\) from anon/i);
  assert.match(source, /grant execute on function public\.set_preview_budget_settings_updated_at\(\) to authenticated/i);

  assert.match(source, /alter table public\.preview_budget_settings enable row level security/i);
  assert.match(source, /alter table public\.preview_transactions enable row level security/i);
  for (const operation of ['select', 'insert', 'update']) {
    assert.match(
      source,
      new RegExp(`create policy "Preview users can ${operation} own settings"[\\s\\S]*?for ${operation}[\\s\\S]*?auth\\.uid\\(\\) = user_id`, 'i')
    );
  }
  for (const operation of ['select', 'insert', 'update', 'delete']) {
    assert.match(
      source,
      new RegExp(`create policy "Preview users can ${operation} own transactions"[\\s\\S]*?for ${operation}[\\s\\S]*?auth\\.uid\\(\\) = user_id`, 'i')
    );
  }
  assert.match(source, /revoke all on table public\.preview_budget_settings from public/i);
  assert.match(source, /revoke all on table public\.preview_budget_settings from anon/i);
  assert.match(source, /revoke all on table public\.preview_transactions from public/i);
  assert.match(source, /revoke all on table public\.preview_transactions from anon/i);

  const settingsAuthenticatedRevoke = source.search(/revoke all on table public\.preview_budget_settings from authenticated/i);
  const transactionsAuthenticatedRevoke = source.search(/revoke all on table public\.preview_transactions from authenticated/i);
  const settingsGrant = source.search(/grant select, insert, update on table public\.preview_budget_settings to authenticated/i);
  const transactionsGrant = source.search(/grant select, insert, update, delete on table public\.preview_transactions to authenticated/i);
  assert.ok(settingsAuthenticatedRevoke >= 0 && settingsAuthenticatedRevoke < settingsGrant);
  assert.ok(transactionsAuthenticatedRevoke >= 0 && transactionsAuthenticatedRevoke < transactionsGrant);
  assert.deepStrictEqual(
    source.match(/grant [^;]+ on table public\.preview_budget_settings to authenticated;/gi),
    ['grant select, insert, update on table public.preview_budget_settings to authenticated;']
  );
  assert.deepStrictEqual(
    source.match(/grant [^;]+ on table public\.preview_transactions to authenticated;/gi),
    ['grant select, insert, update, delete on table public.preview_transactions to authenticated;']
  );
}

function testPreviewSupabaseSetupCopiesProductionOnceWithoutMutatingIt() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'supabase-preview-setup.sql'), 'utf8');
  const executable = source.replace(/--[^\r\n]*/g, '');

  assert.doesNotMatch(
    executable,
    /\b(?:insert\s+into|update|delete\s+from|alter\s+table|truncate(?:\s+table)?|drop\s+table)\s+public\.(?:budget_settings|transactions)\b/i,
    'production tables must only be read as snapshot sources'
  );
  assert.doesNotMatch(
    executable,
    /\b(?:create(?:\s+or\s+replace)?|drop)\s+function\s+public\.(?:set_budget_settings_updated_at|replace_budget_state|replace_budget_samples)\b/i,
    'production functions must not be changed'
  );
  assert.doesNotMatch(
    executable,
    /\b(?:create|drop)\s+policy[\s\S]*?\bon\s+public\.(?:budget_settings|transactions)\b/i,
    'production policies must not be changed'
  );
  assert.doesNotMatch(
    executable,
    /\b(?:create|drop)\s+trigger[\s\S]*?\bon\s+public\.(?:budget_settings|transactions)\b/i,
    'production triggers must not be changed'
  );
  assert.doesNotMatch(
    executable,
    /\b(?:grant|revoke)[^;]*\bon\s+(?:table|function)\s+public\.(?:budget_settings|transactions|replace_budget_state|replace_budget_samples)\b/i,
    'production privileges must not be changed'
  );

  assert.match(source, /-- Preflight 1: deterministic legacy ID mapping/i);
  assert.match(source, /'tx-migrated-' \|\| md5\(user_id::text \|\| ':' \|\| id\) as preview_id/i);
  assert.match(source, /-- Preflight 2: candidate ID collision audit; expected result is zero rows/i);
  assert.match(source, /group by preview_id[\s\S]*having count\(\*\) > 1/i);
  assert.match(source, /-- Preflight 3: existing preview row collision audit/i);
  assert.match(source, /join public\.preview_transactions as existing[\s\S]*existing\.id = candidate\.preview_id/i);

  const seedStart = source.indexOf('-- Atomic one-time production snapshot.');
  const seedEnd = source.indexOf('-- Atomically replace one authenticated user', seedStart);
  assert.ok(seedStart >= 0 && seedEnd > seedStart, 'atomic seed section must be present');
  const seed = source.slice(seedStart, seedEnd);
  assert.match(
    seed,
    /insert into public\.preview_budget_settings[\s\S]*select[\s\S]*from public\.budget_settings/i
  );
  assert.match(
    seed,
    /insert into public\.preview_transactions[\s\S]*case[\s\S]*when [^\r\n]*id ~ '\^\[A-Za-z0-9\._:-\]\+\$'[\s\S]*else 'tx-migrated-' \|\| md5\([^)]*user_id::text \|\| ':' \|\| [^)]*id\)[\s\S]*from public\.transactions/i
  );
  assert.doesNotMatch(seed, /^\s*on\s+conflict\b/im, 'seed collisions must never be hidden');
  assert.doesNotMatch(seed, /\b(?:update|delete\s+from|truncate)\s+public\.(?:budget_settings|transactions)\b/i);
}

function testPreviewSeedIsGuardedAtomicAndSkippedForeverAfterMarker() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'supabase-preview-setup.sql'), 'utf8');
  assert.match(source, /create table if not exists public\.preview_seed_metadata\s*\(/i);
  assert.match(source, /seed_key text primary key/i);
  assert.match(source, /completed_at timestamptz not null/i);
  assert.match(source, /source_settings_count bigint not null/i);
  assert.match(source, /source_transactions_count bigint not null/i);
  assert.match(source, /alter table public\.preview_seed_metadata enable row level security/i);
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(source, new RegExp(`revoke all on table public\\.preview_seed_metadata from ${role}`, 'i'));
  }
  assert.doesNotMatch(source, /grant [^;]+ on table public\.preview_seed_metadata/i);

  const seedStart = source.indexOf('-- Atomic one-time production snapshot.');
  const seedEnd = source.indexOf('-- Atomically replace one authenticated user', seedStart);
  assert.ok(seedStart >= 0 && seedEnd > seedStart);
  const seed = source.slice(seedStart, seedEnd).toLowerCase();
  const begin = seed.indexOf('begin isolation level repeatable read');
  const metadataLock = seed.indexOf('lock table public.preview_seed_metadata in share row exclusive mode');
  const markerCheck = seed.indexOf("seed_key = 'production_snapshot_v1'");
  const skipReturn = seed.indexOf('return;', markerCheck);
  const productionSettingsLock = seed.indexOf('lock table public.budget_settings in share mode');
  const productionTransactionsLock = seed.indexOf('lock table public.transactions in share mode');
  const previewSettingsLock = seed.indexOf('lock table public.preview_budget_settings in share row exclusive mode');
  const previewTransactionsLock = seed.indexOf('lock table public.preview_transactions in share row exclusive mode');
  const candidateGuard = seed.indexOf("raise exception 'preview seed candidate id collision'");
  const settingsConflictGuard = seed.indexOf("raise exception 'existing preview settings conflict'");
  const transactionsConflictGuard = seed.indexOf("raise exception 'existing preview transaction conflict'");
  const settingsInsert = seed.indexOf('insert into public.preview_budget_settings');
  const transactionsInsert = seed.indexOf('insert into public.preview_transactions');
  const settingsCompare = seed.indexOf("raise exception 'preview settings canonical comparison failed'");
  const transactionsCompare = seed.indexOf("raise exception 'preview transactions canonical comparison failed'");
  const markerInsert = seed.indexOf('insert into public.preview_seed_metadata');
  const commit = seed.lastIndexOf('commit;');

  assert.ok(begin >= 0 && begin < metadataLock);
  assert.ok(metadataLock < markerCheck && markerCheck < skipReturn);
  assert.ok(skipReturn < productionSettingsLock, 'completed marker must skip all source and preview data work');
  assert.ok(productionSettingsLock < productionTransactionsLock);
  assert.ok(productionTransactionsLock < previewSettingsLock);
  assert.ok(previewSettingsLock < previewTransactionsLock);
  assert.ok(previewTransactionsLock < candidateGuard);
  assert.ok(candidateGuard < settingsConflictGuard && settingsConflictGuard < transactionsConflictGuard);
  assert.ok(transactionsConflictGuard < settingsInsert, 'all collision guards must run before the first seed mutation');
  assert.ok(settingsInsert < transactionsInsert);
  assert.ok(transactionsInsert < settingsCompare && settingsCompare < transactionsCompare);
  assert.ok(transactionsCompare < markerInsert && markerInsert < commit);
  assert.match(seed, /having count\(\*\) > 1[\s\S]*raise exception 'preview seed candidate id collision'/i);
  assert.ok((seed.match(/\bexcept\b/g) || []).length >= 6, 'existing conflicts and two-way canonical comparisons must use EXCEPT');
  assert.match(seed, /insert into public\.preview_budget_settings[\s\S]*where not exists/i);
  assert.match(seed, /insert into public\.preview_transactions[\s\S]*where not exists/i);
  assert.doesNotMatch(seed, /^\s*on\s+conflict\b/im);
  assert.doesNotMatch(seed, /delete from public\.preview_|update public\.preview_|truncate/i);
  assert.match(source, /production changes and preview edits, deletions, or additions remain byte-for-byte unchanged on rerun/i);
  assert.match(source, /explicit reseed requires a separate reviewed procedure/i);
}

function testPreviewSeedRunbookRequiresShortWriteFreeGateAndCanonicalComparison() {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const readme = read('docs/README.md');
  const plan = read('docs/TEST_PLAN.md');
  const log = read('docs/IMPROVEMENT_LOG.md');
  const checklist = read('manual-test-checklist.md');

  for (const [name, source] of [['README', readme], ['TEST_PLAN', plan], ['IMPROVEMENT_LOG', log], ['checklist', checklist]]) {
    assert.match(source, /짧은 운영 쓰기 중단 창/, `${name} must name the first-seed gate`);
  }
  assert.match(plan, /모든 운영 탭[\s\S]*운영 쓰기[\s\S]*중단/i);
  assert.match(plan, /REPEATABLE READ/);
  assert.match(plan, /production_snapshot_v1/);
  assert.match(plan, /canonical settings[\s\S]*canonical transactions/i);
  assert.match(plan, /양방향 EXCEPT/i);
  assert.match(plan, /비교 완료[\s\S]*운영 쓰기 재개/i);
  assert.match(checklist, /seed와 canonical 전체 비교가 끝난 뒤 운영 쓰기를 재개/i);
  assert.match(readme, /명시적 reseed[\s\S]*별도 검토 절차/i);
}

function testPreviewSupabaseSetupDefinesFullFiveArgumentCasAndDropsOverloads() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'supabase-preview-setup.sql'), 'utf8');
  const start = source.search(/create or replace function public\.replace_preview_budget_state\s*\(/i);
  const permissionStart = source.search(/revoke all on function public\.replace_preview_budget_state/i);
  assert.ok(start >= 0 && permissionStart > start, 'preview whole-state RPC must be defined before permissions');
  const rpc = source.slice(start, permissionStart);

  assert.match(source, /drop function if exists public\.replace_preview_budget_state\(integer,\s*jsonb,\s*jsonb\)/i);
  assert.match(
    source,
    /create or replace function public\.replace_preview_budget_state\(\s*p_monthly_budget integer,\s*p_category_budgets jsonb,\s*p_transactions jsonb,\s*p_expected_updated_at timestamptz,\s*p_expected_transactions jsonb\s*\)/i
  );
  assert.match(rpc, /returns table \(uploaded_count integer, updated_at timestamptz\)/i);
  assert.match(rpc, /security invoker/i);
  assert.match(rpc, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(rpc, /p_monthly_budget is null or p_monthly_budget <= 0/i);
  assert.match(rpc, /jsonb_typeof\(p_category_budgets\) <> 'object'/i);
  assert.match(rpc, /jsonb_typeof\(p_transactions\) <> 'array'/i);
  assert.match(rpc, /jsonb_typeof\(p_expected_transactions\) <> 'array'/i);
  assert.match(rpc, /between 1 and 2147483647/i);
  assert.match(rpc, /__month_start_day[\s\S]*between 1 and 31/i);
  assert.match(rpc, /__monthly_budgets[\s\S]*<> 'object'/i);
  assert.match(rpc, /p_transactions \|\| p_expected_transactions/i);
  assert.match(rpc, /\(transaction_row ->> 'id'\) !~ '\^\[A-Za-z0-9\._:-\]\+\$'/i);
  assert.match(rpc, /to_char\(to_date\(transaction_row ->> 'date', 'YYYY-MM-DD'\), 'YYYY-MM-DD'\)/i);
  assert.match(rpc, /coalesce\(transaction_row ->> 'type', ''\) not in \('income', 'expense'\)/i);
  assert.match(rpc, /nullif\(btrim\(transaction_row ->> 'category'\), ''\) is null/i);
  assert.match(rpc, /coalesce\(transaction_row ->> 'source', 'user'\) not in \('user', 'sample'\)/i);
  assert.match(rpc, /char_length\(coalesce\(transaction_row ->> 'memo', ''\)\) > 80/i);
  assert.match(rpc, /duplicate transaction ids are not allowed/i);
  assert.match(rpc, /duplicate expected transaction ids are not allowed/i);
  assert.match(rpc, /order by transaction_row\.id collate "C"[\s\S]*from jsonb_to_recordset\(p_expected_transactions\)/i);

  const settingsLock = rpc.search(/from public\.preview_budget_settings as settings[\s\S]*?for update/i);
  const settingsCheck = rpc.indexOf('v_current_updated_at is distinct from p_expected_updated_at');
  const transactionsLock = rpc.indexOf('lock table public.preview_transactions in share row exclusive mode');
  const transactionSnapshot = rpc.indexOf('into v_current_transactions');
  const transactionCheck = rpc.indexOf('v_current_transactions is distinct from v_expected_transactions');
  const firstWrite = Math.min(...[
    rpc.indexOf('update public.preview_budget_settings'),
    rpc.indexOf('insert into public.preview_budget_settings'),
    rpc.indexOf('delete from public.preview_transactions')
  ].filter((index) => index >= 0));
  assert.ok(settingsLock >= 0 && settingsLock < settingsCheck, 'settings row must be locked before settings CAS');
  assert.ok(settingsCheck < transactionsLock, 'settings CAS must precede the transaction table lock');
  assert.ok(transactionsLock < transactionSnapshot, 'transaction lock must precede snapshot read');
  assert.ok(transactionSnapshot < transactionCheck && transactionCheck < firstWrite, 'full snapshot CAS must precede writes');
  assert.match(rpc, /from public\.preview_transactions as transaction_row[\s\S]*where transaction_row\.user_id = v_user_id/i);
  assert.match(rpc, /update public\.preview_budget_settings[\s\S]*settings\.updated_at = p_expected_updated_at[\s\S]*returning settings\.updated_at into v_new_updated_at/i);
  assert.match(rpc, /insert into public\.preview_budget_settings[\s\S]*on conflict \(user_id\) do nothing[\s\S]*returning settings\.updated_at into v_new_updated_at/i);
  assert.match(rpc, /delete from public\.preview_transactions\s+where user_id = v_user_id/i);
  assert.match(rpc, /insert into public\.preview_transactions[\s\S]*from jsonb_to_recordset\(p_transactions\)/i);
  assert.match(rpc, /errcode = '40001'/i);
  assert.match(rpc, /return query select jsonb_array_length\(p_transactions\)::integer, v_new_updated_at/i);
  assert.doesNotMatch(rpc, /public\.(?:budget_settings|transactions)\b/i, 'preview RPC must never access production tables');

  assert.match(source, /revoke all on function public\.replace_preview_budget_state\(integer, jsonb, jsonb, timestamptz, jsonb\) from public/i);
  assert.match(source, /revoke all on function public\.replace_preview_budget_state\(integer, jsonb, jsonb, timestamptz, jsonb\) from anon/i);
  assert.match(source, /grant execute on function public\.replace_preview_budget_state\(integer, jsonb, jsonb, timestamptz, jsonb\) to authenticated/i);
  assert.match(source, /drop function if exists public\.replace_preview_budget_samples\(date, date, jsonb\)/i);
  assert.match(source, /drop function if exists public\.replace_preview_budget_samples\(date, date, jsonb, jsonb\)/i);
  assert.doesNotMatch(source, /create or replace function public\.replace_preview_budget_samples/i);
  assert.doesNotMatch(source, /grant execute on function public\.replace_preview_budget_samples/i);
}

function testUiCloudStatusShowsLoadingRetryAndSignedOutStates() {
  const { window, document } = createUiContext();
  window.BudgetCloud = { isConfigured: () => true };
  const elements = {
    cloudStatus: document.createElement('p'),
    cloudPanel: document.createElement('section'),
    cloudLoginForm: document.createElement('form'),
    cloudUploadButton: document.createElement('button'),
    cloudDownloadButton: document.createElement('button'),
    cloudLogoutButton: document.createElement('button'),
    cloudMessage: document.createElement('p')
  };
  const user = { id: 'user-1' };

  window.BudgetUI.updateCloudStatus(elements, user, 'loading');
  assert.strictEqual(elements.cloudPanel.hidden, false);
  assert.strictEqual(elements.cloudLoginForm.hidden, true);
  assert.strictEqual(elements.cloudDownloadButton.hidden, true);
  assert.strictEqual(elements.cloudLogoutButton.hidden, false);

  elements.cloudMessage.textContent = '불러오기 오류를 유지해야 해요.';
  window.BudgetUI.updateCloudStatus(elements, user, 'load-error');
  assert.strictEqual(elements.cloudPanel.hidden, false);
  assert.strictEqual(elements.cloudLoginForm.hidden, true);
  assert.strictEqual(elements.cloudDownloadButton.hidden, false);
  assert.strictEqual(elements.cloudLogoutButton.hidden, false);
  assert.strictEqual(elements.cloudMessage.textContent, '불러오기 오류를 유지해야 해요.');

  window.BudgetUI.updateCloudStatus(elements, user, 'ready');
  assert.strictEqual(elements.cloudPanel.hidden, true);

  window.BudgetUI.updateCloudStatus(elements, null, 'signed-out');
  assert.strictEqual(elements.cloudPanel.hidden, false);
  assert.strictEqual(elements.cloudLoginForm.hidden, false);
  assert.strictEqual(elements.cloudLogoutButton.hidden, true);
}

async function testAppReadinessBlocksWritesAfterLoadErrorAndEnablesAfterSuccess() {
  const failed = createAppHarness({
    cloud: { downloadState: async () => { throw new Error('offline'); } }
  });
  await failed.init();
  assert.strictEqual(failed.records.cloudStatuses.at(-1).readiness, 'load-error');
  assert.strictEqual(failed.writeControls.every((control) => control.disabled), true);
  assert.match(failed.elements.cloudMessage.textContent, /클라우드 데이터를 불러오지 못했어요|클라우드 불러오기 실패/);

  failed.elements.budgetInput.valueAsNumber = 700000;
  await failed.elements.budgetForm.dispatch('submit', { submitter: failed.elements.budgetSave });
  assert.strictEqual(failed.cloudCalls.saveSettings.length, 0);
  await failed.elements.cloudUploadButton.dispatch('click');
  assert.strictEqual(failed.cloudCalls.uploadState.length, 0);
  assert.match(failed.elements.globalMessage.textContent, /불러온 뒤|다시 불러온 뒤/);

  const loaded = createAppHarness();
  await loaded.init();
  assert.strictEqual(loaded.records.cloudStatuses.at(-1).readiness, 'ready');
  assert.strictEqual(loaded.writeControls.every((control) => !control.disabled), true);
  await loaded.elements.cloudUploadButton.dispatch('click');
  assert.strictEqual(
    JSON.stringify(loaded.cloudCalls.uploadState[0][0]),
    JSON.stringify(loaded.cloudCalls.uploadState[0][1])
  );
}

async function testAppShowsIsolatedCopyBannerOnlyInPreviewEnvironment() {
  const preview = createAppHarness({ isPreview: true });
  await preview.init();
  assert.strictEqual(preview.elements.previewDataWarning.hidden, false);
  assert.strictEqual(preview.document.body.classList.contains('has-preview-warning'), true);

  const production = createAppHarness({ isPreview: false });
  await production.init();
  assert.strictEqual(production.elements.previewDataWarning.hidden, true);
  assert.strictEqual(production.document.body.classList.contains('has-preview-warning'), false);
}

async function testAppDisablesWritesDuringInitialSessionLookup() {
  const gate = createDeferred();
  const harness = createAppHarness({
    cloud: { currentUser: () => gate.promise }
  });
  const initializing = harness.init();
  await Promise.resolve();

  assert.strictEqual(harness.records.cloudStatuses.at(-1).readiness, 'loading');
  assert.strictEqual(harness.writeControls.every((control) => control.disabled), true);

  gate.resolve({ id: 'user-1' });
  await initializing;
  assert.strictEqual(harness.records.cloudStatuses.at(-1).readiness, 'ready');
  assert.strictEqual(harness.writeControls.every((control) => !control.disabled), true);
}

async function testAppSerializesMutationsAndRemoteFailureUnlocksWithoutCommit() {
  const gate = createDeferred();
  const overlapping = createAppHarness({
    cloud: { saveSettings: () => gate.promise }
  });
  await overlapping.init();
  overlapping.elements.budgetInput.valueAsNumber = 700000;
  const first = overlapping.elements.budgetForm.dispatch('submit', { submitter: overlapping.elements.budgetSave });
  await Promise.resolve();
  await overlapping.elements.cloudUploadButton.dispatch('click');
  await overlapping.elements.cloudDownloadButton.dispatch('click');
  await overlapping.elements.cloudLogoutButton.dispatch('click');
  assert.strictEqual(overlapping.cloudCalls.uploadState.length, 0);
  assert.strictEqual(overlapping.cloudCalls.downloadState.length, 1);
  assert.strictEqual(overlapping.cloudCalls.signOut.length, 0);
  overlapping.elements.budgetInput.valueAsNumber = 800000;
  const second = overlapping.elements.budgetForm.dispatch('submit', { submitter: overlapping.elements.budgetSave });
  await second;

  assert.strictEqual(overlapping.cloudCalls.saveSettings.length, 1);
  assert.match(overlapping.elements.globalMessage.textContent, /저장 작업이 진행 중/);
  gate.resolve({ ok: true });
  await first;
  await overlapping.elements.exportButton.dispatch('click');
  const firstOwnedState = JSON.parse(overlapping.records.downloads.at(-1).content);
  assert.strictEqual(
    overlapping.window.BudgetStorage.budgetForMonth(firstOwnedState, overlapping.elements.monthInput.value).monthlyBudget,
    700000
  );

  const failed = createAppHarness({
    cloudState: { ...createContext().BudgetStorage.defaultState(), monthlyBudget: 600000 },
    cloud: { saveSettings: async () => { throw new Error('write failed'); } }
  });
  await failed.init();
  failed.elements.budgetInput.valueAsNumber = 900000;
  await failed.elements.budgetForm.dispatch('submit', { submitter: failed.elements.budgetSave });
  assert.strictEqual(failed.cloudCalls.saveSettings.length, 1);
  assert.strictEqual(failed.writeControls.every((control) => !control.disabled), true);
  assert.match(failed.elements.budgetMessage.textContent, /Supabase 저장 실패: write failed/);
  await failed.elements.exportButton.dispatch('click');
  const unchangedState = JSON.parse(failed.records.downloads.at(-1).content);
  assert.strictEqual(
    failed.window.BudgetStorage.budgetForMonth(unchangedState, failed.elements.monthInput.value).monthlyBudget,
    600000
  );
}

async function testAppRoutesDeleteAndMovedEditFeedbackToGlobalMessage() {
  const transaction = {
    id: 'tx-a', date: '2026-05-02', type: 'expense', category: '생활비', amount: 1000, memo: '', source: 'user'
  };
  const deleted = createAppHarness({
    cloudState: { ...createContext().BudgetStorage.defaultState(), transactions: [transaction] }
  });
  await deleted.init();
  const deleteButton = deleted.createElement('button');
  deleteButton.dataset.action = 'delete';
  deleteButton.dataset.id = 'tx-a';
  deleteButton.setAttribute('data-cloud-write', '');
  deleteButton.closest = () => deleteButton;
  await deleted.elements.list.dispatch('click', { target: deleteButton });
  assert.strictEqual(deleted.elements.globalMessage.textContent, '거래를 삭제했어요.');
  assert.strictEqual(deleted.elements.toolMessage.textContent, '');
  assert.strictEqual(JSON.stringify(deleted.cloudCalls.deleteTransaction[0][1]), JSON.stringify(transaction));

  const deleteFailed = createAppHarness({
    cloudState: { ...createContext().BudgetStorage.defaultState(), transactions: [transaction] },
    cloud: { deleteTransaction: async () => { throw new Error('delete failed'); } }
  });
  await deleteFailed.init();
  const failingButton = deleteFailed.createElement('button');
  failingButton.dataset.action = 'delete';
  failingButton.dataset.id = 'tx-a';
  failingButton.setAttribute('data-cloud-write', '');
  failingButton.closest = () => failingButton;
  await deleteFailed.elements.list.dispatch('click', { target: failingButton });
  assert.match(deleteFailed.elements.globalMessage.textContent, /Supabase 저장 실패: delete failed/);
  assert.strictEqual(deleteFailed.elements.toolMessage.textContent, '');

  const edited = createAppHarness({
    cloudState: { ...createContext().BudgetStorage.defaultState(), transactions: [transaction] }
  });
  await edited.init();
  edited.elements.editId.value = 'tx-a';
  edited.elements.editDate.value = '1900-01-01';
  edited.elements.editType.value = 'expense';
  edited.elements.editCategory.value = '생활비';
  edited.elements.editAmount.value = '2000';
  edited.elements.editMemo.value = '';
  await edited.elements.editForm.dispatch('submit', { submitter: edited.elements.editSave });
  assert.strictEqual(
    edited.elements.globalMessage.textContent,
    '수정했어요. 날짜가 바뀌어 현재 월 목록에서는 보이지 않아요.'
  );
  assert.strictEqual(edited.elements.toolMessage.textContent, '');
}

async function testAppTransactionConflictPassesExpectedRowAndKeepsLocalState() {
  const transaction = {
    id: 'tx-cas', date: '2026-05-02', type: 'expense', category: '생활비',
    amount: 12000, memo: '마트', source: 'user'
  };
  const conflict = Object.assign(
    new Error('거래가 이미 변경되었거나 삭제되었어요. 새로고침 후 다시 시도해 주세요.'),
    { code: '40001' }
  );
  const harness = createAppHarness({
    cloudState: { ...createContext().BudgetStorage.defaultState(), transactions: [transaction] },
    cloud: { updateTransaction: async () => { throw conflict; } }
  });
  await harness.init();
  harness.elements.editId.value = transaction.id;
  harness.elements.editDate.value = transaction.date;
  harness.elements.editType.value = transaction.type;
  harness.elements.editCategory.value = '배달비';
  harness.elements.editAmount.value = '15000';
  harness.elements.editMemo.value = '배달';

  await harness.elements.editForm.dispatch('submit', { submitter: harness.elements.editSave });
  await harness.elements.exportButton.dispatch('click');
  const exported = JSON.parse(harness.records.downloads.at(-1).content);

  assert.strictEqual(JSON.stringify(harness.cloudCalls.updateTransaction[0][1]), JSON.stringify(transaction));
  assert.strictEqual(exported.transactions[0].amount, 12000);
  assert.strictEqual(exported.transactions[0].memo, '마트');
  assert.match(harness.elements.globalMessage.textContent, /거래가 이미 변경되었거나 삭제되었어요/);
  assert.strictEqual(harness.records.cloudStatuses.at(-1).readiness, 'load-error');
  assert.strictEqual(harness.writeControls.every((control) => control.disabled), true);
  assert.strictEqual(harness.elements.cloudDownloadButton.hidden, false);
}

async function testAppSampleUsesWholeStateCasAndRollsBackOnConflict() {
  const storage = createContext().BudgetStorage;
  const sampleDate = storage.localDateString();
  const selectedMonth = storage.monthKeyForDate(sampleDate, 1);
  const priorMonth = storage.addMonthsToMonth(selectedMonth, -1);
  const currentSample = {
    id: 'sample-current', date: sampleDate, type: 'expense', category: '생활비',
    amount: 12000, memo: '기존 샘플', source: 'sample'
  };
  const priorSample = {
    id: 'sample-prior', date: `${priorMonth}-01`, type: 'expense', category: '생활비',
    amount: 9000, memo: '이전 달 샘플', source: 'sample'
  };
  const conflict = Object.assign(
    new Error('다른 브라우저에서 샘플 데이터가 변경됐어요. 클라우드 데이터를 다시 불러와 주세요.'),
    { code: '40001' }
  );
  const currentState = storage.normalizeState({
    ...storage.defaultState(),
    transactions: [priorSample, currentSample]
  });
  const harness = createAppHarness({
    cloudState: currentState,
    cloud: { uploadState: async () => { throw conflict; } }
  });
  await harness.init();

  await harness.elements.sampleButton.dispatch('click');
  await harness.elements.exportButton.dispatch('click');
  const exported = JSON.parse(harness.records.downloads.at(-1).content);
  assert.strictEqual(harness.cloudCalls.uploadState.length, 1);
  const [preparedState, expectedState] = harness.cloudCalls.uploadState[0];
  const preparedSelectedSamples = preparedState.transactions.filter((transaction) => (
    transaction.source === 'sample'
    && storage.isDateInBudgetMonth(transaction.date, selectedMonth, 1)
  ));
  assert.strictEqual(JSON.stringify(expectedState), JSON.stringify(currentState));
  assert.strictEqual(preparedSelectedSamples.length, 6);
  assert.strictEqual(preparedState.transactions.some((transaction) => transaction.id === priorSample.id), true);
  assert.strictEqual(preparedState.transactions.some((transaction) => transaction.id === currentSample.id), false);
  assert.strictEqual(JSON.stringify(exported), JSON.stringify(currentState));
  assert.match(harness.elements.globalMessage.textContent, /다른 브라우저에서 샘플 데이터가 변경됐어요/);
  assert.strictEqual(harness.records.cloudStatuses.at(-1).readiness, 'load-error');
  assert.strictEqual(harness.writeControls.every((control) => control.disabled), true);
  assert.strictEqual(harness.elements.cloudDownloadButton.hidden, false);
}

async function testAppWholeStateConflictPassesExpectedStateAndKeepsLocalState() {
  const currentState = {
    ...createContext().BudgetStorage.defaultState(),
    monthlyBudget: 900000,
    transactions: [
      { id: 'tx-current', date: '2026-05-02', type: 'expense', category: '생활비', amount: 45000, memo: '현재', source: 'user' }
    ]
  };
  const conflict = Object.assign(
    new Error('다른 브라우저에서 가계부 데이터가 변경됐어요. 클라우드 데이터를 다시 불러와 주세요.'),
    { code: '40001' }
  );
  const harness = createAppHarness({
    cloudState: currentState,
    cloud: { uploadState: async () => { throw conflict; } }
  });
  await harness.init();

  await harness.elements.resetButton.dispatch('click');
  assert.match(harness.elements.toolMessage.textContent, /다른 브라우저에서 가계부 데이터가 변경됐어요/);
  assert.match(harness.elements.globalMessage.textContent, /다른 브라우저에서 가계부 데이터가 변경됐어요/);
  await harness.elements.exportButton.dispatch('click');
  const exported = JSON.parse(harness.records.downloads.at(-1).content);

  assert.strictEqual(JSON.stringify(harness.cloudCalls.uploadState[0][1]), JSON.stringify(currentState));
  assert.strictEqual(exported.monthlyBudget, 900000);
  assert.strictEqual(exported.transactions[0].id, 'tx-current');
  assert.strictEqual(harness.records.cloudStatuses.at(-1).readiness, 'load-error');
  assert.strictEqual(harness.writeControls.every((control) => control.disabled), true);
  assert.strictEqual(harness.elements.cloudDownloadButton.hidden, false);
}

async function testAppSettingsConflictRetriesOnlyAfterCloudRefresh() {
  const initialState = { ...createContext().BudgetStorage.defaultState(), monthlyBudget: 600000 };
  const refreshedState = { ...createContext().BudgetStorage.defaultState(), monthlyBudget: 650000 };
  const conflict = Object.assign(
    new Error('다른 브라우저에서 예산 설정이 변경됐어요. 클라우드 데이터를 다시 불러와 주세요.'),
    { code: '40001' }
  );
  let downloadCount = 0;
  const harness = createAppHarness({
    cloud: {
      downloadState: async () => {
        downloadCount += 1;
        return downloadCount === 1 ? initialState : refreshedState;
      },
      saveSettings: async () => {
        if (downloadCount < 2) throw conflict;
        return { ok: true };
      }
    }
  });
  await harness.init();

  harness.elements.budgetInput.valueAsNumber = 700000;
  await harness.elements.budgetForm.dispatch('submit', { submitter: harness.elements.budgetSave });
  assert.match(harness.elements.budgetMessage.textContent, /다른 브라우저에서 예산 설정이 변경됐어요/);
  assert.match(harness.elements.globalMessage.textContent, /다른 브라우저에서 예산 설정이 변경됐어요/);
  assert.strictEqual(harness.records.cloudStatuses.at(-1).readiness, 'load-error');
  assert.strictEqual(harness.writeControls.every((control) => control.disabled), true);
  assert.strictEqual(harness.elements.cloudDownloadButton.hidden, false);
  harness.elements.budgetInput.valueAsNumber = 700000;
  await harness.elements.budgetForm.dispatch('submit', { submitter: harness.elements.budgetSave });
  assert.strictEqual(harness.cloudCalls.saveSettings.length, 1);

  await harness.elements.cloudDownloadButton.dispatch('click');
  assert.strictEqual(harness.records.cloudStatuses.at(-1).readiness, 'ready');
  assert.strictEqual(harness.writeControls.every((control) => !control.disabled), true);
  assert.strictEqual(harness.elements.globalMessage.textContent, '');
  assert.strictEqual(harness.elements.budgetMessage.textContent, '');
  harness.elements.budgetInput.valueAsNumber = 700000;
  await harness.elements.budgetForm.dispatch('submit', { submitter: harness.elements.budgetSave });
  await harness.elements.exportButton.dispatch('click');
  const exported = JSON.parse(harness.records.downloads.at(-1).content);
  const selectedBudget = harness.window.BudgetStorage.budgetForMonth(exported, harness.elements.monthInput.value);

  assert.strictEqual(harness.cloudCalls.downloadState.length, 2);
  assert.strictEqual(harness.cloudCalls.saveSettings.length, 2);
  assert.strictEqual(selectedBudget.monthlyBudget, 700000);
  assert.strictEqual(harness.records.cloudStatuses.at(-1).readiness, 'ready');
  assert.strictEqual(harness.writeControls.every((control) => !control.disabled), true);
}

async function testAppLogoutClearsPrivateStateAndFocusesLogin() {
  const base = createContext().BudgetStorage.defaultState();
  const harness = createAppHarness({
    cloudState: {
      ...base,
      monthlyBudget: 900000,
      transactions: [
        { id: 'private', date: '2026-05-02', type: 'expense', category: '생활비', amount: 45000, memo: '비공개', source: 'user' }
      ]
    }
  });
  await harness.init();
  harness.elements.filterType.value = 'expense';
  harness.elements.filterCategory.value = '생활비';
  harness.elements.filterQuery.value = '비공개';

  await harness.elements.cloudLogoutButton.dispatch('click');
  await harness.elements.exportButton.dispatch('click');
  const exported = JSON.parse(harness.records.downloads.at(-1).content);

  assert.strictEqual(harness.cloudCalls.signOut.length, 1);
  assert.strictEqual(exported.monthlyBudget, harness.window.BudgetStorage.DEFAULT_BUDGET);
  assert.strictEqual(exported.transactions.length, 0);
  assert.strictEqual(harness.records.renderedLists.at(-1).length, 0);
  assert.strictEqual(harness.records.cloudStatuses.at(-1).readiness, 'signed-out');
  assert.strictEqual(harness.records.activeTabs.at(-1), 'home');
  assert.strictEqual(harness.elements.filterType.value, 'all');
  assert.strictEqual(harness.elements.filterCategory.value, 'all');
  assert.strictEqual(harness.elements.filterQuery.value, '');
  assert.strictEqual(harness.writeControls.every((control) => control.disabled), true);
  assert.strictEqual(harness.elements.cloudPanel.hidden, false);
  assert.strictEqual(harness.elements.cloudLoginForm.hidden, false);
  assert.ok(harness.elements.cloudPassword.focusCount > 0);
}

const tests = [
  testStorageDefaultsAndIgnoresLocalStorage,
  testSaveDoesNotUseLocalStorage,
  testStrictDateValidation,
  testLocalDateFormatting,
  testNormalizationDropsInvalidRowsAndDeduplicatesIds,
  testTransactionIdsUseSafeOpaqueAsciiContract,
  testDatabaseIntegerBoundsAreEnforced,
  testCategoryBudgetSaveAndSummary,
  testBudgetMonthStartAndMonthlyBudgets,
  testMonthKeyUsesClampedFebruaryStartBoundary,
  testAddTransactionCanonicalizesBeginnerMoneyInput,
  testSummaryInsightsAndSearchFilter,
  testSummaryAndSampleReplace,
  testSampleReplaceHonorsCustomBudgetMonthStart,
  testImportExport,
  testLegacyExpenseCategoriesMapToFourBudgets,
  testCloudStateMappingKeepsBudgetAndTransactions,
  testCloudUsesSharedLoginEmail,
  testCloudRoutesEveryOperationByRuntimeEnvironment,
  testCategoryBudgetDetailShowsSpentBeforeBudget,
  testUiExportsTabEditAndCalendarRenderers,
  testUiTabsAndFilterOptionsBehave,
  testUiValidationAndEditDialogFocusFlow,
  testUiCalendarRenderingPreservesFocusAndExplainsEmptyDates,
  testUiTransactionActionLabelsIncludeType,
  testAppMarkupProvidesTabsCalendarEditDialogAndPreviewWarning,
  testAppStylesCoverTabsCalendarDialogAndMobile,
  testCategoryFilterCombinesWithMonthTypeAndQuery,
  testUpdateTransactionValidatesAndPreservesIdentity,
  testCalendarDaysCoverBudgetPeriodByWholeWeeks,
  testSummarizeTransactionsByDateHonorsBudgetPeriod,
  testAppIntegratesTabsCalendarAndRemoteFirstMutations,
  testCloudRejectsInvalidOrStaleTransactionMutations,
  testCloudTransactionMutationsFilterExpectedPriorRow,
  testCloudMutatesOnlyRequestedTransactionRow,
  testCloudSettingsUpdateUsesDownloadedVersion,
  testCloudSettingsConflictKeepsExpectedVersionAndInput,
  testCloudSettingsInsertDuplicateUsesFriendlyConflict,
  testCloudSettingsVersionChangesOnlyAfterCompleteDownloadAndClearsOnLogout,
  testCloudReplacesWholeStateWithOneRpc,
  testCloudWholeStateReplacementUsesExpectedSnapshotAndAdvancesVersion,
  testCloudWholeStateRpcErrorsBeforeAnyDirectWrite,
  testSupabaseSetupDefinesTransactionalWholeStateRpc,
  testSupabaseSettingsVersionIsDatabaseOwnedAndMonotonic,
  testSupabaseEnforcesSafeOpaqueTransactionIdsBeforeRpcUse,
  testSupabaseWholeStateRpcRejectsUnsafeOpaqueTransactionIds,
  testSupabaseWholeStateRpcLocksTransactionsBeforeSnapshotAndReplacement,
  testSupabaseWholeStateRpcCanonicalizesExpectedTransactionsWithDatabaseOrdering,
  testAppSampleUsesWholeStateCasAndRollsBackOnConflict,
  testAppReplacesSamplesThroughWholeStateCas,
  testCloudDoesNotExposeUnsafeSampleReplacement,
  testSupabaseSetupDropsUnsafeSampleRpcOverloads,
  testPreviewSupabaseSetupCreatesIsolatedTablesRlsAndPermissions,
  testPreviewSupabaseSetupCopiesProductionOnceWithoutMutatingIt,
  testPreviewSeedIsGuardedAtomicAndSkippedForeverAfterMarker,
  testPreviewSeedRunbookRequiresShortWriteFreeGateAndCanonicalComparison,
  testPreviewSupabaseSetupDefinesFullFiveArgumentCasAndDropsOverloads,
  testUiCloudStatusShowsLoadingRetryAndSignedOutStates,
  testAppShowsIsolatedCopyBannerOnlyInPreviewEnvironment,
  testAppDisablesWritesDuringInitialSessionLookup,
  testAppReadinessBlocksWritesAfterLoadErrorAndEnablesAfterSuccess,
  testAppSerializesMutationsAndRemoteFailureUnlocksWithoutCommit,
  testAppRoutesDeleteAndMovedEditFeedbackToGlobalMessage,
  testAppTransactionConflictPassesExpectedRowAndKeepsLocalState,
  testAppWholeStateConflictPassesExpectedStateAndKeepsLocalState,
  testAppSettingsConflictRetriesOnlyAfterCloudRefresh,
  testAppLogoutClearsPrivateStateAndFocusesLogin
];

async function run() {
  for (const test of tests) {
    await test();
    console.log('PASS', test.name);
  }
  console.log(`${tests.length} tests passed`);
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
