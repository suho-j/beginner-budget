# 테스트 계획

## 현재 검증 상태

- 2026-08-12 기존 V1 자동 검증 (`eaad4ba` 앱·운영 SQL 소스): JavaScript 문법 검사 통과, `60 tests passed`, 커밋 범위와 작업 트리 diff check 통과
- 2026-08-12 미리보기 격리 자동 검증: 이전 `65 tests passed` 근거를 보존하고 fail-closed 환경 경계·원자적 일회 seed까지 포함해 `67 tests passed`
- 로컬 비로그인 브라우저 스모크: 통과 (`http://127.0.0.1:8765/`)
- 미리보기 Supabase SQL 적용: 대기 (`docs/supabase-preview-setup.sql`)
- 미리보기 인증 저장 브라우저 스모크: 대기 (사용 가능한 로그인 세션·비밀번호 없음)
- 공개 미리보기 `/beginner-budget-preview/v1/` 스모크: 대기
- 운영 Supabase SQL·선택 버전 승격: 사용자 승인 전까지 대기

자동 검증과 실제 DB·브라우저 검증을 구분합니다. 자동 테스트가 통과했어도 미리보기 격리 SQL 적용과 인증·공개 URL 검증이 끝나기 전에는 미리보기 준비 완료로 판단하지 않습니다.

## 자동 검증

프로젝트 루트에서 실행합니다.

```powershell
node --check js/storage.js
node --check js/transactions.js
node --check js/cloud.js
node --check js/ui.js
node --check js/app.js
node --check tests/run-tests.cjs
node tests/run-tests.cjs
git diff --check
git diff --check origin/master..HEAD
```

주요 범위:

- 브라우저 저장소를 사용하지 않는 상태 정규화와 날짜·금액 검증
- 예산 시작일, 월별 예산, 29~31일 시작의 2월 경계
- 월·유형·검색어·카테고리 필터 조합
- 거래 수정과 캘린더 집계
- 네 탭, 수정 창 포커스, live region, 360px 캘린더 계약
- Supabase 행 단위 추가·수정·삭제와 기존 행 비교
- 설정 `updated_at` 충돌 검사와 로그아웃 시 버전 초기화
- 가져오기·초기화·샘플의 전체 상태 CAS와 실패 시 로컬 상태 보존
- SQL의 ID 제약 조건, 단조 증가 트리거, 원자적 RPC·잠금·권한 계약
- canonical origin `https://suho-j.github.io` + pathname `/beginner-budget/`만 운영으로 판정하고 HTTP·file·비표준 포트·origin 누락·로컬·LAN·알 수 없는 호스트·잘못된 경로를 모두 preview로 닫는 전체 Supabase 테이블·RPC 라우팅
- 미리보기 SQL의 운영 SELECT/읽기 잠금 전용, 결정적 ID 매핑, 충돌 전체 rollback, 일회 marker·재실행 byte-for-byte 불변, RLS·권한·5인자 CAS 계약
- 앱 쓰기 잠금, 로딩 실패, 충돌 안내, 로그아웃 후 메모리 제거

## 2026-08-12 로컬 비로그인 브라우저 근거

`http://127.0.0.1:8765/`에서 운영 데이터를 변경하지 않는 범위만 확인했습니다. 이 근거는 미리보기 격리 변경 전의 비로그인 UI 스모크이며, 새 복사본 배너·인증 저장 런타임 근거로 재사용하지 않습니다.

- HTTP 200과 `<title>처음 가계부</title>`을 확인했다.
- 비로그인 DOM이 정상 로드됐고 콘솔 warning·error는 모두 0건이었다.
- 탭 클릭과 `ArrowRight` 이동 뒤 선택 탭과 표시 패널이 일치했다.
- 이전 달 이동으로 `2026-08`에서 `2026-07`이 선택됐고 예산 기간 라벨도 일치했다.
- 내역에서 카테고리 `생활비`와 검색어 `QA-V1`을 함께 적용했을 때 `0건`으로 표시됐다.
- 캘린더의 `2026-07-15`를 선택했을 때 `aria-pressed="true"`, 상세 `2026-07-15 · 0건`, 빈 내역 안내가 일치했다.
- `data-cloud-write`가 붙은 9개 컨트롤은 모두 비활성화됐고, 화면에 보이는 로그인 버튼은 활성화 상태였다.
- 360×800에서 `scrollWidth 345 ≤ 360`으로 문서 가로 넘침이 없었고, 활성 캘린더 날짜 버튼은 `44×68px`이었다.
- 데스크톱과 360×800 스크린샷을 눈으로 확인했을 때 레이아웃이 일관됐다.

