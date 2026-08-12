# 처음 가계부

입문자가 공용 비밀번호로 로그인해 바로 쓰는 빌드 없는 정적 가계부입니다. 가계부 데이터는 Supabase Auth + RLS로 사용자별 저장되며 브라우저 `localStorage`에는 저장하지 않습니다.

## 로컬 실행

프로젝트 루트에서 정적 서버를 시작합니다.

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

브라우저에서 `http://127.0.0.1:8765/`에 접속합니다. 정확한 운영 주소가 아닌 모든 환경은 fail-closed로 V2 미리보기 저장소를 사용하므로, 로그인한 로컬 화면도 운영 데이터에 직접 쓰지 않습니다.

## 사용자 기능

- 홈·내역·캘린더·설정 네 탭이 같은 예산 월을 공유합니다.
- 이전 달·이번 달·다음 달로 이동하고, 유형·검색어·카테고리 필터를 함께 사용할 수 있습니다.
- 거래의 날짜·유형·카테고리·금액·메모를 수정하거나 삭제할 수 있습니다.
- 캘린더에서 날짜별 수입·지출 합계, 건수, 상세 거래를 확인할 수 있습니다.
- 월별 총예산, 카테고리별 예산, 예산 시작일을 설정할 수 있습니다.
- 설정 탭에서 월세·구독료 같은 반복지출의 이름, 지출 카테고리, 예상 금액, 매월 결제일을 등록·수정·삭제할 수 있습니다.
- 홈 탭의 예정 목록은 `지남`, `오늘`, `예정`, `기록됨`을 텍스트로 구분합니다. 별도의 다섯 번째 탭은 추가하지 않습니다.
- 예정 항목을 지출로 기록하기 전에 사용일·실제 금액·카테고리·메모를 수정할 수 있습니다. 예정 금액은 확정 전까지 실제 합계에 포함되지 않습니다.
- 확정 거래를 수정해도 기록 상태가 유지되고, 현재 템플릿이 남아 있는 상태에서 거래를 삭제하면 같은 예정 항목이 다시 나타납니다. 템플릿 변경은 이미 기록된 거래를 바꾸지 않습니다.
- JSON 백업·가져오기, 샘플 데이터, 전체 초기화, 키보드 조작, 포커스 복원, live region, 360px 화면을 지원합니다.

세부 상태와 ID 계약은 [데이터 모델](DATA_MODEL.md)을 참고합니다.

## 클라우드 저장과 충돌 처리

로그인과 클라우드 다운로드가 끝나야 쓰기 버튼이 활성화됩니다. 일반 거래는 해당 행만 Supabase에서 먼저 추가·수정·삭제하고, 성공한 뒤 화면 상태를 갱신합니다. 수정·삭제는 화면이 기억한 이전 행과 DB 행을 비교하므로 다른 브라우저가 먼저 바꾼 경우 최신 데이터를 다시 불러오게 합니다.

예산과 반복지출 템플릿은 같은 settings 행에 저장합니다. 템플릿 등록·수정·삭제도 DB의 `updated_at` 버전을 비교하는 원격 우선 CAS이며, 성공 전에는 로컬 상태를 확정하지 않습니다. JSON 가져오기·전체 초기화·샘플 교체는 설정 버전과 전체 거래 스냅샷을 함께 비교하는 5인자 RPC로 원자적으로 처리합니다.

반복지출 확정은 결정적 ID의 거래 한 행을 순수 `insert`합니다. `upsert`로 기존 거래를 덮어쓰지 않습니다. DB 오류 코드가 정확히 `23505`일 때만 최신 상태를 다시 다운로드합니다. 같은 ID 거래가 확인되면 이미 기록된 항목으로 안내하고, 그렇지 않거나 재다운로드가 실패하면 충돌로 처리합니다.

로그아웃하면 메모리의 금융 데이터, 반복지출 상호작용 상태, 필터를 비우고 쓰기를 잠급니다.

## 환경별 격리

정확한 canonical origin `https://suho-j.github.io`와 pathname `/beginner-budget/`가 모두 일치할 때만 운영 `budget_settings`, `transactions`, `replace_budget_state`를 사용합니다. 그 외 HTTP·`file://`·로컬·LAN·스테이징·커스텀 호스트·잘못된 경로는 모두 V2 미리보기 대상으로 라우팅됩니다.

각 행은 해당 버전의 배포 산출물 기준입니다. 현재 V2 소스를 V1 폴더에 덮어쓰지 않습니다.

| 환경 | URL | settings | transactions | 전체 상태 RPC |
| --- | --- | --- | --- | --- |
| 운영 | `https://suho-j.github.io/beginner-budget/` | `budget_settings` | `transactions` | `replace_budget_state` |
| V1 미리보기 | `https://suho-j.github.io/beginner-budget-preview/v1/` | `preview_budget_settings` | `preview_transactions` | `replace_preview_budget_state` |
| V2 미리보기 | `https://suho-j.github.io/beginner-budget-preview/v2/` | `preview_v2_budget_settings` | `preview_v2_transactions` | `replace_preview_v2_budget_state` |

