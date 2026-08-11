# Budget Tabs, Editing, Calendar, and Preview Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 운영 사이트를 유지하면서 월 공통 탐색, 4개 탭, 카테고리 단일 필터, 과거 거래 수정, 월간 캘린더를 추가하고 별도 미리보기 URL에서 검증한 동일 커밋을 운영에 배포한다.

**Architecture:** 현재 HTML/CSS/Vanilla JS와 Supabase Auth/RLS 구성을 유지한다. 순수 계산은 `storage.js`와 `transactions.js`, 행 단위 원격 저장은 `cloud.js`, DOM 생성과 접근성은 `ui.js`, 화면 상태와 이벤트 조정은 `app.js`에 둔다. 운영 거래를 통째로 교체하는 일반 저장 경로를 없애고, 미리보기는 별도 GitHub Pages 저장소에서 운영 Supabase를 사용한다.

**Tech Stack:** HTML5, CSS3, Vanilla JavaScript, Node.js 내장 `assert`/`vm`, Supabase JS v2, GitHub Pages, GitHub CLI

---

## 시작 조건

- 기준 브랜치: `guardian/project-setup`
- 기준 커밋: `ddc7a7b`
- 운영 기준: `origin/master`의 `0d487df`
- 승인 설계: `docs/superpowers/specs/2026-08-11-budget-tabs-edit-calendar-preview-design.md`
- 현재 자동 테스트: `15 tests passed`
- 운영 `master`는 미리보기 승인 전까지 push하지 않는다.
- `.superpowers/`는 로컬 시안 자료이며 어떤 기능 커밋에도 포함하지 않는다.

## 파일 구조와 책임

| 파일 | 변경 책임 |
| --- | --- |
| `.gitignore` | 로컬 시안 자료 제외 |
| `index.html` | 월 탐색, 탭 패널, 필터, 캘린더, 수정 dialog, 미리보기 경고 |
| `css/style.css` | 탭·캘린더·dialog·360px 반응형 스타일 |
| `js/storage.js` | 예산 기간을 주 단위 캘린더 셀로 변환 |
| `js/transactions.js` | 카테고리 필터, 거래 수정, 날짜별 집계 |
| `js/cloud.js` | 거래 행 단위 insert/update/delete와 설정 저장 |
| `js/ui.js` | 탭, 목록 액션, 수정 dialog, 캘린더 렌더링 |
| `js/app.js` | 공통 월/탭 상태, remote-first 이벤트 흐름 |
| `tests/run-tests.cjs` | 순수 로직, 클라우드 호출, 필수 마크업 회귀 테스트 |
| `README.md` | 사용자 기능과 미리보기 데이터 경고 |
| `docs/TEST_PLAN.md` | 자동·브라우저 검증 시나리오 |
| `docs/IMPROVEMENT_LOG.md` | 기능, 미리보기 URL, 검증 내역 |

## Task 1: 실행 전 기준 고정과 로컬 시안 제외

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: 브랜치와 운영 기준을 확인한다**

