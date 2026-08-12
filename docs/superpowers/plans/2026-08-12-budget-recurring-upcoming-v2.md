# Budget Recurring Expenses and Upcoming V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 월간 반복지출 템플릿을 관리하고, 선택한 예산기간의 예정·오늘·지남·기록됨 항목을 홈에서 확인한 뒤 실제 지출 거래로 안전하게 기록하는 V2 미리보기를 `/v2/`에 제공한다.

**Architecture:** 기존 정적 HTML/CSS/Vanilla JS와 Supabase Auth/RLS 구조를 유지한다. 템플릿은 상태의 `recurringExpenseTemplates`로 다루고 Supabase `category_budgets.__recurring_expense_templates` 예약 키에 저장한다. 예정 항목은 선택 예산기간과 실제 거래에서 매번 파생하며 저장하지 않는다. 템플릿 CRUD는 기존 설정 CAS를 재사용하고, 기록 확인은 결정적 거래 ID를 가진 일반 지출 한 건을 remote-first insert한다. V2 미리보기는 V1·운영과 분리된 `preview_v2_*` 객체와 `/v2/` 산출물만 사용한다.

**Tech Stack:** HTML5, CSS3, Vanilla JavaScript IIFE modules, Supabase Auth/PostgREST/PostgreSQL RLS, Node.js dependency-free VM tests, PowerShell, GitHub Pages.

---

## 실행 계약

- 작업 소스: `C:\Users\suho.jung\Documents\beginner-budget\.worktrees\budget-preview-v1`
- 작업 브랜치: `guardian/budget-preview-v2`
- 설계 기준 SHA: `3bdac1ae66460d0e0050904a4858527b2e0d9aad`
- V1 기준 SHA: `2b7d34ff84305fdfe679433bce127993861dffa0`
- 운영 기준 SHA: `0d487df82c86c04266845ba90c3632f6736eb1ee`
- 배포 저장소: `C:\Users\suho.jung\Documents\beginner-budget-preview`
- V1 공개 URL: `https://suho-j.github.io/beginner-budget-preview/v1/`
- V2 공개 URL: `https://suho-j.github.io/beginner-budget-preview/v2/`
- 운영 URL: `https://suho-j.github.io/beginner-budget/`
- 모든 기능 슬라이스는 실패 테스트를 먼저 확인한 뒤 최소 구현, 전체 회귀, diff 검토, 한국어 커밋 순서로 닫는다.
- `origin/master`, 배포 저장소의 `v1/`, 운영 Supabase 객체, V1 `preview_*` 객체는 수정하지 않는다.
- 예정 금액은 실제 수입·지출·잔액·예산 사용률·캘린더 합계에 포함하지 않는다.
- 자동 거래 생성, 은행 연동, 푸시 알림, 주간·연간 반복, 일시정지·종료일은 V2 범위에서 제외한다.
- 이 계획은 [승인된 V2 설계](../specs/2026-08-12-budget-recurring-upcoming-v2-design.md)를 구현한다. 충돌 시 설계 문서가 우선한다.

## 테스트 수 계약

기준 자동 테스트는 67개다. 아래 20개 테스트를 정확히 추가해 최종 출력 `87 tests passed`를 만든다.

1. `testV2StatePromotesV1AndNormalizesRecurringTemplates`
2. `testRecurringTemplateNormalizationDropsInvalidDuplicatesAndCapsAt100`
3. `testRecurringDatesClampLeapYearsAndBudgetBoundaries`
4. `testRecurringTemplateCrudValidatesAndPreservesIdentity`
5. `testRecurringOccurrencesUseDeterministicIdsAndStatuses`
6. `testRecurringTransactionCandidateValidatesWithoutChangingSummaries`
7. `testRecurringImportExportAllowsTemplateOnlyAndRejectsFutureVersion`
8. `testCloudMapsRecurringTemplatesThroughEverySettingsPath`
9. `testCloudRoutesEveryNonProductionOperationToPreviewV2`
10. `testCloudClassifiesOnlyDuplicateTransactionErrors`
11. `testPreviewV2SupabaseSetupCreatesIsolatedRlsObjects`
12. `testPreviewV2SeedAndFiveArgumentCasNeverMutateV1OrProduction`
13. `testAppMarkupProvidesRecurringSectionsAndDialogContracts`
14. `testAppStylesCoverRecurringCardsDialogAndMobile`
15. `testUiRendersRecurringOccurrencesAndTemplatesSafely`
16. `testUiRecurringDialogsAndTemplateFocusFlow`
17. `testAppRecurringTemplateCrudIsRemoteFirst`
18. `testAppRecurringConfirmationSerializesAndPreservesFailureInput`
19. `testAppRecurringDuplicateReloadsWithoutUpsert`
20. `testAppRecurringLifecycleCoversImportResetSampleDownloadAndLogout`

---

### Task 1: 기준 상태와 비변경 경계를 고정한다

**Files:**

- Verify: `docs/superpowers/specs/2026-08-12-budget-recurring-upcoming-v2-design.md`
- Verify: `js/storage.js`
- Verify: `js/transactions.js`
- Verify: `js/cloud.js`
- Verify: `js/ui.js`
- Verify: `js/app.js`
- Verify: `tests/run-tests.cjs`

- [ ] **Step 1: 정확한 브랜치·ancestor·실행 시작 SHA를 확인한다**

```powershell
git status --short --branch
git status --porcelain
git merge-base --is-ancestor 3bdac1ae66460d0e0050904a4858527b2e0d9aad HEAD
if ($LASTEXITCODE -ne 0) { throw '승인된 V2 설계 SHA가 현재 브랜치의 ancestor가 아닙니다.' }
git rev-parse HEAD
git rev-parse guardian/budget-preview-v1
git rev-parse origin/master
```

Expected:

```text
## guardian/budget-preview-v2
<계획 커밋을 포함한 clean 실행 시작 SHA>
2b7d34ff84305fdfe679433bce127993861dffa0
0d487df82c86c04266845ba90c3632f6736eb1ee
```

`git status --porcelain`은 출력이 없어야 하고 ancestor 명령은 종료 코드 0이어야 한다. 현재 `HEAD`는 이 계획을 커밋한 SHA이므로 `3bdac1a`와 같을 필요가 없다. 출력된 HEAD를 실행 시작 SHA로 기록한다.

- [ ] **Step 2: 기준 문법 검사와 테스트를 실행한다**

```powershell
node --check js/storage.js
node --check js/transactions.js
node --check js/cloud.js
node --check js/ui.js
node --check js/app.js
node --check tests/run-tests.cjs
node tests/run-tests.cjs
```

Expected: 여섯 문법 검사가 모두 종료 코드 0이고 마지막 줄이 `67 tests passed`다.

- [ ] **Step 3: V1·운영 비변경 기준을 파일로 기록하지 않고 실행 로그에 남긴다**

```powershell
git diff --check 2b7d34ff84305fdfe679433bce127993861dffa0..HEAD
git status --porcelain
```

Expected: 두 명령 모두 출력이 없다. 이 Task는 코드 변경이나 커밋을 만들지 않는다.

---

### Task 2: V2 상태와 반복지출 정규화·날짜 계산을 추가한다

**Files:**

- Modify: `js/storage.js`
- Modify: `tests/run-tests.cjs`

- [ ] **Step 1: 상태 승격·정규화·말일 테스트 세 개를 추가한다**

`tests/run-tests.cjs`에 다음 계약을 갖는 동기 테스트를 추가하고 수동 등록 배열에도 같은 순서로 넣는다.

VM realm 객체 비교가 의도한 RED보다 먼저 실패하지 않도록 test helper 영역에 다음을 한 번 추가한다.

```js
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}
```

```js
function testV2StatePromotesV1AndNormalizesRecurringTemplates() {
  const { BudgetStorage } = createContext();
  const legacy = BudgetStorage.normalizeState({ version: 1, transactions: [] });
  assert.strictEqual(legacy.version, 2);
  assert.deepStrictEqual(plain(legacy.recurringExpenseTemplates), []);

  const current = BudgetStorage.normalizeState({
    version: 2,
    recurringExpenseTemplates: [{
      id: 'rt-rent', memo: '월세', category: '생활비', amount: 550000,
      dayOfMonth: 31, startsOn: '2026-08-12'
    }],
    transactions: []
  });
  assert.deepStrictEqual(plain(current.recurringExpenseTemplates[0]), {
    id: 'rt-rent', memo: '월세', category: '생활비', amount: 550000,
    dayOfMonth: 31, startsOn: '2026-08-12'
  });
}
```

`testRecurringTemplateNormalizationDropsInvalidDuplicatesAndCapsAt100`은 다음을 한 번에 검증한다.

- `^rt-[A-Za-z0-9._:-]+$`에 맞지 않는 ID는 재발급하지 않고 삭제한다.
- 같은 ID의 뒤 항목은 삭제한다.
- 빈/81자 메모, 수입 카테고리, 0·DB 정수 상한 초과 금액, 0·32일, 잘못된 `startsOn`은 삭제한다.
- 유효 항목은 입력 순서를 유지하며 최대 100개만 남긴다.
- `startsOn`과 `dayOfMonth`은 임의로 현재 날짜나 말일로 바꾸지 않는다.

`testRecurringDatesClampLeapYearsAndBudgetBoundaries`은 아래를 검증한다.

```js
assert.strictEqual(BudgetStorage.scheduledDateForMonth('2024-02', 31), '2024-02-29');
assert.strictEqual(BudgetStorage.scheduledDateForMonth('2025-02', 31), '2025-02-28');
assert.strictEqual(BudgetStorage.scheduledDateForMonth('2025-03', 31), '2025-03-31');
assert.strictEqual(BudgetStorage.scheduledDateForMonth('2026-06', 5), '2026-06-05');
```

- [ ] **Step 2: 새 테스트가 실패하는지 확인한다**

```powershell
node tests/run-tests.cjs
```

Expected: 첫 실패가 `version` 1/2 불일치 또는 `scheduledDateForMonth is not a function`이며 `67 tests passed`가 출력되지 않는다.

- [ ] **Step 3: 저장 상태 V2 계약을 최소 구현한다**

`js/storage.js` 상단에 다음 상수를 둔다.

```js
const CURRENT_STATE_VERSION = 2;
const MAX_RECURRING_EXPENSE_TEMPLATES = 100;
const RECURRING_TEMPLATE_ID_PATTERN = /^rt-[A-Za-z0-9._:-]+$/;
```

`defaultState()`는 다음 필드를 포함한다.

```js
return {
  version: CURRENT_STATE_VERSION,
  monthlyBudget: DEFAULT_BUDGET,
  categoryBudgets: {},
  monthStartDay: DEFAULT_MONTH_START_DAY,
  monthlyBudgets: {},
  recurringExpenseTemplates: [],
  transactions: []
};
```

정규화 함수의 책임을 다음처럼 분리한다.

```js
function normalizeRecurringExpenseTemplate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const memo = typeof raw.memo === 'string' ? raw.memo.trim() : '';
  const category = normalizeExpenseCategory(String(raw.category || '').trim());
  const amount = Number(raw.amount);
  const dayOfMonth = Number(raw.dayOfMonth);
  const startsOn = typeof raw.startsOn === 'string' ? raw.startsOn : '';
  if (!RECURRING_TEMPLATE_ID_PATTERN.test(id)
    || !memo || memo.length > MAX_MEMO_LENGTH
    || !EXPENSE_CATEGORIES.includes(category)
    || !isPositiveInteger(amount)
    || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31
    || !isValidDateString(startsOn)) return null;
  return { id, memo, category, amount, dayOfMonth, startsOn };
}

function normalizeRecurringExpenseTemplates(rawTemplates) {
  if (!Array.isArray(rawTemplates)) return [];
  const seen = new Set();
  return rawTemplates.map(normalizeRecurringExpenseTemplate).filter((template) => {
    if (!template || seen.has(template.id) || seen.size >= MAX_RECURRING_EXPENSE_TEMPLATES) return false;
    seen.add(template.id);
    return true;
  });
}
```

`normalizeState()`는 `state.recurringExpenseTemplates`를 채우고 언제나 `version: 2`를 반환한다. `createId()`는 기존 호출을 깨지 않도록 기본 접두사를 유지한다.

```js
function createId(prefix = 'tx') {
  const suffix = window.crypto && typeof window.crypto.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  return `${prefix}-${suffix}`;
}
```

날짜 함수는 원래 반복일을 수정하지 않고 결과 날짜만 clamp한다.

```js
function scheduledDateForMonth(month, dayOfMonth) {
  if (!isValidMonthString(month) || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return '';
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return `${month}-${pad2(Math.min(dayOfMonth, lastDay))}`;
}
```