로그인 세션이나 비밀번호를 사용하지 않았으므로 클라우드 다운로드, 거래 추가·수정·삭제, 예산 저장·복원은 검증하지 않았습니다. 미리보기 SQL 런타임과 공개 미리보기 스모크도 아직 대기 상태이며, 이 검증에서 운영 데이터는 변경하지 않았습니다.

## 미리보기 격리 SQL 게이트

미리보기와 로컬 앱은 `preview_budget_settings`, `preview_transactions`, `replace_preview_budget_state`만 사용합니다. 단, 구 운영 writer는 설정과 거래를 여러 요청으로 저장할 수 있어 DB 잠금만으로 요청 중간 상태 복사를 막을 수 없습니다. 따라서 **최초 seed에만 별도의 짧은 운영 쓰기 중단 창**을 적용합니다.

1. 최초 seed 시작 전 모든 운영 탭을 닫고, API를 포함한 모든 운영 쓰기를 중단해 **짧은 운영 쓰기 중단 창**을 연다.
2. 창 안에서 운영 `budget_settings`, `transactions`를 읽기 전용 기준본으로 백업하고 사용자별 행 수를 기록한다.
3. 결정적 ID 매핑, 후보 간 충돌, 기존 preview 행 충돌 사전 조회를 저장한다. 이 조회는 작업자 검토용이며, SQL 내부 DB guard가 실제 안전 게이트다.
4. `docs/supabase-preview-setup.sql` 전체를 한 번에 적용한다. seed는 `REPEATABLE READ` 트랜잭션에서 운영 두 테이블과 preview 두 테이블을 잠그고, 후보·기존 행 충돌 guard, settings insert, transactions insert, canonical 양방향 비교, `production_snapshot_v1` marker 기록을 한 트랜잭션으로 완료한다. 충돌이나 비교 실패는 예외를 발생시켜 두 insert와 marker를 모두 rollback한다.
5. preview 두 테이블, canonical ID 제약, RLS 정책, authenticated 최소 DML 권한, 단조 `updated_at` 트리거, 5인자 `replace_preview_budget_state`, preview sample RPC 오버로드 제거를 확인한다.
6. 창을 유지한 채 SQL 파일의 **canonical settings** 전체 행/값 비교를 실행한다. DB 소유 버전인 preview `updated_at`은 제외하고 `user_id`, `monthly_budget`, `category_budgets`를 양방향 EXCEPT로 비교하며 결과는 0건이어야 한다.
7. SQL 파일의 **canonical transactions** 전체 행/값 비교를 실행한다. 운영 ID를 같은 규칙으로 매핑한 뒤 `id`, `user_id`, `date`, `type`, `category`, `amount`, `memo`, `source`, `created_at`을 **양방향 EXCEPT**로 비교하며 결과는 0건이어야 한다.
8. `preview_seed_metadata` 행의 source count와 백업 행 수를 대조하고, 운영 두 테이블의 행·값이 기준본과 같은지 확인한다. **seed와 canonical 전체 비교 완료 후에만 운영 쓰기 재개**를 허용한다.
9. 운영 쓰기 재개 후 같은 스냅샷 저장은 성공하고 오래된 설정 버전·거래 스냅샷은 `40001`로 거부되는지 인증 상태에서 확인한다.

canonical settings 비교와 canonical transactions 비교는 `docs/supabase-preview-setup.sql`의 `production_minus_preview`, `preview_minus_production` 양방향 EXCEPT 조회를 그대로 재실행합니다. 두 조회의 최종 `differences`가 모두 0건인 결과를 시간과 함께 보존합니다. 행 수만 비교하면 값 차이를 놓칠 수 있으므로 전체 컬럼 비교를 생략하지 않습니다.

