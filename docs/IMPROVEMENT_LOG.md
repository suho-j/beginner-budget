# 개선 진단 및 반복 로그

## 2026-08-12 · V2 반복지출과 예정 내역

### 구현 기준과 상태

- 문서 수정 직전 확인한 마지막 기능 구현 SHA: `20eddaf476edfc1cb9ceaaaf9ffa953e3a0f1e94`
- 개발 브랜치: `guardian/budget-preview-v2`
- 상태 계약: version 2, `recurringExpenseTemplates`, 결정적 반복 거래 ID
- V2 저장 대상: `preview_v2_budget_settings`, `preview_v2_transactions`, `replace_preview_v2_budget_state`
- V1 `/v1/`과 V2 `/v2/`는 병렬 격리하고 운영과 V1 객체·데이터·파일은 수정하지 않는다.

### 사용자 기능

- 설정 탭에 반복지출 템플릿 등록·수정·삭제를 추가했다. 템플릿은 이름, 지출 카테고리, 예상 금액, 매월 결제일을 가지며 별도의 다섯 번째 탭을 만들지 않았다.
- 홈 탭에서 선택한 예산 기간의 반복지출을 `지남`, `오늘`, `예정`, `기록됨` 상태와 예상 합계로 볼 수 있게 했다.
- 예정 항목을 지출로 기록하기 전 사용일·실제 금액·카테고리·메모를 바꿀 수 있게 했다. 미확정 금액은 실제 합계에 포함하지 않는다.
- 31일 설정은 짧은 달의 마지막 날에 표시하되 설정값은 31로 유지한다.
- 확정 거래 수정은 기록 상태를 유지하고, 거래 삭제는 예정 항목을 다시 보이게 한다. 템플릿 변경은 이미 확정된 거래를 바꾸지 않는다.

### 데이터·동시성 안전성

- 템플릿은 settings `category_budgets.__recurring_expense_templates` 예약 키에 저장하고 일반 카테고리 예산에서 제외한다.
- 템플릿 CRUD는 설정 `updated_at` CAS를 사용하는 원격 우선 저장이다.
- 반복 거래 ID는 원래 예정 월을 사용한 `tx-recurring-<templateId>-<YYYY-MM>`으로 결정한다.
- 확정은 순수 insert이며 upsert하지 않는다. 정확한 `23505`에만 재다운로드해 이미 기록된 행을 확인한다.
- V2 transactions PK를 `(user_id, id)`로 두어 다른 사용자가 같은 결정적 ID를 가질 수 있고, 같은 사용자 중복만 막는다.
- V2 SQL은 잘못된 PK·FK·CHECK, rogue RLS policy, 전역 unique를 적용 전에 거부하고 운영→V2 일회 seed와 `production_snapshot_v2` marker를 제공한다.
- JSON 백업은 version 2와 템플릿을 포함하며 V1/버전 누락 백업은 빈 템플릿으로 승격하고 미래 버전과 손상 배열은 거부한다.

### 자동 검증과 대기 중인 근거

- 마지막 기능 구현 SHA를 기준으로 작성한 문서 동기화 작업 트리에서 `node tests/run-tests.cjs`가 정확히 `87 tests passed`로 끝났다.
- 같은 작업 트리에서 여섯 JavaScript 문법 검사, 8개 대상 파일의 strict UTF-8 읽기, Markdown 상대 링크, 변경 범위·cache-buster, `git diff --check`가 통과했다.
- PostgreSQL 17 격리 런타임: **PENDING — Task 13**
- 실제 Supabase V2 SQL 적용, 두 사용자 RLS·인증 저장, QA 정리: **PENDING — Task 14**
- 배포 산출물 생성과 공개 `/v2/`: **PENDING — Tasks 15~16**
- 공개 URL의 source SHA, 데스크톱·360×800·키보드·포커스·live region·콘솔 QA: **PENDING**

따라서 이 항목은 기능 코드와 자동 검증 계약을 기록한 것이며 DB 런타임, 인증 저장, 공개 배포 완료를 주장하지 않는다. 최종 공개 산출물이 생기면 `/v2/version.json`의 `sourceCommit`을 배포 source SHA의 기준으로 삼는다. QA는 실행별 `QA-V2-RECURRING-<yyyyMMdd-HHmmss>` 접두사와 생성 즉시 기록한 exact 템플릿·거래 ID로 정리하며, 브라우저 전체 월과 V2 DB 양쪽 0건 및 운영·V1 count/hash 불변까지 확인한다.

## V1 당시 현황

- 형태: 빌드 없는 정적 HTML/CSS/JavaScript 앱
- 저장: Supabase Auth + RLS, 브라우저 `localStorage`에 가계부 데이터 저장 안 함
- 운영 저장 대상: `budget_settings`, `transactions`, `replace_budget_state`
- V1 로컬·미리보기 저장 대상: `preview_budget_settings`, `preview_transactions`, `replace_preview_budget_state`
- 개발 브랜치: `guardian/budget-preview-v1`
- V1 앱·SQL 검증 소스: `eaad4ba`
- 운영 `origin/master`: `0d487df` 유지
- 예정 V1 주소: `https://suho-j.github.io/beginner-budget-preview/v1/`
- 배포 방식: 버전 폴더와 소스 SHA 매니페스트를 둔 별도 미리보기 Pages