새 상수와 함수는 `window.BudgetStorage`에 공개한다.

- [ ] **Step 4: 관련 테스트와 전체 회귀를 통과시킨다**

```powershell
node --check js/storage.js
node --check tests/run-tests.cjs
node tests/run-tests.cjs
git diff --check
```

Expected: `70 tests passed`.

- [ ] **Step 5: 변경 범위를 검토하고 커밋한다**

```powershell
git diff -- js/storage.js tests/run-tests.cjs
git add js/storage.js tests/run-tests.cjs
git diff --cached --check
git commit -m "반복지출 상태와 날짜 정규화 추가"
```

---

### Task 3: 템플릿 CRUD와 예정 발생 도메인을 추가한다

**Files:**

- Modify: `js/transactions.js`
- Modify: `tests/run-tests.cjs`

- [ ] **Step 1: CRUD·발생·확정 후보 테스트 세 개를 추가한다**

`testRecurringTemplateCrudValidatesAndPreservesIdentity`은 다음을 검증한다.

- 신규 추가는 `BudgetStorage.createId('rt')`와 오늘 로컬 날짜를 `startsOn`으로 사용한다.
- 메모·카테고리·금액·반복일은 기존 입력 규칙과 동일한 오류 객체를 돌려준다.
- 100개에서 추가는 명시적 오류가 된다.
- 수정은 `id`와 `startsOn`을 보존하고 네 사용자 필드만 바꾼다.
- 삭제는 해당 템플릿만 제거하고 기존 확정 거래를 건드리지 않는다.

`testRecurringOccurrencesUseDeterministicIdsAndStatuses`은 시작일 25일 예산기간 `2026-05-25..2026-06-24`에서 5일 occurrence만 `2026-06-05`로 포함하고 인접 기간에 중복되지 않음을 검증한다. 오늘 `2026-06-05` 기준으로 각 상태를 모두 만든다.

```js
assert.deepStrictEqual(
  occurrences.map(({ scheduledDate, status }) => [scheduledDate, status]),
  [
    ['2026-06-01', 'overdue'],
    ['2026-06-05', 'today'],
    ['2026-06-10', 'upcoming'],
    ['2026-05-26', 'recorded']
  ]
);
```

`recorded`는 날짜·금액이 수정된 거래라도 결정적 ID가 같으면 유지하며 실제 거래를 `transaction` 필드로 제공한다. 정렬은 미기록 `overdue → today → upcoming`을 날짜순으로 먼저, `recorded`를 뒤에 둔다.

같은 상태 안에서는 `scheduledDate → memo` 오름차순으로 정렬한다. 기록 거래를 만든 뒤 템플릿의 `dayOfMonth`을 바꾸더라도 같은 template ID와 scheduled month의 결정적 거래가 있으면 그 달은 계속 `recorded`여야 한다. 이 회귀도 같은 테스트에 포함한다.

`testRecurringTransactionCandidateValidatesWithoutChangingSummaries`은 확정 전 요약이 불변이고 후보가 다음 모양인지 확인한다.

```js
{
  id: 'tx-recurring-rt-rent-2026-06',
  date: '2026-06-05',
  type: 'expense',
  category: '생활비',
  amount: 550000,
  memo: '월세',
  source: 'user'
}
```

- [ ] **Step 2: 새 테스트의 RED를 확인한다**

```powershell
node tests/run-tests.cjs
```

Expected: `addRecurringExpenseTemplate is not a function` 또는 첫 새 API 누락으로 실패한다.

- [ ] **Step 3: 템플릿 입력과 CRUD를 구현한다**

`js/transactions.js`에 아래 공개 API를 추가한다.

```js
canonicalizeRecurringExpenseTemplateInput(input)
validateRecurringExpenseTemplate(input)
addRecurringExpenseTemplate(state, input, today)
updateRecurringExpenseTemplate(state, id, input)
deleteRecurringExpenseTemplate(state, id)
```

신규 추가만 다음을 만든다.

```js
const template = {
  id: window.BudgetStorage.createId('rt'),
  memo: validation.value.memo,
  category: validation.value.category,
  amount: validation.value.amount,
  dayOfMonth: validation.value.dayOfMonth,
  startsOn: window.BudgetStorage.localDateString(today || new Date())
};
```

수정은 기존 객체에서 `id`, `startsOn`을 명시적으로 다시 덮어써 보존한다. 삭제는 거래 배열을 변경하지 않는다.

- [ ] **Step 4: 예정 발생과 결정적 거래 후보를 구현한다**

공개 API는 다음과 같다.

```js
recurringTransactionId(templateId, scheduledMonth)
deriveRecurringExpenseOccurrences(state, budgetMonth, today)
addRecurringExpenseTransaction(state, occurrence, input)
```

결정적 ID는 원래 예정 월을 기준으로 한다.

```js
function recurringTransactionId(templateId, scheduledMonth) {
  return `tx-recurring-${templateId}-${scheduledMonth}`;
}
```

`deriveRecurringExpenseOccurrences()`는 다음 순서로 계산한다.

1. `periodRangeForMonth(budgetMonth, state.monthStartDay)`을 구한다.
2. 기간 시작 달부터 종료 달까지 달 목록을 만든다.
3. 각 템플릿과 달의 `scheduledDateForMonth()`를 만든다.
4. `scheduledDate >= startsOn`이며 예산기간 안인 후보만 남긴다.
5. 결정적 ID로 실제 거래를 찾는다.
6. 실제 거래가 있으면 무조건 `recorded`, 없으면 오늘과 비교해 `overdue/today/upcoming`을 정한다.
7. occurrence에 `templateId`, `scheduledMonth`, `scheduledDate`, `transactionId`, `memo`, `category`, `amount`, `status`, `transaction`을 넣는다.

`addRecurringExpenseTransaction()`은 occurrence의 template ID·scheduled month·결정적 ID가 현재 상태에서 다시 파생한 값과 일치하는지 먼저 확인한다. 그 뒤 dialog 입력을 기존 `validateTransaction()`으로 검증하되 `type: 'expense'`, 결정적 `id`, `source: 'user'`를 강제한다. 이미 같은 ID가 로컬에 있으면 오류를 반환하고 요약 함수를 호출하거나 수정하지 않는다.

- [ ] **Step 5: 도메인 테스트와 전체 회귀를 통과시킨다**

```powershell
node --check js/transactions.js
node --check tests/run-tests.cjs
node tests/run-tests.cjs
git diff --check
```

Expected: `73 tests passed`.

- [ ] **Step 6: 커밋한다**

```powershell
git add js/transactions.js tests/run-tests.cjs
git diff --cached --check
git commit -m "반복지출 예정 발생과 확정 후보 추가"
```

---

### Task 4: 가져오기·내보내기와 상태 수명주기 계약을 확장한다

**Files:**

- Modify: `js/transactions.js`
- Modify: `tests/run-tests.cjs`

- [ ] **Step 1: V2 백업 회귀 테스트를 추가한다**

`testRecurringImportExportAllowsTemplateOnlyAndRejectsFutureVersion`에 다음 사례를 모두 넣는다.

- V2 export JSON에 템플릿과 결정적 확정 거래 ID가 그대로 있다.
- `version: 1` 또는 버전 누락 백업은 템플릿 `[]`로 승격된다.
- 거래 0건·템플릿 1건 백업은 성공한다.
- 거래 0건·템플릿 0건 백업은 기존 데이터를 지우지 않도록 거부한다.
- `version: 3`은 정규화 전에 거부해 모르는 필드를 조용히 버리지 않는다.
- summary에 `sourceTransactionCount`, `importedTransactionCount`, `skippedTransactionCount`, `sourceTemplateCount`, `importedTemplateCount`, `skippedTemplateCount`가 있다. 기존 호출자를 깨지 않도록 `sourceCount`, `importedCount`, `skippedCount`는 거래 건수 alias로 유지한다.
- `createSampleState()`는 기존 템플릿을 보존하고 `defaultState()`는 템플릿을 비운다.

- [ ] **Step 2: 미래 버전/템플릿 전용 백업의 RED를 확인한다**

```powershell
node tests/run-tests.cjs
```

Expected: 템플릿 전용 백업이 기존 “거래 내역이 없어요” 오류로 실패한다.

- [ ] **Step 3: import/export 계약을 최소 수정한다**

`importState()`는 JSON 파싱 직후 다음을 먼저 검사한다.

```js
const sourceVersion = parsed.version === undefined ? 1 : Number(parsed.version);
if (!Number.isInteger(sourceVersion) || sourceVersion > window.BudgetStorage.CURRENT_STATE_VERSION) {
  return { ok: false, state: null, errors: [error('importData', '이 앱보다 새로운 버전의 백업이라 가져올 수 없어요.')] };
}
```

원본 배열이 아니면 각각 빈 배열로 취급하되 둘 다 비었을 때만 거부한다. 정규화 후에도 두 배열이 모두 비었을 때 거부한다. summary는 두 종류의 원본/성공/제외 건수를 별도로 제공하고 기존 거래 건수 alias 세 개도 유지한다.

`createSampleState()`의 상태 spread가 템플릿을 보존한다는 사실을 회귀 테스트로 고정하고 별도 복사 로직은 추가하지 않는다.

- [ ] **Step 4: 전체 테스트를 통과시키고 커밋한다**

```powershell
node --check js/transactions.js
node tests/run-tests.cjs
git diff --check
git add js/transactions.js tests/run-tests.cjs
git diff --cached --check
git commit -m "V2 반복지출 백업 수명주기 보강"
```

Expected before commit: `74 tests passed`.

---

### Task 5: V2 클라우드 라우팅·예약 키·중복 분류를 추가한다

**Files:**

- Modify: `js/cloud.js`
- Modify: `tests/run-tests.cjs`

- [ ] **Step 1: 클라우드 매핑·라우팅·중복 테스트 세 개를 추가한다**

`testCloudMapsRecurringTemplatesThroughEverySettingsPath`은 동일 템플릿 배열이 다음 세 경로에 보존됨을 검증한다.

- `saveSettings()` payload의 `category_budgets.__recurring_expense_templates`
- `uploadState()`의 `p_category_budgets.__recurring_expense_templates`
- `downloadState()` 결과의 `recurringExpenseTemplates`

동시에 `normalizeCategoryBudgets()` 결과에는 예약 키가 나타나지 않아야 한다.

`testCloudRoutesEveryNonProductionOperationToPreviewV2`은 다음 location 각각에서 download/save/insert/update/delete/upload가 오직 V2 객체를 호출하는지 확인한다.

```text
http://localhost:8765/
http://127.0.0.1:8765/
https://suho-j.github.io/beginner-budget-preview/v2/
https://suho-j.github.io/beginner-budget-preview/v2
https://example.com/staging/
file:///C:/budget/index.html
```

정확한 `https://suho-j.github.io/beginner-budget/`만 운영 객체를 사용한다. V2 브랜치에서는 V1 `preview_budget_settings`, `preview_transactions`, `replace_preview_budget_state` 호출이 0회다.

`testCloudClassifiesOnlyDuplicateTransactionErrors`은 오직 `error.code === '23505'`만 true이며 `40001`, HTTP 409 문자열, 메시지에 duplicate만 있는 오류는 false인지 검증한다.

RED를 실행하기 전에 `createSupabaseFake()`가 V2 호출을 관찰할 수 있게 `settingsTables`에 `preview_v2_budget_settings`를 추가하고 기본 RPC 성공 목록에 `replace_preview_v2_budget_state`를 추가한다. 이 fake 준비 자체로 production 코드 테스트가 통과해서는 안 되며, 라우팅 assertion이 V1 table/RPC를 정확히 RED로 잡아야 한다.

- [ ] **Step 2: V1 preview 라우팅의 RED를 확인한다**

```powershell
node tests/run-tests.cjs
```

Expected: 첫 비운영 호출의 table이 `preview_budget_settings`라서 실패한다.

- [ ] **Step 3: V2 격리 상수와 예약 키 매핑을 구현한다**

운영 exact-origin 판정과 기존 `ENVIRONMENT.isPreview/stateRpc` 공개 모양은 그대로 유지하고 비운영 값만 V2로 바꾼다.