Run:

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse origin/master
git diff --check
```

Expected:

```text
guardian/project-setup is ahead of origin/master only by the approved design/plan commits
.superpowers/ is the only unrelated untracked path
git diff --check prints no errors
```

- [ ] **Step 2: 기준 테스트를 다시 실행한다**

Run:

```powershell
node --check js/storage.js
node --check js/transactions.js
node --check js/ui.js
node --check js/app.js
node --check js/cloud.js
node tests/run-tests.cjs
```

Expected: `15 tests passed`

- [ ] **Step 3: 시안 자료를 Git 대상에서 제외한다**

Create `.gitignore` with exactly:

```gitignore
.superpowers/
```

- [ ] **Step 4: 제외 범위를 확인한다**

Run:

```powershell
git status --short
git check-ignore -v .superpowers/brainstorm/4193-1785974708/content/category-filter-v2.html
```

Expected: `.gitignore`만 새 변경으로 보이고 `git check-ignore`가 `.gitignore:1:.superpowers/`를 출력한다.

- [ ] **Step 5: 저장소 위생 변경을 커밋한다**

```powershell
git add -- .gitignore
git commit -m "로컬 시안 자료를 Git 대상에서 제외"
```

## Task 2: 카테고리 단일 필터를 도메인에 추가

**Files:**
- Modify: `tests/run-tests.cjs`
- Modify: `js/transactions.js:156-172`

- [ ] **Step 1: 조합 필터 실패 테스트를 작성한다**

Add this test before the `tests` array in `tests/run-tests.cjs`:

```javascript
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
```

Add `testCategoryFilterCombinesWithMonthTypeAndQuery` to the `tests` array.

- [ ] **Step 2: 테스트가 카테고리를 무시해 실패하는지 확인한다**

Run: `node tests/run-tests.cjs`

Expected: FAIL in `testCategoryFilterCombinesWithMonthTypeAndQuery`; actual IDs include `b` before the category filter exists.

- [ ] **Step 3: 최소 카테고리 필터를 구현한다**

In `filterTransactions` add the category value and filter:

```javascript
function filterTransactions(transactions, filters) {
  const month = filters.month || '';
  const monthStartDay = window.BudgetStorage.normalizeMonthStartDay(filters.monthStartDay || 1);
  const type = filters.type || 'all';
  const category = filters.category || 'all';
  const query = String(filters.query || '').trim().toLocaleLowerCase('ko-KR');
  return transactions
    .filter((tx) => !month || window.BudgetStorage.isDateInBudgetMonth(tx.date, month, monthStartDay))
    .filter((tx) => type === 'all' || tx.type === type)
    .filter((tx) => category === 'all' || tx.category === category)
    .filter((tx) => {
      if (!query) return true;
      return [tx.date, typeLabelsForSearch(tx.type), tx.category, tx.memo]
        .join(' ')
        .toLocaleLowerCase('ko-KR')
        .includes(query);
    })
    .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
}
```

- [ ] **Step 4: 전체 도메인 테스트를 실행한다**

Run: `node tests/run-tests.cjs`

Expected: `16 tests passed`

- [ ] **Step 5: 카테고리 필터를 커밋한다**

```powershell
git add -- js/transactions.js tests/run-tests.cjs
git commit -m "거래 내역 카테고리 필터 추가"
```

## Task 3: 거래 수정 도메인 로직 추가

**Files:**
- Modify: `tests/run-tests.cjs`
- Modify: `js/transactions.js:62-92,299-319`

- [ ] **Step 1: 정상·오류·누락 ID 수정 테스트를 작성한다**

Add:

```javascript
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
  assert.strictEqual(updated.transaction.id, 'tx-a');
  assert.strictEqual(updated.transaction.amount, 25000);
  assert.strictEqual(updated.transaction.memo, '저녁 배달');
  assert.strictEqual(updated.transaction.source, 'user');
  assert.strictEqual(original.transactions[0].amount, 12000);

  const invalid = win.BudgetTransactions.updateTransaction(original, 'tx-a', {
    date: '2026-04-30', type: 'expense', category: '배달비', amount: '0', memo: ''
  });
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.state, original);

  const missing = win.BudgetTransactions.updateTransaction(original, 'tx-missing', {
    date: '2026-04-30', type: 'expense', category: '배달비', amount: '1000', memo: ''
  });
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.errors[0].field, 'transaction');
}
```

Add it to `tests`.

- [ ] **Step 2: 정의되지 않은 함수로 실패하는지 확인한다**

Run: `node tests/run-tests.cjs`

Expected: FAIL with `win.BudgetTransactions.updateTransaction is not a function`.

- [ ] **Step 3: 불변 수정 함수를 구현한다**

Add after `addTransaction`:

```javascript
function updateTransaction(state, id, input) {
  const index = state.transactions.findIndex((tx) => tx.id === id);
  if (index < 0) {
    return { state, ok: false, transaction: null, errors: [error('transaction', '수정할 거래를 찾지 못했어요.')] };
  }

  const validation = validateTransaction(input);
  if (!validation.valid) {
    return { state, ok: false, transaction: null, errors: validation.errors };
  }

  const previous = state.transactions[index];
  const transaction = {
    ...previous,
    ...validation.value,
    id: previous.id,
    source: previous.source
  };
  const transactions = state.transactions.slice();
  transactions[index] = transaction;
  return { state: { ...state, transactions }, ok: true, transaction, errors: [] };
}
```

Export `updateTransaction` immediately after `addTransaction` in `window.BudgetTransactions`.

- [ ] **Step 4: 수정 회귀 테스트를 실행한다**

Run: `node tests/run-tests.cjs`

Expected: `17 tests passed`

- [ ] **Step 5: 거래 수정 도메인을 커밋한다**

```powershell
git add -- js/transactions.js tests/run-tests.cjs
git commit -m "거래 수정 도메인 로직 추가"
```

## Task 4: 예산 기간 캘린더와 날짜별 집계 추가

**Files:**
- Modify: `tests/run-tests.cjs`
- Modify: `js/storage.js:57-89,221-245`
- Modify: `js/transactions.js:178-216,299-322`

- [ ] **Step 1: 캘린더 경계 테스트를 작성한다**

Add:

```javascript
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
```

- [ ] **Step 2: 날짜별 수입·지출·건수 테스트를 작성한다**

Add:

```javascript
function testSummarizeTransactionsByDateHonorsBudgetPeriod() {
  const win = createContext();
  const transactions = [
    { id: 'a', date: '2026-05-25', type: 'expense', category: '생활비', amount: 1000, memo: '' },
    { id: 'b', date: '2026-05-25', type: 'income', category: '급여', amount: 5000, memo: '' },
    { id: 'c', date: '2026-06-24', type: 'expense', category: '배달비', amount: 2000, memo: '' },
    { id: 'd', date: '2026-06-25', type: 'expense', category: '생활비', amount: 9000, memo: '' }
  ];
  const byDate = win.BudgetTransactions.summarizeTransactionsByDate(transactions, '2026-05', 25);
  assert.strictEqual(JSON.stringify(Object.keys(byDate)), JSON.stringify(['2026-05-25', '2026-06-24']));
  assert.strictEqual(byDate['2026-05-25'].expense, 1000);
  assert.strictEqual(byDate['2026-05-25'].income, 5000);
  assert.strictEqual(byDate['2026-05-25'].count, 2);
  assert.strictEqual(JSON.stringify(byDate['2026-05-25'].transactions.map((tx) => tx.id)), JSON.stringify(['b', 'a']));
}
```

Add both tests to `tests`.

- [ ] **Step 3: 새 함수가 없어 실패하는지 확인한다**

Run: `node tests/run-tests.cjs`

Expected: FAIL on `calendarDaysForBudgetMonth is not a function`.

- [ ] **Step 4: 주 단위 캘린더 셀을 구현한다**

Add to `storage.js` after `periodRangeForMonth`:

```javascript
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
    days.push({
      date,
      day: cursor.getDate(),
      inPeriod: date >= range.start && date <= range.end
    });
  }
  return days;
}
```

Export `calendarDaysForBudgetMonth` from `window.BudgetStorage`.

- [ ] **Step 5: 날짜별 집계를 구현한다**

Add to `transactions.js` after `filterTransactions`:

```javascript
function summarizeTransactionsByDate(transactions, month, monthStartDay = 1) {
  const rows = filterTransactions(transactions, {
    month,
    monthStartDay,
    type: 'all',
    category: 'all',
    query: ''
  });
  const byDate = {};
  rows.forEach((tx) => {
    if (!byDate[tx.date]) {
      byDate[tx.date] = { date: tx.date, expense: 0, income: 0, count: 0, transactions: [] };
    }
    const day = byDate[tx.date];
    day[tx.type] += tx.amount;
    day.count += 1;
    day.transactions.push(tx);
  });
  return Object.keys(byDate).sort().reduce((sorted, date) => {
    sorted[date] = byDate[date];
    return sorted;
  }, {});
}
```

Export `summarizeTransactionsByDate` from `window.BudgetTransactions`.

- [ ] **Step 6: 캘린더 도메인 테스트를 실행한다**

Run: `node tests/run-tests.cjs`

Expected: `19 tests passed`

- [ ] **Step 7: 캘린더 도메인을 커밋한다**

```powershell
git add -- js/storage.js js/transactions.js tests/run-tests.cjs
git commit -m "예산 기간 캘린더 집계 추가"
```

## Task 5: Supabase 거래 행 단위 저장 추가

**Files:**
- Modify: `tests/run-tests.cjs:6-39,262-300,tests runner`
- Modify: `js/cloud.js:22-108,131-148`

- [ ] **Step 1: 테스트 컨텍스트에 Supabase 주입점을 추가한다**

Add `supabase` to `createContext`'s `window` object:

```javascript
window: {
  localStorage,
  crypto: { randomUUID: () => 'test-uuid-' + Math.random().toString(16).slice(2) },
  console: testConsole,
  supabase: options.supabase
}
```

Add this fake after `createContext`:

```javascript
function createSupabaseFake() {
  const calls = [];

  function filteredQuery(table, action, payload) {
    const call = { table, action, payload, filters: [] };
    calls.push(call);
    const query = {
      eq(column, value) {
        call.filters.push([column, value]);
        return query;
      },
      then(resolve, reject) {
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      }
    };
    return query;
  }

  const client = {
    auth: {
      async getUser() {
        return { data: { user: { id: 'user-1' } }, error: null };
      }
    },
    from(table) {
      return {
        insert(payload) {
          calls.push({ table, action: 'insert', payload, filters: [] });
          return Promise.resolve({ data: null, error: null });
        },
        update(payload) {
          return filteredQuery(table, 'update', payload);
        },
        delete() {
          return filteredQuery(table, 'delete', null);
        },
        upsert(payload, options) {
          calls.push({ table, action: 'upsert', payload, options, filters: [] });
          return Promise.resolve({ data: null, error: null });
        }
      };
    }
  };

  return { calls, supabase: { createClient: () => client } };
}
```

- [ ] **Step 2: 행 단위 호출 실패 테스트를 작성한다**

Add:

```javascript
async function testCloudMutatesOnlyRequestedTransactionRow() {
  const fake = createSupabaseFake();
  const win = createContext({ supabase: fake.supabase });
  const transaction = {
    id: 'tx-a', date: '2026-05-02', type: 'expense', category: '생활비', amount: 12000, memo: '마트', source: 'user'
  };

  await win.BudgetCloud.insertTransaction(transaction);
  await win.BudgetCloud.updateTransaction({ ...transaction, amount: 15000 });
  await win.BudgetCloud.deleteTransaction('tx-a');
  await win.BudgetCloud.saveSettings(win.BudgetStorage.defaultState());

  assert.strictEqual(fake.calls[0].table, 'transactions');
  assert.strictEqual(fake.calls[0].action, 'insert');
  assert.strictEqual(fake.calls[0].payload.user_id, 'user-1');
  assert.strictEqual(fake.calls[1].action, 'update');
  assert.strictEqual(JSON.stringify(fake.calls[1].filters), JSON.stringify([['id', 'tx-a'], ['user_id', 'user-1']]));
  assert.strictEqual(fake.calls[2].action, 'delete');
  assert.strictEqual(JSON.stringify(fake.calls[2].filters), JSON.stringify([['id', 'tx-a'], ['user_id', 'user-1']]));
  assert.strictEqual(fake.calls[3].table, 'budget_settings');
  assert.strictEqual(fake.calls[3].action, 'upsert');
}
```

Add it to `tests`.

- [ ] **Step 3: 비동기 테스트 실행기를 적용하고 실패를 확인한다**

Replace the final loop with:

```javascript
async function run() {
  for (const test of tests) {
    await test();
    console.log('PASS', test.name);
  }
  console.log(`${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

Run: `node tests/run-tests.cjs`

Expected: FAIL with `insertTransaction is not a function`.

- [ ] **Step 4: 단일 거래 원격 매핑과 인증 헬퍼를 구현한다**

Add after `stateToRemote`:

```javascript
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

async function authenticatedClient() {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase 설정을 찾지 못했어요.');
  const user = await currentUser();
  if (!user) throw new Error('먼저 로그인해 주세요.');
  return { supabase, user };
}
```

- [ ] **Step 5: 설정과 거래 행 단위 메서드를 구현한다**

Add before `uploadState`:

```javascript
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
  const { supabase, user } = await authenticatedClient();
  const row = transactionToRemote(transaction, user.id);
  const patch = {
    date: row.date,
    type: row.type,
    category: row.category,
    amount: row.amount,
    memo: row.memo,
    source: row.source
  };
  const result = await supabase.from('transactions').update(patch).eq('id', row.id).eq('user_id', user.id);
  if (result.error) throw result.error;
  return { ok: true, id: row.id };
}

async function deleteTransaction(id) {
  if (typeof id !== 'string' || !id) throw new Error('삭제할 거래 ID가 올바르지 않아요.');
  const { supabase, user } = await authenticatedClient();
  const result = await supabase.from('transactions').delete().eq('id', id).eq('user_id', user.id);
  if (result.error) throw result.error;
  return { ok: true, id };
}
```

Export `transactionToRemote`, `saveSettings`, `insertTransaction`, `updateTransaction`, and `deleteTransaction` from `window.BudgetCloud`.

- [ ] **Step 6: 클라우드 단위 테스트를 실행한다**

Run: `node tests/run-tests.cjs`

Expected: `20 tests passed`

- [ ] **Step 7: 행 단위 저장을 커밋한다**

```powershell
git add -- js/cloud.js tests/run-tests.cjs
git commit -m "Supabase 거래 행 단위 저장 추가"
```

## Task 6: 접근 가능한 탭·월 탐색·필터·캘린더·수정 마크업 추가

**Files:**
- Modify: `tests/run-tests.cjs`
- Modify: `index.html:9-247`

- [ ] **Step 1: 필수 마크업 실패 테스트를 작성한다**

Add:

```javascript
function testAppMarkupProvidesTabsCalendarEditDialogAndPreviewWarning() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const required of [
    'id="preview-data-warning"',
    'role="tablist"',
    'id="tab-home"',
    'id="tab-history"',
    'id="tab-calendar"',
    'id="tab-settings"',
    'id="month-previous"',
    'id="month-next"',
    'id="filter-category"',
    'id="calendar-grid"',
    'id="calendar-detail-list"',
    '<dialog id="edit-dialog"',
    'id="edit-transaction-form"'
  ]) {
    assert.ok(source.includes(required), `missing markup: ${required}`);
  }
}
```

Add it to `tests`.

- [ ] **Step 2: 현재 단일 페이지 마크업으로 실패하는지 확인한다**

Run: `node tests/run-tests.cjs`

Expected: FAIL with `missing markup: id="preview-data-warning"`.

- [ ] **Step 3: 운영 데이터 경고와 공통 월 탐색을 추가한다**

Insert after the site header and remove the old `.quick-nav` block:

```html
<div id="preview-data-warning" class="preview-data-warning" role="status" hidden>
  개발 화면 · 운영 데이터 사용 중
