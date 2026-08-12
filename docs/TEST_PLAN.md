# V2 반복지출 미리보기 테스트 계획

이 문서는 V2 데이터 계약을 검증하고, 운영·V1을 건드리지 않은 채 V2 SQL을 적용하며, 반복지출 QA 데이터를 완전히 정리하는 실행 절차입니다. 실제 성공 증거가 없는 항목은 `PENDING`으로 유지합니다.

## 현재 근거와 남은 게이트

- 마지막 기능 구현 SHA: `20eddaf476edfc1cb9ceaaaf9ffa953e3a0f1e94`
- 문서 동기화 작업 트리 자동 테스트: `87 tests passed` 확인
- PostgreSQL 17 격리 런타임: **PASS — Task 13**, 검증 SHA `10cd05693449cf154f3559ca3bb27928d613eb7d`, 최종 출력 `preview-v2 PostgreSQL runtime tests passed`
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

## 2. V2 SQL 배타적 창 — 최초 시드와 안전 재실행

### 창을 열기 전 준비 — authoritative 아님

운영 데이터는 공유 DB에서 여러 요청으로 갱신될 수 있으므로 SQL의 테이블 잠금만으로 writer의 요청 사이 중간 상태를 안전하게 복사할 수 없습니다. 최초 V2 seed와 기존 marker의 안전 재실행 모두 짧은 배타적 쓰기 창을 사용합니다.

1. 실행 ID, UTC 시작 시각, evidence 보관 위치를 준비합니다.
2. 동결 전에 상태 파악용 백업이 필요하면 받을 수 있지만 파일명과 로그에 `PRELIMINARY-예비-권위없음`을 표시합니다. writer가 움직일 수 있는 시점의 백업은 **예비 자료이며 authoritative 백업이 아닙니다.** 이후 count·hash·충돌 감사나 복구 기준으로 사용하지 않습니다.
3. 아래 PowerShell로 실행 전체에서 한 번만 쓸 불변 marker를 만들고 append-only evidence ledger를 시작합니다. marker는 marker 재실행 fixture와 기능 QA가 함께 사용하며 중간에 바꾸지 않습니다.

   ```powershell
   $qaMarker = 'QA-V2-RECURRING-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
   $qaLedgerPath = Join-Path '<prepared evidence directory>' 'qa-ledger.json'
   $qaLedger = [ordered]@{
     marker = $qaMarker
     templateIds = @()
     transactionIds = @()
     events = @()
   }
   $qaLedger | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $qaLedgerPath -Encoding utf8
   ```

   `templateIds`와 `transactionIds`는 ID 문자열 하나를 덮어쓰는 변수가 아닙니다. 각 생성 건을 `{ userId, id, memo, purpose, recordedAtUtc }` 형태의 레코드로 즉시 append하는 복수 배열입니다. 화면에서 템플릿의 "이름"으로 보이는 값이 저장 JSON의 `memo`이므로, 템플릿 marker는 이 실제 `memo` 필드에 넣고 ledger에도 같은 값을 기록합니다. 따라서 두 사용자가 같은 결정적 ID를 가져도 사용자별로 구분해 정리할 수 있습니다. 저장 성공 직후 다음처럼 실제 값을 append합니다. 자격증명은 넣지 않습니다.

   ```powershell
   $qaLedger.templateIds += [pscustomobject]@{
     userId = '<QA user UUID>'
     id = '<exact template ID>'
     memo = "$qaMarker-marker-template"
     purpose = 'marker-fixture'
     recordedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
   }
   $qaLedger.transactionIds += [pscustomobject]@{
     userId = '<QA user UUID>'
     id = '<exact transaction ID>'
     memo = "$qaMarker-marker-transaction"
     purpose = 'marker-fixture'
     recordedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
   }
   $qaLedger | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $qaLedgerPath -Encoding utf8
   ```

4. 로그인과 정확한 project ref를 확인하고 아래 4절의 psql `auth_gate`만 실행합니다. 서로 다른 A/B가 `auth.users`에 각각 정확히 한 행이라는 exit code 0 증거가 없으면 여기서 중단하고 writer 창을 열지 않습니다.
5. 운영, V1 미리보기, V2 미리보기, 로컬의 인증된 탭을 모든 기기에서 닫습니다.
6. 백그라운드 클라이언트와 API를 포함해 같은 Supabase 프로젝트에 쓰는 writer를 모두 중단합니다.
7. 담당자가 탭·프로세스·API writer 중단을 명시적으로 확인하고 동결 확인 시각을 기록합니다. 확인되지 않으면 다음 단계로 가지 않습니다.

이 시점부터 SQL, semantic 비교, marker 재실행 fixture, 기능 QA, QA 정리가 모두 끝날 때까지 일반 writer를 재개하지 않습니다. 창 안에서는 기록된 QA 사용자·세션의 통제된 fixture/QA 쓰기만 허용하며, 이를 일반 writer 재개로 취급하지 않습니다.

### 창 안에서 확정할 authoritative 자료

동결을 명시적으로 확인한 **뒤에**, 같은 frozen snapshot에서 아래 순서로 수행합니다. 자격증명을 파일이나 로그에 남기지 않습니다.