```js
const IS_PRODUCTION = runtimeOrigin === 'https://suho-j.github.io'
  && runtimePathname === '/beginner-budget/';
const IS_PREVIEW = !IS_PRODUCTION;
const SETTINGS_TABLE = IS_PREVIEW ? 'preview_v2_budget_settings' : 'budget_settings';
const TRANSACTIONS_TABLE = IS_PREVIEW ? 'preview_v2_transactions' : 'transactions';
const STATE_REPLACEMENT_RPC = IS_PREVIEW
  ? 'replace_preview_v2_budget_state'
  : 'replace_budget_state';
const ENVIRONMENT = Object.freeze({
  name: IS_PREVIEW ? 'preview-v2' : 'production',
  isPreview: IS_PREVIEW,
  settingsTable: SETTINGS_TABLE,
  transactionsTable: TRANSACTIONS_TABLE,
  stateRpc: STATE_REPLACEMENT_RPC
});
```

중복된 예약 키 조립을 피하기 위해 공용 헬퍼를 둔다.

```js
function categoryBudgetsToRemote(state) {
  const normalized = window.BudgetStorage.normalizeState(state);
  return {
    ...normalized.categoryBudgets,
    __month_start_day: normalized.monthStartDay,
    __monthly_budgets: normalized.monthlyBudgets || {},
    __recurring_expense_templates: normalized.recurringExpenseTemplates || []
  };
}
```

`stateToRemote()`와 `replacementArgsForState()`가 이 헬퍼를 사용하고 `remoteToState()`가 예약 키를 `recurringExpenseTemplates`로 꺼낸다. `saveSettings()`와 전체 교체가 서로 다른 구조를 만들면 안 된다.

```js
function isDuplicateTransactionError(error) {
  return Boolean(error && String(error.code) === '23505');
}
```

이 함수만 `BudgetCloud`에 공개하며 `insertTransaction()`은 계속 순수 insert여야 한다. upsert나 overwrite fallback을 추가하지 않는다.

- [ ] **Step 4: 전체 테스트를 통과시키고 커밋한다**

```powershell
node --check js/cloud.js
node tests/run-tests.cjs
git diff --check
git add js/cloud.js tests/run-tests.cjs
git diff --cached --check
git commit -m "V2 미리보기 클라우드 경로와 예약 키 격리"
```

Expected before commit: `77 tests passed`.

---

### Task 6: V2 전용 Supabase RLS·seed·CAS SQL을 만든다

**Files:**

- Create: `docs/supabase-preview-v2-setup.sql`
- Modify: `tests/run-tests.cjs`
- Verify only: `docs/supabase-preview-setup.sql`
- Verify only: `docs/supabase-setup.sql`

- [ ] **Step 1: V2 SQL 구조 테스트 두 개를 추가한다**

`testPreviewV2SupabaseSetupCreatesIsolatedRlsObjects`은 새 SQL에 다음 정확한 객체가 있고 각 이름이 V1과 겹치지 않는지 검사한다.

```text
public.preview_v2_budget_settings
public.preview_v2_transactions
public.preview_v2_seed_metadata
public.set_preview_v2_budget_settings_updated_at
public.replace_preview_v2_budget_state
production_snapshot_v2
```

또한 다음을 검사한다.

- 두 테이블 RLS enabled
- `preview_v2_transactions` primary key는 `(user_id, id)`이며 같은 deterministic ID를 다른 사용자가 각각 가질 수 있음
- `auth.uid() = user_id` 기반 정책
- public/anon/authenticated `REVOKE ALL`이 최소 GRANT보다 먼저 존재
- settings는 SELECT/INSERT/UPDATE, transactions는 SELECT/INSERT/UPDATE/DELETE만 authenticated에 부여
- trigger function과 RPC의 public/anon execute가 회수됨
- RPC는 authenticated만 실행 가능
- 설정 `updated_at` 단조 증가 trigger
- 구 preview_v2 RPC overload drop

`testPreviewV2SeedAndFiveArgumentCasNeverMutateV1OrProduction`은 다음을 검사한다.

- 설정 버전·기대 거래 JSON을 포함한 5인자 RPC
- stale state `40001`
- transaction-table-first lock order와 원자적 delete/insert
- seed metadata lock → marker fresh check → production/preview_v2 transactions → production/preview_v2 settings lock 순서
- 5인자 RPC도 `preview_v2_transactions` table lock을 settings row `FOR UPDATE`보다 먼저 잡아 seed와 동일한 transaction-first 순서를 사용
- 운영 ID 결정적 migration 후보와 mapped↔mapped, mapped↔existing 충돌 guard
- 두 테이블 insert 후 양방향 canonical 비교, marker insert, commit 순서
- marker가 있으면 seed DML 전에 return
- 운영 객체는 seed의 SELECT/LOCK 외에 ALTER/UPDATE/DELETE/GRANT/REVOKE 대상이 아님
- V1 `preview_budget_settings`, `preview_transactions`, `replace_preview_budget_state`, `production_snapshot_v1`이 생성·변경 대상이 아님

- [ ] **Step 2: 새 SQL 파일 부재의 RED를 확인한다**

```powershell
node tests/run-tests.cjs
```

Expected: `ENOENT ... docs/supabase-preview-v2-setup.sql`.

- [ ] **Step 3: V1 SQL을 기반으로 V2 전용 파일을 만든다**

`docs/supabase-preview-setup.sql`의 안전한 구조를 복제하되 아래 심볼을 정확히 바꾼다.

| V1 | V2 |
|---|---|
| `preview_budget_settings` | `preview_v2_budget_settings` |
| `preview_transactions` | `preview_v2_transactions` |
| `preview_seed_metadata` | `preview_v2_seed_metadata` |
| `set_preview_budget_settings_updated_at` | `set_preview_v2_budget_settings_updated_at` |
| `replace_preview_budget_state` | `replace_preview_v2_budget_state` |
| `production_snapshot_v1` | `production_snapshot_v2` |

정책·trigger 이름도 `preview_v2_` 접두사로 고유하게 만든다. `preview_v2_transactions`는 전역 `id text primary key`를 복제하지 않고 `primary key (user_id, id)`를 사용한다. ID canonical CHECK는 그대로 유지하고, seed와 RPC의 duplicate/collision group은 `user_id, id` 단위로 검사한다. 따라서 같은 백업을 두 QA 사용자에게 가져와도 각 사용자는 같은 deterministic ID를 한 번씩 저장할 수 있고, 같은 사용자의 두 번째 저장만 `23505`다. 복사된 V1 설정에는 예약 키가 없을 수 있으며 앱 정규화가 빈 배열로 승격하므로 seed가 임의 템플릿을 만들지 않는다.

SQL은 한 번에 실행 가능한 순서를 유지한다.

1. extension·V2 tables·constraints
2. invalid legacy ID deterministic mapping과 충돌 preflight
3. RLS·최소 권한·trigger
4. explicit transaction의 일회 seed
5. 5인자 CAS RPC와 overload cleanup
6. verification queries

5인자 시그니처는 기존 앱 계약과 같아야 한다.

```sql
replace_preview_v2_budget_state(
  p_monthly_budget integer,
  p_category_budgets jsonb,
  p_transactions jsonb,
  p_expected_updated_at timestamptz,
  p_expected_transactions jsonb
)
```

5인자 RPC 내부 lock은 JSON 입력 검증 후 `lock table public.preview_v2_transactions in share row exclusive mode;`를 먼저 실행하고, 그 다음 settings row를 `FOR UPDATE`한다. seed도 metadata 이후 transaction tables를 settings tables보다 먼저 잠근다. 두 경로를 반대 순서로 구현하지 않는다.

- [ ] **Step 4: SQL 구조와 V1 비변경을 검증한다**

```powershell
node tests/run-tests.cjs
git diff --check
git diff --exit-code 2b7d34ff84305fdfe679433bce127993861dffa0 -- docs/supabase-preview-setup.sql docs/supabase-setup.sql
```

Expected: `79 tests passed`; 마지막 명령은 출력 없이 종료 코드 0이다.

- [ ] **Step 5: 커밋한다**

```powershell
git add docs/supabase-preview-v2-setup.sql tests/run-tests.cjs
git diff --cached --check
git commit -m "V2 미리보기 Supabase 격리 SQL 추가"
```

---

### Task 7: 반복지출 마크업과 360px 스타일 계약을 추가한다

**Files:**

- Modify: `index.html`
- Modify: `css/style.css`
- Modify: `tests/run-tests.cjs`

- [ ] **Step 1: 마크업과 CSS 계약 테스트 두 개를 추가한다**

`testAppMarkupProvidesRecurringSectionsAndDialogContracts`은 DOM 구조를 파싱해 다음을 검증한다.

- 기존 탭은 정확히 4개이며 새 탭이 없다.
- 홈 요약 뒤, 일반 거래 입력 전에 `#recurring-upcoming-section`이 있다.
- `#recurring-upcoming-summary`는 `role="status" aria-live="polite" aria-atomic="true"`다.
- `#recurring-upcoming-list`와 빈 상태가 있다.
- 설정의 항목별 예산 뒤, 데이터 도구 전에 `#recurring-template-section`이 있다.
- `#recurring-template-form`은 memo/category/amount/day 입력의 label·description·error target을 가진다.
- 템플릿 폼과 확인 dialog의 submit 버튼은 `data-cloud-write` 계약을 가진다. 취소 버튼은 쓰기 버튼으로 표시하지 않는다.
- `#recurring-confirm-dialog`는 native dialog, labelledby, form, 실제 날짜·금액·카테고리·메모 입력, status message, cancel/save 버튼을 가진다.
- 템플릿/확인 status는 `tabindex="-1"`이라 원격 오류 포커스를 받을 수 있다.
- 모든 ID가 유일하고 모든 label/ARIA 참조가 해소된다.

`testAppStylesCoverRecurringCardsDialogAndMobile`은 실제 selector/declaration을 검사한다.

- 카드의 `min-width: 0`, 긴 텍스트 `overflow-wrap: anywhere`
- 상태 badge 4개를 색상 이외 텍스트로도 구분
- 모든 action 최소 높이 44px
- dialog의 `overscroll-behavior: contain`, `100dvh` fallback
- 확인 dialog의 데스크톱 폭은 `min(760px, calc(100% - 2rem))` 수준의 거의 전체 폭이며 모바일은 `calc(100% - 1rem)`
- 360px media query에서 카드 action wrap/세로 배치와 document horizontal overflow 방지
- `:focus-visible` 고대비 outline

- [ ] **Step 2: 마크업 부재의 RED를 확인한다**

```powershell
node tests/run-tests.cjs
```

Expected: `recurring-upcoming-section` 또는 첫 필수 ID 누락으로 실패한다.

- [ ] **Step 3: 홈·설정·확인 dialog 마크업을 추가한다**

홈 section은 실제 합계와 구분되는 설명을 명시한다.

```html
<section class="panel recurring-upcoming" id="recurring-upcoming-section" aria-labelledby="recurring-upcoming-heading">
  <div class="section-heading-row">
    <div>
      <h2 id="recurring-upcoming-heading" tabindex="-1">예정된 반복지출</h2>
      <p class="hint">예정 금액은 실제 사용액에 포함되지 않아요.</p>
    </div>
    <p id="recurring-upcoming-summary" role="status" aria-live="polite" aria-atomic="true"></p>
  </div>
  <p id="recurring-upcoming-empty" class="empty-state">이 기간에 예정된 반복지출이 없어요. 설정에서 반복지출을 등록할 수 있어요.</p>
  <div id="recurring-upcoming-list" class="recurring-list"></div>
</section>
```

설정 폼은 `이름`, `카테고리`, `예상 금액`, `매월 결제일`만 노출하고 `startsOn`·ID는 숨긴다. 정확한 ID/getElements 키는 `recurringTemplateForm`, `recurringTemplateMemo`, `recurringTemplateCategory`, `recurringTemplateAmount`, `recurringTemplateDay`, `recurringTemplateSave`, `recurringTemplateCancel`, `recurringTemplateMessage`, `recurringTemplateList`, `recurringTemplateEmpty`, `recurringTemplateHeading`으로 고정한다. 각 입력은 `recurring-template-memo/category/amount/day`, 폼·메시지·목록·빈 상태·heading은 같은 camelCase 키의 kebab-case ID를 쓴다. 편집 취소 버튼은 초기 hidden이며 폼 status `#recurring-template-message`는 `tabindex="-1"`로 결과 포커스를 받을 수 있다. 템플릿 수정·삭제가 기존 거래를 바꾸지 않고, 확정 거래를 삭제하면 예정 건이 다시 나타난다는 짧은 도움말을 둔다.