</div>

<section class="container month-toolbar" aria-labelledby="month-toolbar-title">
  <h2 id="month-toolbar-title" class="visually-hidden">조회 월 선택</h2>
  <button id="month-previous" type="button" class="secondary" aria-label="이전 달 보기">← 이전 달</button>
  <label class="month-picker" for="filter-month">
    <span>조회 월</span>
    <input id="filter-month" name="filterMonth" type="month">
  </label>
  <button id="month-current" type="button" class="secondary">이번 달</button>
  <button id="month-next" type="button" class="secondary" aria-label="다음 달 보기">다음 달 →</button>
  <p id="selected-month-label" class="muted" aria-live="polite">선택한 달 기준</p>
</section>
```

Remove the old `.filters` block from the data-tools section so `#filter-month`, `#filter-type`, and `#filter-query` each appear only in their new locations. Remove the old `#selected-month-label` paragraph from the summary heading so the month toolbar owns the only element with that ID.

- [ ] **Step 4: 네 개 탭과 패널 경계를 추가한다**

Insert before `<main>`:

```html
<nav class="container app-tabs" aria-label="주요 메뉴">
  <div role="tablist" aria-label="가계부 화면">
    <button id="tab-home" type="button" role="tab" aria-selected="true" aria-controls="panel-home" data-tab="home">홈</button>
    <button id="tab-history" type="button" role="tab" aria-selected="false" aria-controls="panel-history" data-tab="history" tabindex="-1">내역</button>
    <button id="tab-calendar" type="button" role="tab" aria-selected="false" aria-controls="panel-calendar" data-tab="calendar" tabindex="-1">캘린더</button>
    <button id="tab-settings" type="button" role="tab" aria-selected="false" aria-controls="panel-settings" data-tab="settings" tabindex="-1">설정</button>
  </div>
</nav>
```

Use these exact panel assignments inside `#main-content`:

```text
panel-home: cloud-panel, summary-section, transaction-form section
panel-history: history filters, transactions-panel
panel-calendar: calendar panel and selected-date detail panel
panel-settings: month-start/budget section, category-budget section, data-tools section
```

Each wrapper is a `<section class="tab-panel">` with `role="tabpanel"`, matching `aria-labelledby`, and all except `panel-home` carry `hidden`.

- [ ] **Step 5: 내역 카테고리 필터와 캘린더 패널을 추가한다**

Place this filter block at the start of `#panel-history`:

```html
<div class="panel filters" aria-labelledby="history-filter-title">
  <h2 id="history-filter-title">사용 내역 찾기</h2>
  <div class="filter-grid">
    <div class="field">
      <label for="filter-type">유형</label>
      <select id="filter-type" name="filterType">
        <option value="all">전체</option>
        <option value="income">수입만</option>
        <option value="expense">지출만</option>
      </select>
    </div>
    <div class="field">
      <label for="filter-category">카테고리</label>
      <select id="filter-category" name="filterCategory">
        <option value="all">전체</option>
      </select>
    </div>
    <div class="field full">
      <label for="filter-query">검색</label>
      <input id="filter-query" name="filterQuery" type="search" placeholder="예: 생활비, 마트, 2026-05-02">
    </div>
  </div>
</div>
```

Place this in `#panel-calendar`:

```html
<section class="panel" aria-labelledby="calendar-title">
  <div class="section-heading section-heading-spread">
    <h2 id="calendar-title">월간 사용 캘린더</h2>
    <p id="calendar-period-label" class="muted"></p>
  </div>
  <div class="calendar-weekdays" aria-hidden="true">
    <span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span>
  </div>
  <div id="calendar-grid" class="calendar-grid" role="grid" aria-labelledby="calendar-title"></div>
</section>
<section class="panel" aria-labelledby="calendar-detail-title">
  <div class="section-heading section-heading-spread">
    <h2 id="calendar-detail-title">날짜별 상세</h2>
    <p id="calendar-detail-count" class="muted">날짜를 선택해 주세요.</p>
  </div>
  <div id="calendar-detail-empty" class="empty-state">날짜를 누르면 거래 내역을 보여드려요.</div>
  <ul id="calendar-detail-list" class="transaction-list"></ul>
</section>
```

- [ ] **Step 6: 거래 수정 dialog를 추가한다**

Insert before the footer:

```html
<dialog id="edit-dialog" aria-labelledby="edit-dialog-title">
  <form id="edit-transaction-form" class="transaction-form dialog-form" method="dialog" novalidate>
    <div class="dialog-heading full">
      <h2 id="edit-dialog-title">사용 내역 수정</h2>
      <button id="edit-close" type="button" class="secondary" aria-label="수정 창 닫기">닫기</button>
    </div>
    <input id="edit-id" name="transaction" type="hidden">
    <div class="field">
      <label for="edit-date">날짜</label>
      <input id="edit-date" name="date" type="date" required aria-describedby="edit-message">
    </div>
    <div class="field">
      <label for="edit-type">유형</label>
      <select id="edit-type" name="type" required aria-describedby="edit-message">
        <option value="expense">지출</option>
        <option value="income">수입</option>
      </select>
    </div>
    <div class="field">
      <label for="edit-category">카테고리</label>
      <select id="edit-category" name="category" required aria-describedby="edit-message"></select>
    </div>
    <div class="field">
      <label for="edit-amount">금액</label>
      <input id="edit-amount" name="amount" type="text" inputmode="numeric" pattern="[0-9,]*" required aria-describedby="edit-message">
    </div>
    <div class="field full">
      <label for="edit-memo">메모 <span class="optional">선택</span></label>
      <input id="edit-memo" name="memo" type="text" maxlength="80" aria-describedby="edit-message">
    </div>
    <p id="edit-message" class="message full" role="status" aria-live="polite"></p>
    <div class="form-actions full">
      <button id="edit-save" type="submit" class="primary">수정 저장</button>
      <button id="edit-cancel" type="button" class="secondary">취소</button>
    </div>
  </form>
</dialog>
```

- [ ] **Step 7: 캐시 버전을 갱신하고 마크업 테스트를 실행한다**

Set local asset URLs to:

```html
<link rel="stylesheet" href="css/style.css?v=20260811a">
<script src="js/cloud.js?v=20260811a"></script>
<script src="js/ui.js?v=20260811a"></script>
<script src="js/app.js?v=20260811a"></script>
```

Run: `node tests/run-tests.cjs`

Expected: `21 tests passed`

- [ ] **Step 8: 접근 가능한 앱 셸을 커밋한다**

```powershell
git add -- index.html tests/run-tests.cjs
git commit -m "가계부 탭과 캘린더 화면 구조 추가"
```

## Task 7: 탭·캘린더·수정 dialog 반응형 스타일 추가

**Files:**
- Modify: `tests/run-tests.cjs`
- Modify: `css/style.css`

- [ ] **Step 1: 필수 스타일 실패 테스트를 작성한다**

