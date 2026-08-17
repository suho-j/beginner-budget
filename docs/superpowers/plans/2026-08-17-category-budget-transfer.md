# 항목 간 예산 이동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 선택한 예산기간에서 사용하지 않은 항목 예산을 다른 항목으로 안전하게 옮기고 Supabase에 원격 우선으로 저장한다.

**Architecture:** 새 거래나 별도 이력 테이블을 만들지 않고 기존 `monthlyBudgets[YYYY-MM].categoryBudgets`의 두 항목만 같은 금액만큼 증감한다. 도메인 함수가 선택 기간의 실제 지출을 계산해 출발 항목의 남은 예산까지만 허용하고, 화면은 기존 `BudgetCloud.saveSettings` CAS 경로가 성공한 뒤에만 로컬 상태를 반영한다.

**Tech Stack:** 정적 HTML, CSS, Vanilla JavaScript, Node `assert` 테스트 러너, Supabase Auth + RLS settings CAS

---

## File map

- Modify: `tests/run-tests.cjs` — 도메인 검증, 마크업 계약, 원격 우선 저장 회귀 테스트
- Modify: `js/transactions.js` — 남은 항목 예산 계산과 예산 이동 순수 함수
- Modify: `js/ui.js` — 출발/도착 선택지, 이동 가능 금액 안내, 새 DOM 참조
- Modify: `js/app.js` — 폼 제출, CAS 저장, 성공/실패 피드백, 월 변경 동기화
- Modify: `index.html` — 설정 탭의 접근 가능한 예산 이동 폼
- Modify: `css/style.css` — 360px 우선 레이아웃과 데스크톱 3열 배치
- Modify: `docs/README.md`, `docs/DATA_MODEL.md`, `docs/TEST_PLAN.md`, `docs/IMPROVEMENT_LOG.md`, `manual-test-checklist.md` — 실제 기능 및 검증 계약 동기화

### Task 1: 예산 이동 도메인 계약

- [x] **Step 1: 정상 이동이 예산 총합과 월 총예산을 보존하는 실패 테스트 작성**

`tests/run-tests.cjs`에 `testCategoryBudgetTransferUsesOnlyUnspentSourceBudget`를 추가한다. 예산 시작일 25일, 생활비 200,000원, 비상금 300,000원, 기간 내 비상금 지출 80,000원인 상태에서 다음 호출을 검증한다.

```js
const result = win.BudgetTransactions.transferCategoryBudget(state, {
  fromCategory: '비상금',
  toCategory: '생활비',
  amount: '120,000'
}, '2026-05');

assert.strictEqual(result.ok, true);
assert.deepStrictEqual(plain(result.state.monthlyBudgets['2026-05'].categoryBudgets), {
  생활비: 320000,
  비상금: 180000
});
assert.strictEqual(result.state.monthlyBudgets['2026-05'].monthlyBudget, 700000);
assert.strictEqual(JSON.stringify(state), before);
```

- [x] **Step 2: 테스트를 실행해 RED 확인**

Run: `node tests/run-tests.cjs`

Expected: `BudgetTransactions.transferCategoryBudget is not a function` 때문에 실패한다.

- [x] **Step 3: 잘못된 이동을 거부하는 실패 테스트 작성**

동일 항목 선택, 미설정 출발 예산, 출발 항목의 `예산 - 기간 내 지출` 초과, 쉼표 형식 오류, 도착 항목의 DB 정수 상한 초과가 원본 상태를 바꾸지 않고 해당 필드 오류를 반환하는지 각각 검증한다. 기간 밖 거래는 출발 항목 사용액에 포함하지 않는다.

- [x] **Step 4: 최소 도메인 구현**

`js/transactions.js`에 아래 두 함수를 추가하고 `window.BudgetTransactions`로 내보낸다.

