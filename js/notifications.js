/* beginner-budget-app notifications.js
   알림은 매번 클라우드 데이터(거래·분류 대기)에서 다시 계산한다.
   localStorage에는 알림 id 목록(UI 읽음 상태)만 저장하고, 금액·메모 같은
   가계부 내용 자체는 저장하지 않는다. */
(function (window, document) {
  'use strict';

  const SEEN_KEY = 'beginner-budget.notification-seen.v1';
  const RECENT_DAYS = 7;
  const MAX_TRANSACTION_NOTIFICATIONS = 20;
  const POLL_MS = 60000;
  const KIND_PRIORITY = { report: 0, pending: 1, transaction: 2 };

  function storage() { return window.BudgetStorage; }
  function transactionsApi() { return window.BudgetTransactions; }
  function formatWon(amount) { return Number(amount || 0).toLocaleString('ko-KR') + '원'; }

  function shiftDate(dateString, deltaDays) {
    const [y, m, d] = String(dateString).split('-').map(Number);
    const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    date.setUTCDate(date.getUTCDate() + deltaDays);
    return date.toISOString().slice(0, 10);
  }

  function transactionId(tx) {
    if (tx && typeof tx.id === 'string' && tx.id) return 'tx:' + tx.id;
    return 'tx:' + [tx && tx.date, tx && tx.type, tx && tx.category, tx && tx.amount, tx && tx.memo].join('|');
  }

  function buildNotifications(input = {}) {
    const today = typeof input.today === 'string' ? input.today : storage().localDateString();
    const windowStart = shiftDate(today, -(RECENT_DAYS - 1));
    const byId = new Map();
    const add = (item) => { if (!byId.has(item.id)) byId.set(item.id, item); };

    add({
      id: 'report:' + today,
      kind: 'report',
      date: today,
      title: '오늘의 리포트가 준비됐어요',
      detail: '홈 화면에서 오늘의 리포트를 확인하세요.'
    });

    const pendingTotal = Math.max(0, Math.floor(Number(input.pending && input.pending.total) || 0));
    if (pendingTotal > 0) {
      add({
        id: 'pending:' + pendingTotal,
        kind: 'pending',
        date: today,
        title: '분류 대기 ' + pendingTotal + '건',
        detail: '확인할 알림이 있어요. 분류 탭에서 정리해 주세요.'
      });
    }

    const recent = (Array.isArray(input.transactions) ? input.transactions : [])
      .filter((tx) => tx && typeof tx.date === 'string' && tx.date >= windowStart && tx.date <= today
        && (tx.type === 'expense' || tx.type === 'income') && Number(tx.amount) > 0);
    const sorted = [...recent].sort((a, b) => b.date.localeCompare(a.date)
      || transactionId(a).localeCompare(transactionId(b)));
    const seenTx = new Set();
    for (const tx of sorted) {
      const id = transactionId(tx);
      if (seenTx.has(id)) continue;
      seenTx.add(id);
      if (seenTx.size > MAX_TRANSACTION_NOTIFICATIONS) break;
      add({
        id,
        kind: 'transaction',
        date: tx.date,
        title: String(tx.memo || '').trim() || tx.category || '거래',
        detail: (tx.type === 'income' ? '수입' : '지출') + ' · ' + tx.category + ' · ' + formatWon(tx.amount)
      });
    }

    return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date)
      || (KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind])
      || a.id.localeCompare(b.id));
  }

  function unreadCount(notifications, seenIds) {
    const seen = new Set(Array.isArray(seenIds) ? seenIds : []);
    return (notifications || []).filter((item) => !seen.has(item.id)).length;
  }

  function pruneSeenIds(seenIds, notifications) {
    const current = new Set((notifications || []).map((item) => item.id));
    return (Array.isArray(seenIds) ? seenIds : []).filter((id) => current.has(id));
  }

  function detectNewTransactions(previous, next) {
    if (!Array.isArray(previous)) return [];
    const before = new Set(previous.filter((i) => i.kind === 'transaction').map((i) => i.id));
    return (next || []).filter((i) => i.kind === 'transaction' && !before.has(i.id));
  }

  function buildDailyReport(state, today = new Date()) {
    const S = storage();
    const normalized = S.normalizeState(state);
    const startDay = normalized.monthStartDay || 1;
    const todayString = S.localDateString(today);
    const month = S.monthKeyForDate(todayString, startDay) || S.localMonthString(today);
    const budget = S.budgetForMonth(normalized, month);
    const summary = transactionsApi().summarize(
      normalized.transactions, budget.monthlyBudget, month, today, budget.categoryBudgets, startDay
    );
    const period = S.periodRangeForMonth(month, startDay);
    const byCategory = new Map(summary.categoryBreakdown.map((item) => [item.category, item.amount]));
    const categories = S.EXPENSE_CATEGORIES
      .map((category, index) => ({ category, amount: byCategory.get(category) || 0, index }))
      .sort((a, b) => b.amount - a.amount || a.index - b.index)
      .map(({ category, amount }) => ({ category, amount }));
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return {
      month,
      periodStart: period.start,
      periodEnd: period.end,
      monthlyBudget: budget.monthlyBudget,
      income: summary.income,
      expense: summary.expense,
      budgetRemaining: summary.budgetRemaining,
      usageRate: budget.monthlyBudget > 0 ? Math.round((summary.expense / budget.monthlyBudget) * 1000) / 10 : 0,
      categories,
      merchants: summary.merchantBreakdown,
      coupangTotal: summary.coupangTotal,
      coupangRate: summary.coupangRate,
      yesterday: S.localDateString(yesterday),
      yesterdayExpenses: summary.yesterdayExpenses
    };
  }

  const api = {
    SEEN_KEY, RECENT_DAYS, MAX_TRANSACTION_NOTIFICATIONS,
    buildNotifications, buildDailyReport, unreadCount, pruneSeenIds, detectNewTransactions
  };
  window.BudgetNotifications = api;

  /* ---------- 브라우저 UI (Node 테스트 환경에서는 건너뜀) ---------- */
  if (!document || typeof document.getElementById !== 'function') return;

  const $ = (id) => document.getElementById(id);
  const node = (tag, text, cls) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };

  let currentState = null;
  let pendingSummary = { total: 0, main: 0, notice: 0 };
  let notifications = [];
  let previousNotifications = null;
  let seenIds = [];
  let seenLoaded = false;
  let seenKeyExisted = false;
  let baselinePending = null;
  let bannerTimer = null;

  function loadSeen() {
    if (seenLoaded) return seenKeyExisted;
    seenLoaded = true;
    try {
      const raw = window.localStorage.getItem(SEEN_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      seenIds = Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
      seenKeyExisted = raw !== null;
    } catch (_) {
      seenIds = [];
      seenKeyExisted = false;
    }
    return seenKeyExisted;
  }

  function saveSeen() {
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(pruneSeenIds(seenIds, notifications)));
    } catch (_) { /* 저장할 수 없으면 이번 화면에서만 읽음 상태를 유지 */ }
  }

  function renderBadge() {
    const badge = $('notification-count');
    if (!badge) return;
    const count = unreadCount(notifications, seenIds);
    badge.textContent = String(count);
    badge.hidden = count === 0;
    const button = $('notification-button');
    if (button) button.setAttribute('aria-label', count ? '알림 ' + count + '건 안 읽음' : '알림');
  }

  function renderList() {
    const list = $('notification-list');
    if (!list) return;
    list.replaceChildren();
    const seen = new Set(seenIds);
    for (const item of notifications) {
      const li = node('li', undefined, 'notification-item' + (seen.has(item.id) ? '' : ' is-unread'));
      const button = node('button', undefined, 'notification-item-button');
      button.type = 'button';
      if (!seen.has(item.id)) button.append(node('span', '새 알림', 'notification-new'));
      button.append(node('strong', item.title), node('span', item.detail, 'notification-detail'), node('span', item.date, 'notification-date'));
      button.addEventListener('click', () => openTarget(item));
      li.append(button);
      list.append(li);
    }
    const empty = $('notification-empty');
    if (empty) empty.hidden = notifications.length > 0;
    renderBadge();
  }

  function openTarget(item) {
    seenIds = [...new Set([...seenIds, item.id])];
    saveSeen();
    renderList();
    const tabId = item.kind === 'pending' ? 'tab-review' : item.kind === 'transaction' ? 'tab-history' : 'tab-home';
    const tab = $(tabId);
    if (tab) tab.click();
    if (item.kind === 'report') {
      const card = $('daily-report-card');
      if (card) { card.scrollIntoView({ block: 'start' }); card.focus({ preventScroll: true }); }
    }
    closePanel();
  }

  function barRow(name, amount, maxAmount) {
    const row = node('div', undefined, 'bar-row');
    const track = node('span', undefined, 'bar-track');
    const fill = node('span', undefined, 'bar-fill');
    fill.style.width = (maxAmount > 0 ? Math.min(100, Math.round((amount / maxAmount) * 100)) : 0) + '%';
    track.append(fill);
    row.append(node('span', name, 'bar-name'), track, node('strong', formatWon(amount), 'bar-amount'));
    return row;
  }

  function renderReport() {
    const card = $('daily-report-card');
    if (!card || !currentState) return;
    let report;
    try { report = buildDailyReport(currentState, new Date()); } catch (_) { return; }
    $('daily-report-period').textContent = '기간 ' + report.periodStart + ' ~ ' + report.periodEnd;
    $('daily-report-expense').textContent = formatWon(report.expense);
    $('daily-report-remaining').textContent = formatWon(report.budgetRemaining);
    $('daily-report-rate').textContent = '사용률 ' + report.usageRate + '%';
    const categories = $('daily-report-categories');
    categories.replaceChildren();
    const maxCategory = Math.max(0, ...report.categories.map((c) => c.amount));
    for (const item of report.categories) categories.append(barRow(item.category, item.amount, maxCategory));
    const merchants = $('daily-report-merchants');
    merchants.replaceChildren();
    if (!report.merchants.length) merchants.append(node('p', '아직 지출이 없어요.', 'muted'));
    const maxMerchant = Math.max(0, ...report.merchants.map((m) => m.amount));
    for (const item of report.merchants) merchants.append(barRow(item.place, item.amount, maxMerchant));
    $('daily-report-coupang').textContent = report.coupangTotal > 0
      ? '쿠팡 전체 ' + formatWon(report.coupangTotal) + ' · 이번 기간 지출의 ' + report.coupangRate + '%'
      : '';
    const yesterday = $('daily-report-yesterday');
    yesterday.replaceChildren();
    if (!report.yesterdayExpenses.length) {
      yesterday.append(node('p', '어제 사용 내역이 없어요.', 'muted'));
    } else {
      for (const item of report.yesterdayExpenses) {
        const row = node('div', undefined, 'bar-row');
        row.append(
          node('span', (item.memo || '').trim() || item.category, 'bar-name'),
          node('span', item.category, 'notification-detail'),
          node('strong', formatWon(item.amount), 'bar-amount')
        );
        yesterday.append(row);
      }
    }
  }

  function showBanner(text) {
    const banner = $('notification-banner');
    if (!banner) return;
    banner.textContent = text;
    banner.hidden = false;
    if (bannerTimer) window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => { banner.hidden = true; }, 10000);
  }

  function recompute(announce) {
    if (!currentState) return;
    const keyExisted = loadSeen();
    if (baselinePending === null) baselinePending = !keyExisted;
    const next = buildNotifications({
      transactions: currentState.transactions,
      pending: pendingSummary,
      today: storage().localDateString()
    });
    let seededNow = false;
    if (baselinePending && next.some((i) => i.kind === 'transaction')) {
      // 첫 실행: 거래 목록이 처음 채워진 시점의 기존 거래는 기준선으로 보고
      // 읽음 처리해 배지가 폭증하지 않게 한다. (로그인 전 빈 상태에서는 미루기)
      const baseline = next.filter((i) => i.kind === 'transaction').map((i) => i.id);
      seenIds = [...new Set([...seenIds, ...baseline])];
      baselinePending = false;
      seededNow = true;
    }
    if (announce && previousNotifications && !seededNow) {
      const fresh = detectNewTransactions(previousNotifications, next);
      const prevPendingItem = previousNotifications.find((i) => i.kind === 'pending');
      const prevPendingTotal = prevPendingItem ? Number(prevPendingItem.id.split(':')[1]) || 0 : 0;
      const pendingGrew = pendingSummary.total > prevPendingTotal;
      if (fresh.length) showBanner('새 사용 내역 ' + fresh.length + '건이 있어요.');
      else if (pendingGrew) showBanner('분류 대기 ' + pendingSummary.total + '건이 있어요.');
    }
    notifications = next;
    previousNotifications = next;
    if (seenLoaded) saveSeen();
    renderList();
    renderReport();
  }

  function closePanel() {
    const panel = $('notification-panel');
    const button = $('notification-button');
    if (!panel || !button) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  function init() {
    const button = $('notification-button');
    const panel = $('notification-panel');
    if (!button || !panel) return;
    loadSeen();
    button.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      if (open) renderList();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) { closePanel(); button.focus(); }
    });
    const markAll = $('notification-mark-all');
    if (markAll) markAll.addEventListener('click', () => {
      seenIds = notifications.map((i) => i.id);
      saveSeen();
      renderList();
    });
    window.setInterval(() => {
      if (document.hidden) return;
      if (window.BudgetPhoneReviewUI && typeof window.BudgetPhoneReviewUI.open === 'function') {
        window.BudgetPhoneReviewUI.open();
      }
    }, POLL_MS);
    recompute(false);
  }

  api.update = function update(state) {
    if (!state) return;
    const isFirst = currentState === null;
    currentState = state;
    recompute(!isFirst);
  };
  api.setPending = function setPending(summary) {
    const next = {
      total: Math.max(0, Math.floor(Number(summary && summary.total) || 0)),
      main: Math.max(0, Math.floor(Number(summary && summary.main) || 0)),
      notice: Math.max(0, Math.floor(Number(summary && summary.notice) || 0))
    };
    const changed = next.total !== pendingSummary.total;
    pendingSummary = next;
    if (changed) recompute(true);
  };

  document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : undefined);