Add:

```javascript
function testAppStylesCoverTabsCalendarDialogAndMobile() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'css/style.css'), 'utf8');
  for (const required of [
    '.preview-data-warning',
    '.month-toolbar',
    '.app-tabs',
    '.tab-panel[hidden]',
    '.calendar-grid',
    '.calendar-day',
    'dialog::backdrop',
    '@media (max-width: 559px)'
  ]) {
    assert.ok(source.includes(required), `missing style: ${required}`);
  }
}
```

Add it to `tests` and run `node tests/run-tests.cjs`.

Expected: FAIL with `missing style: .preview-data-warning`.

- [ ] **Step 2: 앱 셸과 미리보기 경고 스타일을 추가한다**

Append:

```css
.preview-data-warning {
  position: sticky;
  top: 0;
  z-index: 30;
  padding: 0.65rem 1rem;
  background: #7c2d12;
  color: #fff7ed;
  text-align: center;
  font-weight: 900;
}

.month-toolbar {
  display: grid;
  grid-template-columns: auto minmax(150px, 1fr) auto auto;
  gap: 0.65rem;
  align-items: end;
  padding-top: 1rem;
}

.month-picker { display: grid; gap: 0.35rem; font-weight: 800; }
.month-toolbar #selected-month-label { grid-column: 1 / -1; margin: 0; }

.app-tabs {
  position: sticky;
  top: 0;
  z-index: 20;
  padding-top: 0.75rem;
  padding-bottom: 0.75rem;
  background: color-mix(in srgb, var(--bg) 94%, transparent);
  backdrop-filter: blur(10px);
}

.app-tabs [role="tablist"] {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.4rem;
  padding: 0.35rem;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel);
}

.app-tabs [role="tab"] { background: transparent; color: var(--muted); }
.app-tabs [role="tab"][aria-selected="true"] { background: var(--primary); color: #fff; }
.has-preview-warning .app-tabs { top: 44px; }
.tab-panel[hidden] { display: none; }
.tab-panel { grid-column: 1 / -1; display: grid; gap: 1rem; }
.filter-grid { display: grid; gap: 0.8rem; }
```

- [ ] **Step 3: 캘린더와 dialog 스타일을 추가한다**

Append:

```css
.calendar-weekdays,
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.35rem;
}

.calendar-weekdays { margin-bottom: 0.35rem; text-align: center; color: var(--muted); font-weight: 800; }
.calendar-day {
  min-height: 82px;
  padding: 0.45rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel);
  color: var(--text);
  text-align: left;
  display: grid;
  align-content: start;
  gap: 0.2rem;
}
.calendar-day.outside-period { opacity: 0.38; cursor: default; }
.calendar-day.is-selected { outline: 3px solid color-mix(in srgb, var(--primary) 35%, transparent); border-color: var(--primary); }
.calendar-date { font-weight: 900; }
.calendar-expense { color: var(--expense); font-size: 0.78rem; font-weight: 800; }
.calendar-income { color: var(--income); font-size: 0.78rem; font-weight: 800; }
.calendar-count { color: var(--muted); font-size: 0.75rem; }

dialog {
  width: min(680px, calc(100% - 2rem));
  max-height: calc(100vh - 2rem);
  overflow: auto;
  border: 0;
  border-radius: 18px;
  padding: 0;
  background: var(--panel);
  color: var(--text);
  box-shadow: 0 24px 80px rgb(15 23 42 / 0.3);
}
dialog::backdrop { background: rgb(15 23 42 / 0.58); }
.dialog-form { padding: 1.25rem; }
.dialog-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.transaction-actions { gap: 0.5rem; flex-wrap: wrap; }
```

- [ ] **Step 4: 360px 스타일을 추가한다**

Append:

```css
@media (max-width: 559px) {
  .month-toolbar { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .month-picker { grid-column: 1 / -1; grid-row: 1; }
  .month-toolbar #selected-month-label { text-align: center; }
  .app-tabs { padding-left: 0.75rem; padding-right: 0.75rem; }
  .app-tabs [role="tab"] { padding-left: 0.35rem; padding-right: 0.35rem; }
  .calendar-weekdays, .calendar-grid { gap: 0.2rem; }
  .calendar-day { min-height: 68px; padding: 0.3rem; }
  .calendar-expense, .calendar-income { font-size: 0.66rem; overflow-wrap: anywhere; }
  .calendar-count { font-size: 0.64rem; }
  dialog { width: calc(100% - 1rem); max-height: calc(100vh - 1rem); }
}
```

- [ ] **Step 5: 스타일 회귀 테스트를 실행한다**

Run: `node tests/run-tests.cjs`

Expected: `22 tests passed`

- [ ] **Step 6: 반응형 스타일을 커밋한다**

```powershell
git add -- css/style.css tests/run-tests.cjs
git commit -m "탭과 캘린더 반응형 스타일 추가"
```

## Task 8: UI 렌더러와 수정 dialog 포커스 흐름 추가

**Files:**
- Modify: `tests/run-tests.cjs`
- Modify: `js/ui.js:1-67,210-255,292-371`

- [ ] **Step 1: UI 공개 함수 실패 테스트를 작성한다**

Add:

```javascript
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
```

Add it to `tests` and run `node tests/run-tests.cjs`.

Expected: FAIL with `missing UI function: setActiveTab`.

- [ ] **Step 2: 폼 범위 안에서 오류 필드를 찾도록 수정한다**

Add this helper and use it in `showValidationErrors` before falling back to `fieldSelectors`:

```javascript
function fieldForError(scope, field) {
  if (!field) return null;
  const scoped = scope.querySelector(`[name="${field}"]`);
  if (scoped) return scoped;
  return fieldSelectors[field] ? document.querySelector(fieldSelectors[field]) : null;
}
```

Replace both global lookup sites in `showValidationErrors` with `fieldForError(scope, item.field)` and `fieldForError(scope, first.field)` respectively.

- [ ] **Step 3: 탭과 카테고리 선택 UI를 구현한다**

Add:

```javascript
function setActiveTab(elements, tabName, focus = false) {
  elements.tabs.forEach((tab) => {
    const active = tab.dataset.tab === tabName;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (focus && active) tab.focus();
  });
  elements.tabPanels.forEach((panel) => {
    panel.hidden = panel.id !== `panel-${tabName}`;
  });
}

function fillFilterCategoryOptions(select, type, selected = 'all') {
  const categories = type === 'all'
    ? [...window.BudgetTransactions.EXPENSE_CATEGORIES, ...window.BudgetTransactions.INCOME_CATEGORIES]
    : window.BudgetTransactions.categoriesFor(type);
  select.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = '전체';
  select.append(all);
  Array.from(new Set(categories)).forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    select.append(option);
  });
  select.value = categories.includes(selected) ? selected : 'all';
}
```

- [ ] **Step 4: 목록에 수정 버튼과 공통 액션 속성을 추가한다**

In `renderList`, create actions in this order:

```javascript
const editButton = document.createElement('button');
editButton.type = 'button';
editButton.className = 'secondary edit-button';
editButton.dataset.id = tx.id;
editButton.dataset.action = 'edit';
editButton.textContent = '수정';
editButton.setAttribute('aria-label', `${tx.date} ${tx.category} ${formatWon(tx.amount)} 수정`);

const deleteButton = document.createElement('button');
deleteButton.type = 'button';
deleteButton.className = 'danger delete-button';
deleteButton.dataset.id = tx.id;
deleteButton.dataset.action = 'delete';
deleteButton.textContent = '삭제';
deleteButton.setAttribute('aria-label', `${tx.date} ${tx.category} ${formatWon(tx.amount)} 삭제`);
actions.append(editButton, deleteButton);
```

- [ ] **Step 5: 수정 dialog 열기·닫기를 구현한다**

Add:

```javascript
function openEditDialog(elements, transaction, trigger) {
  elements.editId.value = transaction.id;
  elements.editDate.value = transaction.date;
  elements.editType.value = transaction.type;
  fillCategoryOptions(elements.editCategory, transaction.type);
  elements.editCategory.value = transaction.category;
  elements.editAmount.value = String(transaction.amount);
  elements.editMemo.value = transaction.memo || '';
  elements.editDialog.returnFocus = trigger || null;
  const ownerPanel = trigger ? trigger.closest('[role="tabpanel"]') : null;
  elements.editDialog.returnTab = ownerPanel ? ownerPanel.id.replace('panel-', '') : 'history';
  setMessage(elements.editMessage, '', null);
  clearFieldErrors(elements.editForm);
  elements.editDialog.showModal();
  elements.editDate.focus();
}

function closeEditDialog(elements) {
  const returnFocus = elements.editDialog.returnFocus;
  const transactionId = elements.editId.value;
  const returnTab = elements.editDialog.returnTab || 'history';
  elements.editDialog.close();
  elements.editDialog.returnFocus = null;
  elements.editDialog.returnTab = null;
  const replacement = Array.from(document.querySelectorAll('[data-action="edit"]'))
    .find((button) => button.dataset.id === transactionId && !button.closest('[hidden]'));
  const target = returnFocus && document.contains(returnFocus)
    ? returnFocus
    : replacement || elements.tabs.find((tab) => tab.dataset.tab === returnTab);
  if (target) target.focus();
}
```

