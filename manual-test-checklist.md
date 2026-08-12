# V2 반복지출 수동 테스트 체크리스트

상세 이유와 SQL 계약은 [테스트 계획](docs/TEST_PLAN.md)을 따릅니다. 실행별 증거가 없는 항목은 체크하지 않습니다.

## 자동·로컬 게이트

- [ ] storage, transactions, cloud, ui, app, 테스트 실행기의 `node --check`가 모두 통과했다.
- [ ] `node tests/run-tests.cjs`가 정확히 `87 tests passed`로 끝났다.
- [ ] `git diff --check`가 통과했다.
- [ ] 현재 검증 대상의 clean SHA를 기록했다.

## V2 SQL 배타적 창 — 최초 시드와 안전 재실행

- [ ] 실행 ID, UTC 시작 시각, 증거 보관 위치를 기록했다.
- [ ] 동결 전 백업을 받았다면 `PRELIMINARY-예비-권위없음`으로 표시했고 authoritative 자료·충돌 감사·복구 기준으로 사용하지 않았다.
- [ ] `$qaMarker = 'QA-V2-RECURRING-' + (Get-Date -Format 'yyyyMMdd-HHmmss')`를 만들고 `templateIds = @()`, `transactionIds = @()`, `events = @()`인 실행 전체 append-only evidence ledger를 증거 위치에 저장했다. 각 ID 배열 항목은 `{ userId, id, memo, purpose, recordedAtUtc }` record이며 append 직후 파일도 갱신한다.
- [ ] 운영·V1·V2·로컬의 모든 인증된 탭과 백그라운드/API writer를 멈췄다.
- [ ] 탭·프로세스·API writer 동결을 명시적으로 확인하고 확인 시각을 기록했다.
- [ ] **동결 확인 뒤** 운영 두 테이블의 새 authoritative 전체 백업을 만들었다. 동결 전 예비 백업을 재사용하지 않았다.
- [ ] 같은 frozen snapshot에서 운영·V1 두 테이블의 사용자별 count와 `production/V1 invariant hash`를 기록했다.
- [ ] settings invariant hash에 `user_id`, `monthly_budget`, `category_budgets`, UTC `updated_at`이 모두 포함된다.
- [ ] transactions invariant hash에 `id`, `user_id`, `date`, `type`, `category`, `amount`, `memo`, `source`, UTC `created_at`이 모두 포함된다.
- [ ] `to_regclass`로 V2 settings·transactions·seed metadata 각각을 `ABSENT` 또는 `EXISTS`로 기록했다.
- [ ] ABSENT relation은 count·dump·hash 조회에서 참조하지 않았다.
- [ ] EXISTS relation만 적용 전 count·모든 컬럼 full dump·full hash를 기록했고, 기존 객체를 삭제·truncate·수선하지 않았다.
- [ ] metadata relation이 EXISTS일 때만 `production_snapshot_v2`를 조회해 marker `ABSENT` 또는 `EXISTS`와 정확한 행을 기록했다. metadata relation이 ABSENT라면 조회하지 않고 `marker ABSENT — metadata relation ABSENT`로 기록했다.
- [ ] `A 최초 시드`, `A' 불완전 최초 설치`, `B 안전 재실행`, `중단` 중 하나를 기록했다.
- [ ] marker가 EXISTS인데 V2 세 relation 중 하나라도 ABSENT인 모순 상태라면 SQL을 적용하지 않고 중단했다.

### A/A' — marker ABSENT