1. 운영 `budget_settings`, `transactions`의 **새 authoritative 전체 백업**을 승인된 암호화 백업 위치에 만듭니다. 이 원문 백업은 live verification stdout이나 evidence 폴더에 복사하지 않고, evidence에는 백업 ID·UTC 생성 시각·대상 project ref만 기록합니다. 동결 전 예비 백업을 이름만 바꿔 재사용하지 않습니다.
2. 같은 frozen snapshot에서 운영과 V1 두 테이블의 사용자별 count와 아래 `production/V1 invariant hash`를 기록합니다. 이 값은 최초 시드의 source 기준이자 안전 재실행 중 운영·V1 무변경 기준입니다.
3. `to_regclass`로 V2 객체의 설치 전 ABSENT/EXISTS 상태를 판정합니다. EXISTS relation은 count와 모든 컬럼을 포함한 canonical hash만 기록하고 금융 행 원문은 출력하지 않습니다. metadata가 EXISTS일 때만 `production_snapshot_v2` marker를 조회해 marker ABSENT/EXISTS와 정확한 행을 기록합니다.
4. 아래 판정표로 `A 최초 시드`, `A' 불완전 최초 설치`, `B 안전 재실행`, `중단` 중 하나를 증거에 기록합니다.
5. A/A'일 때만 같은 snapshot에서 비표준 거래 ID의 결정적 매핑과 필요한 충돌 감사를 실행합니다. B에서는 현재 운영과 기존 V2가 이미 달라도 정상이므로 이를 재실행 합격 조건으로 쓰지 않습니다.
6. 해당 분기의 사전 증거와 감사를 끝낸 즉시, 다른 조회나 writer 재개 없이 정확한 V2 SQL을 적용합니다.

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

select
  (select count(*) from public.budget_settings) as settings_total,
  (select count(*) from public.transactions) as transactions_total;
```

사용자별 count와 전체 count를 같은 frozen snapshot 증거로 함께 보관합니다. A/A'의 새 marker source count는 이 전체 count와 비교합니다. B의 기존 marker source count에는 이 비교를 하지 않습니다.

#### production/V1 invariant hash

이 hash는 운영과 V1이 V2 작업 중 단 한 필드도 바뀌지 않았음을 전후 비교하기 위한 값입니다. seed 내용 비교용이 아닙니다. 정렬과 UTC 시각 표현을 고정하고 **모든 관련 컬럼**을 넣습니다. settings의 `updated_at`만 바뀌어도 반드시 hash가 달라져야 합니다.

아래 조회를 `public.budget_settings`, `public.transactions`에 실행한 뒤, 테이블명만 `public.preview_budget_settings`, `public.preview_transactions`로 바꿔 V1 결과도 저장합니다.

```sql
set timezone to 'UTC';

select
  user_id,
  count(*) as row_count,
  md5(coalesce(string_agg(
    jsonb_build_array(
      user_id,
      monthly_budget,
      category_budgets,
      to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )::text,
    E'\n' order by user_id, updated_at
  ), '')) as invariant_hash
from public.budget_settings
group by user_id
order by user_id;

select
  user_id,
  count(*) as row_count,
  md5(coalesce(string_agg(
    jsonb_build_array(
      id,
      user_id,
      date,
      type,
      category,
      amount,
      memo,
      source,
      to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )::text,
    E'\n' order by id, date, type, category, amount, memo, source, created_at
  ), '')) as invariant_hash
from public.transactions
group by user_id
order by user_id;
```

조회와 저장은 같은 frozen window 안에서 수행합니다. 시각·테이블명·사용자별 행 수·hash를 한 묶음으로 기록하고, V2 SQL·marker fixture·기능 QA·정리가 끝난 뒤 같은 조회 결과와 문자열 그대로 비교합니다.

#### 설치 전 V2 객체 ABSENT/EXISTS 분기

V2 SQL 실행 전에 먼저 관계 존재 여부만 조회합니다.

```sql
select
  to_regclass('public.preview_v2_budget_settings') as settings_relation,
  to_regclass('public.preview_v2_transactions') as transactions_relation,
  to_regclass('public.preview_v2_seed_metadata') as seed_metadata_relation;
```

- `NULL`은 `ABSENT`, relation 이름은 `EXISTS`로 evidence에 기록합니다.
- `ABSENT` relation은 count·hash 조회에서 절대 참조하지 않습니다.
- `EXISTS` relation만 아래 count·hash 조회를 실행합니다. 세션 timezone을 UTC로 고정하고 모든 컬럼의 정렬된 표현으로 hash를 계산하되 행 원문은 select하거나 보관하지 않습니다. 테이블별로 해당 relation이 EXISTS일 때만 그 조회를 실행합니다.

```sql
set timezone to 'UTC';

select
  count(*) as row_count,
  md5(coalesce(string_agg(to_jsonb(row_value)::text, E'\n' order by to_jsonb(row_value)::text), '')) as full_hash
from public.preview_v2_budget_settings as row_value;

select
  count(*) as row_count,
  md5(coalesce(string_agg(to_jsonb(row_value)::text, E'\n' order by to_jsonb(row_value)::text), '')) as full_hash