```html
<section class="panel" id="recurring-template-section" aria-labelledby="recurring-template-heading">
  <h2 id="recurring-template-heading" tabindex="-1">반복지출 설정</h2>
  <p id="recurring-template-help" class="hint">매달 예상되는 지출을 등록해요. 이미 기록한 거래는 템플릿을 바꿔도 유지돼요.</p>
  <form id="recurring-template-form" class="transaction-form" novalidate>
    <div class="field full"><label for="recurring-template-memo">이름</label><input id="recurring-template-memo" name="memo" maxlength="80" required aria-describedby="recurring-template-help recurring-template-message"></div>
    <div class="field"><label for="recurring-template-category">카테고리</label><select id="recurring-template-category" name="category" required aria-describedby="recurring-template-message"></select></div>
    <div class="field"><label for="recurring-template-amount">예상 금액</label><input id="recurring-template-amount" name="amount" type="text" inputmode="numeric" pattern="[0-9,]*" required aria-describedby="recurring-template-message"></div>
    <div class="field"><label for="recurring-template-day">매월 결제일</label><input id="recurring-template-day" name="dayOfMonth" type="number" inputmode="numeric" min="1" max="31" step="1" required aria-describedby="recurring-template-message"></div>
    <div class="form-actions full"><button id="recurring-template-save" type="submit" data-cloud-write>반복지출 등록</button><button id="recurring-template-cancel" type="button" class="secondary" hidden>수정 취소</button></div>
  </form>
  <p id="recurring-template-message" class="message" role="status" aria-live="polite" tabindex="-1"></p>
  <p id="recurring-template-empty" class="empty-state">등록한 반복지출이 없어요.</p>
  <div id="recurring-template-list" class="recurring-list"></div>
</section>
```

확인 dialog는 `recurringConfirmDialog`, `recurringConfirmForm`, `recurringConfirmHeading`, `recurringConfirmScheduledDate`, `recurringConfirmDate`, `recurringConfirmAmount`, `recurringConfirmCategory`, `recurringConfirmMemo`, `recurringConfirmMessage`, `recurringConfirmSave`, `recurringConfirmCancel` getElements 키와 동일한 kebab-case ID를 사용한다. 원래 예정일은 `#recurring-confirm-scheduled-date` 설명 text로 표시하되 사용자는 실제 날짜·금액·카테고리·메모를 수정할 수 있다. `#recurring-confirm-message`는 `tabindex="-1"`이다. 이 입력 변경은 결정적 occurrence ID를 바꾸지 않는다.

```html
<dialog id="recurring-confirm-dialog" aria-labelledby="recurring-confirm-heading">
  <form id="recurring-confirm-form" class="transaction-form dialog-form" method="dialog" novalidate>
    <div class="dialog-heading full"><h2 id="recurring-confirm-heading">반복지출 기록 확인</h2><button id="recurring-confirm-cancel" type="button" class="secondary">닫기</button></div>
    <p class="hint full">원래 예정일: <strong id="recurring-confirm-scheduled-date"></strong></p>
    <div class="field"><label for="recurring-confirm-date">사용일</label><input id="recurring-confirm-date" name="date" type="date" required aria-describedby="recurring-confirm-message"></div>
    <div class="field"><label for="recurring-confirm-amount">실제 금액</label><input id="recurring-confirm-amount" name="amount" type="text" inputmode="numeric" pattern="[0-9,]*" required aria-describedby="recurring-confirm-message"></div>
    <div class="field"><label for="recurring-confirm-category">카테고리</label><select id="recurring-confirm-category" name="category" required aria-describedby="recurring-confirm-message"></select></div>
    <div class="field full"><label for="recurring-confirm-memo">메모</label><input id="recurring-confirm-memo" name="memo" maxlength="80" aria-describedby="recurring-confirm-message"></div>
    <p id="recurring-confirm-message" class="message full" role="status" aria-live="polite" tabindex="-1"></p>
    <div class="form-actions full"><button id="recurring-confirm-save" type="submit" data-cloud-write>지출로 기록</button></div>
  </form>
</dialog>
```

- [ ] **Step 4: 기존 시각 언어를 재사용해 CSS를 추가한다**

새 selector는 `.recurring-*` 범위로 한정한다. 전역 `button`이나 기존 calendar/dialog 규칙을 덮어쓰지 않는다. 최소 선언은 `.recurring-list { display:grid; gap:.75rem; }`, `.recurring-card { min-width:0; overflow-wrap:anywhere; }`, `.recurring-card-actions { display:flex; flex-wrap:wrap; gap:.5rem; }`, `.recurring-card-actions button { min-height:44px; }`, `#recurring-confirm-dialog { width:min(760px, calc(100% - 2rem)); }`다. 559px 이하에서는 `.recurring-card-actions { display:grid; grid-template-columns:1fr; }`와 `#recurring-confirm-dialog { width:calc(100% - 1rem); }`를 사용한다. 스크롤 가능한 dialog는 기존 `overscroll-behavior: contain`과 `100dvh` 계약을 상속한다.

- [ ] **Step 5: 테스트와 diff를 통과시키고 커밋한다**

```powershell
node tests/run-tests.cjs
git diff --check
git add index.html css/style.css tests/run-tests.cjs
git diff --cached --check
git commit -m "반복지출 예정 목록과 설정 화면 골격 추가"
```

Expected before commit: `81 tests passed`.

---

### Task 8: 안전한 UI 렌더러와 dialog 포커스 흐름을 추가한다

**Files:**

- Modify: `js/ui.js`
- Modify: `tests/run-tests.cjs`

- [ ] **Step 1: 렌더링·포커스 테스트 두 개를 추가한다**

`testUiRendersRecurringOccurrencesAndTemplatesSafely`은 실제 fake DOM에서 다음을 검증한다.

- 미기록 건수와 금액만 summary에 들어간다.
- 상태 표시가 `지남`, `오늘`, `예정`, `기록됨` 텍스트를 가진다.
- 기록됨 카드는 실제 거래 날짜·금액을 표시한다.
- 미기록 카드만 `기록하기` 버튼을 가진다.
- 버튼 accessible name에 예정일·이름·금액이 포함된다.
- 사용자 메모 `<img src=x onerror=...>`가 text node로만 들어가고 HTML로 실행되지 않는다.
- 템플릿 목록 수정·삭제 버튼에 ID가 dataset으로만 저장되며 dynamic button도 `data-cloud-write`를 가진다.

`testUiRecurringDialogsAndTemplateFocusFlow`은 다음을 검증한다.

- 확인 dialog open은 원래 예정일 설명과 editable 값을 채우고 날짜 입력에 포커스한다.
- 취소 close는 동일 occurrence 호출 버튼으로 복원한다. 저장 성공으로 항목 action이 사라지면 승인 설계대로 곧바로 `#recurring-upcoming-heading`으로 복원한다. 호출 버튼이 외부 렌더로 분리된 비저장 close만 DOM상 다음 미기록 버튼 → heading을 fallback으로 쓴다.
- 템플릿 편집 시작은 폼을 채우고 memo에 포커스한다.
- 편집 취소는 원래 수정 버튼 → 동일 템플릿의 다음 action → `#recurring-template-heading`, 삭제 성공은 DOM상 다음 템플릿 수정 버튼 → 이전 템플릿 수정 버튼 → `#recurring-template-heading` 순으로 복원한다.
- dialog cancel과 명시 취소가 동일한 정리 경로를 사용한다.

- [ ] **Step 2: UI API 누락의 RED를 확인한다**

```powershell
node tests/run-tests.cjs
```

Expected: `renderUpcomingRecurringExpenses is not a function`.

- [ ] **Step 3: element registry와 렌더러를 구현한다**

`getElements()`에 홈, 템플릿 폼/목록, 확인 dialog의 모든 요소를 등록한다. 공개 API는 다음과 같다.

```js
renderUpcomingRecurringExpenses(elements, occurrences)
renderRecurringExpenseTemplates(elements, templates)
fillRecurringExpenseCategoryOptions(elements)
beginRecurringTemplateEdit(elements, template)
clearRecurringTemplateEdit(elements, focusTarget)
openRecurringConfirmDialog(elements, occurrence, returnFocus)
closeRecurringConfirmDialog(elements, options)
```

`renderUpcomingRecurringExpenses()`는 list를 `replaceChildren()`로 비우고 정렬된 occurrence마다 `.recurring-card`를 만든다. `data-recurring-transaction-id`는 action button에만 둔다. 기록됨은 실제 거래 date/amount를, 나머지는 scheduledDate/template amount를 표시한다. summary는 `미기록 N건 · 예상 합계 X원`, N=0이면 `미기록 예정 없음`이다. `renderRecurringExpenseTemplates()`도 같은 방식으로 카드와 dynamic 수정/삭제 버튼을 만들며 두 버튼 모두 `data-cloud-write`를 가진다.

`fillRecurringExpenseCategoryOptions(elements)`를 추가해 `BudgetStorage.EXPENSE_CATEGORIES`만 template/confirm select 양쪽에 동일 순서로 채운다. `initDefaults()`에서 한 번 호출하고, dialog/편집 open은 선택값 설정 전에 option이 존재하는지 보장한다. UI 테스트는 두 select의 option value가 정확히 지출 카테고리 목록이고 수입 카테고리가 0개인지 검사한다.

`openRecurringConfirmDialog()`는 module-local `recurringConfirmReturnFocus`에 호출 버튼을 저장하고 입력값·scheduled date·`dialog.dataset.transactionId`를 채운 뒤 `showModal()`과 date focus를 호출한다. `closeRecurringConfirmDialog()`는 입력·dataset·message를 비우고 `dialog.close()`한다. 취소는 연결된 호출 버튼, 외부 render로 분리된 취소는 동일 ID action → 다음 미기록 action → heading 순이다. 저장 성공은 action 존재 여부와 관계없이 heading으로 보낸다. 템플릿 편집도 module-local return-focus ID를 사용하며 앞에서 고정한 fallback 순서를 따른다.

DOM은 기존 `createElement()`와 `textContent`만 사용한다. `innerHTML`이나 사용자 데이터가 포함된 HTML 문자열을 추가하지 않는다. summary 갱신은 전체 목록을 live region으로 만들지 않고 짧은 건수/금액만 공지한다.

확인 dialog는 occurrence 전체 객체를 DOM JSON이나 문자열 attribute로 넣지 않는다. `dialog.dataset.transactionId`만 저장하고 앱이 현재 파생 목록에서 다시 찾는다.

- [ ] **Step 4: 테스트·문법·diff를 통과시키고 커밋한다**

```powershell
node --check js/ui.js
node tests/run-tests.cjs
git diff --check
git add js/ui.js tests/run-tests.cjs
git diff --cached --check
git commit -m "반복지출 렌더링과 dialog 포커스 흐름 추가"
```

Expected before commit: `83 tests passed`.

---

### Task 9: 템플릿 CRUD를 설정 CAS에 remote-first로 연결한다

**Files:**

- Modify: `js/app.js`
- Modify: `tests/run-tests.cjs`

- [ ] **Step 1: 앱 템플릿 CRUD 통합 테스트를 추가한다**

`testAppRecurringTemplateCrudIsRemoteFirst`은 실제 app VM harness에서 추가·수정·삭제를 순서대로 실행한다.

테스트 작성 전에 `createAppHarness()` element registry에 Task 7의 모든 반복지출 getElements 키를 추가하고, `recurringTemplateSave`와 `recurringConfirmSave`를 write controls로 등록한다. `BudgetUI` stub에는 `renderUpcomingRecurringExpenses`, `renderRecurringExpenseTemplates`, `fillRecurringExpenseCategoryOptions`, `beginRecurringTemplateEdit`, `clearRecurringTemplateEdit`, `openRecurringConfirmDialog`, `closeRecurringConfirmDialog`를 추가하고 각 인자를 deep-copy해 `records`에 남긴다. dynamic recurring action을 `document.querySelectorAll('[data-cloud-write]')` 결과에 포함하는 fake DOM 계약도 추가한다.

- `render()`가 선택 예산기간 occurrence와 템플릿을 렌더러에 전달한다.
- submit은 `BudgetTransactions.add/updateRecurringExpenseTemplate()` 결과를 사용한다.
- 각 성공은 `BudgetCloud.saveSettings(nextState)` 정확히 1회, 거래 API 0회다.
- deferred save 동안 로컬 export, 폼 값, 버튼 잠금 상태가 이전 상태다.
- 성공 후에만 state/render/form reset/focus restore가 일어난다.
- `40001`이면 이전 state와 입력을 유지하고 `load-error`로 쓰기를 잠근다. 일반 네트워크 오류는 이전 state와 입력을 유지하고 mutation lock만 해제한다.
- 삭제 확인 취소 시 cloud 호출 0회다.
- 삭제 성공 후 기존 확정 거래는 그대로 남는다.
- 템플릿 validation 실패는 첫 오류 입력에 포커스하고 입력을 보존하며 cloud 호출은 0회다.

