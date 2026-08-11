/* beginner-budget-app cloud.js */
(function (window) {
  'use strict';

  const SUPABASE_URL = 'https://htarkoatahivxgzbogmx.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_bx0mPHkBtNdbYF8GUn_4Fg_TLKDEY1j';
  const LOGIN_EMAIL = 'ho910728@naver.com';
  const runtimeLocation = window.location || {};
  const runtimeHostname = String(runtimeLocation.hostname || '').toLowerCase();
  const runtimePathname = String(runtimeLocation.pathname || '/');
  const IS_PRODUCTION = runtimeHostname === 'suho-j.github.io'
    && runtimePathname === '/beginner-budget/';
  const IS_PREVIEW = !IS_PRODUCTION;
  const SETTINGS_TABLE = IS_PREVIEW ? 'preview_budget_settings' : 'budget_settings';
  const TRANSACTIONS_TABLE = IS_PREVIEW ? 'preview_transactions' : 'transactions';
  const STATE_REPLACEMENT_RPC = IS_PREVIEW ? 'replace_preview_budget_state' : 'replace_budget_state';
  const ENVIRONMENT = Object.freeze({
    name: IS_PREVIEW ? 'preview' : 'production',
    isPreview: IS_PREVIEW,
    settingsTable: SETTINGS_TABLE,
    transactionsTable: TRANSACTIONS_TABLE,
    stateRpc: STATE_REPLACEMENT_RPC
  });
  const SETTINGS_CONFLICT_MESSAGE = '다른 브라우저에서 예산 설정이 변경됐어요. 클라우드 데이터를 다시 불러와 주세요.';
  let client = null;
  let settingsVersion = null;

  function conflictError(message) {
    const error = new Error(message);
    error.code = '40001';
    return error;
  }

  function isConfigured() {
    return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase && typeof window.supabase.createClient === 'function');
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (!client) {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return client;
  }

  function stateToRemote(state, userId) {
    const normalized = window.BudgetStorage.normalizeState(state);
    return {
      settings: {
        user_id: userId,
        monthly_budget: normalized.monthlyBudget,
        category_budgets: {
          ...(normalized.categoryBudgets || {}),
          __month_start_day: normalized.monthStartDay,
          __monthly_budgets: normalized.monthlyBudgets || {}
        }
      },
      transactions: normalized.transactions.map((tx) => ({
        id: tx.id,
        user_id: userId,
        date: tx.date,
        type: tx.type,
        category: tx.category,
        amount: tx.amount,
        memo: tx.memo || '',
        source: tx.source === 'sample' ? 'sample' : 'user'
      }))
    };
  }

  function transactionToRemote(transaction, userId) {
    const normalized = window.BudgetStorage.normalizeState({ transactions: [transaction] }).transactions[0];
    if (!normalized) throw new Error('저장할 거래 정보가 올바르지 않아요.');
    return {
      id: normalized.id,
      user_id: userId,
      date: normalized.date,
      type: normalized.type,
      category: normalized.category,
      amount: normalized.amount,
      memo: normalized.memo || '',
      source: normalized.source === 'sample' ? 'sample' : 'user'
    };
  }

  function addExpectedTransactionFilters(query, expectedTransaction, userId, transactionId) {
    if (!expectedTransaction) return query;
    const expected = transactionToRemote(expectedTransaction, userId);
    if (expected.id !== transactionId) {
      throw new Error('비교할 거래 정보가 올바르지 않아요.');
    }
    return query
      .eq('date', expected.date)
      .eq('type', expected.type)
      .eq('category', expected.category)
      .eq('amount', expected.amount)
      .eq('memo', expected.memo)
      .eq('source', expected.source);
  }

  function transactionRowsForState(state) {
    const normalized = window.BudgetStorage.normalizeState(state);
    return normalized.transactions.map((transaction) => ({
      id: transaction.id,
      date: transaction.date,
      type: transaction.type,
      category: transaction.category,
      amount: transaction.amount,
      memo: transaction.memo || '',
      source: transaction.source === 'sample' ? 'sample' : 'user'
    }));
  }

  function replacementArgsForState(state, expectedState) {
    const normalized = window.BudgetStorage.normalizeState(state);
    return {
      p_monthly_budget: normalized.monthlyBudget,
      p_category_budgets: {
        ...(normalized.categoryBudgets || {}),
        __month_start_day: normalized.monthStartDay,
        __monthly_budgets: normalized.monthlyBudgets || {}
      },
      p_transactions: transactionRowsForState(normalized),
      p_expected_updated_at: settingsVersion,
      p_expected_transactions: transactionRowsForState(expectedState)
        .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    };
  }

  function countFromRpcResult(data, field, fallback) {
    const row = Array.isArray(data) ? data[0] : data;
    const count = Number(row && row[field]);
    return Number.isInteger(count) && count >= 0 ? count : fallback;
  }

  async function authenticatedClient() {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase 설정을 찾지 못했어요.');
    const user = await currentUser();
    if (!user) throw new Error('먼저 로그인해 주세요.');
    return { supabase, user };
  }

  function remoteToState(settings, rows) {
    const remoteBudgets = settings && settings.category_budgets ? settings.category_budgets : {};
    return window.BudgetStorage.normalizeState({
      monthlyBudget: settings && settings.monthly_budget,
      categoryBudgets: remoteBudgets,
      monthStartDay: remoteBudgets.__month_start_day,
      monthlyBudgets: remoteBudgets.__monthly_budgets,
      transactions: (rows || []).map((row) => ({
        id: row.id,
        date: row.date,
        type: row.type,
        category: row.category,
        amount: row.amount,
        memo: row.memo || '',
        source: row.source === 'sample' ? 'sample' : 'user'
      }))
    });
  }

  async function currentUser() {
    const supabase = getClient();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getUser();
    if (error && error.name !== 'AuthSessionMissingError') throw error;
    return data && data.user ? data.user : null;
  }

  async function signInWithPassword(password) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase 설정을 찾지 못했어요.');
    const { error } = await supabase.auth.signInWithPassword({ email: LOGIN_EMAIL, password });
    if (error) throw error;
  }

  async function signOut() {
    const supabase = getClient();
    if (!supabase) {
      settingsVersion = null;
      return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    settingsVersion = null;
  }

  async function saveSettings(state) {
    const { supabase, user } = await authenticatedClient();
    const settings = stateToRemote(state, user.id).settings;
    const result = settingsVersion
      ? await supabase
        .from(SETTINGS_TABLE)
        .update({
          monthly_budget: settings.monthly_budget,
          category_budgets: settings.category_budgets
        })
        .eq('user_id', user.id)
        .eq('updated_at', settingsVersion)
        .select('updated_at')
      : await supabase
        .from(SETTINGS_TABLE)
        .insert(settings)
        .select('updated_at');
    if (result.error) {
      if (result.error.code === '23505') throw conflictError(SETTINGS_CONFLICT_MESSAGE);
      throw result.error;
    }
    if (!Array.isArray(result.data)
      || result.data.length !== 1
      || typeof result.data[0].updated_at !== 'string'
      || !result.data[0].updated_at) {
      throw conflictError(SETTINGS_CONFLICT_MESSAGE);
    }
    settingsVersion = result.data[0].updated_at;
    return { ok: true };
  }

  async function insertTransaction(transaction) {
    const { supabase, user } = await authenticatedClient();
    const row = transactionToRemote(transaction, user.id);
    const result = await supabase.from(TRANSACTIONS_TABLE).insert(row);
    if (result.error) throw result.error;
    return { ok: true, id: row.id };
  }

  async function updateTransaction(transaction, expectedTransaction = null) {
    if (!transaction || typeof transaction.id !== 'string' || !transaction.id.trim()) {
      throw new Error('거래 ID가 올바르지 않아요.');
    }
    const { supabase, user } = await authenticatedClient();
    const row = transactionToRemote({ ...transaction, id: transaction.id.trim() }, user.id);
    const patch = {
      date: row.date,
      type: row.type,
      category: row.category,
      amount: row.amount,
      memo: row.memo,
      source: row.source
    };
    let query = supabase
      .from(TRANSACTIONS_TABLE)
      .update(patch)
      .eq('id', row.id)
      .eq('user_id', user.id);
    query = addExpectedTransactionFilters(query, expectedTransaction, user.id, row.id);
    const result = await query.select('id');
    if (result.error) throw result.error;
    if (!Array.isArray(result.data) || result.data.length !== 1 || result.data[0].id !== row.id) {
      throw conflictError('거래가 이미 변경되었거나 삭제되었어요. 클라우드 데이터를 다시 불러와 주세요.');
    }
    return { ok: true, id: row.id };
  }

  async function deleteTransaction(id, expectedTransaction = null) {
    if (typeof id !== 'string' || !id) throw new Error('삭제할 거래 ID가 올바르지 않아요.');
    const { supabase, user } = await authenticatedClient();
    let query = supabase
      .from(TRANSACTIONS_TABLE)
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    query = addExpectedTransactionFilters(query, expectedTransaction, user.id, id);
    const result = await query.select('id');
    if (result.error) throw result.error;
    if (!Array.isArray(result.data) || result.data.length !== 1 || result.data[0].id !== id) {
      throw conflictError('거래가 이미 변경되었거나 삭제되었어요. 클라우드 데이터를 다시 불러와 주세요.');
    }
    return { ok: true, id };
  }

  async function uploadState(state, expectedState) {
    if (!expectedState || typeof expectedState !== 'object') {
      throw new Error('비교할 기존 가계부 데이터가 필요해요. 클라우드 데이터를 다시 불러와 주세요.');
    }
    const { supabase } = await authenticatedClient();
    const args = replacementArgsForState(state, expectedState);
    const result = await supabase.rpc(STATE_REPLACEMENT_RPC, args);
    if (result.error) throw result.error;
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row || typeof row.updated_at !== 'string' || !row.updated_at) {
      throw conflictError('클라우드 저장 버전을 확인하지 못했어요. 데이터를 다시 불러와 주세요.');
    }
    settingsVersion = row.updated_at;
    return {
      ok: true,
      uploadedCount: countFromRpcResult(result.data, 'uploaded_count', args.p_transactions.length)
    };
  }

  async function downloadState() {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase 설정을 찾지 못했어요.');
    const user = await currentUser();
    if (!user) throw new Error('먼저 로그인해 주세요.');

    const settingsResult = await supabase
      .from(SETTINGS_TABLE)
      .select('monthly_budget, category_budgets, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (settingsResult.error) throw settingsResult.error;

    const txResult = await supabase
      .from(TRANSACTIONS_TABLE)
      .select('id, date, type, category, amount, memo, source')
      .eq('user_id', user.id)
      .order('date', { ascending: false });
    if (txResult.error) throw txResult.error;

    settingsVersion = settingsResult.data && typeof settingsResult.data.updated_at === 'string'
      ? settingsResult.data.updated_at
      : null;
    return remoteToState(settingsResult.data, txResult.data || []);
  }

  window.BudgetCloud = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    LOGIN_EMAIL,
    ENVIRONMENT,
    isConfigured,
    getClient,
    stateToRemote,
    transactionToRemote,
    remoteToState,
    currentUser,
    signInWithPassword,
    signOut,
    saveSettings,
    insertTransaction,
    updateTransaction,
    deleteTransaction,
    uploadState,
    downloadState
  };
})(window);