from public.preview_v2_transactions as row_value;

select
  count(*) as row_count,
  md5(coalesce(string_agg(to_jsonb(row_value)::text, E'\n' order by to_jsonb(row_value)::text), '')) as full_hash
from public.preview_v2_seed_metadata as row_value;
```

metadata relation이 EXISTS일 때만 아래 조회를 실행합니다. 결과가 0행이면 marker `ABSENT`, 정확히 1행이면 marker `EXISTS`와 그 행 전체를 evidence에 기록합니다. metadata relation 자체가 ABSENT라면 조회하지 않고 `marker ABSENT — metadata relation ABSENT`로 기록합니다.

```sql
select
  seed_key,
  completed_at,
  source_settings_count,
  source_transactions_count
from public.preview_v2_seed_metadata
where seed_key = 'production_snapshot_v2';
```

설치 전 판정은 다음 네 경우뿐입니다.

| 판정 | 설치 전 상태 | 적용 기준 |
|---|---|---|
| A 최초 시드 | V2 세 relation과 marker가 모두 ABSENT | ABSENT relation을 조회하지 않고 최초 시드 감사를 수행합니다. |
| A' 불완전 최초 설치 | V2 relation이 하나 이상 EXISTS지만 marker는 ABSENT | EXISTS relation의 사전 count·모든 컬럼 canonical hash를 보존하고, schema guard와 충돌 감사를 통과해야 합니다. 성공 뒤에는 A와 같은 최초 시드 결과를 요구합니다. |
| B 안전 재실행 | V2 세 relation이 모두 EXISTS이고 marker도 EXISTS | 기존 V2의 count·모든 컬럼 canonical hash와 marker를 사전 기준으로 삼아 SQL 전후 문자열 불변을 요구합니다. |
| 중단 | marker는 EXISTS지만 V2 세 relation 중 하나라도 ABSENT | 완전한 사전 V2 snapshot을 만들 수 없는 모순 상태입니다. SQL을 적용하지 않고 evidence를 보존해 별도 검토합니다. |

EXISTS는 곧 정상 스키마라는 뜻이 아닙니다. V2 SQL의 schema guard가 기존 객체의 정확한 계약을 검사하게 두고, drift가 있으면 실패 상태를 보존합니다. 기존 객체를 삭제·truncate·수선해 첫 설치처럼 만들지 않습니다.

A/A'의 ID 매핑은 V2 SQL과 동일한 다음 식을 사용합니다.

```sql
case
  when id ~ '^[A-Za-z0-9._:-]+$' then id
  else 'tx-migrated-' || md5(user_id::text || ':' || id)