- [ ] **Step 2: 이벤트 미연결 RED를 확인한다**

```powershell
node tests/run-tests.cjs
```

Expected: template form submit 뒤 `saveSettings` 호출 수가 0이라 실패한다.

- [ ] **Step 3: render와 CRUD 이벤트를 구현한다**

앱 상태에 저장하지 않는 UI 값은 다음 두 개뿐이다.

```js
let recurringTemplateEditId = '';
let recurringOccurrences = [];
```

`render()`는 `BudgetTransactions.deriveRecurringExpenseOccurrences(state, viewState.month, new Date())`를 계산해 두 UI renderer에 전달한다.

추가·수정은 하나의 submit handler에서 `recurringTemplateEditId`로 분기한다. 원격 저장은 기존 settings CAS 패턴을 그대로 사용한다.

validation이 실패하면 기존 `BudgetUI.showValidationErrors(elements.recurringTemplateForm, elements.recurringTemplateMessage, result.errors)`를 호출해 첫 오류 control에 포커스한 뒤 즉시 return한다. 이 경로에서는 `runExclusiveMutation()`을 호출하지 않는다. 확인 form도 `showValidationErrors(elements.recurringConfirmForm, elements.recurringConfirmMessage, result.errors)`로 같은 순서로 검증한 뒤에만 remote insert를 시작한다.

```js
const saved = await persistRemoteFirst(
  result.state,
  () => window.BudgetCloud.saveSettings(result.state),
  elements.recurringTemplateMessage,
  event.submitter
);
if (saved) {
  recurringTemplateEditId = '';
  window.BudgetUI.clearRecurringTemplateEdit(elements, elements.recurringTemplateHeading);
}
```

삭제도 먼저 다음 상태를 계산하되 성공 전 `state`에 대입하지 않는다. 모든 dynamic write button은 공통 mutation lock이 disable할 수 있어야 한다.

`clearMutationMessages()`에는 템플릿 폼과 확인 dialog의 status element를 추가한다. 설정 `40001` 충돌은 기존 공통 흐름대로 `load-error`가 되며, 일반 네트워크 오류는 입력과 로컬 상태를 보존한 채 잠금만 해제해 재시도할 수 있어야 한다.

- [ ] **Step 4: 테스트를 통과시키고 커밋한다**

```powershell
node --check js/app.js
node tests/run-tests.cjs
git diff --check
git add js/app.js tests/run-tests.cjs
git diff --cached --check
git commit -m "반복지출 템플릿 설정 CAS 연결"
```

Expected before commit: `84 tests passed`.

---

### Task 10: 확인 거래 저장과 교차 브라우저 중복 처리를 연결한다

**Files:**

- Modify: `js/app.js`
- Modify: `tests/run-tests.cjs`

- [ ] **Step 1: 저장 직렬화와 실패 보존 테스트를 추가한다**

`testAppRecurringConfirmationSerializesAndPreservesFailureInput`은 다음을 검증한다.

- `기록하기`는 dialog를 열 뿐 cloud 호출하지 않는다.
- 사용자가 실제 날짜·금액·카테고리·메모를 수정해 submit하면 결정적 ID는 원래 scheduled month를 유지한다.
- 성공 시 `insertTransaction` 1회, update/upsert/upload 0회다.
- deferred insert 동안 두 번 submit해도 두 번째 cloud 호출은 0회이고 모든 write control이 잠긴다.
- 성공 뒤에만 local state/render/dialog close/focus restore가 일어난다.
- 일반 원격 오류 시 local state와 dialog 값이 유지되고 dialog가 열린 채 오류에 포커스한다.
- confirmation validation 실패는 첫 오류 입력에 포커스하고 dialog 값을 보존하며 cloud 호출은 0회다.
- 저장 전후 실제 요약 차이는 성공한 확정 거래 하나뿐이다.

- [ ] **Step 2: PK 중복 재동기화 테스트를 추가한다**

`testAppRecurringDuplicateReloadsWithoutUpsert`은 두 경우를 검증한다.

1. insert가 `23505`, 이어진 `downloadState()`에 같은 결정적 ID가 있음:
   - 최신 state를 적용
   - dialog close
   - “이미 기록된 항목이에요. 최신 내용을 다시 불러와 주세요.” 안내
   - insert 1, download 1, upsert/update/upload 0
2. insert가 `23505`지만 download 결과에 ID가 없거나 download 실패:
   - local state/dialog 입력 불변
   - `load-error`로 전환하고 명시적 재다운로드 전 쓰기 금지
   - 기존 거래 덮어쓰기 0

- [ ] **Step 3: RED를 확인한다**

```powershell
node tests/run-tests.cjs
```

Expected: dialog submit 후 `insertTransaction` 호출 수가 0이라 실패한다.

- [ ] **Step 4: 전용 remote-first 확인 흐름을 구현한다**

`persistRemoteFirst()`는 오류 종류를 감추므로 사용하지 않는다. 기존 `runExclusiveMutation()` 안에서 다음 상태를 명시적으로 반환한다.

```js
const mutation = await runExclusiveMutation(async () => {
  try {
    await window.BudgetCloud.insertTransaction(result.transaction);
    return { kind: 'created', state: result.state };
  } catch (error) {
    if (!window.BudgetCloud.isDuplicateTransactionError(error)) throw error;
    let latest;
    try {
      latest = await window.BudgetCloud.downloadState();
    } catch (downloadError) {
      const conflict = new Error('최신 클라우드 거래를 확인하지 못했어요. 다시 불러와 주세요.');
      conflict.code = '40001';
      throw conflict;
    }
    if (latest.transactions.some((tx) => tx.id === result.transaction.id)) {
      return { kind: 'already-recorded', state: latest };
    }
    const conflict = new Error('클라우드 거래 상태가 달라졌어요. 다시 불러와 주세요.');
    conflict.code = '40001';
    throw conflict;
  }
}, elements.recurringConfirmMessage, '반복지출 저장 실패');

if (!mutation.ok) {
  elements.recurringConfirmMessage.focus();
  return;
}
const outcome = mutation.value;
```

`outcome`이 있을 때만 state를 저장하고 render/dialog close한다. `already-recorded`는 성공 안내만 다르게 한다. 어떤 경로에서도 upsert하지 않는다.

`created`이고 사용자가 바꾼 실제 날짜가 현재 선택 예산기간 밖이면 `기록했어요. 입력한 날짜가 현재 예산기간 밖이라 내역과 캘린더에는 보이지 않아요.`를 성공 메시지로 표시한다. 이 경우에도 실제 거래 저장과 occurrence의 `기록됨` 판정은 성공이다.

일반 지출 거래 삭제 문구는 결정적 반복 거래일 때 “삭제하면 해당 예정 항목이 다시 나타나요.”를 함께 표시한다. 삭제 로직 자체는 기존 expected-row CAS를 그대로 사용한다.

- [ ] **Step 5: 테스트를 통과시키고 커밋한다**

```powershell
node --check js/app.js
node tests/run-tests.cjs
git diff --check
git add js/app.js tests/run-tests.cjs
git diff --cached --check
git commit -m "반복지출 확인 거래와 중복 충돌 처리"
```

Expected before commit: `86 tests passed`.

---

### Task 11: import/reset/sample/download/logout 전체 경로를 연결한다

**Files:**

- Modify: `js/app.js`
- Modify: `js/ui.js`
- Modify: `tests/run-tests.cjs`

- [ ] **Step 1: 전체 수명주기 앱 테스트를 추가한다**

`testAppRecurringLifecycleCoversImportResetSampleDownloadAndLogout`은 한 테스트 안에서 독립 harness를 만들어 다음 경로를 검증한다.

- import confirm 문구에 거래 성공/제외 건수와 템플릿 성공/제외 건수가 모두 표시된다.
- 템플릿 전용 백업 import가 `uploadState(next, expected)` 한 번으로 교체된다.
- reset 성공은 템플릿·거래·열린 확인 dialog·편집 입력을 모두 비운다.
- sample 추가/교체는 기존 템플릿을 byte-for-byte 보존한다.
- manual download는 V2 예약 키에서 템플릿을 복원하고 occurrence를 다시 파생한다.
- logout 성공은 메모리 템플릿·파생 목록·편집 ID·모든 반복 입력·dialog return focus를 지우고 export에도 이전 정보가 없다.
- import/reset/sample 실패는 local state와 반복 UI 입력을 보존한다.

테스트 전에 app harness의 빈 `FileReader`와 고정 confirm을 다음 계약으로 확장한다.

```js
const confirmCalls = [];
window.confirm = (message) => {
  confirmCalls.push(String(message));
  return options.confirmResult !== false;
};
class FakeFileReader {
  readAsText() {
    this.result = String(options.importText || '');
    if (typeof this.onload === 'function') this.onload();
  }
}
context.FileReader = FakeFileReader;
```

harness 반환값에 `confirmCalls`를 공개하고 `importFile.files = [{ name: 'backup.json' }]`을 설정할 수 있게 한다. 새 DOM 요소·write controls와 `BudgetUI` 반복지출 stub/record도 Task 7~10에서 실제 앱 테스트가 처음 실행되기 전에 harness element registry에 추가한다.

- [ ] **Step 2: 기존 import confirm/logout 누락의 RED를 확인한다**

```powershell
node tests/run-tests.cjs
```

Expected: import confirm에 템플릿 건수가 없거나 logout 후 dialog가 열려 있어 실패한다.

- [ ] **Step 3: lifecycle 정리를 구현한다**

공용 UI 정리 함수로 폼 편집 상태와 확인 dialog를 닫되, 원격 성공 뒤에만 호출한다. 로그아웃은 개인정보 제거이므로 signOut 성공 직후 기본 상태 대입 전에 dialog의 dataset·입력·오류 메시지도 지운다.

import confirm 문구는 예를 들어 다음 구조를 사용한다.

```text
거래 3건과 반복지출 2건을 가져옵니다.
제외된 거래 1건, 반복지출 0건이 있어요.
현재 클라우드 데이터를 교체할까요?
```

sample은 기존 `createSampleState()` 결과를 그대로 사용하고 템플릿 전용 추가 로직을 만들지 않는다.

- [ ] **Step 4: 최종 87개 자동 테스트를 통과시키고 커밋한다**

```powershell
node --check js/storage.js
node --check js/transactions.js
node --check js/cloud.js
node --check js/ui.js
node --check js/app.js
node --check tests/run-tests.cjs
node tests/run-tests.cjs
git diff --check
git add js/app.js js/ui.js tests/run-tests.cjs
git diff --cached --check
git commit -m "반복지출 전체 상태 경로 연결"
```

Expected: `87 tests passed`.

---

### Task 12: 문서와 cache-buster를 실제 V2 계약으로 동기화한다

**Files:**

- Modify: `index.html`
- Modify: `docs/DATA_MODEL.md`
- Modify: `docs/README.md`
- Modify: `docs/TEST_PLAN.md`
- Modify: `docs/IMPROVEMENT_LOG.md`
- Modify: `manual-test-checklist.md`
- Modify: `docs/REQUIREMENTS.md`
- Modify: `docs/IMPLEMENTATION_PLAN.md`

- [ ] **Step 1: 문서별 사실을 현재 코드에서 다시 추출한다**

```powershell
rg -n "recurringExpenseTemplates|__recurring_expense_templates|preview_v2_|replace_preview_v2|tx-recurring|version: 2|87 tests" js index.html tests docs manual-test-checklist.md
```

Expected: 구현 심볼과 테스트명이 실제 파일에 나타난다. 문서를 먼저 추측해 쓰지 않는다.

- [ ] **Step 2: 데이터 모델과 README를 갱신한다**

`docs/DATA_MODEL.md`에는 템플릿 필드, 예약 키, 파생 occurrence, 결정적 거래 ID, 상태 우선순위, 삭제 후 재등장, V1→V2 승격, future-version 거부를 기록한다.

`docs/README.md`에는 V2 기능, 템플릿 settings CAS, 순수 insert와 23505 재동기화, V2 SQL 적용 순서, `/v1/`·`/v2/` 병렬 URL, 최종 87개 테스트 근거를 기록한다. V1 이력은 과거 사실로 보존한다.

- [ ] **Step 3: 테스트·운영 절차 문서를 갱신한다**

`docs/TEST_PLAN.md`와 `manual-test-checklist.md`에는 다음을 정확히 넣는다.

