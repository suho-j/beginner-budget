# V2 반복지출 수동 테스트 체크리스트

상세 이유와 SQL 계약은 [테스트 계획](docs/TEST_PLAN.md)을 따릅니다. 실행별 증거가 없는 항목은 체크하지 않습니다.

## 자동·로컬 게이트

- [ ] storage, transactions, cloud, ui, app, 테스트 실행기의 `node --check`가 모두 통과했다.
- [ ] `node tests/run-tests.cjs`가 정확히 `87 tests passed`로 끝났다.
- [ ] `git diff --check`가 통과했다.
- [ ] 현재 검증 대상의 clean SHA를 기록했다.

## 최초 V2 seed 배타적 창

- [ ] 실행 ID, UTC 시작 시각, 증거 보관 위치를 기록했다.
- [ ] 운영 `budget_settings`, `transactions` 전체를 읽기 전용 백업했다.
- [ ] 운영·V1·V2·로컬의 모든 로그인 탭과 백그라운드/API writer를 멈췄다.
- [ ] 창 안에서 운영 두 테이블의 사용자별 count와 전체 컬럼 canonical hash를 authoritative 자료로 기록했다.
- [ ] 비표준 ID의 결정적 매핑 결과를 기록했다.
- [ ] `(user_id, mapped_id)` 기준 mapped→mapped 충돌이 0건이다.
- [ ] `(user_id, id)` 기준 mapped→existing 값 충돌이 0건이다.
- [ ] 적용 전 운영·V1·V2 두 테이블의 count와 canonical hash를 기록했다.
- [ ] [V2 SQL](docs/supabase-preview-v2-setup.sql)만 한 단위로 적용했고 V1·운영 SQL은 실행하지 않았다.
- [ ] `production_snapshot_v2` marker와 source count가 authoritative 자료와 일치한다.
- [ ] 운영→V2 settings·transactions canonical 양방향 차이가 모두 0건이다.
- [ ] 적용 후 운영과 V1 두 테이블의 count·canonical hash가 적용 전과 같다.
- [ ] marker 뒤 V2 테스트 변경을 만든 후 SQL을 재실행해 V2 행·값과 marker가 byte-for-byte 그대로다.
- [ ] marker를 삭제하거나 임의 reseed하지 않았다.
- [ ] 모든 비교가 끝난 뒤에만 writer를 재개했다.

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
- [ ] 실제 검증 전후 운영·V1 count/hash가 같다.

## V2 QA 준비

- [ ] `$qaMarker = 'QA-V2-RECURRING-' + (Get-Date -Format 'yyyyMMdd-HHmmss')`로 불변 접두사를 만들었다.
- [ ] 시작 시각, URL, source SHA, 테스트 예산 월을 기록했다.
- [ ] 원래 총예산과 카테고리 예산을 기록했다.
- [ ] 템플릿 생성 직후 exact 템플릿 ID를 기록했다.
- [ ] 반복 거래 확정 직후 exact 거래 ID를 기록했다.
- [ ] 모든 QA 메모가 `$qaMarker`로 시작한다.

## 반복지출 기능

- [ ] V2 화면은 홈·내역·캘린더·설정 네 탭이며 다섯 번째 탭이 없다.
- [ ] 설정에서 이름·지출 카테고리·예상 금액·1~31일로 템플릿을 등록한다.
- [ ] 템플릿 이름·카테고리·금액·발생일을 수정해도 ID와 시작일이 유지된다.
- [ ] 미확정 템플릿을 삭제하면 예정 목록에서 사라지고 기존 거래는 바뀌지 않는다.
- [ ] 예정 목록에서 `지남`, `오늘`, `예정`, `기록됨` 네 라벨을 확인한다. 새 템플릿으로 `지남`을 만들 때는 OS 시계 대신 격리 브라우저 context의 `Date`만 고정·전진했다.
- [ ] 순서가 `지남 → 오늘 → 예정 → 기록됨`, 같은 상태 안에서는 날짜 순이다.
- [ ] 31일 설정이 2월 28일/29일과 30일인 달에는 월말로 표시되지만 설정은 31로 남는다.
- [ ] 확인 dialog에 원래 예정일이 표시된다.
- [ ] 확인 전 사용일·실제 금액·카테고리·메모를 모두 수정할 수 있다.
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
- [ ] 샘플 교체, 전체 초기화, 클라우드 재다운로드가 템플릿·거래 전체 상태 계약을 지킨다.
- [ ] 로그아웃하면 금융 데이터, 반복지출 dialog/edit 상태, 필터가 화면과 메모리에서 사라지고 쓰기가 잠긴다.

## 데스크톱·360×800·접근성

- [ ] 데스크톱과 360×800에서 가로 스크롤과 잘린 컨트롤이 없다.
- [ ] 모든 핵심 입력·버튼에 Tab으로 접근할 수 있다.
- [ ] 탭에서 방향키·Home·End·Enter·Space가 동작한다.
- [ ] 반복지출 확인 dialog가 첫 입력으로 포커스를 옮긴다.
- [ ] Escape·취소·저장 후 포커스가 호출 지점으로 돌아간다.
- [ ] 템플릿 삭제 후 포커스가 다음 항목 또는 제목으로 이동한다.
- [ ] 상태·성공·오류·충돌이 live region으로 전달된다.
- [ ] `지남`, `오늘`, `예정`, `기록됨`처럼 색상 외 텍스트가 있다.
- [ ] 브라우저 콘솔 warning·error가 0건이다.

## QA 정리

- [ ] 기록한 exact 거래 ID를 삭제했다.
- [ ] 기록한 exact 템플릿 ID를 삭제했다.
- [ ] 변경한 총예산과 카테고리 예산을 시작 값으로 복원했다.
- [ ] 클라우드를 다시 받고 브라우저의 모든 예산 월에서 exact ID와 marker prefix가 0건이다.
- [ ] JSON 내보내기에서 exact ID와 marker prefix가 0건이다.
- [ ] `preview_v2_transactions`에서 exact 거래 ID 또는 marker prefix가 0건이다.
- [ ] `preview_v2_budget_settings.__recurring_expense_templates`에서 exact 템플릿 ID 또는 marker prefix가 0건이다.
- [ ] 사용자별 V2 두 테이블의 최종 count를 기록했다.
- [ ] 운영·V1 count/hash가 시작 전과 같다.
- [ ] 브라우저·DB 양쪽 0건, 예산 원복, 운영·V1 불변 뒤에만 writer를 재개했다.

## 공개 `/v2/` — PENDING

- [ ] 미리보기 루트, `/v1/`, `/v2/`가 모두 HTTP 200이다.
- [ ] `/v1/` 파일과 동작이 이전 값 그대로다.
- [ ] `/v2/version.json`의 `sourceCommit`, `testCount`, V2 객체가 clean source와 일치한다.
- [ ] 공개 `/v2/`에서 전체 기능·접근성·콘솔 QA를 반복했다.
- [ ] 공개 QA exact ID와 marker를 브라우저 전체 월·export JSON·V2 DB에서 모두 정리했다.
- [ ] 공개 QA 전후 운영·V1 count/hash가 같다.

## V1 역사적 회귀 문구

V1 최초 seed는 **짧은 운영 쓰기 중단 창**에서 운영·미리보기·로컬 로그인 탭의 쓰기를 중단했습니다. seed와 canonical 전체 비교가 끝난 뒤 운영·preview·local 쓰기를 재개하는 계약은 V1 자동 회귀를 위해 보존하며, 현재 V2 실행에는 위 V2 절차를 사용합니다.
