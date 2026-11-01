const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ctx = vm.createContext({ window: {}, console });
ctx.window.window = ctx.window;
for (const f of ['storage', 'transactions', 'notifications']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), ctx, { filename: 'js/' + f + '.js' });
}
const S = ctx.window.BudgetStorage;
const plain = (v) => JSON.parse(JSON.stringify(v));
const N = ctx.window.BudgetNotifications;
assert.ok(N, 'BudgetNotifications 모듈이 있어야 해요');
assert.equal(typeof N.buildNotifications, 'function');
assert.equal(typeof N.buildDailyReport, 'function');

const TODAY = '2026-11-01';
const tx = (id, date, type, category, amount, memo) => ({ id, date, type, category, amount, memo, source: 'user' });

// --- buildNotifications: 최근 7일 창 ---
{
  const items = N.buildNotifications({
    today: TODAY,
    pending: { total: 0, main: 0, notice: 0 },
    transactions: [
      tx('a', '2026-11-01', 'expense', '생활비', 11110, '쿠팡 주식회사'),
      tx('b', '2026-10-26', 'expense', '생활비', 980, '편의점'), // 6일 전: 포함
      tx('c', '2026-10-25', 'expense', '생활비', 5000, '오래된 지출'), // 7일 전 경계 밖: 제외
      tx('d', '2026-11-02', 'income', '기타', 1006, '이자'), // 미래 날짜: 제외
      tx('e', '2026-10-31', 'income', '기타', 122, '') // 메모 없음: 카테고리로 표시
    ]
  });
  const txItems = items.filter((i) => i.kind === 'transaction');
  assert.deepEqual(plain(txItems.map((i) => i.id)), ['tx:a', 'tx:e', 'tx:b'], '최근 7일(오늘 포함 7일)만, 최신 날짜순');
  assert.equal(txItems[0].title, '쿠팡 주식회사');
  assert.match(txItems[0].detail, /지출/);
  assert.match(txItems[0].detail, /생활비/);
  assert.match(txItems[0].detail, /11,110원/);
  assert.equal(txItems[1].title, '기타', '메모가 없으면 카테고리를 제목으로');
  assert.match(txItems[1].detail, /수입/);
}

// --- 안정적인 id와 중복 제거 ---
{
  const input = {
    today: TODAY,
    pending: { total: 0 },
    transactions: [tx('x', '2026-11-01', 'expense', '생활비', 100, '마트'), tx('x', '2026-11-01', 'expense', '생활비', 100, '마트')]
  };
  const first = N.buildNotifications(input);
  const second = N.buildNotifications(input);
  assert.deepEqual(plain(first), plain(second), '같은 입력이면 같은 알림 목록(안정 id)');
  assert.equal(first.filter((i) => i.id === 'tx:x').length, 1, '중복 거래 id는 한 번만');
  const noId = N.buildNotifications({ today: TODAY, pending: { total: 0 }, transactions: [{ date: '2026-11-01', type: 'expense', category: '생활비', amount: 100, memo: '마트' }] });
  assert.equal(noId.filter((i) => i.kind === 'transaction').length, 1, 'id 없는 거래도 내용 기반 id로 1건');
}

// --- 분류 대기 + 아침 리포트 항목과 순서 ---
{
  const items = N.buildNotifications({
    today: TODAY,
    pending: { total: 3, main: 2, notice: 1 },
    transactions: [tx('a', '2026-11-01', 'expense', '생활비', 100, '마트')]
  });
  assert.equal(items[0].kind, 'report', '오늘 리포트 알림이 맨 앞');
  assert.equal(items[0].id, 'report:2026-11-01');
  assert.match(items[0].title, /리포트/);
  assert.equal(items[1].kind, 'pending');
  assert.equal(items[1].id, 'pending:3');
  assert.match(items[1].title, /3건/);
  const none = N.buildNotifications({ today: TODAY, pending: { total: 0 }, transactions: [] });
  assert.equal(none.filter((i) => i.kind === 'pending').length, 0, '대기 0건이면 분류 알림 없음');
  assert.equal(none.filter((i) => i.kind === 'report').length, 1, '리포트 알림은 매일 1건');
}

// --- 상한: 거래 알림은 최대 20건 ---
{
  const many = Array.from({ length: 25 }, (_, i) => tx('m' + i, '2026-11-01', 'expense', '생활비', 100 + i, '가게' + i));
  const items = N.buildNotifications({ today: TODAY, pending: { total: 0 }, transactions: many });
  assert.equal(items.filter((i) => i.kind === 'transaction').length, 20);
}