```js
function categoryBudgetAvailability(state, month, category) {
  const selectedBudget = window.BudgetStorage.budgetForMonth(state, month);
  const budget = Number(selectedBudget.categoryBudgets[category]) || 0;
  const spent = (state.transactions || [])
    .filter((tx) => tx.type === 'expense'
      && tx.category === category
      && window.BudgetStorage.isDateInBudgetMonth(tx.date, month, state.monthStartDay || 1))
    .reduce((sum, tx) => sum + tx.amount, 0);
  return { budget, spent, available: Math.max(0, budget - spent) };
}

function transferCategoryBudget(state, input, month) {
  const value = input && typeof input === 'object' ? input : {};
  const fromCategory = String(value.fromCategory || '').trim();
  const toCategory = String(value.toCategory || '').trim();
  const amount = parseMoneyInput(value.amount);
  const errors = [];

  if (!window.BudgetStorage.isValidMonthString(month)) errors.push(error('budgetMonth', '예산기간을 올바르게 선택해 주세요.'));
  if (!EXPENSE_CATEGORIES.includes(fromCategory)) errors.push(error('fromCategory', '가져올 항목을 골라 주세요.'));
  if (!EXPENSE_CATEGORIES.includes(toCategory)) errors.push(error('toCategory', '보낼 항목을 골라 주세요.'));
  if (fromCategory && fromCategory === toCategory) errors.push(error('toCategory', '서로 다른 두 항목을 골라 주세요.'));
  if (!amount) errors.push(error('amount', '옮길 금액은 1원 이상 2,147,483,647원 이하의 숫자로 입력해 주세요.'));
  if (errors.length) return { state, ok: false, transfer: null, errors };

  const source = categoryBudgetAvailability(state, month, fromCategory);
  if (!source.budget) {
    return { state, ok: false, transfer: null, errors: [error('fromCategory', `${fromCategory} 예산을 먼저 설정해 주세요.`)] };
  }
  if (amount > source.available) {
    return { state, ok: false, transfer: null, errors: [error('amount', `${fromCategory}에서 옮길 수 있는 금액은 남은 예산 ${source.available.toLocaleString('ko-KR')}원까지예요.`)] };
  }

  const selectedBudget = window.BudgetStorage.budgetForMonth(state, month);
  const nextBudgets = { ...selectedBudget.categoryBudgets };
  const nextTargetBudget = (Number(nextBudgets[toCategory]) || 0) + amount;
  if (!window.BudgetStorage.isPositiveInteger(nextTargetBudget)) {
    return { state, ok: false, transfer: null, errors: [error('amount', `${toCategory} 예산은 2,147,483,647원을 넘을 수 없어요.`)] };
  }
  const nextSourceBudget = source.budget - amount;
  if (nextSourceBudget > 0) nextBudgets[fromCategory] = nextSourceBudget;
  else delete nextBudgets[fromCategory];
  nextBudgets[toCategory] = nextTargetBudget;

  const result = setCategoryBudgets(state, nextBudgets, month);
  return {
    ...result,
    transfer: {
      fromCategory,
      toCategory,
      amount,
      fromRemaining: nextSourceBudget,
      toBudget: nextTargetBudget
    }
  };
}
```

- [x] **Step 5: GREEN 확인**

Run: `node tests/run-tests.cjs`

Expected: 새 도메인 테스트를 포함해 모든 테스트가 통과한다.

### Task 2: 접근 가능한 예산 이동 UI와 원격 우선 저장

- [x] **Step 1: 마크업·앱 통합 실패 테스트 작성**

`tests/run-tests.cjs`에 다음 계약을 검증한다.

```js
for (const id of [
  'budget-transfer-form', 'budget-transfer-from', 'budget-transfer-to',
  'budget-transfer-amount', 'budget-transfer-available',
  'budget-transfer-save', 'budget-transfer-message'
]) assert.ok(source.includes(`id="${id}"`));
```

또한 모든 입력에 연결된 `<label>`, 도움말/상태 영역의 `aria-live="polite"`, 저장 버튼의 `data-cloud-write`를 검사한다. 앱 하네스에서는 비상금 300,000원에서 생활비로 120,000원을 옮겼을 때 `BudgetCloud.saveSettings(nextState)`가 한 번 호출되고, 성공 전에는 로컬 상태가 바뀌지 않으며 성공 후 입력 금액만 비워지는지 검증한다. Supabase 실패 시 입력과 로컬 상태는 그대로 남아야 한다.

- [x] **Step 2: 테스트를 실행해 RED 확인**

Run: `node tests/run-tests.cjs`

Expected: 새 마크업 ID 또는 폼 이벤트 연결이 없어서 실패한다.

- [x] **Step 3: HTML과 UI 헬퍼 구현**

`index.html`의 `항목별 잔액` 패널 안에 `어디에서`, `어디로`, `얼마를` 필드와 `예산 옮기기` 버튼을 추가한다. 안내 문구는 `총예산은 그대로이고 항목별 예산만 바뀌어요.`로 고정한다.

`js/ui.js`에 다음 책임을 추가한다.