## 2026-08-12 · V1 월별 탭, 거래 수정, 캘린더

### 사용자 기능

- 홈·내역·캘린더·설정 네 탭과 공통 예산 월 탐색을 추가했다.
- 이전 달·이번 달·다음 달의 예산과 거래를 같은 기준으로 볼 수 있게 했다.
- 월·유형·검색어·카테고리 하나를 조합하는 내역 필터를 추가했다.
- 과거 거래의 날짜, 유형, 카테고리, 금액, 메모 수정과 다른 예산 월 이동 안내를 추가했다.
- 예산 기간 경계를 따르는 캘린더와 날짜별 수입·지출 합계, 건수, 상세 내역을 추가했다.
- 로그아웃하면 메모리의 금융 데이터와 필터를 지우고 쓰기를 잠그도록 했다.

### 데이터 안전성

- 일반 거래 추가는 한 행 insert, 수정·삭제는 기존 행 값까지 비교하는 원격 우선 변경으로 전환했다.
- 예산 설정은 DB의 `updated_at` 버전을 비교해 다른 브라우저의 선행 변경을 감지한다.
- JSON 가져오기·전체 초기화·샘플 교체는 설정 버전과 전체 거래 스냅샷을 비교하는 원자적 `replace_budget_state` RPC로 통합했다.
- 충돌이나 네트워크 오류 때 로컬 상태를 확정하지 않고 클라우드 다시 불러오기를 안내한다.
- 거래 ID를 안전한 ASCII 형식으로 제한하고, 비표준 ID를 `old_id`에서 `'tx-migrated-' || md5(user_id::text || ':' || id)`로 결정적으로 바꾸는 적용 전 매핑·보정·제약 SQL을 추가했다.
- 정확한 `suho-j.github.io/beginner-budget/`만 운영으로 라우팅하고, `file://`·로컬·LAN IP·알 수 없는 호스트·잘못된 경로는 모두 fail-closed로 preview 테이블·RPC를 사용한다.
- `docs/supabase-preview-setup.sql`은 `READ COMMITTED`에서 최신 marker를 확인한 뒤 운영·preview 모두 transactions→settings 순으로 잠그고, DB 충돌 guard, 두 복사, canonical 양방향 비교, `production_snapshot_v1` marker를 한 트랜잭션으로 실행한다. marker 이후 재실행은 seed를 건너뛰어 preview 편집·삭제·추가를 보존한다.
- preview 전용 RLS·authenticated 최소 권한·단조 설정 버전 트리거·5인자 전체 상태 CAS를 추가했다.

### 접근성·모바일

- `tablist`·`tab`·`tabpanel`, 키보드 방향키와 Home/End 이동을 구현했다.
- 수정 창의 초기 포커스, Escape·취소 후 포커스 복원, 전역 live region을 보강했다.
- 360px에서 네 탭과 44px 캘린더 날짜 버튼이 가로 스크롤 없이 들어오도록 조정했다.
- 로컬·미리보기 환경에서만 `개발 화면 · 운영 데이터 복사본`과 운영 미반영 안내를 표시한다.

### 자동 검증 근거

2026-08-12, 앱·SQL 소스 `eaad4ba`에서 다음 결과를 확인했다.

- `node --check`: storage, transactions, cloud, ui, app, 테스트 실행기 모두 통과
- `node tests/run-tests.cjs`: `60 tests passed`
- `git diff --check`와 `git diff --check origin/master..HEAD`: 통과
- `origin/master`가 개발 소스의 조상임을 확인했고 운영 브랜치는 `0d487df` 그대로다.

미리보기 격리 변경에서는 환경별 download/save/insert/update/delete/upload 대상, 운영 객체 비변경, snapshot seed, RLS·권한·트리거·5인자 CAS·오버로드 제거 구조까지 포함해 `65 tests passed`를 확인했다. fail-closed 환경 경계, 충돌 시 전체 rollback, 일회 marker·재실행 불변, 운영 쓰기 중단·canonical 비교 runbook을 보강한 당시 마지막 V1 자동 검증은 `67 tests passed`였다. 기존 `eaad4ba`의 60개 테스트 근거와 로컬 UI 스모크 근거는 그대로 보존한다.

동시성·데이터 안전 관련 주요 커밋:

- `62e5a0e`: 교차 브라우저 충돌 감지와 예산월 경계 보강
- `f9f7706`: 전체 교체 동시성 잠금 보강
- `805a908`: 샘플 충돌 방지와 설정 버전 DB 관리
- `f5d722e`: 샘플 저장을 전체 상태 충돌 검사로 통합
- `d74f3f2`: 거래 ID 계약을 안전한 ASCII 규칙으로 통일
- `eaad4ba`: 레거시 거래 ID 매핑을 결정적으로 변경

