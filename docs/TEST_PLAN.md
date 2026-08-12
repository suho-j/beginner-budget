# V2 반복지출 미리보기 테스트 계획

이 문서는 V2 데이터 계약을 검증하고, 운영·V1을 건드리지 않은 채 V2 SQL을 적용하며, 반복지출 QA 데이터를 완전히 정리하는 실행 절차입니다. 실제 성공 증거가 없는 항목은 `PENDING`으로 유지합니다.

## 현재 근거와 남은 게이트

- 마지막 기능 구현 SHA: `20eddaf476edfc1cb9ceaaaf9ffa953e3a0f1e94`
- 문서 동기화 작업 트리 자동 테스트: `87 tests passed` 확인
- PostgreSQL 17 격리 런타임: **PENDING — Task 13**
- 실제 Supabase V2 SQL과 사용자 A/B RLS·인증 저장: **PENDING — Task 14**
- `/v2/` 산출물과 `/v2/version.json`: **PENDING — Tasks 15~16**
- 공개 URL 브라우저 QA와 QA 데이터 정리: **PENDING — Task 16**

자동 테스트 통과와 실제 PostgreSQL·Supabase·브라우저 검증은 별도 게이트입니다. 한 단계의 성공으로 다음 단계가 완료됐다고 기록하지 않습니다.

## 1. 로컬 자동 검증

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
```

성공 기준은 여섯 문법 검사 통과, 정확히 `87 tests passed`, diff 오류 0건입니다. 테스트 범위는 다음을 포함합니다.

- 상태 버전 2, V1 승격, 미래 버전·손상 배열 거부
- 반복지출 템플릿 정규화·100개 제한·CRUD·월말 보정
- 선택 예산 기간 occurrence, 네 상태, 결정적 거래 ID, 확정 후보 검증
- 예약 키 왕복과 일반 카테고리 예산 제외
- V2 fail-closed 라우팅, settings CAS, 순수 insert, 정확한 `23505` 판정
- 템플릿·예정 UI의 안전한 DOM 렌더링, 포커스, 모바일 계약
- V2 SQL의 스키마·RLS·권한·seed·5인자 RPC 정적 계약
- 가져오기·초기화·샘플·다운로드·로그아웃 전체 수명주기

## 2. 최초 V2 seed 배타적 창

### 창을 열기 전

운영 데이터는 공유 DB에서 여러 요청으로 갱신될 수 있으므로 SQL의 테이블 잠금만으로 writer의 요청 사이 중간 상태를 안전하게 복사할 수 없습니다. 최초 V2 seed에는 짧은 배타적 쓰기 창을 사용합니다.

1. 실행 ID와 UTC 시작 시각을 기록합니다.
2. 운영 `budget_settings`, `transactions`의 전체 백업을 읽기 전용으로 확보합니다.
3. 운영, V1 미리보기, V2 미리보기, 로컬의 모든 로그인 탭을 모든 기기에서 닫습니다.
4. 백그라운드 클라이언트와 API를 포함해 같은 Supabase 프로젝트에 쓰는 writer를 모두 중단합니다.
5. 중단 상태가 확인되지 않으면 SQL을 적용하지 않습니다.

### 창 안에서 확정할 authoritative 자료

자격증명을 파일이나 로그에 남기지 않습니다. 다음 결과는 실행별 evidence 위치에 시간과 함께 보관합니다.

- 운영 두 테이블의 사용자별 행 수
- 운영 두 테이블의 전체 컬럼을 canonical 순서로 직렬화한 사용자별 hash
- 비표준 거래 ID의 결정적 매핑 결과
- 같은 사용자 안의 mapped→mapped 충돌 0건
- 같은 사용자 안의 mapped→existing 충돌 0건
- 적용 전 운영, V1, V2 두 테이블의 count와 canonical hash

최소 사용자별 count 조회 예시는 다음과 같습니다.

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

같은 스냅샷의 canonical hash는 정렬 순서와 UTC 시각 표현을 고정해 계산합니다. 아래 두 조회를 먼저 운영 테이블에서 실행하고, 테이블명만 각각 `preview_budget_settings`와 `preview_transactions`로 바꿔 V1 기준도 저장합니다. V2 SQL 적용 뒤에는 `preview_v2_budget_settings`와 `preview_v2_transactions`로 바꿔 V2 결과를 저장합니다.

```sql
select
  user_id,
  count(*) as row_count,
  md5(coalesce(string_agg(
    jsonb_build_array(monthly_budget, category_budgets)::text,
    E'\n' order by user_id
  ), '')) as canonical_hash