- [ ] V2 세 relation이 모두 ABSENT면 A, 하나 이상 EXISTS지만 marker가 ABSENT면 A'로 판정했다.
- [ ] 같은 frozen snapshot에서 비표준 ID의 결정적 매핑 결과를 기록하고 `(user_id, mapped_id)` 기준 mapped→mapped 충돌 0건을 확인했다.
- [ ] A'에서 V2 transactions가 EXISTS인 경우만 `(user_id, id)` 기준 mapped→existing 값 충돌 0건을 확인했다. ABSENT라면 relation을 조회하지 않고 `not applicable — ABSENT`로 기록했다.
- [ ] A'의 기존 객체에 schema drift나 existing-conflict가 있으면 삭제·truncate·수선하지 않고 V2 SQL 실패 상태를 보존했다.
- [ ] 위 frozen snapshot 자료 뒤 다른 writer를 열지 않고 [V2 SQL](docs/supabase-preview-v2-setup.sql)만 정확히 한 단위로 적용했고 V1·운영 SQL은 실행하지 않았다.
- [ ] 적용 뒤 V2 세 relation 모두의 count·모든 컬럼 full dump·full hash와 새 marker 행을 기록했다.
- [ ] 새 marker의 source settings/transactions count가 같은 frozen snapshot의 authoritative 현재 운영 전체 count와 각각 일치한다.
- [ ] `production→V2 seed semantic content comparison`에서 settings의 `user_id`, `monthly_budget`, `category_budgets` 양방향 차이가 0건이다. V2 trigger 소유 `updated_at`은 이 비교에서만 제외했다.
- [ ] 같은 A/A' semantic comparison에서 transactions의 mapped ID와 모든 의미 필드(`user_id`, 날짜, 유형, 카테고리, 금액, 메모, source, `created_at`) 양방향 차이가 0건이다.
- [ ] semantic content comparison을 `production/V1 invariant hash`와 같은 hash라고 부르거나 혼용하지 않았다.
- [ ] 적용 후 운영·V1 count와 `updated_at` 포함 invariant hash가 이 실행의 동결 직후 값과 문자열 그대로 같다.

### B — marker EXISTS 안전 재실행

- [ ] V2 세 relation과 `production_snapshot_v2` marker가 모두 EXISTS이며, 세 relation의 적용 전 count·모든 컬럼 full dump·full hash와 marker 정확한 행을 기록했다.
- [ ] 다른 writer를 열지 않고 [V2 SQL](docs/supabase-preview-v2-setup.sql)만 정확히 한 단위로 적용해 schema guard 통과를 확인했다.
- [ ] 적용 뒤 같은 세 relation의 count·모든 컬럼 full dump·full hash와 marker 행을 다시 기록했다.
- [ ] 적용 전후 세 relation의 count·full dump·full hash와 marker 행이 문자열 그대로 byte-for-byte 일치한다.
- [ ] marker source count를 현재 운영 count와 비교하지 않았고, production→V2 semantic equality를 B의 합격 조건으로 요구하지 않았다.
- [ ] marker source count는 최초 snapshot의 역사적 값이며 이후 운영·V2가 정상적으로 달라질 수 있음을 실패나 reseed 근거로 사용하지 않았다.
- [ ] 적용 후 운영·V1 count와 `updated_at` 포함 invariant hash가 이 실행의 동결 직후 값과 문자열 그대로 같다.

### 공통 종료 조건

- [ ] 선택하지 않은 분기의 조건을 현재 실행에 적용하지 않았다.
- [ ] 최초 시드 또는 안전 재실행부터 marker fixture, 기능 QA, 정리 종료까지 일반 writer를 계속 중단했다.

## 최초 분기 판정 뒤 marker 재실행 fixture와 복수 ID ledger