// --- 읽음 계산과 seen 정리 ---
{
  const items = N.buildNotifications({
    today: TODAY,
    pending: { total: 1 },
    transactions: [tx('a', '2026-11-01', 'expense', '생활비', 100, '마트'), tx('b', '2026-10-31', 'expense', '생활비', 200, '마트')]
  });
  assert.equal(N.unreadCount(items, []), items.length);
  assert.equal(N.unreadCount(items, items.map((i) => i.id)), 0);
  assert.equal(N.unreadCount(items, ['tx:a']), items.length - 1);
  assert.deepEqual(plain(N.pruneSeenIds(['tx:a', 'tx:gone', 'report:2026-11-01'], items)), ['tx:a', 'report:2026-11-01'],
    '현재 목록에 없는 seen id는 버려 저장 크기를 유지');
}

// --- 새 거래 감지 (배너용) ---
{
  const before = N.buildNotifications({ today: TODAY, pending: { total: 0 }, transactions: [tx('a', '2026-11-01', 'expense', '생활비', 100, '마트')] });
  const after = N.buildNotifications({
    today: TODAY, pending: { total: 0 },
    transactions: [tx('a', '2026-11-01', 'expense', '생활비', 100, '마트'), tx('b', '2026-11-01', 'expense', '배달비', 200, '치킨')]
  });
  const fresh = N.detectNewTransactions(before, after);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].id, 'tx:b');
  assert.equal(N.detectNewTransactions(after, after).length, 0);
  assert.equal(N.detectNewTransactions(null, after).length, 0, '첫 로드는 배너 대상이 아님');
}

// --- buildDailyReport: 텔레그램 브리핑과 같은 숫자 ---
{
  const state = S.normalizeState({
    monthlyBudget: 2000000,
    monthStartDay: 19,
    monthlyBudgets: {},
    transactions: [
      tx('t1', '2026-10-20', 'expense', '생활비', 500000, '쿠팡 주식회사'),
      tx('t2', '2026-10-25', 'expense', '배달비', 30000, '쿠팡이츠'),
      tx('t3', '2026-10-31', 'expense', '생활비', 16900, '더온정육'),
      tx('t4', '2026-10-31', 'expense', '의류비', 8000, '탑텐'),
      tx('t5', '2026-11-01', 'expense', '생활비', 3400, 'GS25 김해안'),
      tx('t6', '2026-10-19', 'income', '월급', 2000000, '월급'),
      tx('t7', '2026-09-30', 'expense', '생활비', 999999, '이전 기간 지출')
    ]
  });
  const report = N.buildDailyReport(state, new Date(2026, 10, 1)); // 2026-11-01 로컬
  assert.equal(report.periodStart, '2026-10-19');
  assert.equal(report.periodEnd, '2026-11-18');
  assert.equal(report.monthlyBudget, 2000000);
  assert.equal(report.expense, 558300, '현재 기간 지출만 합산');
  assert.equal(report.budgetRemaining, 2000000 - 558300);
  assert.equal(report.usageRate, 27.9, '사용률은 소수 1자리');
  assert.deepEqual(plain(report.categories.map((c) => c.category)), ['생활비', '배달비', '의류비', '비상금', '휴가비'],
    '지출 카테고리 전체를 큰 순으로, 없는 카테고리는 0원');
  assert.equal(report.categories.find((c) => c.category === '비상금').amount, 0);
  assert.equal(report.categories.find((c) => c.category === '생활비').amount, 520300);
  assert.equal(report.merchants[0].place, '쿠팡');
  assert.equal(report.merchants[0].amount, 500000);
  assert.ok(report.merchants.some((m) => m.place === '쿠팡이츠' && m.amount === 30000), '쿠팡과 쿠팡이츠는 따로 집계');
  assert.equal(report.coupangTotal, 530000);
  assert.equal(report.coupangRate, 94.9);
  assert.equal(report.yesterday, '2026-10-31');
  assert.deepEqual(plain(report.yesterdayExpenses.map((e) => e.memo)), ['더온정육', '탑텐'], '어제 지출만');
}

// 예산이 없을 때도 깨지지 않음
{
  const state = S.normalizeState({ monthlyBudget: 0, monthStartDay: 1, transactions: [] });
  const report = N.buildDailyReport(state, new Date(2026, 10, 1));
  assert.equal(report.usageRate, 0);
  assert.equal(report.expense, 0);
}

console.log('Notifications: build/report/seen/new-detection passed');