end
```

A/A'에서는 매핑 후보를 `(user_id, mapped_id)`로 그룹화해 mapped→mapped 중복 0건을 확인합니다. A'에서 V2 transactions가 EXISTS하면 기존 V2 행과 `(user_id, id)`로 조인해 mapped→existing 값 충돌도 0건인지 확인합니다. V2 transactions가 ABSENT라면 그 relation을 참조하지 않고 `not applicable — ABSENT`로 기록합니다. A'의 기존 settings·transactions는 V2 SQL 내부의 schema guard와 양방향 existing-conflict guard도 모두 통과해야 하며, 실패한 객체를 삭제·truncate·수선하지 않습니다.

B에서는 이 seed 매핑·충돌 감사를 합격 조건으로 사용하지 않습니다. marker 확인 뒤 SQL seed 블록이 운영 data lock과 seed 충돌 검사 전에 반환하므로, 현재 운영 변경이나 기존 V2 편집·삭제·추가가 안전 재실행을 막아서는 안 됩니다.

### 분기별 V2 SQL 적용과 판정

A/A'/B로 판정되고 중단 사유가 없는 실행만 [V2 미리보기 SQL](supabase-preview-v2-setup.sql) 전체를 Supabase SQL Editor에서 정확히 한 단위로 적용합니다. V1 [미리보기 SQL](supabase-preview-setup.sql)이나 운영 SQL은 실행하지 않습니다. 성공 뒤에는 분기와 관계없이 V2 세 relation의 count·모든 컬럼 canonical hash와 marker 행을 다시 기록하고, 운영·V1의 count와 `production/V1 invariant hash`를 다시 계산해 이 실행의 동결 직후 값과 문자열 그대로 비교합니다. 어떤 phase도 금융 행 원문을 stdout/evidence에 출력하지 않습니다.

#### A/A' — marker ABSENT, 최초 시드 또는 불완전 최초 설치

1. A'라면 기존 객체에 대한 schema guard와 충돌 감사까지 통과하는지 확인합니다. 실패하면 기존 객체를 고치거나 지우지 않습니다.
2. SQL 성공 뒤 V2 세 relation의 count와 모든 컬럼 canonical hash를 기록합니다.
3. 새 `production_snapshot_v2` marker의 `source_settings_count`, `source_transactions_count`가 같은 frozen snapshot에서 기록한 authoritative 현재 운영 settings·transactions 전체 count와 각각 일치하는지 확인합니다.
4. 아래 `production→V2 seed semantic content comparison`의 양방향 차이가 모두 0건인지 확인합니다.
5. 운영·V1의 count와 `production/V1 invariant hash`가 이 실행의 동결 직후 값과 문자열 그대로 같아야 합니다.

#### B — marker EXISTS, 안전 재실행

1. 적용 전 V2 settings·transactions·metadata 각각의 count·모든 컬럼 canonical hash와 marker 정확한 행이 모두 기록됐는지 확인합니다.
2. 정확한 V2 SQL을 적용하고 schema guard가 통과했는지 확인합니다.
3. 적용 후 같은 세 relation의 count·모든 컬럼 canonical hash와 marker 행을 같은 형식으로 다시 기록합니다.
4. 적용 전후 세 relation의 count·canonical hash와 marker 행이 문자열 그대로 동일해야 합니다.
5. 운영·V1의 count와 `production/V1 invariant hash`도 이 실행의 동결 직후 값과 문자열 그대로 같아야 합니다.

B에서는 marker의 source count를 **현재** 운영 count와 비교하지 않고, 현재 운영과 V2의 semantic equality도 요구하지 않습니다. marker source count는 최초 snapshot 당시의 역사적 값이며, 그 뒤 운영과 V2는 각각 정상적으로 변경될 수 있습니다. 이 차이는 실패나 reseed 근거가 아닙니다.

어느 분기든 필수 비교가 다르거나 SQL이 실패하면 일반 writer를 재개하지 말고 authoritative 백업과 실행 로그를 보존한 채 중단합니다. A/A' 기준을 B에 적용하거나 B의 count·hash·marker 문자열 불변 기준을 새 시드 전 ABSENT relation에 적용하지 않습니다.

#### production→V2 seed semantic content comparison — A/A' 전용

이 비교는 marker가 ABSENT였던 A/A'에만 적용합니다. invariant hash와 목적·컬럼이 다르며 같은 hash라고 부르지 않습니다. V2 SQL seed 블록의 `production_minus_preview`와 `preview_minus_production` 양방향 `EXCEPT`가 실행 기준입니다.

- settings semantic content: `user_id`, `monthly_budget`, `category_budgets`. V2 `updated_at`은 V2 DB trigger가 소유하므로 의도적으로 제외합니다.
- transactions semantic content: 사용자 범위로 결정적 매핑한 `id`, `user_id`, `date`, `type`, `category`, `amount`, `memo`, `source`, `created_at` 전체입니다.
- settings와 transactions 두 방향 모두 결과가 0건이어야 합니다. 운영/V1 불변 여부는 별도의 `production/V1 invariant hash`로 판정합니다.
- B에서는 이 비교를 실행 합격 조건으로 사용하지 않습니다.

### 최초 분기 판정 뒤 marker fixture 재실행 불변성

A/A'의 최초 시드 검증 또는 B의 기존 marker 안전 재실행 검증을 먼저 끝내고 `production_snapshot_v2` marker가 EXISTS인 상태에서만 진행합니다. 창을 열기 전에 만든 `$qaMarker` 하나만 사용하며 seed marker를 삭제하지 않습니다. 기록된 QA 사용자로 다음 안전한 synthetic fixture를 수행합니다.

1. memo가 모두 `<marker>-marker-...`로 시작하는 템플릿을 최소 2개 만들고, 생성 직후 **각 `{ userId, exact id, memo, purpose: 'marker-fixture', recordedAtUtc }`를 `templateIds` 배열에 append**합니다.
2. 두 템플릿의 거래를 만들고, 생성 직후 **각 `{ userId, exact id, memo, purpose: 'marker-fixture', recordedAtUtc }`를 `transactionIds` 배열에 append**합니다.
3. 첫 번째 템플릿과 거래를 marker memo로 수정하고 `events`에 edit를 기록합니다.
4. 두 번째 거래와 템플릿을 삭제하고 `events`에 delete를 기록합니다. 삭제된 ID도 ledger 배열에서 제거하지 않습니다.
5. 재실행 직전에 V2 settings·transactions·seed metadata의 count·모든 컬럼 canonical hash와 `production_snapshot_v2` marker 행을 evidence에 저장합니다.
6. 같은 V2 SQL을 다시 실행하고 schema guard 통과를 확인합니다.
7. 세 relation의 count·모든 컬럼 canonical hash와 marker 행을 다시 저장하고 직전 값과 문자열 그대로 비교합니다.

fixture용이든 이후 기능 QA용이든 새 템플릿·거래가 만들어질 때마다 memo에 같은 marker prefix를 유지하고 사용자 ID·exact ID·memo·용도·UTC 기록 시각을 해당 복수 배열에 즉시 append합니다. ID 하나만 덮어써 보관하지 않습니다. marker prefix는 누락 탐지용이고 ledger의 모든 사용자별 exact ID가 우선 정리 대상입니다.

fixture 재실행은 위 B와 같은 계약입니다. 최신 marker를 보고 seed 전체를 건너뛰어 V2의 add·edit·delete 결과를 그대로 보존해야 하며, marker source count와 현재 운영 count의 일치나 production→V2 semantic equality를 요구하지 않습니다. 운영과 V1의 count와 `updated_at` 포함 `production/V1 invariant hash`는 이 실행 안에서 계속 동일해야 합니다. fixture는 이 시점에 정리하지 않아도 되지만 ledger에 남겨 기능 QA 종료 정리에서 모두 제거합니다. 명시적 reseed가 필요하면 marker를 지우지 말고 별도 검토된 절차를 만듭니다. 일반 writer는 계속 중단 상태입니다.

## 3. 스키마 드리프트와 PostgreSQL 런타임

V2 SQL은 기존 객체가 부분적으로 존재할 때 고쳐 쓰지 않고 적용 전에 실패해야 합니다. PostgreSQL 17 격리 검증에서 각각 독립 fixture로 다음 드리프트를 만들고 `55000` 실패와 무변경을 확인합니다.

- settings 또는 transactions의 잘못된 PK
- `auth.users(id) on delete cascade`가 아닌 FK
- canonical ID, 유형, 양수 금액, 예산 양수 CHECK의 누락·변형
- 정확한 7개 집합에 없는 rogue RLS policy
- `(user_id, id)` PK 외 거래 전역 unique 또는 표현식·부분 unique

Task 13 런타임 하네스는 PostgreSQL 17.6 격리 DB에서 사용자 A/B를 서로 다른 인증 세션으로 실행해 RLS 격리, anon/public RPC 거부, 단조 `updated_at`, CAS 성공·stale `40001`, 동일 결정적 ID의 사용자별 공존, 같은 사용자의 중복 `23505`, marker 재실행 불변, 운영·V1 무변경과 seed↔RPC 실제 lock wait를 검증했습니다. 검증 SHA `10cd05693449cf154f3559ca3bb27928d613eb7d`에서 두 session exit code 0, 잔여 컨테이너 0, 최종 출력 `preview-v2 PostgreSQL runtime tests passed`를 기록했습니다.

## 4. 실제 Supabase 두 사용자 게이트

Task 14는 setup이나 DML보다 먼저 read-only `auth_gate` phase를 실행합니다. 외부 변수로 받은 서로 다른 A/B UUID가 유효하고 `auth.users`에 각각 정확히 한 행 존재해야 합니다. 이 조건은 hard gate입니다. 어느 한 사용자가 없거나 A/B가 같으면 writer 중단 창도 열지 않고 즉시 중단합니다. 임의 UUID나 계정을 만들지 않으며, 사용자가 정상 Auth 흐름으로 둘째 계정을 준비한 뒤 `auth_gate`부터 다시 실행합니다. setup 뒤의 `preflight` phase와 혼용하지 않습니다.

### psql 실행 수단 gate

setup SQL 전체는 SQL Editor에서 적용할 수 있지만 live verification phase는 psql로만 실행합니다. SQL Editor 여러 탭은 고정 세션, `ON_ERROR_STOP`, native exit code, `application_name` 증거를 보장하지 않으므로 동시성 근거로 사용하지 않습니다. Supabase dashboard의 **Connect** 안내에서 현재 project의 host·port·database·user를 확인해 현재 PowerShell 프로세스의 `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE=require`에 넣습니다. password는 `PGPASSWORD`, 파일, 명령 인자에 넣지 않고 각 psql 호출의 `-W` prompt에 직접 입력합니다. 출력은 count·hash·SQLSTATE·PID·lock metadata로 제한하고 금융 행 원문을 출력하지 않습니다.

repo 밖 evidence 폴더, 불변 `runId`·`qaMarker`, 실제 A/B UUID를 준비한 뒤 다음 형태로 실행합니다. 실제 값과 원문 출력은 Git에 넣지 않습니다.

```powershell
$liveSql = 'tests/supabase-preview-v2-live-verification.sql'
$common = @(
  '-X', '-W', '--csv',
  '-v', 'ON_ERROR_STOP=1',
  '-v', "run_id=$runId",
  '-v', "qa_user_a=$qaUserA",
  '-v', "qa_user_b=$qaUserB",
  '-v', "qa_marker=$qaMarker"
)