`production_snapshot_v1` marker가 이미 있으면 재실행은 운영 잠금·guard·insert를 포함한 seed 전체를 건너뜁니다. 이후 운영 변경과 preview 수정·삭제·추가가 있어도 재실행 전후 preview 행·값과 marker는 byte-for-byte 불변이어야 합니다. **명시적 reseed는 marker를 임의로 삭제하지 말고 별도 검토 절차로만 진행**합니다.

미리보기 SQL은 운영 테이블·함수·정책을 update·delete·alter하지 않고, 운영 테이블을 읽기 일관성을 위한 SELECT/LOCK 원본으로만 사용합니다. 짧은 최초 seed 창은 아래 최종 운영 승격의 긴 단일 배타적 창과 별도입니다.

## 최종 운영 승격 단일 배타적 쓰기 창

사용자가 특정 미리보기 URL을 승인한 뒤에만 운영 창을 한 번 열고 중간에 해제하지 않습니다.

- 시작: 운영 `docs/supabase-setup.sql` 적용 직전, 최종 백업·행 수·ID 매핑·충돌 감사를 확정하기 전
- 유지: 운영 SQL 적용, 선택한 정확한 소스 SHA 승격, 운영 URL 새 다운로드·인증 스모크 전체 기간
- 종료: 운영 QA 거래 정리와 예산 원복을 확인한 뒤

창을 열 때 모든 기기의 구버전 운영 탭을 닫고 운영 URL 쓰기를 금지합니다. 창 안에서 확정한 자료만 운영 마이그레이션 기준으로 사용합니다.

## 최종 운영 Supabase SQL 게이트

`docs/supabase-setup.sql` 변경은 저장소에만 있으며 2026-08-12 현재 운영 DB에는 적용하지 않았습니다. 사용자가 특정 미리보기 URL을 승인한 뒤 최종 승격에서만 다음을 수행합니다.

1. 필요하면 창을 열기 전에 예비 백업·감사를 수행할 수 있다. 단, 이 결과는 참고용이며 SQL 적용의 기준 자료가 아니다.
2. 실제 SQL 적용 작업을 시작할 때 **먼저** 단일 배타적 쓰기 창을 열고 모든 기기의 구버전 운영 탭을 닫으며 운영 URL 쓰기를 금지한다.
3. 창 안에서 `budget_settings`, `transactions` 전체를 다시 백업해 이 백업을 마이그레이션 기준본으로 확정한다.
4. 창 안에서 아래 사용자별 행 수를 각각 다시 실행해 authoritative CSV로 저장한다. SQL 적용 후 같은 쿼리를 다시 실행해 사용자별로 대조한다.

   ```sql
   select user_id, count(*) as settings_count
   from public.budget_settings
   group by user_id
   order by user_id;

   select user_id, count(*) as transaction_count
   from public.transactions
   group by user_id
   order by user_id;
   ```

5. 창 안에서 비표준 거래 ID의 **적용 전 결정적 매핑**을 다시 실행해 authoritative CSV로 보관한다. 설정 SQL의 update도 정확히 같은 식을 사용한다.

   ```sql
   select
     user_id,
     id AS old_id,
     'tx-migrated-' || md5(user_id::text || ':' || id) AS new_id
   from public.transactions
   where id !~ '^[A-Za-z0-9._:-]+$'
   order by user_id, id;
   ```

6. 창 안에서 매핑끼리 같은 `new_id`를 만드는 경우와 기존 행 ID에 부딪히는 경우를 모두 다시 감사한다. 두 결과가 0건이어야 하며 authoritative 결과 CSV도 보관한다.

   ```sql
   with id_mapping as (
     select
       user_id,
       id AS old_id,
       'tx-migrated-' || md5(user_id::text || ':' || id) AS new_id
     from public.transactions
     where id !~ '^[A-Za-z0-9._:-]+$'
   )
   select new_id, count(*) as mapped_count
   from id_mapping
   group by new_id
   having count(*) > 1;

   with id_mapping as (
     select
       user_id,
       id AS old_id,
       'tx-migrated-' || md5(user_id::text || ':' || id) AS new_id
     from public.transactions
     where id !~ '^[A-Za-z0-9._:-]+$'
   )
   select m.user_id, m.old_id, m.new_id, t.user_id as existing_user_id
   from id_mapping m
   join public.transactions t on t.id = m.new_id;
   ```