- [ ] A/A' 최초 시드 검증 또는 B 기존 marker 안전 재실행 검증을 먼저 끝냈고 `production_snapshot_v2` marker가 EXISTS다.
- [ ] 창 시작 때 만든 동일 `$qaMarker`를 사용했고 marker 재실행용 새 marker를 만들지 않았다.
- [ ] marker memo를 가진 V2-only 템플릿을 2개 이상 만들고 각 user-scoped exact ID record를 생성 즉시 `templateIds` 배열에 append했다.
- [ ] marker memo를 가진 V2-only 거래를 만들고 각 user-scoped exact ID record를 생성 즉시 `transactionIds` 배열에 append했다.
- [ ] marker fixture에서 edit와 delete를 각각 수행하고 시각·행동·ID를 `events`에 append했다.
- [ ] fixture 중 삭제한 ID도 ledger 배열에서 제거하지 않았다.
- [ ] SQL 재실행 직전 V2 세 relation의 count·모든 컬럼 full dump·full hash와 seed marker 행을 기록했다.
- [ ] 동일 V2 SQL을 재실행해 schema guard 통과를 확인한 뒤 같은 자료를 기록해 문자열 그대로 byte-for-byte 일치했다.
- [ ] marker 재실행에서 add·edit·delete 결과가 보존되고 운영·V1 count와 `updated_at` 포함 invariant hash도 변하지 않았다.
- [ ] fixture 재실행에도 B 계약을 적용해 marker source count와 현재 운영 count의 일치나 production→V2 semantic equality를 요구하지 않았다.
- [ ] marker를 삭제하거나 임의 reseed하지 않았다.
- [ ] marker fixture 데이터는 최종 정리 ledger에 남겨 두었고 일반 writer를 재개하지 않았다.

## 스키마·PostgreSQL 런타임 — PENDING

- [ ] 잘못된 settings/transactions PK fixture가 적용 전 `55000`으로 실패하고 객체·데이터를 바꾸지 않는다.
- [ ] 잘못된 FK 또는 CHECK fixture가 적용 전 `55000`으로 실패한다.
- [ ] rogue RLS policy fixture가 적용 전 `55000`으로 실패한다.
- [ ] 거래 전역 unique·표현식 unique·부분 unique fixture가 적용 전 `55000`으로 실패한다.
- [ ] PostgreSQL 17에서 사용자 A/B RLS 격리와 anon/public RPC 거부를 확인했다.
- [ ] 단조 settings version, CAS 성공, stale `40001`을 확인했다.
- [ ] 같은 결정적 ID는 다른 사용자에게 공존하고 같은 사용자 중복은 `23505`다.
- [ ] marker 재실행, 운영·V1 불변을 런타임에서 확인했다.

## 실제 Supabase 두 사용자 — PENDING

- [ ] 기존 인증 사용자 A/B가 각각 한 명 존재한다. B가 없으면 중단하고 사용자에게 준비를 요청했다.
- [ ] A/B가 서로의 V2 settings·transactions를 읽거나 쓰지 못한다.
- [ ] A/B가 같은 결정적 거래 ID를 각각 저장할 수 있다.
- [ ] 같은 사용자 중복은 정확히 `23505`이고 upsert가 일어나지 않는다.
- [ ] 템플릿 settings stale CAS가 `40001`이고 로컬 입력을 덮어쓰지 않는다.
- [ ] A/B 검증으로 새로 만든 모든 템플릿·거래의 memo를 같은 `$qaMarker`로 시작하고, 저장 성공 직후 user-scoped exact ID record를 같은 복수 ledger에 append했다.
- [ ] 실제 검증 전후 운영·V1 count와 `updated_at` 포함 `production/V1 invariant hash`가 문자열 그대로 같다.

## V2 QA 준비

- [ ] 창 시작 때 만든 같은 `$qaMarker`와 복수 ID ledger를 그대로 사용했고 새 marker·단일 ID 변수로 교체하지 않았다.
- [ ] 시작 시각, URL, source SHA, 테스트 예산 월을 기록했다.
- [ ] 원래 총예산과 카테고리 예산을 기록했다.
- [ ] marker fixture와 기능 QA에서 만든 **모든** 템플릿의 `{ userId, exact id, marker memo, purpose, recordedAtUtc }`를 저장 성공 직후 `templateIds` 배열에 append했다.
- [ ] marker fixture와 기능 QA에서 만든 **모든** 거래의 `{ userId, exact id, marker memo, purpose, recordedAtUtc }`를 저장 성공 직후 `transactionIds` 배열에 append했다.
- [ ] 수정·삭제 이벤트도 `events`에 append했고 이미 삭제된 ID를 배열에서 제거하지 않았다.
- [ ] 모든 QA 메모가 `$qaMarker`로 시작한다.

