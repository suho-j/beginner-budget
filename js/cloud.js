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

  async function uploadState(state) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase 설정을 찾지 못했어요.');
    const user = await currentUser();
    if (!user) throw new Error('먼저 로그인해 주세요.');
    const remote = stateToRemote(state, user.id);

    let result = await supabase.from('budget_settings').upsert(remote.settings, { onConflict: 'user_id' });
    if (result.error) throw result.error;

    result = await supabase.from('transactions').delete().eq('user_id', user.id);
    if (result.error) throw result.error;

    if (remote.transactions.length) {
      result = await supabase.from('transactions').insert(remote.transactions);
      if (result.error) throw result.error;
    }
    return { ok: true, uploadedCount: remote.transactions.length };
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
    remoteToState,
    currentUser,
    signInWithPassword,
    signOut,
    uploadState,
    downloadState
  };
})(window);