### 로컬 비로그인 브라우저 검증 근거

2026-08-12 `http://127.0.0.1:8765/`에서 운영 데이터를 쓰지 않는 범위를 확인했다.

- HTTP 200, `<title>처음 가계부</title>`, 비로그인 DOM 로드를 확인했다.
- 콘솔 warning·error는 0건이었다.
- 클릭과 `ArrowRight`로 탭 선택·패널 전환이 일치했다.
- 이전 달 이동은 `2026-08` → `2026-07`이었고 예산 기간 라벨이 맞았다.
- 카테고리 `생활비`와 검색어 `QA-V1`의 내역 결과는 `0건`이었다.
- 캘린더 `2026-07-15`는 `aria-pressed="true"`였고 상세 `2026-07-15 · 0건`과 빈 내역 안내가 맞았다.
- 9개 클라우드 쓰기 컨트롤은 모두 비활성화됐고 보이는 로그인 버튼은 활성화됐다.
- 360×800의 `scrollWidth`는 345로 뷰포트 360 이내였고 활성 날짜 버튼은 `44×68px`이었다.
- 데스크톱과 360×800 스크린샷을 눈으로 확인했을 때 레이아웃이 일관됐다.
- 로그인 세션·비밀번호를 사용하지 않았고 운영 데이터 변경은 0건이었다.

### V1 당시 남아 있던 런타임 근거

- `docs/supabase-preview-setup.sql`은 저장소에만 있으며 Supabase에 아직 적용하지 않았다.
- preview 두 테이블·RLS·권한·트리거·RPC와 운영→preview 일회성 복사의 실제 DB 검증이 남아 있다.
- 미리보기 인증 상태의 클라우드 다운로드, 거래 추가·수정·삭제, 예산 저장·복원, 수정 창 포커스 검증이 남아 있다.
- 미리보기 복사본에서 불변 접두사 `<marker> = QA-V1-<timestamp>`와 생성 직후 기록한 QA ID를 사용한 추가·수정·필터·캘린더·삭제, 모든 월과 `preview_transactions`의 0건 확인, 미리보기 예산 원복 검증이 남아 있다.
- 공개 `/beginner-budget-preview/v1/` 배포, 소스 SHA 매니페스트 확인, 공개 URL 재검증이 남아 있다.
- `docs/supabase-setup.sql` 운영 적용과 운영 승격은 사용자가 미리보기 URL을 선택한 뒤까지 대기한다.

따라서 당시 결과는 **코드·자동 테스트와 이전 로컬 비로그인 UI 스모크 근거 확보**였으며, 미리보기 인증 저장 흐름, DB 격리 SQL 런타임, 공개 미리보기 검증 완료를 뜻하지 않았다.

### 최초 seed와 최종 운영 승격 하드 게이트

최초 미리보기 seed는 writer의 다중 요청 중간 상태를 복사하지 않도록 **짧은 운영 쓰기 중단 창**에서만 수행한다. 운영·미리보기·로컬 로그인 탭을 모두 닫고 API를 포함한 모든 쓰기를 중단한 뒤 `READ COMMITTED` seed와 canonical settings·canonical transactions 전체 행/값 양방향 비교를 끝낸다. 그 뒤에만 세 환경의 쓰기를 재개하며, marker 삭제를 통한 명시적 reseed는 별도 검토 절차 없이 실행하지 않는다.

사용자가 특정 URL을 승인한 뒤에는 이 짧은 seed 창과 별도로, 운영 SQL 적용 직전에 단일 배타적 쓰기 창을 연다. 모든 기기의 구버전 운영 탭을 닫고 창 안에서 기준 백업, 사용자별 행 수, 결정적 ID 매핑, 매핑 간·기존 ID 충돌 감사를 authoritative 자료로 확정한다. 운영 SQL과 사용자가 선택한 정확한 안전 소스 SHA를 승격하고 운영 URL의 새 다운로드·인증 스모크·QA 정리를 끝낼 때까지 창을 유지한다.

## 이전 반복 기록

### 1차 안정성·가져오기 개선

- 로컬 날짜 계산, 엄격한 거래 검증, 샘플 교체, JSON 내보내기·가져오기 검증을 도입했다.
- 빈 파일, 잘못된 스키마, 1MB 초과 파일, 중복 ID를 방어했다.

### 2차 입력·인사이트 개선

- 쉼표 포함 금액, 검색 필터, 하루 사용 가능액, 최다 지출 카테고리, 카테고리별 지출을 추가했다.
- 당시 브라우저 스모크로 예산 저장, `12,000` 지출 입력, 인사이트와 검색 갱신을 확인했다.

이전 반복에서 사용했던 브라우저 저장 방식 설명은 현재 구조에 적용되지 않는다. 현재 가계부 데이터의 기준 저장소는 Supabase다.