## 반복지출 기능

- [ ] V2 화면은 홈·내역·캘린더·설정 네 탭이며 다섯 번째 탭이 없다.
- [ ] 설정에서 이름·지출 카테고리·예상 금액·1~31일로 템플릿을 등록하고 각 exact ID를 복수 ledger에 즉시 append한다.
- [ ] 템플릿 이름·카테고리·금액·발생일을 수정해도 ID와 시작일이 유지된다.
- [ ] 미확정 템플릿을 삭제하면 예정 목록에서 사라지고 기존 거래는 바뀌지 않는다.
- [ ] 예정 목록에서 `지남`, `오늘`, `예정`, `기록됨` 네 라벨을 확인한다. 새 템플릿으로 `지남`을 만들 때는 OS 시계 대신 격리 브라우저 context의 `Date`만 고정·전진했다.
- [ ] 순서가 `지남 → 오늘 → 예정 → 기록됨`, 같은 상태 안에서는 날짜 순이다.
- [ ] 31일 설정이 2월 28일/29일과 30일인 달에는 월말로 표시되지만 설정은 31로 남는다.
- [ ] 확인 dialog에 원래 예정일이 표시된다.
- [ ] 확인 전 사용일·실제 금액·카테고리·marker 메모를 모두 수정하고 생성된 각 exact 거래 ID를 복수 ledger에 즉시 append한다.
- [ ] 실제 사용일을 다른 달로 바꿔도 거래 ID 끝의 `YYYY-MM`은 원래 예정 월이다.
- [ ] 미확정 예정 금액은 요약·예산 사용률·카테고리 합계·캘린더에 포함되지 않는다.
- [ ] 확정 후 실제 거래가 합계에 정확히 한 번 포함된다.
- [ ] 확정 거래의 날짜·금액·카테고리·메모를 수정해도 `기록됨`이다.
- [ ] 확정 거래를 삭제하면 예정 항목이 다시 나타난다.
- [ ] 템플릿 수정·삭제는 이미 확정된 거래를 바꾸지 않고 이후 예정에만 반영된다.

## 동시성·전체 상태 수명주기

- [ ] 두 브라우저에서 템플릿을 동시에 저장하면 stale settings CAS가 덮어쓰기 없이 안내된다.
- [ ] 같은 반복 항목을 동시에 확정하면 한 insert만 성공하고 duplicate는 최신 데이터를 다시 받는다.
- [ ] duplicate 처리에서 기존 거래를 upsert하거나 수정하지 않는다.
- [ ] JSON 내보내기에 version 2, 템플릿, 확정 거래가 포함된다.
- [ ] V1 또는 version 누락 백업을 가져오면 템플릿은 빈 배열로 승격된다.
- [ ] future version, 손상된 transactions/templates 배열, 유효 데이터 0건 백업은 현재 상태를 지우지 않고 거부된다.
- [ ] marker fixture import·export·클라우드 재다운로드가 템플릿·거래 전체 상태 계약을 지키고 import로 생긴 모든 user-scoped ID도 즉시 ledger에 append했다.
- [ ] 샘플·전체 초기화의 87개 자동 테스트 커버리지와 별개로, marker 주입 또는 롤백 보장 격리 PostgreSQL/live 하네스 결과는 **PENDING**이다. 고정 memo 샘플·전체 상태 삭제를 공유 DB frozen run에서 실행하지 않았고, 자동 테스트만으로 수동 항목을 통과 처리하지 않았다.
- [ ] 로그아웃하면 금융 데이터, 반복지출 dialog/edit 상태, 필터가 화면과 메모리에서 사라지고 쓰기가 잠긴다.

## 데스크톱·360×800·접근성