- V2 최초 seed 동안 운영·V1 preview·V2 preview·로컬 로그인 탭/API writer 모두 중단
- 창 안에서 authoritative backup, 사용자별 두 테이블 count, canonical hash, ID mapping/collision audit
- V2 SQL만 적용하고 V1·운영 hash/count 불변 확인
- marker 재실행 byte-for-byte 불변
- 실행별 `QA-V2-RECURRING-<yyyyMMdd-HHmmss>` 불변 prefix와 생성 즉시 템플릿/거래 ID 기록
- 템플릿 CRUD, 네 상태, 말일, 수정 가능한 확인 dialog, duplicate/CAS, 거래 삭제 후 재등장
- desktop/360×800, keyboard, focus, live region, console 0 errors
- QA cleanup은 기록 ID 또는 marker prefix 양쪽으로 브라우저 전체 월과 DB에서 0건 확인

`docs/IMPROVEMENT_LOG.md`에는 2026-08-12 V2 항목을 append한다. 문서를 수정하기 직전 `git rev-parse HEAD`로 확인한 마지막 기능 구현 SHA를 구현 기준으로 정확히 기록하고, 최종 공개 산출물 SHA는 이후 `/v2/version.json`을 source of truth로 사용한다고 명시한다.

- [ ] **Step 4: 오래된 문서의 충돌 주장을 superseded 처리한다**

`docs/REQUIREMENTS.md`의 localStorage 저장 주장과 `docs/IMPLEMENTATION_PLAN.md`의 반복 거래 제외 주장을 현재 문장처럼 남기지 않는다. 두 문서 상단에 역사 문서임을 표시하고 현재 V2 설계·계획 링크를 제공하며, 실제 현재 저장 방식은 Supabase Auth+RLS이고 localStorage에는 가계부 데이터가 없다고 바로잡는다.

- [ ] **Step 5: 정적 자산 cache-buster를 한 버전으로 맞춘다**

`index.html`의 `css/style.css`와 다섯 로컬 JS(`storage`, `transactions`, `cloud`, `ui`, `app`) 모두에 동일한 `?v=20260812-v2` query string을 붙인다. Supabase CDN URL은 바꾸지 않고 파일 load order도 유지한다.

- [ ] **Step 6: 문서·UTF-8·테스트를 검증하고 커밋한다**

```powershell
node tests/run-tests.cjs
node --check js/storage.js
node --check js/transactions.js
node --check js/cloud.js
node --check js/ui.js
node --check js/app.js
node --check tests/run-tests.cjs
git diff --check
@'
from pathlib import Path
paths = [
  Path('index.html'), Path('docs/DATA_MODEL.md'), Path('docs/README.md'),
  Path('docs/TEST_PLAN.md'), Path('docs/IMPROVEMENT_LOG.md'),
  Path('manual-test-checklist.md'), Path('docs/REQUIREMENTS.md'),
  Path('docs/IMPLEMENTATION_PLAN.md')
]
for path in paths:
    path.read_text(encoding='utf-8', errors='strict')
print('UTF-8 OK')
'@ | python -
git add index.html docs/DATA_MODEL.md docs/README.md docs/TEST_PLAN.md docs/IMPROVEMENT_LOG.md manual-test-checklist.md docs/REQUIREMENTS.md docs/IMPLEMENTATION_PLAN.md
git diff --cached --check
git commit -m "V2 반복지출 문서와 검증 절차 동기화"
```

Expected: `87 tests passed`, `UTF-8 OK`.

---

### Task 13: 전체 자동 검증·전문 리뷰·격리 PostgreSQL 런타임 검증을 수행한다

**Files:**

- Create: `tests/postgres-preview-v2-runtime.sql`
- Create: `tests/run-preview-v2-postgres-tests.ps1`
- Create: `scripts/build-preview-v2-artifact.ps1`
- Modify if a real defect is found: only the smallest affected source/test/doc files

- [ ] **Step 1: 전체 자동 게이트를 새 프로세스에서 두 번 실행한다**

```powershell
node --check js/storage.js
node --check js/transactions.js
node --check js/cloud.js
node --check js/ui.js
node --check js/app.js
node --check tests/run-tests.cjs
node tests/run-tests.cjs
node tests/run-tests.cjs
git diff --check 2b7d34ff84305fdfe679433bce127993861dffa0..HEAD
git status --porcelain
```

Expected: 두 번 모두 `87 tests passed`; diff-check와 status는 clean이다.

- [ ] **Step 2: 독립 spec·quality·a11y 리뷰를 병렬 요청한다**

각 reviewer에게 `2b7d34f..HEAD`만 읽도록 하고 다음 별도 판정을 받는다.

- spec: 승인 설계의 모든 필드·상태·경계·비범위·V2 격리
- quality/security: settings CAS, pure insert, 23505, logout privacy, import future-version, XSS
- a11y/mobile: keyboard/focus/dialog/live region/44px/360×800

Critical/Important는 테스트로 재현한 뒤 같은 Task 안에서 최소 수정·전체 87개 재검증·별도 한국어 수정 커밋한다. Minor는 사용자 가치와 회귀 위험을 따져 수정 여부와 근거를 문서화한다.

- [ ] **Step 3: PostgreSQL 17용 실행형 검증 하네스를 만든다**

`tests/postgres-preview-v2-runtime.sql`은 고정 UUID `00000000-0000-0000-0000-0000000000a1`과 `00000000-0000-0000-0000-0000000000b2`를 user A/B로 사용하고, `auth.uid()` mock은 `current_setting('request.jwt.claim.sub', true)::uuid`를 반환하게 한다. 각 사용자 session SQL은 반드시 `begin; select set_config('request.jwt.claim.sub', '<uuid>', true); set local role authenticated; ... assertions ...; rollback;` 한 트랜잭션으로 감싼다. 운영 fixture를 만든 뒤 `docs/supabase-preview-v2-setup.sql`을 적용하고 다음을 SQL assertion으로 검증한다.

- 다른 user의 settings/transactions RLS 차단
- anon/public RPC execute 거부
- settings `updated_at` 단조 증가와 RETURNING 토큰 일치
- 최초 seed 값이 production canonical rows와 양방향 동일
- marker 뒤 production 변화·preview 수정/삭제 후 setup 재실행 시 V2 preview byte-for-byte 불변
- 5인자 RPC stale version/transaction snapshot은 `40001`이고 행 불변
- 같은 결정적 거래 ID 두 insert 중 정확히 한 건 성공, 한 건 `23505`
- user A와 B가 같은 결정적 ID를 각각 한 번 insert하면 둘 다 성공하고, 같은 user의 두 번째 insert만 `23505`
- seed와 5인자 RPC를 barrier로 실제 겹쳐도 timeout·`40P01` 없이 둘 중 하나가 대기 후 완료
- 운영과 V1 preview fixture의 hash/count 불변

`tests/run-preview-v2-postgres-tests.ps1`은 이미지 `postgres:17.6-alpine`과 일회용 DB `beginner_budget_v2_test`를 사용한다. 이름은 `beginner-budget-preview-v2-pg17-<현재 프로세스 ID>-<8자리 GUID>`로 만들어 기존 컨테이너와 충돌하지 않게 한다. `$createdByThisRun = $false`로 시작해 `docker run` 성공 직후에만 true로 바꾸며, `finally`에서는 true인 경우 정확한 생성 ID만 제거한다. 기존 컨테이너·port·volume을 정리하지 않는다. host `psql`이나 host port에 의존하지 않는다. `docker cp`로 session-a/b SQL을 이 실행의 컨테이너에 넣고, 두 `Start-Process docker -ArgumentList @('exec', $containerId, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'beginner_budget_v2_test', '-f', '/tmp/session-a.sql') -PassThru` 프로세스(session B는 파일명만 변경)와 DB barrier table을 사용한다. 15초 timeout 뒤 살아 있는 프로세스만 이 실행이 만든 PID로 중단한다. 두 exit code가 0이고 로그에 `40P01`·statement timeout이 없는지 검사한다.