function Invoke-LivePhase([string]$phase, [string]$evidenceName) {
  $phaseArgs = $common + @('-v', "live_phase=$phase", '-f', $liveSql)
  $phaseOutput = & psql @phaseArgs 2>&1
  $phaseExitCode = $LASTEXITCODE
  $phaseOutput | Set-Content -LiteralPath (Join-Path $evidenceDir $evidenceName) -Encoding utf8
  if ($phaseExitCode -ne 0) {
    throw "live phase failed: $phase (exit $phaseExitCode)"
  }
}
```

로그인과 project ref를 확인한 직후, writer 중단이나 setup 전에 `Invoke-LivePhase 'auth_gate' 'auth-gate.txt'`만 실행합니다. 이 phase는 A/B UUID 유효성, A≠B, `auth.users` 각각 정확히 한 행만 읽고 V2 객체를 요구하거나 DML하지 않아야 합니다. exit code 0과 정확한 count 증거가 없으면 중단합니다.

writer 중단과 setup 성공 뒤에는 `preflight`, A/A'에서만 `seed_canonical`, `permissions`, `rls_a`, `rls_b`, `cas_a`, `cas_b`, `duplicate_scope`를 각각 별도 psql 호출로 실행합니다. `snapshot`은 아래 marker fixture를 만든 뒤 setup 재실행 직전과 직후에 서로 다른 evidence 파일명으로 실행합니다. B에서는 `seed_canonical`을 실행 합격 조건으로 사용하지 않습니다. 모든 phase는 script 안의 UTC·bounded timeout·transaction-local role·rollback 계약과 native exit code 0을 충족해야 합니다.

이 rollback-only script는 committed winner가 필요한 교차 세션 stale CAS나 동시 same-ID insert를 증명하지 않습니다. `cas-stale`, `same-user-duplicate`, `cross-user-same-id`를 각각 별도 phase로 실행하고 advisory controller/worker, PID·lock 관찰, ledger, exact cleanup을 책임지는 reviewed PowerShell runner가 아직 없으면 이 세 항목과 Task 14 전체 live 결과를 **PENDING**으로 유지합니다. 수동 SQL Editor 탭이나 rollback-only 결과로 대체하지 않습니다.

설치 결과 판정은 위 2절의 분기를 그대로 따릅니다. A/A'에서만 운영→V2 semantic 양방향 차이 **건수** 0을 요구하며 차이 행 원문은 출력하지 않습니다. B에서는 setup 전후 V2 count·모든 컬럼 canonical hash·marker의 문자열 불변만 요구하며, 현재 운영↔V2 차이를 실패나 reseed 근거로 사용하지 않습니다.

### rollback-only 검증

RLS·권한과 단일 세션 CAS는 각 사용자 세션에서 다음 순서로 실행하고 outer transaction을 항상 rollback합니다.

1. `begin`
2. JWT subject를 transaction-local로 설정
3. `set local role authenticated`
4. `current_user = 'authenticated'`, `auth.uid() = <대상 user>` 자체 assertion
5. RLS·권한 또는 성공 CAS와 같은 세션 stale token/snapshot assertion
6. `rollback`

다음 결과를 owner 세션이 아닌 authenticated role에서 확인합니다.

- A와 B는 자신의 settings·transactions만 SELECT하고 다른 사용자 SELECT는 0행
- cross-user INSERT는 정확한 `42501`, UPDATE·DELETE는 0행이며 대상 hash 불변
- settings의 cross-user user_id 변경 차단과 settings DELETE 권한 없음
- seed metadata는 authenticated·anon·public 접근 불가
- RPC execute는 authenticated만 허용되고 anon·public은 거부
- 성공 RPC 반환 token은 저장값과 같고 이전 token보다 큼
- stale settings token과 stale transactions snapshot은 정확한 `40001`이고 사용자 전체 상태 불변

기대 오류는 `RETURNED_SQLSTATE`로 정확히 비교합니다. 다른 오류를 `WHEN OTHERS`로 성공 처리하지 않고 다시 발생시킵니다. 실제 JWT/API 경로는 이후 브라우저 로그인 스모크에서 별도로 확인합니다.

### committed disposable fixture 교차 세션 검증

교차 세션 stale CAS와 동일 ID `23505`는 모든 세션을 rollback하면 결정적으로 관찰할 수 없습니다. preflight에서 production/V1/V2 상태가 비어 있음을 확인한 전용 QA 사용자 또는 실행 전 상태를 건드리지 않는 marker 전용 행만 사용하고, winner의 최소 marker fixture만 commit합니다. full-state RPC로 실제 사용자 상태를 무표식 commit하지 않습니다.

1. controller가 `run_id`에서 만든 advisory key의 session lock을 먼저 잡습니다.
2. 두 worker는 같은 base token/snapshot을 읽고, `run_id`와 phase가 포함된 `application_name`과 backend PID를 증거에 기록한 뒤 같은 key의 `pg_advisory_xact_lock`에서 대기합니다.
3. controller는 bounded deadline 안에 `pg_locks`와 `pg_stat_activity`에서 두 PID가 실제 대기 중임을 확인합니다. 새 영속 barrier table이나 단순 sleep은 사용하지 않습니다.
4. controller가 lock을 해제하면 worker가 직렬로 진행합니다. 세 시나리오를 독립 실행합니다. `cas-stale`의 둘째 worker는 정확한 `40001`, `same-user-duplicate`의 둘째 worker는 정확한 `23505`, `cross-user-same-id`의 두 worker는 모두 성공해야 합니다. `40001` 또는 `23505` 중 아무 오류나 하나면 통과시키지 않습니다.
5. commit 성공 즉시 `{ userId, id, memo, purpose, recordedAtUtc }`를 append-only ledger에 저장합니다. user A/B가 같은 결정적 ID를 각각 저장하는 경우도 두 user-scoped record로 분리합니다.
6. transaction exact ID, template exact ID 순으로 정리하고 0건을 증명합니다. 기존 settings 행은 실행 전 canonical 값을 CAS로 복원하고 삭제하지 않습니다. settings 행은 사전 ABSENT였고 marker 소유임을 증명한 disposable 행만 마지막에 삭제할 수 있습니다.

모든 session은 bounded `statement_timeout`·`lock_timeout`을 사용합니다. deadline 초과, `40P01`, statement timeout, lock timeout, cleanup 실패 또는 production/V1 불변 hash 차이가 하나라도 있으면 실패이며 writer를 재개하지 않습니다.

live seed↔full-state RPC 경합은 실행하지 않습니다. RPC가 최초 seed 완료 뒤 생성되고 marker가 있는 setup 재실행은 seed를 즉시 건너뛰므로, live 경합 재현에는 marker/data 삭제가 필요합니다. 이는 금지된 파괴적 reseed입니다. 따라서 `NOT EXECUTED LIVE — destructive reset required`로 기록하고 Task 13 격리 PostgreSQL 17 증거를 참조합니다. 이 미실행 항목을 live 성공으로 체크하지 않습니다. 이는 live seed↔RPC 항목에만 해당하며, committed marker fixture의 교차 세션 advisory-lock 대기 검증은 위 절차대로 별도 수행합니다.

committed concurrency 정리 뒤에는 위 2절의 marker 재실행 fixture를 생략하지 않습니다. 동일 `$qaMarker`로 V2-only 템플릿·거래를 만들고 edit/delete event를 ledger에 append한 뒤 `snapshot` phase를 `marker-rerun-before.csv`로 저장합니다. 정확한 setup SQL 전체를 한 번 재실행하고 `snapshot`을 `marker-rerun-after.csv`로 다시 저장합니다. 두 snapshot의 count·hash·marker 문자열이 같고 운영·V1 invariant가 유지되어야 합니다. 이 증거가 없으면 Task 14를 완료 처리하지 않습니다.

A/B 검증에서 새로 만든 모든 템플릿·거래는 같은 `$qaMarker`로 `memo`를 시작합니다. 템플릿에서는 화면 "이름"이 이 JSON `memo` 필드입니다. 저장 성공 직후 해당 `userId`와 exact ID를 같은 복수 ledger에 append합니다. 두 사용자의 같은 ID를 한 건으로 합치지 않으며, writer 재개 전에 A/B 모두를 정리합니다.

실제 Supabase setup SQL, 인증 저장, 브라우저 결과는 아직 **PENDING**입니다.

## 5. V2 브라우저 QA

### 실행 식별자와 원복 자료

창을 열기 전에 만든 `$qaMarker`와 `$qaLedger`를 그대로 이어서 사용합니다. 새 marker나 단일 `templateId`/`transactionId` 변수로 교체하지 않습니다. 테스트한 예산 월, 원래 총예산·카테고리 예산, URL, source SHA를 ledger의 `events` 또는 같은 evidence 묶음에 기록합니다.

marker fixture와 기능 QA를 포함해 템플릿이나 거래를 만들 때마다 다음 두 작업을 저장 성공 직후 수행합니다.

1. memo가 `<marker>-월세`, `<marker>-수정`처럼 실행 marker로 시작하는지 확인합니다.
2. `userId`, exact ID, memo, 용도, UTC 기록 시각을 `templateIds` 또는 `transactionIds` 복수 배열에 즉시 append하고 시각·행동을 `events`에 남깁니다.

ledger에서 이전 ID를 덮어쓰거나 삭제하지 않습니다. 이미 테스트 중 삭제된 ID도 최종 0건 증명을 위해 남깁니다.

### 기능 시나리오

1. `/v2/` 배너와 네 탭을 확인하고 로그인해 V2 데이터를 다운로드합니다.
2. 설정에서 템플릿을 등록하고 exact ID를 ledger 배열에 즉시 append합니다. 이름·카테고리·금액·발생일을 수정한 뒤 ID와 `startsOn`이 유지되는지 확인합니다.
3. 아직 확정하지 않은 템플릿을 삭제해 예정 목록에서 사라지는지 확인하고 다시 만듭니다.
4. `오늘`, `예정` 템플릿을 만들고 하나를 확정해 `기록됨`을 확인합니다. 새 템플릿의 `startsOn` 때문에 같은 실제 날짜에 `지남`을 만들 수 없으면 OS 시계는 바꾸지 않습니다. 격리된 브라우저 테스트 context의 `Date`만 고정해 QA 템플릿을 만든 뒤 context 날짜를 하루 앞으로 옮겨 `지남`을 확인합니다. 두 context에서 같은 DB와 `$qaMarker`를 사용하고 종료 시 모두 정리합니다. 네 상태와 `지남 → 오늘 → 예정 → 기록됨` 순서를 확인합니다.
5. 31일 템플릿이 2월 28일 또는 29일, 30일인 달에는 30일로 표시되지만 설정은 31로 남는지 확인합니다.
6. 확인 dialog에서 원래 예정일 안내를 읽고 사용일·실제 금액·카테고리·marker memo를 모두 바꾼 뒤 확정합니다. 생성된 exact 거래 ID를 ledger 배열에 즉시 append하고, ID 끝의 달은 바뀐 사용일이 아니라 원래 예정 월인지 확인합니다.
7. 확정 거래를 다시 수정해도 `기록됨`인지 확인합니다. 삭제하면 예정 항목이 다시 나타나는지 확인합니다.
8. 템플릿을 수정·삭제해도 기존 확정 거래는 유지되고 이후 예정에만 반영되는지 확인합니다.
9. 예정 금액이 요약·예산 사용률·카테고리 합계·캘린더에 포함되지 않고, 확정 후 한 번만 포함되는지 확인합니다.
10. 두 브라우저에서 템플릿 settings CAS 충돌과 반복 거래 동시 확정을 재현합니다. duplicate는 기존 행을 덮어쓰지 않고 최신 다운로드로 안내해야 합니다.
11. marker memo를 넣은 전용 fixture로 JSON 내보내기·가져오기, 클라우드 재다운로드, 로그아웃의 템플릿·확정 거래·개인정보 수명주기를 확인합니다. import로 새로 생긴 각 ID도 저장 성공 직후 ledger에 append합니다.

샘플 버튼은 현재 고정 memo를 생성하여 실행 marker를 생성 시점에 넣을 수 없고, 전체 초기화는 QA 사용자의 전체 상태를 지웁니다. 따라서 이 공유 DB frozen live run에서 둘을 실행하지 않습니다. 87개 자동 테스트와 Task 13 격리 PostgreSQL 17 결과는 별도 근거로 보존하되, 공유 live Supabase에서 샘플·전체 초기화를 실행한 것으로 체크하지 않습니다.

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

1. `transactionIds` 배열을 `userId`별로 나누고 **모든 exact 거래 ID**를 순회해 먼저 삭제합니다. 이미 marker fixture에서 삭제된 ID도 조회해 0건을 기록합니다.
2. `templateIds` 배열을 `userId`별로 나누고 **모든 exact 템플릿 ID**를 순회해 삭제합니다. 이미 삭제된 ID도 0건을 기록합니다.
3. 두 exact-ID pass 뒤 marker prefix로 브라우저 전체 월과 템플릿 목록을 검색합니다. ledger에 없던 잔여 항목이 나오면 exact ID를 해당 배열에 append한 뒤 삭제하고, marker 결과가 0건이 될 때까지 반복합니다.
4. committed concurrency fixture가 기존 settings 행을 썼다면 실행 전 canonical 값을 CAS로 복원합니다. 행을 새로 만들었다면 사전 ABSENT와 marker 소유가 둘 다 증명된 disposable 행만 정확한 user ID로 삭제합니다. 기존 settings 행 전체는 삭제하지 않습니다.
5. 변경한 예산을 시작 전에 기록한 값으로 복원합니다.
6. 클라우드를 다시 다운로드하고 브라우저의 모든 예산 월을 이동하며 **ledger의 어느 ID도 없고** `$qaMarker` prefix도 0건인지 확인합니다.
7. JSON 내보내기 결과에서도 ledger의 어느 ID도 없고 marker가 0건인지 확인합니다.
8. `preview_v2_budget_settings`의 `__recurring_expense_templates`와 `preview_v2_transactions` 양쪽에서 **어느 ledger ID 또는 marker prefix도** 0건인지 확인합니다. ledger record를 `userId`별로 그룹화한 뒤 각 record의 `id`를 SQL `array[...]::text[]`에 넣습니다. ID가 하나도 없는 배열은 `array[]::text[]`을 사용합니다. A/B가 같은 ID를 가져도 각 user row를 별도로 조회합니다.

   ```sql
   select count(*) as remaining_transactions
   from public.preview_v2_transactions
   where user_id = '<QA user UUID>'::uuid
     and (
       id = any(array['<transaction ID 1>', '<transaction ID 2>']::text[])
       or memo like '<marker>%'
     );

   select count(*) as remaining_templates
   from public.preview_v2_budget_settings as settings
   cross join lateral jsonb_array_elements(
     coalesce(settings.category_budgets -> '__recurring_expense_templates', '[]'::jsonb)
   ) as template
   where settings.user_id = '<QA user UUID>'::uuid
     and (
       template ->> 'id' = any(array['<template ID 1>', '<template ID 2>']::text[])
       or template ->> 'memo' like '<marker>%'
     );
   ```
9. marker fixture에서 만든 뒤 삭제한 ID까지 포함한 ledger 전체에 대해 브라우저 모든 월·export JSON·DB가 0건임을 기록합니다.
10. 사용자별 V2 두 테이블의 최종 count·모든 컬럼 canonical hash와 seed marker를 기록합니다. 금융 행 원문은 출력하지 않습니다.
11. 운영과 V1의 `production/V1 invariant hash`와 count를 다시 계산해 동결 직후 authoritative 값과 문자열 그대로 같은지 확인합니다.
12. marker fixture와 기능 QA의 모든 ledger ID·marker가 제거되고, 예산 원복, 운영·V1 불변이 모두 확인된 뒤에만 일반 writer를 재개하고 재개 시각을 기록합니다.

정리 조회는 실행 중 기록한 사용자 ID, exact ID 복수 배열, marker로 범위를 제한합니다. 복수 사용자면 사용자별 exact-ID 조회를 모두 실행한 뒤 marker prefix 조회를 다시 실행합니다. 자격증명은 명령이나 증거 파일에 넣지 않습니다. marker fixture가 남아 있으면 일반 writer를 재개하지 않습니다.

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