- [ ] **Step 6: 캘린더와 상세 렌더러를 구현한다**

Add:

```javascript
function renderCalendar(elements, days, byDate, selectedDate) {
  elements.calendarGrid.innerHTML = '';
  days.forEach((day) => {
    const summary = byDate[day.date];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'calendar-day';
    button.dataset.date = day.date;
    button.dataset.action = 'select-date';
    button.setAttribute('role', 'gridcell');
    button.disabled = !day.inPeriod;
    button.classList.toggle('outside-period', !day.inPeriod);
    button.classList.toggle('is-selected', day.date === selectedDate);

    const date = document.createElement('span');
    date.className = 'calendar-date';
    date.textContent = String(day.day);
    button.append(date);

    if (summary && summary.expense) {
      const expense = document.createElement('span');
      expense.className = 'calendar-expense';
      expense.textContent = `지출 ${formatWon(summary.expense)}`;
      button.append(expense);
    }
    if (summary && summary.income) {
      const income = document.createElement('span');
      income.className = 'calendar-income';
      income.textContent = `수입 ${formatWon(summary.income)}`;
      button.append(income);
    }
    if (summary) {
      const count = document.createElement('span');
      count.className = 'calendar-count';
      count.textContent = `${summary.count}건`;
      button.append(count);
    }
    const accessible = summary
      ? `${day.date}, 지출 ${formatWon(summary.expense)}, 수입 ${formatWon(summary.income)}, ${summary.count}건`
      : `${day.date}, 거래 없음`;
    button.setAttribute('aria-label', accessible);
    elements.calendarGrid.append(button);
  });
}

function renderCalendarDetails(elements, selectedDate, transactions) {
  elements.calendarDetailList.innerHTML = '';
  elements.calendarDetailEmpty.hidden = transactions.length > 0;
  elements.calendarDetailCount.textContent = selectedDate ? `${selectedDate} · ${transactions.length}건` : '날짜를 선택해 주세요.';
  if (!transactions.length) return;
  const proxy = {
    list: elements.calendarDetailList,
    listCount: elements.calendarDetailCount,
    emptyState: elements.calendarDetailEmpty
  };
  renderList(proxy, transactions);
  elements.calendarDetailCount.textContent = `${selectedDate} · ${transactions.length}건`;
}
```

- [ ] **Step 7: 새 DOM 참조와 함수를 공개한다**

Add these entries in `getElements`:

```javascript
tabs: Array.from(document.querySelectorAll('[role="tab"]')),
tabPanels: Array.from(document.querySelectorAll('[role="tabpanel"]')),
previousMonthButton: $('#month-previous'),
currentMonthButton: $('#month-current'),
nextMonthButton: $('#month-next'),
filterCategory: $('#filter-category'),
calendarPeriodLabel: $('#calendar-period-label'),
calendarGrid: $('#calendar-grid'),
calendarDetailList: $('#calendar-detail-list'),
calendarDetailEmpty: $('#calendar-detail-empty'),
calendarDetailCount: $('#calendar-detail-count'),
previewDataWarning: $('#preview-data-warning'),
editDialog: $('#edit-dialog'),
editForm: $('#edit-transaction-form'),
editId: $('#edit-id'),
editDate: $('#edit-date'),
editType: $('#edit-type'),
editCategory: $('#edit-category'),
editAmount: $('#edit-amount'),
editMemo: $('#edit-memo'),
editMessage: $('#edit-message'),
editClose: $('#edit-close'),
editCancel: $('#edit-cancel'),
editSave: $('#edit-save')
```

Export the six functions named in Step 1.

- [ ] **Step 8: UI 구조 테스트와 syntax check를 실행한다**

Run:

```powershell
node --check js/ui.js
node tests/run-tests.cjs
```

Expected: `23 tests passed`

- [ ] **Step 9: UI 렌더러를 커밋한다**

```powershell
git add -- js/ui.js tests/run-tests.cjs
git commit -m "수정 창과 캘린더 UI 렌더러 추가"
```

## Task 9: 공통 월·탭 상태와 remote-first 저장 연결

**Files:**
- Modify: `tests/run-tests.cjs`
- Modify: `js/app.js:5-109,112-205,347-391`

- [ ] **Step 1: 앱 연결 경로 실패 테스트를 작성한다**

Add:

```javascript
function testAppUsesRowLevelCloudMutationsAndSharedViews() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
  for (const required of [
    'BudgetCloud.insertTransaction',
    'BudgetCloud.updateTransaction',
    'BudgetCloud.deleteTransaction',
    'BudgetCloud.saveSettings',
    'BudgetUI.setActiveTab',
    'BudgetUI.renderCalendar',
    'filterCategory'
  ]) {
    assert.ok(source.includes(required), `missing app integration: ${required}`);
  }
  assert.ok(!source.includes('persist(window.BudgetTransactions.deleteTransaction'));
}
```

Add it to `tests` and run `node tests/run-tests.cjs`.

Expected: FAIL with `missing app integration: BudgetCloud.insertTransaction`.

- [ ] **Step 2: 공통 화면 상태와 remote-first 헬퍼를 추가한다**

Replace quick-nav state with:

```javascript
const viewState = {
  tab: 'home',
  month: '',
  selectedDate: ''
};

async function persistRemoteFirst(nextState, remoteAction, messageElement, busyButton = null) {
  if (busyButton) busyButton.disabled = true;
  try {
    await remoteAction();
    state = window.BudgetStorage.saveState(nextState).state;
    render();
    return true;
  } catch (error) {
    window.BudgetUI.setMessage(messageElement || elements.toolMessage, `Supabase 저장 실패: ${error.message}`, 'error');
    return false;
  } finally {
    if (busyButton) busyButton.disabled = false;
  }
}
```

Remove the old `persist`, `syncMonthFilterToBudgetPeriod`, `syncQuickNavTargets`, `setActiveQuickNav`, `updateQuickNavActive`, and `scheduleQuickNavUpdate` functions.

- [ ] **Step 3: 공통 필터와 렌더를 연결한다**

Use:

```javascript
function activeFilters() {
  return {
    month: viewState.month,
    monthStartDay: state.monthStartDay || 1,
    type: elements.filterType.value || 'all',
    category: elements.filterCategory.value || 'all',
    query: elements.filterQuery.value || ''
  };
}

function render() {
  const filters = activeFilters();
  elements.monthInput.value = viewState.month;
  const selectedBudget = window.BudgetStorage.budgetForMonth(state, filters.month);
  if (document.activeElement !== elements.monthStartInput) elements.monthStartInput.value = state.monthStartDay || 1;
  if (document.activeElement !== elements.budgetInput) elements.budgetInput.value = selectedBudget.monthlyBudget;
  window.BudgetUI.syncCategoryBudgetInputs(elements, selectedBudget.categoryBudgets);

  const period = window.BudgetStorage.periodRangeForMonth(filters.month, filters.monthStartDay);
  const summary = window.BudgetTransactions.summarize(
    state.transactions, selectedBudget.monthlyBudget, filters.month, new Date(), selectedBudget.categoryBudgets, filters.monthStartDay
  );
  const list = window.BudgetTransactions.filterTransactions(state.transactions, filters);
  const days = window.BudgetStorage.calendarDaysForBudgetMonth(filters.month, filters.monthStartDay);
  const byDate = window.BudgetTransactions.summarizeTransactionsByDate(state.transactions, filters.month, filters.monthStartDay);
  const selectedRows = viewState.selectedDate && byDate[viewState.selectedDate] ? byDate[viewState.selectedDate].transactions : [];

  window.BudgetUI.renderSummary(elements, summary, filters.month, period);
  window.BudgetUI.renderList(elements, list);
  window.BudgetUI.renderCalendar(elements, days, byDate, viewState.selectedDate);
  window.BudgetUI.renderCalendarDetails(elements, viewState.selectedDate, selectedRows);
  window.BudgetUI.setActiveTab(elements, viewState.tab);
  elements.calendarPeriodLabel.textContent = `${period.start} ~ ${period.end}`;
}
```