- [ ] 데스크톱과 360×800에서 가로 스크롤과 잘린 컨트롤이 없다.
- [ ] 모든 핵심 입력·버튼에 Tab으로 접근할 수 있다.
- [ ] 탭에서 방향키·Home·End·Enter·Space가 동작한다.
- [ ] 반복지출 확인 dialog가 첫 입력으로 포커스를 옮긴다.
- [ ] Escape·취소 후 포커스가 호출 지점으로 돌아가고, 저장 후에는 반복지출 예정 제목으로 이동한다.
- [ ] 템플릿 삭제 후 포커스가 다음 항목 또는 제목으로 이동한다.
- [ ] 상태·성공·오류·충돌이 live region으로 전달된다.
- [ ] `지남`, `오늘`, `예정`, `기록됨`처럼 색상 외 텍스트가 있다.
- [ ] 브라우저 콘솔 warning·error가 0건이다.

## QA 정리

- [ ] `transactionIds` 배열을 `userId`별로 나누고 모든 exact 거래 ID를 먼저 순회해 삭제하거나 이미 0건임을 기록했다.
- [ ] `templateIds` 배열을 `userId`별로 나누고 모든 exact 템플릿 ID를 다음으로 순회해 삭제하거나 이미 0건임을 기록했다.
- [ ] exact-ID pass 뒤 marker prefix로 잔여 항목을 찾아 발견한 ID를 ledger에 append하고 삭제해 marker 0건을 만들었다.
- [ ] 변경한 총예산과 카테고리 예산을 시작 값으로 복원했다.
- [ ] 클라우드를 다시 받고 브라우저의 모든 예산 월에서 ledger의 **어느 ID도 없고** marker prefix도 0건이다.
- [ ] JSON 내보내기에서 ledger의 어느 ID도 없고 marker prefix도 0건이다.
- [ ] `preview_v2_transactions`에서 user-scoped ledger record를 사용한 `id = any(<해당 user transactionIds 배열>) OR memo like '<marker>%'`가 모든 ledger user에게 0건이다.
- [ ] `preview_v2_budget_settings.__recurring_expense_templates`에서 user-scoped ledger record를 사용한 `id = any(<해당 user templateIds 배열>) OR memo like '<marker>%'`가 모든 ledger user에게 0건이다.
- [ ] marker fixture에서 이미 삭제한 ID까지 ledger 전체의 브라우저·export·DB 0건 증거가 있다.
- [ ] 사용자별 V2 두 테이블의 최종 count·모든 컬럼 full dump·full hash와 seed marker를 기록했다.
- [ ] 운영·V1 count와 `updated_at` 포함 invariant hash가 동결 직후 authoritative 값과 문자열 그대로 같다.
- [ ] marker fixture와 기능 QA의 모든 ledger ID·marker 제거, 예산 원복, 운영·V1 불변 뒤에만 일반 writer를 재개하고 시각을 기록했다.
- [ ] marker fixture가 하나라도 남아 있는 동안 writer를 재개하지 않았다.

## 공개 `/v2/` — PENDING

- [ ] 미리보기 루트, `/v1/`, `/v2/`가 모두 HTTP 200이다.
- [ ] `/v1/` 파일과 동작이 이전 값 그대로다.
- [ ] `/v2/version.json`의 `sourceCommit`, `testCount`, V2 객체가 clean source와 일치한다.
- [ ] 공개 `/v2/`에서 전체 기능·접근성·콘솔 QA를 반복했다.
- [ ] 공개 QA exact ID와 marker를 브라우저 전체 월·export JSON·V2 DB에서 모두 정리했다.
- [ ] 공개 QA 전후 운영·V1 count와 `updated_at` 포함 `production/V1 invariant hash`가 문자열 그대로 같다.

## V1 역사적 회귀 문구

V1 최초 seed는 **짧은 운영 쓰기 중단 창**에서 운영·미리보기·로컬 로그인 탭의 쓰기를 중단했습니다. seed와 canonical 전체 비교가 끝난 뒤 운영·preview·local 쓰기를 재개하는 계약은 V1 자동 회귀를 위해 보존하며, 현재 V2 실행에는 위 V2 절차를 사용합니다.