7. 3~6단계의 authoritative 자료를 확정한 뒤 창을 유지한 채 Supabase SQL Editor에서 `docs/supabase-setup.sql`을 곧바로 적용한다. 중간에 운영 쓰기를 허용하거나 탭을 다시 열지 않는다.
8. 사용자별 `budget_settings`와 `transactions` 행 수가 적용 전 authoritative CSV와 모두 같고, 비표준 ID가 0건인지 확인한다. 매핑 결과는 5단계 CSV와 정확히 일치해야 한다.
9. `transactions_id_canonical` 제약 조건과 `set_budget_settings_updated_at` 트리거가 활성화됐는지 확인한다.
10. 5개 인자를 받는 `replace_budget_state`만 존재하고, 3개 인자 구버전과 `replace_budget_samples` 오버로드가 제거됐는지 확인한다.
11. `replace_budget_state`가 `authenticated`에만 실행 허용되고 `anon`에는 허용되지 않았는지 확인한다.
12. 격리 환경 또는 별도 테스트 계정에서 정상 전체 교체가 한 번에 완료되고, 오래된 설정 버전이나 거래 스냅샷은 `40001` 충돌로 거부되는지 확인한다.
13. 설정을 연속 저장했을 때 `updated_at`이 매번 증가하는지 확인하고, 기준 백업·매핑 CSV·사용자별 행 수를 다시 대조한다.

실패가 하나라도 있으면 운영 승격을 중단하고 백업을 보존합니다. 미리보기는 계속 격리 테이블만 사용합니다.

## 최종 운영 승격 하드 게이트

기존 운영 버전은 저장 시 오래된 전체 상태를 비원자적으로 쓸 수 있습니다. 따라서 위 단일 배타적 쓰기 창이 열려 있는 동안 다음 조건을 강제합니다.

- 모든 기기에서 기존 운영 사이트 탭을 닫고 다시 열지 않는다.
- 운영 URL에서 거래·예산·샘플·가져오기·초기화를 포함한 모든 쓰기를 금지한다.
- 운영 SQL 적용과 승인된 소스의 통제된 운영 QA 외에는 공유 DB를 변경하지 않는다.
- 사용자가 선택한 정확한 안전 소스 SHA를 운영에 승격하고 운영 URL의 새 다운로드·인증 스모크가 끝날 때까지 창을 닫지 않는다.
- 전체 기간을 보장할 수 없으면 운영 승격을 중단하고 격리 미리보기만 유지한다.

## 미리보기 복사본 안전 절차

1. 미리보기 SQL 적용 결과와 `preview_budget_settings`, `preview_transactions`의 사용자별 행 수를 기록한다.
2. 미리보기 앱에서 선택 월의 총예산과 네 카테고리 예산을 별도 메모에 스냅샷으로 남긴다.
3. 변경하지 않을 QA 접두사는 `$qaMarker = 'QA-V1-' + (Get-Date -Format 'yyyyMMdd-HHmmss')`로 만든다. 예: `QA-V1-20260812-153045`. 최초 메모는 `<marker>-추가`, 수정 메모는 `<marker>-수정`처럼 항상 같은 접두사를 유지한다.
4. QA 거래 한 건을 쉼표 금액으로 추가한 즉시 생성된 거래 ID를 기록한다. 같은 ID의 날짜·카테고리·금액·메모를 수정하되 ID와 QA 접두사는 바꾸지 않는다.
5. 내역 탭에서 수정한 카테고리를 선택해 정확히 한 건이 보이는지 확인한다.
6. 캘린더에서 수정한 날짜의 합계·건수와 상세 거래를 확인한다.
7. 같은 QA 거래를 삭제하고 브라우저에서 최종 클라우드 다운로드 후 JSON 내보내기를 새로 받는다. 모든 월의 거래를 대상으로 기록한 ID 또는 QA 접두사가 남아 있지 않아야 한다.
8. DB에서도 `select count(*) from public.preview_transactions where id = '<QA ID>' or memo like '<marker>%';` 결과가 0인지 확인한다.
9. 예산 저장을 검증했다면 즉시 2단계의 총예산과 카테고리 예산으로 복원한다. 충돌 메시지가 나오면 재시도하지 말고 클라우드를 다시 불러온 뒤 현재 값을 대조한다.
10. 마지막으로 클라우드 데이터를 다시 다운로드하고 브라우저·DB 모두에서 QA ID와 접두사가 0건이며 예산이 원래 값과 일치하는지 확인한다.
11. 검증 로그에 시작·종료 시각, 불변 QA 접두사, QA ID, 원복 값, 콘솔 오류 수를 남기고 운영 두 테이블이 바뀌지 않았음을 확인한다.