- [ ] **Step 4: 예산과 거래 추가를 remote-first로 전환한다**

In `handleBudgetSubmit`, replace the old persistence call with:

```javascript
if (await persistRemoteFirst(
  result.state,
  () => window.BudgetCloud.saveSettings(result.state),
  elements.budgetMessage,
  event.submitter
)) {
  window.BudgetUI.setMessage(elements.budgetMessage, `${month} 예산을 저장했어요.`, 'ok');
}
```

In `handleCategoryBudgetSubmit`, use the same remote method with the category message:

```javascript
if (await persistRemoteFirst(
  result.state,
  () => window.BudgetCloud.saveSettings(result.state),
  elements.categoryBudgetMessage,
  event.submitter
)) {
  window.BudgetUI.setMessage(elements.categoryBudgetMessage, `${month} 항목별 예산을 저장했어요.`, 'ok');
}
```

In `handleMonthStartSubmit`, replace the old `todayMonth`, `elements.monthInput`, and `persist` block with this remote-first block so the old view month is restored on failure:

```javascript
const previousMonth = viewState.month;
const nextMonth = window.BudgetStorage.monthKeyForDate(window.BudgetStorage.localDateString(), result.state.monthStartDay) || previousMonth;
viewState.month = nextMonth;
const saved = await persistRemoteFirst(
  result.state,
  () => window.BudgetCloud.saveSettings(result.state),
  elements.monthStartMessage,
  event.submitter
);
if (!saved) {
  viewState.month = previousMonth;
  render();
} else {
  window.BudgetUI.setMessage(elements.monthStartMessage, '월 시작일을 저장했어요.', 'ok');
}
```

For transaction add, pass the submit button:

```javascript
if (await persistRemoteFirst(
  result.state,
  () => window.BudgetCloud.insertTransaction(result.transaction),
  elements.formMessage,
  event.submitter
)) {
  elements.transactionForm.reset();
  elements.dateInput.value = window.BudgetStorage.localDateString();
  elements.typeSelect.value = input.type;
  window.BudgetUI.fillCategoryOptions(elements.categorySelect, input.type);
  window.BudgetUI.setMessage(elements.formMessage, '거래를 추가했어요.', 'ok');
}
```

- [ ] **Step 5: 목록 수정·삭제와 수정 저장을 연결한다**

Replace `handleListClick` with:

```javascript
async function handleTransactionAction(event) {
  const button = event.target.closest('[data-action][data-id]');
  if (!button) return;
  const transaction = state.transactions.find((item) => item.id === button.dataset.id);
  if (!transaction) return;
  if (button.dataset.action === 'edit') {
    window.BudgetUI.openEditDialog(elements, transaction, button);
    return;
  }
  if (button.dataset.action !== 'delete') return;
  const label = `${transaction.date} ${transaction.category} ${window.BudgetUI.formatWon(transaction.amount)}`;
  if (!window.confirm(`${label} 내역을 삭제할까요?`)) return;
  const nextState = window.BudgetTransactions.deleteTransaction(state, transaction.id);
  if (await persistRemoteFirst(
    nextState,
    () => window.BudgetCloud.deleteTransaction(transaction.id),
    elements.toolMessage,
    button
  )) {
    window.BudgetUI.setMessage(elements.toolMessage, '거래를 삭제했어요.', 'ok');
  }
}
```

Add:

```javascript
async function handleEditSubmit(event) {
  event.preventDefault();
  window.BudgetUI.clearFieldErrors(elements.editForm);
  const id = elements.editId.value;
  const result = window.BudgetTransactions.updateTransaction(state, id, {
    date: elements.editDate.value,
    type: elements.editType.value,
    category: elements.editCategory.value,
    amount: elements.editAmount.value,
    memo: elements.editMemo.value
  });
  if (!result.ok) {
    window.BudgetUI.showValidationErrors(elements.editForm, elements.editMessage, result.errors);
    return;
  }
  const saved = await persistRemoteFirst(
    result.state,
    () => window.BudgetCloud.updateTransaction(result.transaction),
    elements.editMessage,
    elements.editSave
  );
  if (!saved) return;
  const moved = !window.BudgetStorage.isDateInBudgetMonth(result.transaction.date, viewState.month, state.monthStartDay || 1);
  window.BudgetUI.closeEditDialog(elements);
  window.BudgetUI.setMessage(elements.toolMessage, moved ? '수정했어요. 날짜가 바뀌어 현재 월 목록에서는 보이지 않아요.' : '거래를 수정했어요.', 'ok');
}
```

- [ ] **Step 6: 탭 키보드, 월 이동, 필터, 캘린더 이벤트를 연결한다**

Add handlers using these exact state changes:

```javascript
function changeMonth(delta) {
  viewState.month = window.BudgetStorage.addMonthsToMonth(viewState.month, delta);
  viewState.selectedDate = '';
  render();
}

function selectTab(tab, focus = false) {
  viewState.tab = tab;
  window.BudgetUI.setActiveTab(elements, tab, focus);
}

function handleTabKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index = elements.tabs.indexOf(event.currentTarget);
  const nextIndex = event.key === 'Home' ? 0
    : event.key === 'End' ? elements.tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + elements.tabs.length) % elements.tabs.length;
  selectTab(elements.tabs[nextIndex].dataset.tab, true);
}
```

Export `addMonthsToMonth` from `BudgetStorage`, then bind:

```javascript
elements.tabs.forEach((tab) => {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  tab.addEventListener('keydown', handleTabKeydown);
});
elements.previousMonthButton.addEventListener('click', () => changeMonth(-1));
elements.nextMonthButton.addEventListener('click', () => changeMonth(1));
elements.currentMonthButton.addEventListener('click', () => {
  viewState.month = currentBudgetMonth();
  viewState.selectedDate = '';
  render();
});
elements.monthInput.addEventListener('change', () => {
  if (!window.BudgetStorage.isValidMonthString(elements.monthInput.value)) return;
  viewState.month = elements.monthInput.value;
  viewState.selectedDate = '';
  render();
});
elements.filterType.addEventListener('change', () => {
  window.BudgetUI.fillFilterCategoryOptions(elements.filterCategory, elements.filterType.value, 'all');
  render();
});
elements.filterCategory.addEventListener('change', render);
elements.filterQuery.addEventListener('input', render);
elements.list.addEventListener('click', handleTransactionAction);
elements.calendarDetailList.addEventListener('click', handleTransactionAction);
elements.calendarGrid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="select-date"]');
  if (!button || button.disabled) return;
  viewState.selectedDate = button.dataset.date;
  render();
});
elements.editForm.addEventListener('submit', handleEditSubmit);
elements.editType.addEventListener('change', () => window.BudgetUI.fillCategoryOptions(elements.editCategory, elements.editType.value));
elements.editClose.addEventListener('click', () => window.BudgetUI.closeEditDialog(elements));
elements.editCancel.addEventListener('click', () => window.BudgetUI.closeEditDialog(elements));
elements.editDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  window.BudgetUI.closeEditDialog(elements);
});
```

- [ ] **Step 7: 샘플은 선택 월의 샘플 행만 원격 변경한다**

Replace `handleSampleClick` with:

```javascript
async function handleSampleClick(event) {
  const month = viewState.month;
  const hasSample = window.BudgetTransactions.hasSampleForMonth(state.transactions, month, state.monthStartDay || 1);
  if (hasSample && !window.confirm('선택한 달에 이미 샘플 데이터가 있어요. 기존 샘플만 교체할까요?')) return;
  const nextState = window.BudgetTransactions.createSampleState(state, month, { replace: hasSample });
  const previousSampleIds = state.transactions
    .filter((tx) => tx.source === 'sample' && window.BudgetStorage.isDateInBudgetMonth(tx.date, month, state.monthStartDay || 1))
    .map((tx) => tx.id);
  const previousIds = new Set(state.transactions.map((tx) => tx.id));
  const nextSampleRows = nextState.transactions.filter((tx) => tx.source === 'sample' && !previousIds.has(tx.id));
  const insertedIds = [];
  event.currentTarget.disabled = true;
  try {
    for (const transaction of nextSampleRows) {
      await window.BudgetCloud.insertTransaction(transaction);
      insertedIds.push(transaction.id);
    }
    for (const id of previousSampleIds) {
      await window.BudgetCloud.deleteTransaction(id);
    }
    state = window.BudgetStorage.saveState(nextState).state;
    render();
    window.BudgetUI.setMessage(elements.toolMessage, hasSample ? '선택한 달의 샘플 데이터를 교체했어요.' : '선택한 달에 샘플 데이터를 추가했어요.', 'ok');
  } catch (error) {
    for (const id of insertedIds) {
      try {
        await window.BudgetCloud.deleteTransaction(id);
      } catch (cleanupError) {
        window.console.error('샘플 정리 실패', cleanupError);
      }
    }
    try {
      state = await window.BudgetCloud.downloadState();
      render();
    } catch (reloadError) {
      window.console.error('샘플 실패 후 새로고침 실패', reloadError);
    }
    window.BudgetUI.setMessage(elements.toolMessage, `샘플 저장 실패: ${error.message}`, 'error');
  } finally {
    event.currentTarget.disabled = false;
  }
}
```

