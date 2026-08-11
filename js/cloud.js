/* beginner-budget-app cloud.js */
(function (window) {
  'use strict';

  const SUPABASE_URL = 'https://htarkoatahivxgzbogmx.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_bx0mPHkBtNdbYF8GUn_4Fg_TLKDEY1j';
  const LOGIN_EMAIL = 'ho910728@naver.com';
  let client = null;

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

  function replacementArgsForState(state) {
    const normalized = window.BudgetStorage.normalizeState(state);
    return {
      p_monthly_budget: normalized.monthlyBudget,
      p_category_budgets: {
        ...(normalized.categoryBudgets || {}),
        __month_start_day: normalized.monthStartDay,
        __monthly_budgets: normalized.monthlyBudgets || {}
      },
      p_transactions: normalized.transactions.map((transaction) => ({
        id: transaction.id,
        date: transaction.date,
        type: transaction.type,
        category: transaction.category,
        amount: transaction.amount,
        memo: transaction.memo || '',
        source: transaction.source === 'sample' ? 'sample' : 'user'
      }))
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
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  async function saveSettings(state) {
    const { supabase, user } = await authenticatedClient();
    const settings = stateToRemote(state, user.id).settings;
    const result = await supabase.from('budget_settings').upsert(settings, { onConflict: 'user_id' });
    if (result.error) throw result.error;
    return { ok: true };
  }

  async function insertTransaction(transaction) {
    const { supabase, user } = await authenticatedClient();
    const row = transactionToRemote(transaction, user.id);
    const result = await supabase.from('transactions').insert(row);
    if (result.error) throw result.error;
    return { ok: true, id: row.id };
  }

  async function updateTransaction(transaction) {
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
    const result = await supabase
      .from('transactions')
      .update(patch)
      .eq('id', row.id)
      .eq('user_id', user.id)
      .select('id');
    if (result.error) throw result.error;
    if (!Array.isArray(result.data) || result.data.length !== 1 || result.data[0].id !== row.id) {
      throw new Error('거래가 이미 변경되었거나 삭제되었어요. 새로고침 후 다시 시도해 주세요.');
    }
    return { ok: true, id: row.id };
  }

  async function deleteTransaction(id) {
    if (typeof id !== 'string' || !id) throw new Error('삭제할 거래 ID가 올바르지 않아요.');
    const { supabase, user } = await authenticatedClient();
    const result = await supabase
      .from('transactions')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id');
    if (result.error) throw result.error;
    if (!Array.isArray(result.data) || result.data.length !== 1 || result.data[0].id !== id) {
      throw new Error('거래가 이미 변경되었거나 삭제되었어요. 새로고침 후 다시 시도해 주세요.');
    }
    return { ok: true, id };
  }

  async function uploadState(state) {
    const { supabase } = await authenticatedClient();
    const args = replacementArgsForState(state);
    const result = await supabase.rpc('replace_budget_state', args);
    if (result.error) throw result.error;
    return {
      ok: true,
      uploadedCount: countFromRpcResult(result.data, 'uploaded_count', args.p_transactions.length)
    };
  }

  async function replaceSampleTransactions(month, startDay, transactions) {
    if (!window.BudgetStorage.isValidMonthString(month)) {
      throw new Error('샘플을 저장할 예산월이 올바르지 않아요.');
    }
    const normalizedStartDay = window.BudgetStorage.normalizeMonthStartDay(startDay || 1);
    if (Number(startDay || 1) !== normalizedStartDay) {
      throw new Error('월 시작일은 1일부터 31일 사이여야 해요.');
    }
    if (!Array.isArray(transactions) || transactions.length !== 6) {
      throw new Error('저장할 샘플 거래 6건이 필요해요.');
    }

    const period = window.BudgetStorage.periodRangeForMonth(month, normalizedStartDay);
    const rows = transactions.map((transaction) => {
      if (!transaction || transaction.source !== 'sample') {
        throw new Error('샘플 거래 정보가 올바르지 않아요.');
      }
      const normalized = window.BudgetStorage.normalizeState({ transactions: [transaction] }).transactions[0];
      if (!normalized || normalized.id !== transaction.id || normalized.source !== 'sample') {
        throw new Error('샘플 거래 정보가 올바르지 않아요.');
      }
      if (!window.BudgetStorage.isDateInBudgetMonth(normalized.date, month, normalizedStartDay)) {
        throw new Error('샘플 거래 날짜가 선택한 예산월 밖에 있어요.');
      }
      return {
        id: normalized.id,
        date: normalized.date,
        type: normalized.type,
        category: normalized.category,
        amount: normalized.amount,
        memo: normalized.memo || '',
        source: 'sample'
      };
    });

    const { supabase } = await authenticatedClient();
    const result = await supabase.rpc('replace_budget_samples', {
      p_period_start: period.start,
      p_period_end: period.end,
      p_transactions: rows
    });
    if (result.error) throw result.error;
    return {
      ok: true,
      replacedCount: countFromRpcResult(result.data, 'replaced_count', rows.length)
    };
  }

  async function downloadState() {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase 설정을 찾지 못했어요.');
    const user = await currentUser();
    if (!user) throw new Error('먼저 로그인해 주세요.');

    const settingsResult = await supabase
      .from('budget_settings')
      .select('monthly_budget, category_budgets')
      .eq('user_id', user.id)
      .maybeSingle();
    if (settingsResult.error) throw settingsResult.error;

    const txResult = await supabase
      .from('transactions')
      .select('id, date, type, category, amount, memo, source')
      .eq('user_id', user.id)
      .order('date', { ascending: false });
    if (txResult.error) throw txResult.error;

    return remoteToState(settingsResult.data, txResult.data || []);
  }

  window.BudgetCloud = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    LOGIN_EMAIL,
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
    replaceSampleTransactions,
    downloadState
  };
})(window);
