# 처음 가계부

입문자가 공용 비밀번호로 로그인해 바로 쓰는 정적 가계부입니다. 설치와 빌드 없이 실행되며, 가계부 데이터는 브라우저 저장소가 아니라 Supabase의 사용자별 영역에 저장됩니다.

## 실행

프로젝트 루트에서 정적 서버를 시작합니다.

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

브라우저에서 `http://127.0.0.1:8765/`에 접속합니다. 파일을 직접 열기보다 정적 서버 사용을 권장합니다.

## 주요 기능

- 홈·내역·캘린더·설정 탭이 같은 예산 월을 공유합니다.
- 이전 달·이번 달·다음 달로 이동해 과거 예산과 거래를 확인할 수 있습니다.
- 내역을 유형, 검색어, 카테고리 하나로 함께 필터링할 수 있습니다.
- 과거 거래도 날짜, 유형, 카테고리, 금액, 메모를 수정하거나 삭제할 수 있습니다.
- 수정한 날짜가 다른 예산 월이면 현재 목록에서 사라진 이유를 안내합니다.
- 캘린더에서 날짜별 지출·수입 합계와 거래 건수를 보고, 날짜를 눌러 상세 거래를 확인할 수 있습니다.
- 월별 총예산, 카테고리별 예산, 예산 시작일을 설정할 수 있습니다.
- 쉼표를 포함한 정수 금액 입력을 지원합니다. 예: `12,000`
- JSON 백업, 가져오기, 전체 초기화, 샘플 데이터 채우기를 제공합니다.
- 탭 키보드 조작, 수정 창 포커스 복원, 상태 알림, 360px 화면을 지원합니다.

## 클라우드 저장 원칙

로그인과 클라우드 다운로드가 끝나야 저장 버튼이 활성화됩니다. 일반 거래의 추가·수정·삭제는 해당 행만 Supabase에서 먼저 변경하고, 성공한 뒤 화면 상태를 갱신합니다. 수정·삭제 때 화면에 있던 기존 행과 DB 행이 다르면 저장하지 않고 최신 데이터를 다시 불러오도록 안내합니다.

예산 설정은 DB가 발급한 `updated_at` 버전을 비교합니다. JSON 가져오기·전체 초기화·샘플 교체는 현재 설정 버전과 전체 거래 목록을 함께 비교하는 5인자 RPC로 한 번에 처리합니다. 다른 브라우저에서 먼저 변경했다면 로컬 화면을 확정하지 않고 다시 불러오기를 요구합니다.

정확한 운영 조합 `https://suho-j.github.io/beginner-budget/`만 `budget_settings`, `transactions`, `replace_budget_state`를 사용합니다. `file://`, 로컬호스트, LAN IP, 스테이징·커스텀 호스트, 잘못된 운영 경로를 포함한 그 외 모든 실행 환경은 fail-closed로 `preview_budget_settings`, `preview_transactions`, `replace_preview_budget_state`만 사용합니다.

로그아웃하면 메모리에 있던 가계부 데이터와 필터를 비우고 모든 쓰기 동작을 잠급니다. 가계부 데이터는 `localStorage`에 저장하지 않습니다.

## 미리보기 격리 SQL 선행 게이트

`docs/supabase-preview-setup.sql`은 운영 테이블을 수정하지 않고 다음 작업만 수행합니다.

- 사용자별 RLS를 적용한 `preview_budget_settings`, `preview_transactions` 생성
- `preview_budget_settings.updated_at`을 DB가 단조 증가시키는 트리거 생성
- 설정 버전과 전체 거래 스냅샷을 비교하는 5인자 `replace_preview_budget_state` 생성
- 운영 데이터를 읽어 미리보기 테이블로 한 번만 복사
- 비표준 운영 거래 ID를 `'tx-migrated-' || md5(user_id::text || ':' || id)`로 결정적으로 매핑
- `REPEATABLE READ` 트랜잭션에서 운영·미리보기 잠금, DB 충돌 guard, 두 복사, canonical 양방향 비교를 통과한 뒤 `production_snapshot_v1` 완료 marker를 같은 트랜잭션에 기록
- marker가 있는 재실행은 seed 전체를 건너뛰어 운영 변경과 미리보기 수정·삭제·추가를 그대로 보존