V1과 V2는 URL, 테이블, RPC, seed marker가 서로 다릅니다. V2 앱·SQL·배포는 V1 미리보기 파일과 `preview_*` 객체, 운영 객체를 수정하지 않아야 합니다.

## V2 SQL 선행 게이트

V2 URL을 로그인 상태로 열기 전에 [V2 미리보기 SQL](supabase-preview-v2-setup.sql)을 한 단위로 적용하고 [테스트 계획](TEST_PLAN.md)의 seed 검증을 완료해야 합니다. 순서를 바꾸면 V2 앱이 아직 없는 테이블이나 RPC에 접근할 수 있습니다.

SQL은 다음 계약을 fail-closed로 검사합니다.

- V2 전용 settings·transactions·seed metadata의 컬럼, PK, FK, CHECK
- 거래 PK `(user_id, id)`와 사용자 범위를 벗어난 전역 unique 부재
- 정확한 RLS 정책 집합과 authenticated 최소 권한
- 설정 `updated_at` 단조 트리거와 5인자 CAS RPC
- 운영 데이터의 결정적 레거시 ID 매핑과 사용자 범위 충돌 0건
- 운영→V2 일회 복사, canonical 양방향 비교, `production_snapshot_v2` marker

최초 seed 직전에는 운영·V1·V2·로컬의 로그인 탭과 API writer를 모두 멈추는 짧은 배타적 창이 필요합니다. authoritative backup, 사용자별 두 운영 테이블의 행 수와 canonical hash, ID 매핑·충돌 감사를 창 안에서 기록합니다. V2 SQL만 적용한 뒤 운영과 V1의 count/hash가 그대로인지 확인하고, marker가 있는 재실행에서 V2 행과 값이 byte-for-byte 유지되는지 확인한 후에만 쓰기를 재개합니다. marker를 지워 reseed하지 않습니다.

## 검증

```powershell
node --check js/storage.js
node --check js/transactions.js
node --check js/cloud.js
node --check js/ui.js
node --check js/app.js
node --check tests/run-tests.cjs
node tests/run-tests.cjs
git diff --check
```

2026-08-12 마지막 기능 구현 SHA `20eddaf476edfc1cb9ceaaaf9ffa953e3a0f1e94`에서 자동 테스트 `87 tests passed`를 로컬에서 확인할 수 있는 코드와 테스트가 있습니다. 이 수치는 자동 검증 근거일 뿐이며 PostgreSQL 런타임, 실제 Supabase 적용, 두 사용자 인증 QA, 공개 URL 배포 완료를 뜻하지 않습니다.

현재 상태:

- PostgreSQL 17 격리 런타임: **PENDING**
- 실제 Supabase V2 SQL 적용과 두 사용자 RLS·인증 저장 검증: **PENDING**
- 공개 `/v2/` 배포와 `/v2/version.json` source SHA 대조: **PENDING**
- 공개 데스크톱·360×800·키보드·포커스·live region·콘솔 QA 및 데이터 정리: **PENDING**
- 운영 반영: 사용자 URL 선택 전까지 범위 밖

공개 산출물이 생기면 `/v2/version.json`의 `sourceCommit`이 배포된 소스의 기준입니다. 자세한 준비·QA·정리 절차는 [테스트 계획](TEST_PLAN.md)과 [수동 체크리스트](../manual-test-checklist.md)를 따릅니다.

## V1 이력

V1은 네 탭, 월 이동, 카테고리 필터, 거래 수정, 예산 기간 캘린더와 V1 전용 미리보기 격리를 도입한 이전 버전입니다. 당시 앱·운영 SQL 소스 `eaad4ba`에서 `60 tests passed`, 미리보기 격리 보강 과정에서 `65 tests passed`, 최종 V1 runbook 보강에서 `67 tests passed`를 기록했습니다. 이 숫자와 V1 문서는 역사적 근거이며 V2 완료 상태를 나타내지 않습니다. V1 URL과 `preview_*` 데이터는 V2 검증 중에도 그대로 유지합니다.

V1 최초 seed의 역사적 안전 계약은 **짧은 운영 쓰기 중단 창**에서 운영·미리보기·로컬 로그인 탭의 쓰기를 중단하고 canonical 전체 비교 후 재개하는 것이었습니다. **명시적 reseed는 marker를 임의로 삭제하지 않고 별도 검토 절차로만 수행**합니다. 이 문장은 V1 회귀 계약을 보존하기 위한 것이며 V2 적용에는 위의 V2 SQL 게이트를 사용합니다.

## 설계·실행 문서

- [현재 V2 반복지출·예정 내역 설계](superpowers/specs/2026-08-12-budget-recurring-upcoming-v2-design.md)
- [현재 V2 구현·검증 계획](superpowers/plans/2026-08-12-budget-recurring-upcoming-v2.md)
- [과거 V1 탭·수정·캘린더 설계](superpowers/specs/2026-08-11-budget-tabs-edit-calendar-preview-design.md)