미리보기 복사본 스모크에서도 범위를 좁히기 위해 **JSON 가져오기와 전체 초기화를 실행하지 않습니다.** 샘플 데이터도 전체 상태를 바꾸므로 브라우저 스모크 대상에서 제외합니다.

## 데스크톱 브라우저 스모크

다음 순서로 검증합니다.

```text
`개발 화면 · 운영 데이터 복사본`과 운영 미반영 안내 확인
-> 로그인
-> 클라우드 다운로드
-> 이전 달 / 다음 달 / 이번 달
-> 홈에서 <marker>-추가 거래 추가(쉼표 금액) 후 QA ID 즉시 기록
-> 내역에서 유형 + 검색어 + 카테고리 필터
-> 같은 QA ID 거래를 <marker>-수정 메모로 수정(다른 예산 월 이동 안내 포함)
-> 캘린더에서 수정 날짜와 상세 확인
-> QA 거래 삭제
-> 설정 예산 저장 후 원래 값 복원
-> 최종 클라우드 다운로드
```

기대 결과:

- 저장 성공 전에는 로컬 목록과 합계가 바뀌지 않는다.
- 다른 브라우저 충돌은 명확한 메시지를 보이고 클라우드 다시 불러오기를 요구한다.
- 로그아웃하면 금액·거래·필터가 화면에서 제거되고 쓰기 버튼이 잠긴다.
- 콘솔 오류가 0건이다.
- 종료 후 브라우저 전체 월과 `preview_transactions`에서 QA ID 또는 불변 접두사가 0건이고 미리보기 예산이 원상 복원됐다.
- 운영 `budget_settings`, `transactions`에는 미리보기 QA 변경이 없다.

## 키보드·스크린리더·360px 스모크

- Tab으로 네 탭과 각 입력·버튼에 도달할 수 있다.
- 탭에서 `ArrowLeft`, `ArrowRight`, `Home`, `End`로 포커스를 이동하고 Enter 또는 Space로 활성화할 수 있다.
- 수정 창이 열리면 첫 입력으로 포커스가 이동하고, Escape·취소 후 원래 수정 버튼 또는 해당 탭으로 돌아간다.
- 저장·오류·필터 결과·날짜 상세 건수가 live region으로 전달된다.
- 캘린더 날짜 버튼의 이름으로 날짜, 수입·지출 합계, 거래 건수를 알 수 있다.
- 360×800에서 문서 전체 가로 스크롤이 없고 44px 날짜 버튼을 선택할 수 있다.
- 고정 경고와 탭이 본문이나 포커스 표시를 가리지 않는다.

## 배포 검증

V1 목표 주소는 `https://suho-j.github.io/beginner-budget-preview/v1/`입니다. 배포 폴더의 매니페스트에서 원본 저장소, `guardian/budget-preview-v1` 브랜치, 검증된 소스 SHA를 확인합니다. HTTP 200 뒤 위 브라우저 스모크를 다시 수행합니다.

사용자 승인 전에는 운영 `master`와 운영 Supabase 객체를 변경하지 않습니다. 승인된 URL의 매니페스트가 가리키는 정확한 안전 소스 SHA만 최종 운영 게이트에서 fast-forward 승격합니다. 승격 뒤 운영 URL을 새로 열어 클라우드 데이터를 다시 다운로드하고 인증 스모크·QA 0건·예산 원복·복사본 배너 숨김까지 확인한 뒤에만 단일 배타적 쓰기 창을 닫습니다.