최초 seed 직전에는 **짧은 운영 쓰기 중단 창**을 열어 모든 운영 탭과 쓰기를 멈춥니다. SQL 내부의 충돌 guard와 canonical settings·canonical transactions 전체 행/값 양방향 비교가 모두 성공한 후에만 운영 쓰기를 재개합니다. 운영 `budget_settings`, `transactions`는 `SELECT`와 읽기 일관성을 위한 `LOCK`의 원본일 뿐이며 update·delete·alter 대상이 아닙니다. **명시적 reseed는 marker를 임의로 지우지 말고 별도 검토 절차로만 수행**합니다.

2026-08-12 현재 이 미리보기 SQL은 저장소에만 있고 Supabase에는 적용하지 않았습니다. 따라서 실제 인증 다운로드·저장, 공개 미리보기 런타임 검증도 아직 대기 상태입니다.

## 격리 미리보기

예정 주소는 `https://suho-j.github.io/beginner-budget-preview/v1/`이며 화면 상단에 `개발 화면 · 운영 데이터 복사본`과 `여기서 변경한 내용은 운영에 반영되지 않아요.` 안내가 표시됩니다. 배포 산출물에는 원본 브랜치와 소스 SHA를 적은 버전 매니페스트를 둘 예정입니다. 운영 `master`는 사용자 승인 전까지 `0d487df`에 그대로 둡니다.

미리보기 브라우저 QA는 불변 접두사 `<marker> = QA-V1-<timestamp>`와 생성 직후 기록한 QA ID를 사용합니다. 거래를 추가·수정·삭제한 뒤 모든 월과 `preview_transactions`에서 `id = '<QA ID>' or memo like '<marker>%'`가 0건인지 확인하고, 변경한 미리보기 예산을 원복합니다. 범위를 좁히기 위해 JSON 가져오기·전체 초기화·샘플 교체는 스모크에서 실행하지 않습니다.

## 최종 운영 승격 게이트

`docs/supabase-setup.sql`의 운영 ID 제약·단조 버전 트리거·5인자 `replace_budget_state`는 2026-08-12 현재 운영 Supabase에 적용하지 않았습니다. 사용자가 특정 미리보기 URL을 승인한 뒤에만 단일 배타적 쓰기 창을 열고 운영 백업·행 수·ID 매핑·충돌 감사를 창 안에서 확정한 뒤 운영 SQL과 정확한 소스 SHA를 승격합니다.

이 최종 창은 운영 SQL 적용 직전에 시작해 운영 URL의 새 다운로드·인증 스모크와 운영 QA 정리가 끝날 때까지 유지합니다. 최초 미리보기 seed만을 위한 짧은 운영 쓰기 중단 창과는 별도입니다. 상세 절차는 [테스트 계획](TEST_PLAN.md)을 따릅니다.

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
git diff --check origin/master..HEAD
```

기존 V1 앱·운영 SQL 소스 `eaad4ba`에서 기록한 `60 tests passed`와 이전 미리보기 격리의 `65 tests passed` 근거는 유지합니다. 2026-08-12 fail-closed 환경 경계와 원자적 일회 seed 강화를 포함해 `67 tests passed`를 확인했습니다. 미리보기 SQL 적용, 실제 로그인 저장, 공개 URL 스모크는 아직 남아 있으므로 공개 미리보기 준비 완료로 간주하지 않습니다.

운영 데이터 보존을 포함한 상세 절차는 [테스트 계획](TEST_PLAN.md)을 따릅니다.