- [ ] **Step 4: 실행형 DB 테스트를 돌린다**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/run-preview-v2-postgres-tests.ps1
```

Expected final line:

```text
preview-v2 PostgreSQL runtime tests passed
```

- [ ] **Step 5: 하네스와 필요한 수정만 검증·커밋한다**

```powershell
node tests/run-tests.cjs
git diff --check
git add tests/postgres-preview-v2-runtime.sql tests/run-preview-v2-postgres-tests.ps1 scripts/build-preview-v2-artifact.ps1
git diff --cached --check
git commit -m "V2 미리보기 실행 검증과 산출물 도구 추가"
```

실제 defect 수정 파일이 있으면 해당 파일과 회귀 테스트만 같은 수정 커밋에 추가한다. unrelated formatting은 포함하지 않는다.

---

### Task 14: 실제 Supabase에 V2 객체만 적용하고 인증 저장을 검증한다

**Files:**

- Execute: `docs/supabase-preview-v2-setup.sql`
- Create: `tests/supabase-preview-v2-live-verification.sql`
- Required before committed concurrency phases: reviewed `tests/run-preview-v2-live-concurrency.ps1` — **PENDING, not created in this Task 14 preparation change**
- Create evidence outside repository: `$env:TEMP\beginner-budget-preview-v2-live\<UTC-run-id>\`
- Update evidence: `docs/TEST_PLAN.md`
- Update evidence: `manual-test-checklist.md`
- Verify only: `docs/supabase-preview-setup.sql`
- Verify only: production and V1 database objects/data

- [ ] **Step 1: 사용자에게 Supabase 대시보드 로그인을 요청하고 로그인 완료를 확인한다**

OAuth 버튼이나 자격증명 입력을 에이전트가 대신하지 않는다. 사용자가 로그인했다는 확인과 정확한 project ref가 보일 때까지 live SQL 적용을 시작하지 않는다. 그 뒤에도 먼저 setup 전 read-only `auth_gate` phase만 실행해 서로 다른 QA user A/B UUID가 유효하고 `auth.users`에 각각 정확히 한 행 존재하는지 확인한다.

이 검사는 **Task 14 전체의 hard gate**다. A/B가 같거나 어느 한쪽이라도 0행 또는 2행 이상이면 쓰기 중단 창, setup SQL, live DML을 시작하지 않는다. B가 없으면 임의 UUID나 계정을 자동 생성하지 않고, 사용자가 정상 Supabase Auth 흐름으로 두 번째 테스트 계정을 준비하도록 요청한 채 live 검증을 `PENDING`으로 둔다. 둘째 계정 준비와 A/B 재확인은 writer를 중단하기 전에 끝낸다.

- [ ] **Step 2: 짧은 최초 seed 쓰기 중단 창을 연다**

사용자가 운영, V1 preview, V2 preview, 로컬의 로그인 탭을 모두 닫고 API writer를 중단했다고 명시적으로 확인한 뒤에만 다음 단계로 간다. 확인 전에는 pause하고 SQL을 실행하지 않는다. 이 창 안에서 authoritative backup과 다음 증거를 다시 만들어 `$env:TEMP\beginner-budget-preview-v2-live\<UTC-run-id>\`에 CSV/텍스트로 보관하되 자격증명은 저장하지 않는다. 이 임시 evidence 경로는 Git repo 밖이며 Task 15 clean gate에 포함되지 않는다.

- production/V1 preview settings·transactions 사용자별 count
- production/V1 preview canonical row hash
- invalid ID deterministic mapping CSV
- mapped↔mapped, mapped↔existing collision CSV가 0건
- 백업 파일의 생성 시각과 대상 project ref

이 창 밖에서 만든 자료는 예비 자료로만 취급한다.

- [ ] **Step 3: V2 SQL 전체를 한 번 적용한다**

SQL editor에서 `docs/supabase-preview-v2-setup.sql` 전체만 실행한다. 일부 statement만 골라 실행하지 않는다. 오류가 하나라도 나면 쓰기 중단 창을 유지하고 V2 object/data만 조사하며 운영/V1을 복구 대상으로 수정하지 않는다.

- [ ] **Step 4: seed·RLS·권한·CAS를 실제 두 세션에서 검증한다**

`tests/supabase-preview-v2-live-verification.sql`은 `run_id`, 동일한 `qa_marker`, 서로 다른 실제 QA user A/B UUID, 명시적 실행 phase를 외부 변수로 받는다. 기본값은 없으며 setup 전 첫 phase는 DML 없는 read-only `auth_gate`다. 변수 누락, UUID 오류, A/B 동일, `auth.users` 정확히 한 행 조건 실패 시 즉시 실패하며 setup이나 DML로 진행하지 않는다. 모든 phase는 UTC, `ON_ERROR_STOP`, bounded `statement_timeout`·`lock_timeout`을 사용하고 자격증명·이메일·원문 금융 데이터는 출력하지 않는다.

실행 수단도 hard gate다. setup 전체 적용은 Step 3의 SQL Editor를 쓸 수 있지만, live verification은 `ON_ERROR_STOP`, 고정 세션, exit code와 파일 증거가 필요한 **psql 전용**이다. SQL Editor 여러 탭을 동시성 증거로 쓰지 않는다. 접속 정보는 Supabase dashboard의 정확한 project ref에서 가져오되 password·access token·service-role key를 파일, 명령 인자, stdout에 넣지 않고 psql 대화형 prompt로만 입력한다. rollback-only phase는 스크립트 상단에 열거된 정확한 phase를 각각 별도 psql 프로세스로 실행하고 모든 exit code 0을 기록한다.

현재 `tests/supabase-preview-v2-live-verification.sql`은 read-only/rollback-only 검증과 setup 재실행 snapshot만 담당한다. 아래 commit이 필요한 교차 세션 세 시나리오는 이 파일의 rollback 결과로 통과 처리하지 않는다. controller/worker 실행, lock 관찰, append-only ledger, exact cleanup을 자동화하는 별도 PowerShell runner가 구현·독립 검토·격리 검증되기 전에는 committed concurrency phase와 이후 live 완료 판정을 `PENDING`으로 두고 pause한다.

설치 분기 증거는 섞지 않는다.

- A/A'는 최초 seed 뒤 production→V2 settings·transactions semantic 양방향 차이가 각각 0건인지 확인한다. settings의 trigger 소유 `updated_at`만 이 비교에서 제외한다.
- B는 현재 운영과 V2가 달라도 정상이다. setup 전후 V2 세 relation의 count·모든 컬럼을 포함한 canonical hash와 marker가 문자열 그대로 같은지만 확인한다. 금융 행 원문은 stdout/evidence에 출력하지 않는다. 운영↔V2 차이를 실패나 reseed 근거로 사용하지 않는다.
- 어느 분기든 production/V1 count와 모든 컬럼 invariant hash는 preflight, 각 검증 phase, cleanup 뒤까지 같아야 한다.

RLS·권한과 단일 세션 CAS 검증은 각 세션을 `begin; select set_config('request.jwt.claim.sub', ..., true); set local role authenticated; ...; rollback;`로 감싼다. assertion 전에 `current_user = 'authenticated'`와 `auth.uid() = <대상 사용자>`를 자체 확인하고, 자신의 행만 보이는지, 교차 사용자 SELECT/DML이 차단되는지, metadata 접근과 anon/public RPC가 거부되는지 확인한다. 성공 CAS의 단조 token과 같은 세션의 stale settings/transaction snapshot `40001`도 outer transaction에서 전부 rollback한다. 기대 오류는 정확한 SQLSTATE만 잡고 다른 오류는 다시 발생시킨다.

교차 세션 stale CAS와 동일 ID `23505`는 rollback-only 절차로 증명할 수 없으므로 검토된 runner의 별도 committed disposable fixture phase로 실행한다. 이 phase는 preflight에서 production/V1/V2 사용자 상태가 비어 있음을 확인한 전용 QA 사용자 또는 실행 전 상태를 훼손하지 않는 marker 전용 행만 사용한다. 두 worker는 같은 base token/snapshot을 읽고, `run_id`가 포함된 `application_name`과 backend PID를 기록한 뒤 controller가 먼저 보유한 run-scoped advisory lock에 `pg_advisory_xact_lock`으로 대기한다. controller는 worker의 `lock_timeout`보다 짧은 관찰 deadline 안에 `pg_locks`와 `pg_stat_activity`에서 두 PID의 실제 대기를 확인한 경우에만 lock을 해제한다. 단순 sleep을 barrier로 인정하지 않고 새 영속 table도 만들지 않는다.

runner는 결과가 다른 세 시나리오를 합치지 않고 각각 별도 phase와 fixture로 실행한다.

1. `cas-stale`: 같은 base token/snapshot의 첫 worker가 marker settings/full-state를 commit하고, 둘째 worker는 정확한 `40001`; loser와 다른 사용자의 전체 상태 불변
2. `same-user-duplicate`: 같은 user와 결정적 ID의 첫 insert가 commit되고 둘째 insert는 정확한 `23505`; 최종 한 행
3. `cross-user-same-id`: A와 B가 같은 결정적 ID를 각각 commit하며 `(user_id, id)`별 정확히 한 행; 오류 없음

commit된 marker 템플릿·거래는 성공 직후 `{ userId, id, memo, purpose, recordedAtUtc }`를 append-only ledger에 기록한다. transaction exact ID를 먼저, template exact ID를 다음으로 정리한다. 기존 settings 행은 실행 전 canonical 값을 CAS로 복원하고 삭제하지 않는다. 사전 ABSENT였고 marker 소유가 증명된 settings 행만 마지막에 정확히 삭제한다. 같은 결정적 ID를 A/B가 각각 commit하는 검증도 두 user-scoped ID를 별도 ledger 항목으로 남긴다. cleanup 0건, 사용자별 V2 사전 canonical 값 복원과 production/V1 불변을 확인하지 못하면 writer를 재개하지 않는다.

rollback-only와 committed concurrency 검증 뒤에는 `production_snapshot_v2` marker를 지우지 않은 채 기존 marker 안전 재실행 fixture를 반드시 수행한다. 같은 `$qaMarker`의 V2-only 템플릿·거래를 만들고 edit/delete를 ledger에 기록한 다음, V2 세 relation의 count·모든 컬럼 canonical hash와 marker 행을 저장한다. 정확한 setup SQL 전체를 한 번 재실행하고 같은 count·hash·marker를 다시 저장해 문자열 그대로 불변인지 확인한다. 금융 행 원문은 저장하지 않는다. 이 재실행 근거 없이는 Task 14를 완료 처리하지 않는다.

live seed↔full-state RPC 경합은 실행하지 않는다. RPC는 최초 setup의 seed가 끝난 뒤 생기고, marker가 있는 재실행은 seed를 건너뛰므로 live에서 경합을 만들려면 marker/data를 파괴해야 한다. 이 항목은 `NOT EXECUTED LIVE — destructive reset required`로 남기고, Task 13의 격리 PostgreSQL 17 경합 증거를 참조한다. live 미실행을 Task 14 성공으로 바꾸지 않는다. 이는 live seed↔RPC 항목에만 해당하며, 위 교차 세션 marker fixture의 advisory-lock 대기 검증은 별도로 수행한다.

실행 결과는 임시 evidence 폴더의 `rls-session-a.txt`, `rls-session-b.txt`, `cas-session-a.txt`, `cas-session-b.txt`, `invariants-before.csv`, `invariants-after.csv`와 append-only ledger에 저장한다. evidence에는 count·hash·SQLSTATE·PID·lock 상태만 남기고 금융 행 원문은 저장하지 않는다. 다음을 확인한다.

- V2 marker와 두 테이블이 생성됨
- A/A'는 운영→V2 semantic 양방향 차이 건수 0, B는 setup 전후 V2 count·모든 컬럼 canonical hash·marker 문자열 불변
- user A/B 교차 SELECT/DML 차단과 anon/public RPC 실행 거부
- rollback-only 단일 세션 CAS와 committed marker fixture 교차 세션 CAS가 정확한 `40001`
- 같은 user의 동일 결정적 ID insert는 한 건만 성공하고 두 번째는 정확한 `23505`; user A/B의 같은 ID는 각각 한 건 공존
- advisory lock 대기의 PID·lock 관찰, bounded deadline 준수, `40P01`·statement timeout·lock timeout 0건
- marker fixture exact cleanup 0건과 production/V1 hash/count 불변
- marker fixture edit/delete 뒤 setup 전체 재실행 전후 V2 세 relation count·canonical hash·marker 문자열 불변
- live seed↔RPC는 미실행이며 Task 13 격리 증거만 참조

- [ ] **Step 5: 로컬 앱에서 인증 저장 스모크를 수행한다**

```powershell
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$previewPort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$server = Start-Process -FilePath python -ArgumentList '-m','http.server',"$previewPort",'--bind','127.0.0.1' -WorkingDirectory (Get-Location) -WindowStyle Hidden -PassThru
Start-Sleep -Milliseconds 500
if ($server.HasExited) { throw '로컬 V2 서버가 시작되지 않았습니다.' }
$previewUrl = "http://127.0.0.1:$previewPort/"
$response = Invoke-WebRequest $previewUrl -UseBasicParsing
if ($response.StatusCode -ne 200 -or $response.Content -notmatch '예정된 반복지출') {
  Stop-Process -Id $server.Id
  throw '현재 V2 산출물이 아닌 응답입니다.'
}
$server.Id
$previewUrl
```

출력된 동적 `$previewUrl`에서 다음을 확인한다. 기존 8765 listener나 다른 프로세스를 중단하지 않는다.

- 로그인 후 V2 preview tables에서 다운로드
- 템플릿 추가 → 새 브라우저 컨텍스트 로그인 → 동일 템플릿 표시
- 확인 거래 저장 → 요약·내역·캘린더 갱신
- 템플릿 수정/삭제가 기존 거래를 보존
- 확정 거래 삭제 후 occurrence 재등장
- console error 0

브라우저 QA와 Step 6 정리가 끝난 뒤 별도 PowerShell 호출에서 실행 로그에 기록한 `$server.Id`가 아직 같은 Python 프로세스인지 확인하고 `Stop-Process -Id <기록한 PID>`로 그 PID만 종료한다. 서버 시작 code block 안에서 `finally`로 즉시 종료하지 않는다.

- [ ] **Step 6: QA 데이터를 정리하고 쓰기를 재개한다**

실행 시작 때 `$qaMarker = 'QA-V2-RECURRING-' + (Get-Date -Format 'yyyyMMdd-HHmmss')`를 만들고 생성 즉시 템플릿 ID·거래 ID와 함께 같은 evidence 폴더에 기록한다. 정리 시 user-scoped exact 거래 ID를 먼저, exact 템플릿 ID를 다음으로 사용하고 `$qaMarker%`는 누락 탐지 보조 조건으로만 사용한다. 사전 ABSENT와 marker 소유를 모두 증명한 disposable settings 행이 있으면 마지막에 그 행만 정리한다. `auth.users`, production, V1, seed marker는 UPDATE·DELETE·TRUNCATE·DROP하지 않는다. 브라우저 전체 월과 DB 양쪽 0건, production/V1 hash/count 불변을 다시 확인한 뒤에만 모든 환경 writer를 재개한다.

- [ ] **Step 7: 실제 증거를 문서화하고 커밋한다**

PENDING을 지우는 대신 실제 성공한 항목만 날짜·project ref 일부 마스킹값·hash/count·cleanup 결과와 함께 체크한다. 미검증 항목은 계속 PENDING으로 둔다.

```powershell
git add tests/supabase-preview-v2-live-verification.sql docs/TEST_PLAN.md manual-test-checklist.md
git diff --cached --check
git commit -m "V2 Supabase 인증 저장 검증 근거 기록"
```

---

### Task 15: source SHA를 고정하고 `/v2/` 배포 산출물을 만든다

**Files in source repo:**

- Verify: `index.html`
- Verify: `css/style.css`
- Verify: `js/storage.js`
- Verify: `js/transactions.js`
- Verify: `js/cloud.js`
- Verify: `js/ui.js`
- Verify: `js/app.js`

**Files in deploy repo `C:\Users\suho.jung\Documents\beginner-budget-preview`:**

- Create: `v2/index.html`
- Create: `v2/css/style.css`
- Create: `v2/js/storage.js`
- Create: `v2/js/transactions.js`
- Create: `v2/js/cloud.js`
- Create: `v2/js/ui.js`
- Create: `v2/js/app.js`
- Create: `v2/version.json`
- Modify: `index.html`
- Modify: `README.md`
- Verify only: `v1/**`

배포 저장소는 현재 workspace writable root 밖이므로 Step 3 이후의 읽기·복사·stage·commit·push는 필요한 시점에 사용자 승인을 받아 escalation한다. 모든 deploy Git 명령은 `-c safe.directory=C:/Users/suho.jung/Documents/beginner-budget-preview`를 사용한다. writable source repo에서 `scripts/build-preview-v2-artifact.ps1`을 `apply_patch`로 작성·커밋하고, 승인된 escalation으로 이 스크립트만 실행해 deploy repo를 갱신한다. deploy repo에 `apply_patch`를 직접 호출하지 않는다.

- [ ] **Step 1: source 최종 게이트와 clean SHA를 고정한다**

```powershell
node --check js/storage.js
node --check js/transactions.js
node --check js/cloud.js
node --check js/ui.js
node --check js/app.js
node --check tests/run-tests.cjs
node tests/run-tests.cjs
git diff --check 2b7d34ff84305fdfe679433bce127993861dffa0..HEAD
git status --porcelain
git rev-parse HEAD
```

Expected: `87 tests passed`, clean status. 마지막 40자리 SHA와 다음 명령의 UTC 시각을 실행 로그에 기록한다.

```powershell
(Get-Date).ToUniversalTime().ToString('o')
```

- [ ] **Step 2: source 브랜치만 push한다**

```powershell
git push -u origin guardian/budget-preview-v2
```

운영 `master`나 V1 branch에는 push하지 않는다.

- [ ] **Step 3: deploy repo 기준 상태와 V1 hash를 기록한다**

`scripts/build-preview-v2-artifact.ps1`은 필수 인자 `-SourceRoot`, `-DeployRoot`, `-SourceCommit`, `-BuiltAtUtc`를 받는다. 하나의 PowerShell 프로세스 안에서 deploy status/HEAD를 검사하고 `$v1Before` SHA 목록을 메모리에 유지한다. deploy repo가 dirty하거나 branch가 `main`이 아니면 어떤 파일도 쓰기 전에 중단한다. `v1/**`는 수정·삭제·재생성하지 않는다.

- [ ] **Step 4: 허용된 정적 파일만 `/v2/`에 복사한다**

artifact script는 승인된 escalation 안에서 `New-Item -ItemType Directory -Force`로 deploy repo의 `v2/css`와 `v2/js` 경로만 만든 뒤 source의 `index.html`, `css/style.css`, 다섯 JS 파일만 같은 상대 경로로 복사한다. 파일 목록은 아래 PowerShell 배열로 고정하고 bulk directory copy를 사용하지 않는다.

```powershell
New-Item -ItemType Directory -Force -Path (Join-Path $deployRoot 'v2\css'), (Join-Path $deployRoot 'v2\js') | Out-Null
$artifactFiles = @(
  'index.html', 'css/style.css', 'js/storage.js', 'js/transactions.js',
  'js/cloud.js', 'js/ui.js', 'js/app.js'
)
foreach ($relative in $artifactFiles) {
  $target = Join-Path (Join-Path $deployRoot 'v2') $relative
  Copy-Item -LiteralPath (Join-Path $sourceRoot $relative) -Destination $target
}
```

artifact script는 PowerShell ordered hashtable를 `ConvertTo-Json`한 UTF-8 파일로 `v2/version.json`을 만든다. `sourceCommit`에는 인자 `-SourceCommit`, `builtAt`에는 `-BuiltAtUtc`를 사용하며 SHA 40자리와 UTC ISO-8601 regex가 아니면 쓰기 전에 중단한다.

| Field | Exact value source |
|---|---|
| `version` | `v2` |
| `sourceRepository` | `https://github.com/suho-j/beginner-budget` |
| `sourceBranch` | `guardian/budget-preview-v2` |
| `sourceCommit` | Task 15 Step 1 `git rev-parse HEAD` 출력 |
| `builtAt` | Task 15 Step 1 UTC 명령 출력 |
| `testCount` | integer `87` |
| `environment` | `preview-v2` |
| `dataTables` | `preview_v2_budget_settings`, `preview_v2_transactions` |

- [ ] **Step 5: root landing과 README에 V1/V2 선택을 추가한다**

root `index.html`은 V1과 V2를 모두 링크하고 V2에 “반복지출·예정 내역”을 표시한다. 어떤 버전도 운영이라고 부르지 않는다. README에는 두 URL, source branch/SHA, data table 격리를 기록한다.

artifact script가 쓰는 root landing HTML과 README markdown은 script 안의 single-quoted here-string 상수로 완전하게 정의한다. root landing의 링크 label은 `V1 — 탭·수정·캘린더`와 `V2 — 반복지출·예정 내역`으로 고정하고 각각 `/beginner-budget-preview/v1/`, `/beginner-budget-preview/v2/`를 가리킨다. README 표는 version, public URL, source branch, source SHA, data tables 열을 가진다. root landing에는 이 두 링크·제목·“각 버전은 격리된 개발 미리보기” 안내 외 사용자 데이터를 넣지 않는다.

- [ ] **Step 6: artifact 동등성과 V1 불변을 검증한다**

artifact script 끝에서 source↔deploy V2 각 파일 SHA256이 동일한지, 시작 때 저장한 V1 hash와 현재 hash가 byte-for-byte 같은지 확인한다. `v2/index.html`의 로컬 자산 경로가 상대 경로인지, `version.json`이 인자 SHA/87/V2 tables인지 검사한다. 검증 실패 시 nonzero로 끝내고 commit하지 않는다.

```powershell
$artifactFiles | ForEach-Object {
  $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $sourceRoot $_)).Hash
  $deployHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path (Join-Path $deployRoot 'v2') $_)).Hash
  if ($sourceHash -ne $deployHash) { throw "V2 artifact mismatch: $_" }
}
$v1After = Get-ChildItem -Recurse -File (Join-Path $deployRoot 'v1') | Sort-Object FullName | ForEach-Object {
  "{0} {1}" -f $_.FullName.Substring($deployRoot.Length), (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
}
if (Compare-Object $v1Before $v1After) { throw 'V1 artifact changed' }
```

Step 3~6은 아래 단일 script 호출 한 번이다. 변수 수명을 여러 shell 호출에 의존하지 않는다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-preview-v2-artifact.ps1 `
  -SourceRoot (Get-Location).Path `
  -DeployRoot 'C:\Users\suho.jung\Documents\beginner-budget-preview' `
  -SourceCommit '<Task 15 Step 1의 40자리 SHA>' `
  -BuiltAtUtc '<Task 15 Step 1의 UTC ISO 값>'
```

설명용 `<...>` 문자열을 그대로 실행하지 않고 Step 1 실제 값을 넣는다.

- [ ] **Step 7: deploy repo만 커밋한다**

```powershell
git -c safe.directory=C:/Users/suho.jung/Documents/beginner-budget-preview -C C:/Users/suho.jung/Documents/beginner-budget-preview add index.html README.md v2
git -c safe.directory=C:/Users/suho.jung/Documents/beginner-budget-preview -C C:/Users/suho.jung/Documents/beginner-budget-preview diff --cached --check
git -c safe.directory=C:/Users/suho.jung/Documents/beginner-budget-preview -C C:/Users/suho.jung/Documents/beginner-budget-preview diff --cached --name-only
git -c safe.directory=C:/Users/suho.jung/Documents/beginner-budget-preview -C C:/Users/suho.jung/Documents/beginner-budget-preview commit -m "V2 반복지출 미리보기 버전 추가"
```

Expected staged scope: root `index.html`, `README.md`, `v2/**`만 있다.

---

### Task 16: `/v2/`를 공개하고 실제 브라우저 QA 결과를 인계한다

**Files:**

- Push only: deploy repository `main`
- Update evidence if needed: source `docs/TEST_PLAN.md`, `manual-test-checklist.md`, `docs/IMPROVEMENT_LOG.md`

- [ ] **Step 1: deploy main을 push하고 Pages 응답을 기다린다**

```powershell
git -c safe.directory=C:/Users/suho.jung/Documents/beginner-budget-preview -C C:/Users/suho.jung/Documents/beginner-budget-preview push origin main
```

다음 세 URL이 HTTP 200일 때까지 GitHub Pages 상태를 확인한다.

```text
https://suho-j.github.io/beginner-budget-preview/
https://suho-j.github.io/beginner-budget-preview/v1/
https://suho-j.github.io/beginner-budget-preview/v2/
```

- [ ] **Step 2: 배포 manifest와 source SHA를 대조한다**

`/v2/version.json`의 `sourceCommit`, `testCount`, `dataTables`를 source의 clean SHA와 비교한다. `/v1/version.json`과 V1 화면이 이전 값 그대로인지 확인한다.

- [ ] **Step 3: signed-out 공개 스모크를 수행한다**

desktop과 360×800에서 다음을 확인한다.

- title/한글/배너 정상
- V2 배너가 “개발 화면 · 운영 데이터 복사본”과 운영 미반영을 알림
- 로그인 전 write controls 비활성
- 네 탭 keyboard arrow/Home/End 동작
- 수평 overflow 0
- console error 0, failed asset 0

- [ ] **Step 4: signed-in 핵심 플로우를 수행한다**

테스트 계정으로 다음을 확인한다.

1. 템플릿 추가·수정·삭제
2. 29·30·31일과 2월 clamp
3. 시작일 25일 예산기간에서 다음 달 occurrence
4. 예정·오늘·지남·기록됨 상태
5. 확인 dialog 날짜·금액·카테고리·메모 수정
6. 저장 후 요약·내역·캘린더 갱신
7. 두 브라우저 같은 occurrence 확인 시 한 건만 존재
8. 확정 거래 수정 후 기록됨 유지
9. 확정 거래 삭제 후 예정 재등장
10. backup/export/import, sample 보존, reset 삭제, logout 개인정보 제거
11. keyboard/Escape/focus restore/live region
12. console error 0

- [ ] **Step 5: QA 데이터를 완전히 정리한다**

실행별 `$qaMarker = 'QA-V2-RECURRING-' + (Get-Date -Format 'yyyyMMdd-HHmmss')`와 생성 즉시 기록한 exact ID로 전체 예산월, export JSON, V2 DB 모두 0건인지 확인한다. exact ID가 우선이고 `$qaMarker%`는 누락 탐지용이다. production/V1 count/hash가 배포 전과 동일해야 한다.

- [ ] **Step 6: 실제 검증 근거만 source 문서에 기록한다**

공개 URL, source SHA, deploy SHA, 87개 테스트, PostgreSQL runtime 결과, auth browser 결과, QA cleanup, production/V1 불변을 기록한다. 실제로 완료하지 못한 Supabase/auth 단계는 `PENDING`을 유지한다.

```powershell
git add docs/TEST_PLAN.md manual-test-checklist.md docs/IMPROVEMENT_LOG.md
git diff --cached --check
git commit -m "V2 반복지출 공개 미리보기 검증 기록"
git push origin guardian/budget-preview-v2
```

- [ ] **Step 7: 사용자에게 버전 URL을 인계하고 운영 승격은 멈춘다**

최종 인계에는 다음을 포함한다.

- V2 URL과 V1 URL
- source/deploy SHA
- 자동·DB·브라우저 검증 결과
- V2 데이터가 `preview_v2_*`에만 저장됨
- production과 V1은 변경되지 않음
- 남은 제한과 알려진 이슈
- 사용자가 만족한 URL을 명시하기 전에는 운영 승격하지 않았다는 문장

사용자가 이후 특정 URL을 선택하면 별도 운영 승격 계획을 작성한다. 그 계획에는 운영 `transactions`의 전역 ID PK를 `(user_id, id)` 사용자 범위 키로 안전하게 마이그레이션하는 collision audit·FK/정책 검증이 포함되어야 한다. 모든 구버전 탭 종료·운영 백업·SQL-first·정확한 SHA 승격·운영 URL 재다운로드/인증 스모크 완료까지 하나의 배타적 쓰기 창을 유지한다.

---

## 최종 완료 기준

- [ ] 상태 버전 2와 반복지출 템플릿 정규화가 V1 데이터를 무손실 승격한다.
- [ ] 월 시작일·윤년·29~31일·기간 경계에서 occurrence가 중복 없이 계산된다.
- [ ] 템플릿 CRUD는 settings CAS remote-first이고 실패 시 입력·로컬 상태를 보존한다.
- [ ] 확인 거래는 결정적 ID의 순수 insert이며 23505에서 덮어쓰기 없이 재동기화한다.
- [ ] 예정 금액은 실제 합계에 포함되지 않고 네 상태가 텍스트로 구분된다.
- [ ] import/export/reset/sample/download/logout 전체 경로가 템플릿을 올바르게 보존·삭제한다.
- [ ] V2 SQL·앱·배포가 V1 preview와 production 객체/데이터/파일을 변경하지 않는다.
- [ ] 6개 문법 검사, 87개 Node 테스트, PostgreSQL 17 runtime, desktop/360×800, keyboard/a11y, signed-in 브라우저 QA가 통과한다.
- [ ] `/v2/version.json`이 정확한 clean source SHA와 V2 table을 가리킨다.
- [ ] `/v1/`은 그대로 열리고 `/v2/`는 별도 URL에서 열린다.
- [ ] QA 데이터가 브라우저와 DB에서 모두 0건으로 정리된다.
- [ ] 사용자에게 `/v2/` URL을 제공하되 운영 `master`는 승격하지 않는다.