- [ ] **Step 8: 확인된 가져오기·초기화만 전체 교체 경로를 사용한다**

Add:

```javascript
function replaceAllRemoteFirst(nextState, messageElement, busyButton) {
  return persistRemoteFirst(
    nextState,
    () => window.BudgetCloud.uploadState(nextState),
    messageElement,
    busyButton
  );
}
```

In `handleImportFile`, replace the old `persist(result.state)` call with:

```javascript
if (await replaceAllRemoteFirst(result.state, elements.toolMessage, elements.importButton)) {
  window.BudgetUI.setMessage(elements.toolMessage, 'JSON 데이터를 가져왔어요.', 'ok');
}
```

Replace the entire reset handler so it does not mutate memory before the remote replacement succeeds:

```javascript
async function handleResetClick(event) {
  if (!window.confirm('모든 가계부 데이터를 삭제하고 기본 예산으로 되돌릴까요?')) return;
  const result = window.BudgetStorage.resetState();
  if (!result.ok) {
    window.BudgetUI.setMessage(elements.toolMessage, '초기화할 데이터를 준비하지 못했어요.', 'error');
    return;
  }
  if (!await replaceAllRemoteFirst(result.state, elements.toolMessage, event.currentTarget)) return;
  elements.categoryBudgetFields.innerHTML = '';
  window.BudgetUI.initDefaults(elements, state);
  viewState.month = currentBudgetMonth();
  viewState.selectedDate = '';
  render();
  window.BudgetUI.setMessage(elements.toolMessage, '전체 데이터를 초기화하고 Supabase에 저장했어요.', 'ok');
}
```

- [ ] **Step 9: 클라우드 다운로드 뒤 월 상태를 다시 맞춘다**

Add:

```javascript
function applyDownloadedState(cloudState) {
  state = window.BudgetStorage.saveState(cloudState).state;
  viewState.month = currentBudgetMonth();
  viewState.selectedDate = '';
  render();
}
```

Use `applyDownloadedState(await window.BudgetCloud.downloadState())` in `loadCloudStateForSignedInUser` and after successful login. Replace `handleCloudDownload` with:

```javascript
async function handleCloudDownload() {
  if (!window.confirm('현재 화면을 최신 클라우드 데이터로 다시 불러올까요?')) return;
  try {
    applyDownloadedState(await window.BudgetCloud.downloadState());
    window.BudgetUI.setMessage(elements.cloudMessage, '클라우드 데이터를 불러왔어요.', 'ok');
  } catch (error) {
    window.BudgetUI.setMessage(elements.cloudMessage, `클라우드 불러오기 실패: ${error.message}`, 'error');
  }
}
```

- [ ] **Step 10: 초기 상태와 미리보기 경고를 설정한다**

In `init`, before the first render:

```javascript
viewState.month = currentBudgetMonth();
window.BudgetUI.fillFilterCategoryOptions(elements.filterCategory, 'all', 'all');
const previewPath = window.location.pathname.startsWith('/beginner-budget-preview/');
elements.previewDataWarning.hidden = !previewPath;
document.body.classList.toggle('has-preview-warning', previewPath);
```

- [ ] **Step 11: 앱 연결 테스트와 syntax check를 실행한다**

Run:

```powershell
node --check js/storage.js
node --check js/app.js
node tests/run-tests.cjs
```

Expected: `24 tests passed`

- [ ] **Step 12: 앱 이벤트 연결을 커밋한다**

```powershell
git add -- js/storage.js js/app.js tests/run-tests.cjs
git commit -m "월별 탭 화면과 거래 수정 흐름 연결"
```

## Task 10: 문서 갱신과 로컬 브라우저 품질 게이트

**Files:**
- Modify: `README.md`
- Modify: `docs/TEST_PLAN.md`
- Modify: `docs/IMPROVEMENT_LOG.md`
- Modify: `docs/README.md`

- [ ] **Step 1: 전체 자동 검증을 실행한다**

Run:

```powershell
node --check js/storage.js
node --check js/transactions.js
node --check js/ui.js
node --check js/app.js
node --check js/cloud.js
node tests/run-tests.cjs
git diff --check
```

Expected: 모든 syntax check가 exit 0, `24 tests passed`, diff 오류 없음.

- [ ] **Step 2: 사용자 문서를 실제 기능에 맞춘다**

Add these exact facts to `README.md` and link the detailed test plan:

```markdown
- 홈·내역·캘린더·설정 탭에서 선택한 월을 함께 사용합니다.
- 내역은 유형, 검색어, 카테고리 하나로 필터링할 수 있습니다.
- 과거 월 거래도 날짜, 유형, 카테고리, 금액, 메모를 수정할 수 있습니다.
- 캘린더에서 날짜별 지출 합계와 거래 건수를 확인할 수 있습니다.
- 데이터는 브라우저 저장소가 아니라 Supabase에 저장됩니다.
- 미리보기 사이트는 운영 데이터를 사용하므로 화면의 경고를 확인해야 합니다.
```

- [ ] **Step 3: 테스트 문서에 데이터 보존 절차를 기록한다**

Add this section to `docs/TEST_PLAN.md`:

```markdown
## 미리보기 운영 데이터 안전 절차

1. 자동 검증 거래 메모는 `$qaMemo = 'QA-' + (Get-Date -Format 'yyyyMMdd-HHmmss')`로 만들며 `QA-20260811-153045` 형태를 사용한다.
2. 거래 추가 후 같은 ID를 수정하고 삭제해 QA 거래를 남기지 않는다.
3. 예산 저장 전 원래 월 예산과 카테고리 예산을 기록하고 검증 직후 같은 값으로 복원한다.
4. 자동 검증에서는 JSON 가져오기와 전체 초기화를 실행하지 않는다.
5. 검증 종료 후 Supabase 다운로드로 QA 메모가 남지 않았는지 확인한다.
```

- [ ] **Step 4: 로컬 서버를 정확한 프로젝트 루트에서 시작하거나 기존 앱 서버를 재사용한다**

Run:

```powershell
$devPort = 8000
try {
  $existing = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$devPort/" -TimeoutSec 3
  if (-not $existing.Content.Contains('<title>처음 가계부</title>')) {
    $devPort = 8001
  }
} catch {
  $existing = $null
}

if (-not $existing -or $devPort -eq 8001) {
  $python = (Get-Command python).Source
  Start-Process -FilePath $python `
    -ArgumentList @('-m', 'http.server', [string]$devPort, '--bind', '127.0.0.1') `
    -WorkingDirectory (Get-Location).Path `
    -WindowStyle Hidden
}

$response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$devPort/" -TimeoutSec 10
Write-Output "url=http://127.0.0.1:$devPort/"
Write-Output "status=$($response.StatusCode)"
Write-Output "app=$($response.Content.Contains('<title>처음 가계부</title>'))"
```

Expected: status `200` and app `True`. If port 8000 belongs to another service, leave that process untouched and use port 8001.

- [ ] **Step 5: Chrome/Playwright 데스크톱 스모크를 수행한다**

Use the URL printed in Step 4 and verify in this order:

```text
login -> download cloud state -> previous month -> next month -> current month
home -> add QA transaction with comma amount -> history -> category filter
edit the same QA transaction -> calendar -> select its date -> delete the QA transaction
settings -> save captured original budget -> restore original budget
console errors = 0
```

Expected: 모든 단계가 성공하고 종료 후 QA 거래가 0건이다.

- [ ] **Step 6: 키보드·스크린리더·360px 스모크를 수행한다**

Verify:

```text
Tab reaches each app tab
ArrowLeft/ArrowRight/Home/End move tab focus
Enter/Space activates a tab
edit dialog receives focus and Escape/cancel returns focus
live region announces save and filter results
360x800 viewport has no document-level horizontal scroll
calendar controls remain selectable at 360px
```

- [ ] **Step 7: 검증 결과를 개선 로그에 기록한다**

Add this exact entry to `docs/IMPROVEMENT_LOG.md` after the checks pass:

```markdown
## 2026-08-11 · 월별 탭, 거래 수정, 캘린더, 미리보기 준비