from public.budget_settings
group by user_id
order by user_id;

select
  user_id,
  count(*) as row_count,
  md5(coalesce(string_agg(
    jsonb_build_array(
      id,
      date,
      type,
      category,
      amount,
      memo,
      source,
      to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )::text,
    E'\n' order by id, date, type, category, amount, memo, source, created_at
  ), '')) as canonical_hash
from public.transactions
group by user_id
order by user_id;
```

조회와 저장은 같은 배타적 창 안에서 수행합니다. 시각·테이블명·행 수·hash를 한 묶음으로 기록하고, 나중 결과와 문자열 그대로 비교합니다.

ID 매핑은 V2 SQL과 동일한 다음 식을 사용합니다.

```sql
case
  when id ~ '^[A-Za-z0-9._:-]+$' then id
  else 'tx-migrated-' || md5(user_id::text || ':' || id)
end
```

매핑 후보는 `(user_id, mapped_id)`로 그룹화해 mapped→mapped 중복을 찾고, 기존 V2 행과 `(user_id, id)`로 조인해 mapped→existing 값 충돌을 찾습니다. 두 결과 모두 0건이어야 합니다. count만 맞는 것은 충분하지 않으므로 settings는 `user_id`, `monthly_budget`, `category_budgets`, transactions는 매핑된 `id`, `user_id`, `date`, `type`, `category`, `amount`, `memo`, `source`, `created_at` 전체를 canonical hash에 포함합니다.

### V2 SQL만 적용

1. [V2 미리보기 SQL](supabase-preview-v2-setup.sql) 전체를 Supabase SQL Editor에서 한 단위로 실행합니다.
2. V1 [미리보기 SQL](supabase-preview-setup.sql)이나 운영 SQL은 실행하지 않습니다.
3. `production_snapshot_v2` marker와 기록된 source count를 확인합니다.
4. V2 settings·transactions의 canonical 양방향 차이가 모두 0건인지 확인합니다.
5. 운영과 V1 두 테이블의 count·canonical hash가 적용 전과 동일한지 확인합니다.
6. 하나라도 다르거나 SQL이 실패하면 writer를 재개하지 말고 백업과 실행 로그를 보존한 채 중단합니다.

### marker 재실행 불변성

marker를 삭제하지 않습니다. 최초 성공 후 V2에 marker용 테스트 변경을 만든 뒤 같은 V2 SQL을 다시 실행하고, 다음 값이 byte-for-byte 같은지 비교합니다.

- V2 settings와 transactions의 모든 행·값
- V2 seed metadata의 기존 marker 값
- 운영과 V1의 count·canonical hash

재실행은 최신 marker를 보고 seed 전체를 건너뛰어야 합니다. 명시적 reseed가 필요하면 이 SQL의 marker를 지우지 말고 별도 검토된 절차를 만듭니다.

## 3. 스키마 드리프트와 PostgreSQL 런타임

V2 SQL은 기존 객체가 부분적으로 존재할 때 고쳐 쓰지 않고 적용 전에 실패해야 합니다. PostgreSQL 17 격리 검증에서 각각 독립 fixture로 다음 드리프트를 만들고 `55000` 실패와 무변경을 확인합니다.

- settings 또는 transactions의 잘못된 PK
- `auth.users(id) on delete cascade`가 아닌 FK
- canonical ID, 유형, 양수 금액, 예산 양수 CHECK의 누락·변형
- 정확한 7개 집합에 없는 rogue RLS policy
- `(user_id, id)` PK 외 거래 전역 unique 또는 표현식·부분 unique

Task 13 런타임 하네스는 사용자 A/B를 서로 다른 인증 세션으로 실행해 RLS 격리, anon/public RPC 거부, 단조 `updated_at`, CAS 성공·stale `40001`, 동일 결정적 ID의 사용자별 공존, 같은 사용자의 중복 `23505`, marker 재실행 불변과 운영·V1 무변경을 검증합니다. 현재 결과는 **PENDING**입니다.

## 4. 실제 Supabase 두 사용자 게이트

Task 14에서 실제 프로젝트의 기존 인증 사용자 A와 B를 확인한 뒤 진행합니다. 두 번째 사용자가 없다면 임의 UUID나 계정을 만들지 않고 사용자에게 준비를 요청합니다.

- A와 B가 서로의 V2 settings·transactions를 읽거나 쓸 수 없는지 확인
- 같은 결정적 거래 ID가 A와 B에게 각각 존재할 수 있는지 확인
- 같은 사용자 중복은 정확한 `23505`인지 확인
- settings 템플릿 CRUD의 stale CAS가 `40001`인지 확인
- 운영과 V1의 count·canonical hash가 전후 동일한지 확인

실제 Supabase SQL, 인증 저장, 브라우저 결과는 아직 **PENDING**입니다.

## 5. V2 브라우저 QA

### 실행 식별자와 원복 자료

실행마다 아래 PowerShell로 불변 접두사를 만듭니다.

```powershell
$qaMarker = 'QA-V2-RECURRING-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$qaMarker
```

첫 저장 직후 다음을 즉시 기록합니다.

- `$qaMarker` 전체 문자열
- 템플릿 ID
- 확정된 반복 거래 ID
- 테스트한 예산 월
- 원래 총예산·카테고리 예산
- 시작·종료 시각, URL, source SHA

메모는 `<marker>-월세`, `<marker>-수정`처럼 접두사를 끝까지 유지합니다. exact ID가 정리의 우선 조건이고 marker prefix는 누락 탐지용입니다.

### 기능 시나리오

1. `/v2/` 배너와 네 탭을 확인하고 로그인해 V2 데이터를 다운로드합니다.
2. 설정에서 템플릿을 등록하고 ID를 기록합니다. 이름·카테고리·금액·발생일을 수정한 뒤 ID와 `startsOn`이 유지되는지 확인합니다.
3. 아직 확정하지 않은 템플릿을 삭제해 예정 목록에서 사라지는지 확인하고 다시 만듭니다.
4. `오늘`, `예정` 템플릿을 만들고 하나를 확정해 `기록됨`을 확인합니다. 새 템플릿의 `startsOn` 때문에 같은 실제 날짜에 `지남`을 만들 수 없으면 OS 시계는 바꾸지 않습니다. 격리된 브라우저 테스트 context의 `Date`만 고정해 QA 템플릿을 만든 뒤 context 날짜를 하루 앞으로 옮겨 `지남`을 확인합니다. 두 context에서 같은 DB와 `$qaMarker`를 사용하고 종료 시 모두 정리합니다. 네 상태와 `지남 → 오늘 → 예정 → 기록됨` 순서를 확인합니다.
5. 31일 템플릿이 2월 28일 또는 29일, 30일인 달에는 30일로 표시되지만 설정은 31로 남는지 확인합니다.
6. 확인 dialog에서 원래 예정일 안내를 읽고 사용일·실제 금액·카테고리·메모를 모두 바꾼 뒤 확정합니다. ID 끝의 달은 바뀐 사용일이 아니라 원래 예정 월인지 확인합니다.
7. 확정 거래를 다시 수정해도 `기록됨`인지 확인합니다. 삭제하면 예정 항목이 다시 나타나는지 확인합니다.
8. 템플릿을 수정·삭제해도 기존 확정 거래는 유지되고 이후 예정에만 반영되는지 확인합니다.
9. 예정 금액이 요약·예산 사용률·카테고리 합계·캘린더에 포함되지 않고, 확정 후 한 번만 포함되는지 확인합니다.
10. 두 브라우저에서 템플릿 settings CAS 충돌과 반복 거래 동시 확정을 재현합니다. duplicate는 기존 행을 덮어쓰지 않고 최신 다운로드로 안내해야 합니다.
11. JSON 내보내기·가져오기, 샘플, 전체 초기화, 클라우드 재다운로드, 로그아웃에서 템플릿·확정 거래·개인정보 수명주기를 확인합니다.

### 화면·접근성 시나리오

데스크톱과 360×800에서 모두 확인합니다.

- 문서 전체 가로 스크롤 없음, 버튼과 입력이 화면 밖으로 잘리지 않음
- Tab으로 네 탭, 템플릿 CRUD, 예정 기록 버튼, dialog 필드와 버튼에 접근
- 탭의 방향키·Home·End·Enter·Space 동작
- dialog 열림 초기 포커스, Escape·취소·저장 후 호출 지점 포커스 복원
- 삭제 후 다음 항목 또는 제목으로 예측 가능한 포커스 이동
- 상태·성공·오류·충돌이 live region으로 전달되고 색상 외 텍스트가 있음
- 콘솔 warning·error 0건

## 6. QA 정리와 쓰기 재개

1. 기록한 exact 거래 ID를 먼저 삭제하고, 기록한 exact 템플릿 ID를 삭제합니다.
2. 변경한 예산을 시작 전에 기록한 값으로 복원합니다.
3. 클라우드를 다시 다운로드하고 브라우저의 모든 예산 월을 이동하며 exact ID와 `$qaMarker` prefix가 0건인지 확인합니다.
4. JSON 내보내기 결과에서도 exact ID와 marker가 0건인지 확인합니다.
5. `preview_v2_budget_settings`의 `__recurring_expense_templates`와 `preview_v2_transactions` 양쪽에서 exact ID 또는 marker prefix가 0건인지 확인합니다. 기록한 사용자 ID, 템플릿 ID, 거래 ID, marker를 아래 자리표시자에 넣어 읽기 전용 조회를 실행합니다.

   ```sql
   select count(*) as remaining_transactions
   from public.preview_v2_transactions
   where user_id = '<QA user UUID>'::uuid
     and (id = '<exact transaction ID>' or memo like '<marker>%');

   select count(*) as remaining_templates
   from public.preview_v2_budget_settings as settings
   cross join lateral jsonb_array_elements(
     coalesce(settings.category_budgets -> '__recurring_expense_templates', '[]'::jsonb)
   ) as template
   where settings.user_id = '<QA user UUID>'::uuid
     and (
       template ->> 'id' = '<exact template ID>'
       or template ->> 'memo' like '<marker>%'
     );
   ```
6. 사용자별 V2 두 테이블의 최종 count를 기록합니다.
7. 운영과 V1 두 테이블의 count·canonical hash가 시작 전과 동일한지 확인합니다.
8. 브라우저와 DB 양쪽 정리, 예산 원복, 운영·V1 불변이 모두 확인된 뒤에만 writer를 재개합니다.

정리 조회는 실행 중 기록한 사용자 ID와 exact ID로 범위를 제한합니다. 자격증명은 명령이나 증거 파일에 넣지 않습니다.

## 7. 공개 배포 검증

Tasks 15~16 이후에만 실행합니다.

- `/v1/`, `/v2/`, 미리보기 루트가 모두 HTTP 200인지 확인
- `/v1/` 파일과 동작이 이전 값 그대로인지 확인
- `/v2/version.json`의 `sourceCommit`, `testCount`, V2 table/RPC 목록을 clean source SHA와 대조
- 공개 `/v2/`에서 위 브라우저 QA와 정리를 다시 실행
- 운영 URL이 계속 production 객체를 사용하고 V2 배너가 없는지 읽기·인증 스모크로 확인

공개 산출물의 source SHA는 `/v2/version.json`이 source of truth입니다. 현재 공개 URL, artifact SHA, 공개 브라우저 결과는 **PENDING**입니다.

## 부록. V1 runbook 회귀 계약

이 부록은 기존 V1 자동 회귀가 요구하는 역사적 계약이며 V2 SQL 적용 명령이 아닙니다. V1 최초 seed는 **짧은 운영 쓰기 중단 창**에서 운영·미리보기·로컬 로그인 탭의 쓰기를 중단하고, API를 포함한 세 환경의 모든 writer를 멈춘 상태로 실행했습니다. V1 SQL은 `READ COMMITTED`, `production_snapshot_v1`, **canonical settings**와 **canonical transactions** 전체 행/값의 **양방향 EXCEPT**를 사용했습니다. 비교 완료 후에만 운영·preview·local 쓰기 재개가 허용됐습니다.