```js
function fillBudgetTransferCategoryOptions(elements) {
  const fromSelected = elements.budgetTransferFrom.value;
  const toSelected = elements.budgetTransferTo.value;
  [elements.budgetTransferFrom, elements.budgetTransferTo].forEach((select) => {
    select.innerHTML = '';
    window.BudgetTransactions.EXPENSE_CATEGORIES.forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      select.append(option);
    });
  });
  elements.budgetTransferFrom.value = window.BudgetTransactions.EXPENSE_CATEGORIES.includes(fromSelected)
    ? fromSelected
    : '비상금';
  elements.budgetTransferTo.value = window.BudgetTransactions.EXPENSE_CATEGORIES.includes(toSelected)
    && toSelected !== elements.budgetTransferFrom.value
    ? toSelected
    : '생활비';
}

function renderBudgetTransferAvailability(elements, state, month) {
  const category = elements.budgetTransferFrom.value;
  const source = window.BudgetTransactions.categoryBudgetAvailability(state, month, category);
  elements.budgetTransferAvailable.textContent = source.budget > 0
    ? `${category} 예산 ${formatWon(source.budget)} 중 ${formatWon(source.spent)}을 사용했고, ${formatWon(source.available)}까지 옮길 수 있어요.`
    : `${category} 예산이 설정되지 않았어요.`;
}
```

- [x] **Step 4: 앱의 원격 우선 제출 구현**

`js/app.js`에 `handleBudgetTransferSubmit`을 추가한다.

```js
const result = window.BudgetTransactions.transferCategoryBudget(state, {
  fromCategory: elements.budgetTransferFrom.value,
  toCategory: elements.budgetTransferTo.value,
  amount: elements.budgetTransferAmount.value
}, viewState.month);
```

검증 오류는 기존 `showValidationErrors`로 첫 오류 필드에 포커스하고, 성공 후보는 기존 `persistRemoteFirst(result.state, () => BudgetCloud.saveSettings(result.state), ...)`를 사용한다. 저장 성공 후에만 금액을 비우고 `비상금에서 생활비로 120,000원을 옮겼어요.` 형태의 live-region 메시지를 표시한다.

- [x] **Step 5: 반응형 스타일 구현 및 GREEN 확인**

모바일은 세 필드를 한 열로, 560px 이상은 세 열로 배치한다. 기존 색상 변수와 포커스 스타일을 재사용하고 정보 전달을 색상에만 의존하지 않는다.

Run: `node tests/run-tests.cjs`

Expected: 도메인, 마크업, 앱 원격 우선 테스트가 모두 통과한다.

### Task 3: 문서와 최종 검증

- [x] **Step 1: 문서 동기화**

README와 DATA_MODEL에 예산 이동이 새 저장 형식을 만들지 않으며 선택 기간의 `categoryBudgets`만 변경한다고 기록한다. TEST_PLAN과 수동 체크리스트에는 정상 이동, 잔액 초과 거부, Supabase 실패 롤백, 모바일/키보드 확인을 추가한다. IMPROVEMENT_LOG에는 구현 날짜와 실제 검증 결과를 기록한다.

- [x] **Step 2: 전체 정적·자동 검증**

Run:

```powershell
node --check js/storage.js
node --check js/transactions.js
node --check js/ui.js
node --check js/app.js
node tests/run-tests.cjs
```

Expected: 모든 명령이 exit code 0이고 테스트 실패가 없다.

- [ ] **Step 3: 실제 브라우저 스모크**

Run: `python -m http.server 8000 --bind 127.0.0.1`

로그인된 테스트 세션에서 비상금 → 생활비 이동, 쉼표 포함 금액, 잔액 초과 오류, 요약 즉시 갱신, 새로고침 후 유지, 콘솔 오류 없음, 360px 가로 넘침 없음, Tab/Enter 흐름과 live-region 안내를 확인한다. 실제 Supabase 쓰기를 수행할 수 없는 환경이면 그 항목을 미검증으로 명시한다.

진행 기록: 로그인하지 않은 로컬 미리보기에서 카드·기본값·명시적 라벨, 360px 1열/가로 넘침 없음, 1024px 3열, 콘솔 error/warn 0건을 확인했다. 로그인 Supabase 저장·새로고침 유지·실제 성공 live-region은 미검증이다.

- [x] **Step 4: diff와 범위 검토**

Run: `git diff --check`와 `git diff --stat`

Expected: 공백 오류가 없고 예산 이동과 문서/테스트 외 변경이 없다. 커밋, 푸시, 운영 배포는 별도 요청 전에는 수행하지 않는다.