- 홈·내역·캘린더·설정 탭과 공통 월 탐색을 추가했다.
- 카테고리 단일 필터와 과거 거래 수정을 추가했다.
- 예산 기간 경계를 따르는 날짜별 캘린더를 추가했다.
- 일반 거래 저장을 Supabase 행 단위 변경으로 전환했다.
- 자동 검증: 24 tests passed, JavaScript syntax check 통과, git diff check 통과.
- 브라우저 검증: 데스크톱과 360x800, 키보드 탭·dialog 흐름, 콘솔 오류 0건.
- 데이터 검증: QA 거래 삭제 완료, 변경한 월 예산 원상 복원 완료.
- 예정 미리보기 URL: https://suho-j.github.io/beginner-budget-preview/
```

Add a `docs/TEST_PLAN.md` link to `docs/README.md` if the test plan is not already listed.

- [ ] **Step 8: 문서와 로컬 검증 결과를 커밋한다**

```powershell
git add -- README.md docs/README.md docs/TEST_PLAN.md docs/IMPROVEMENT_LOG.md
git commit -m "가계부 개선 기능과 검증 절차 문서화"
```

## Task 11: 별도 GitHub Pages 미리보기 배포

**Files:**
- External create: `https://github.com/suho-j/beginner-budget-preview`
- External configure: GitHub Pages from `main` `/`

- [ ] **Step 1: 원본 저장소와 최종 커밋을 고정한다**

Run:

```powershell
git status --short --branch
git rev-parse HEAD
git fetch origin
git merge-base --is-ancestor origin/master HEAD
```

Expected: tracked working tree clean, merge-base command exit 0, `.superpowers/` ignored.

- [ ] **Step 2: 미리보기 저장소 존재 여부를 확인한다**

Run:

```powershell
gh auth status
gh api repos/suho-j/beginner-budget-preview
```

Expected before first deployment: authenticated as `suho-j`; repo API returns HTTP 404. If it exists, verify `owner.login` is `suho-j` and continue without recreating it.

- [ ] **Step 3: 비어 있는 공개 미리보기 저장소를 만든다**

Run only when Step 2 returned 404:

```powershell
gh repo create suho-j/beginner-budget-preview --public --description "처음 가계부 기능 개선 미리보기"
```

Expected: `https://github.com/suho-j/beginner-budget-preview` created without changing `origin`.

- [ ] **Step 4: 별도 remote로 검증 커밋을 push한다**

Run:

```powershell
if (-not (git remote | Select-String -SimpleMatch 'preview')) {
  git remote add preview https://github.com/suho-j/beginner-budget-preview.git
}
git push preview guardian/project-setup:main
git remote -v
```

Expected: `preview/main` points to the exact `git rev-parse HEAD` value; `origin` URLs are unchanged.

- [ ] **Step 5: 미리보기 Pages를 활성화한다**

Run:

```powershell
gh api --method POST repos/suho-j/beginner-budget-preview/pages -f 'source[branch]=main' -f 'source[path]=/'
```

If Pages already exists, use:

```powershell
gh api --method PUT repos/suho-j/beginner-budget-preview/pages -f 'source[branch]=main' -f 'source[path]=/'
```

Expected: `html_url` is `https://suho-j.github.io/beginner-budget-preview/`.

- [ ] **Step 6: Pages 빌드 완료와 공개 HTTP를 확인한다**

Run:

```powershell
gh api repos/suho-j/beginner-budget-preview/pages --jq '{status: .status, url: .html_url, branch: .source.branch, path: .source.path}'
$response = Invoke-WebRequest -UseBasicParsing -Uri 'https://suho-j.github.io/beginner-budget-preview/' -TimeoutSec 20
$response.StatusCode
```

Expected: Pages `status` is `built`, source `main` `/`, HTTP `200`.

- [ ] **Step 7: 공개 미리보기에서 운영 데이터 안전 스모크를 수행한다**

At `https://suho-j.github.io/beginner-budget-preview/`, run this exact flow with a new memo generated by `$qaMemo = 'QA-' + (Get-Date -Format 'yyyyMMdd-HHmmss')`:

```text
confirm fixed banner = 개발 화면 · 운영 데이터 사용 중
login -> download production cloud state
capture current selected-month budget and category budgets
previous month -> next month -> current month
home -> add QA transaction with comma amount
history -> select its category -> edit date/category/amount/memo
calendar -> select the edited date -> delete the QA transaction
settings -> save the captured original budget values -> verify they match the snapshot
keyboard Tab/ArrowLeft/ArrowRight/Home/End and dialog Escape focus flow
desktop viewport and 360x800 viewport
console errors = 0
final cloud download -> QA memo count = 0
```

Do not run JSON import or full reset during this smoke test.

- [ ] **Step 8: 운영 배포 전 사용자 승인 게이트에서 멈춘다**

Report:

```text
preview URL
preview commit SHA
automated test count
desktop/mobile/keyboard result
console error count
QA data cleanup result
known limitations
```

Do not push `origin/master` until the user explicitly approves this preview.

## Task 12: 승인된 동일 커밋을 운영에 승격

**Files:**
- External update: `origin/master`
- External verify: `https://suho-j.github.io/beginner-budget/`

- [ ] **Step 1: 사용자 승인을 기록하고 커밋 동일성을 확인한다**

Run only after explicit preview approval:

```powershell
$localSha = git rev-parse HEAD
$previewSha = git ls-remote preview refs/heads/main | ForEach-Object { ($_ -split "`t")[0] }
Write-Output "local=$localSha"
Write-Output "preview=$previewSha"
```

Expected: both SHA values are identical.

- [ ] **Step 2: 운영 브랜치가 예상 기준에서 벗어나지 않았는지 확인한다**

Run:

```powershell
git fetch origin
git merge-base --is-ancestor origin/master HEAD
git log --oneline origin/master..HEAD
$existingTag = git tag --list 'pre-budget-tabs-20260811'
if (-not $existingTag) {
  git tag pre-budget-tabs-20260811 origin/master
}
git rev-parse pre-budget-tabs-20260811
git rev-parse origin/master
```

Expected: merge-base exit 0; log contains only reviewed feature, test, documentation commits; the tag and `origin/master` SHA values are identical.

- [ ] **Step 3: fast-forward 가능한 정확한 커밋을 운영에 push한다**

Run:

```powershell
git push origin guardian/project-setup:master
```

Expected: non-force fast-forward push succeeds. Never use `--force`.

- [ ] **Step 4: 운영 Pages 빌드를 확인한다**

Run:

```powershell
gh api repos/suho-j/beginner-budget/pages --jq '{status: .status, url: .html_url, branch: .source.branch, path: .source.path}'
$response = Invoke-WebRequest -UseBasicParsing -Uri 'https://suho-j.github.io/beginner-budget/' -TimeoutSec 20
$response.StatusCode
```

Expected: source `master` `/`, status `built`, HTTP `200`.

- [ ] **Step 5: 운영 공개 URL에서 최종 스모크를 수행한다**

Verify all tabs, previous/current month navigation, category filter, edit dialog, calendar date detail, login/data download, mobile 360px, keyboard focus, and console errors. Use one unique QA transaction and remove it before finishing. The preview-only data warning must be hidden on the production URL.

- [ ] **Step 6: 운영 실패 시 복구한다**

If a production-only failure is confirmed, revert every promoted commit in one normal rollback commit and push it:

```powershell
git revert --no-commit pre-budget-tabs-20260811..HEAD
git commit -m "가계부 기능 개선 운영 배포 롤백"
git push origin guardian/project-setup:master
```

Then wait for Pages `built` and re-run the production HTTP and smoke checks. Do not reset or force push.

## 최종 검증 체크리스트

- [ ] Spec의 다섯 기능이 모두 구현됐다.
- [ ] 일반 거래 추가·수정·삭제는 한 거래 행만 원격 변경한다.
- [ ] 과거 월 거래 수정·삭제가 동작한다.
- [ ] 캘린더가 사용자 예산 시작일 경계를 존중한다.
- [ ] 탭·dialog·캘린더가 키보드와 스크린리더 이름을 제공한다.
- [ ] `24 tests passed`, 모든 syntax check, `git diff --check`가 통과한다.
- [ ] 로컬과 공개 미리보기에서 데스크톱·360px 검증을 통과한다.
- [ ] QA 거래와 임시 예산 변경이 운영 데이터에 남지 않는다.
- [ ] 사용자 승인 전 운영 `master`는 변경되지 않는다.
- [ ] 사용자 승인 후 미리보기와 운영의 커밋 SHA가 동일하다.
- [ ] 운영 공개 URL에서 최종 스모크와 콘솔 오류 0건을 확인한다.
