# 처음 가계부

입문자가 가입이나 설치 없이 브라우저에서 바로 사용할 수 있는 정적 가계부 웹 앱입니다. 수입과 지출을 기록하고, 선택한 예산 기간의 수입 합계·지출 합계·잔액·예산 남은 금액·예산 사용률을 한 화면에서 확인합니다.

## 실행 방법

### 파일로 바로 열기

`beginner-budget-app/index.html` 파일을 브라우저로 엽니다.

### 로컬 서버로 실행

```bash
cd beginner-budget-app
python3 -m http.server 8000
```

브라우저에서 `http://localhost:8000`에 접속합니다.

## 무료 호스팅

정적 앱이라 GitHub Pages, Netlify, Cloudflare Pages, Vercel 무료 플랜에 그대로 올릴 수 있습니다. 데이터는 Supabase 인증 사용자별 DB에 저장되며 브라우저 `localStorage`에는 저장하지 않습니다.

### GitHub Pages 예시

1. 이 폴더를 GitHub 저장소로 푸시합니다.
2. GitHub 저장소의 **Settings → Pages**에서 배포 소스를 `Deploy from a branch`로 선택합니다.
3. 브랜치는 `master` 또는 `main`, 폴더는 `/root`를 선택하고 저장합니다.
4. 표시되는 `https://계정명.github.io/저장소명/` 주소로 접속합니다.

## 주요 기능

- 날짜, 유형, 카테고리, 금액, 메모로 수입/지출 추가
- 쉼표가 포함된 금액 입력 지원(예: 12,000)
- 월 시작일 설정(예: 25일 시작이면 25일~다음달 24일 기준)
- 월별 총 예산 저장(기본값 500,000원)
- 월별 항목 예산 저장과 항목별 남은 금액 표시(생활비, 배달비, 의류비, 비상금)
- Supabase 클라우드 저장(공용 비밀번호 로그인)
- 월별 필터, 유형별 필터, 검색 필터
- 수입/지출/잔액/예산 남은 금액 요약
- 하루 사용 가능액과 가장 많이 쓴 카테고리 표시
- 카테고리별 지출 분석
- 예산 사용률 진행바
- 거래 삭제 전 확인 창 표시
- 샘플 데이터 채우기와 기존 샘플 교체
- JSON 내보내기/가져오기
- 가져오기 스키마 검증, 빈 가져오기 차단, 1MB 파일 크기 제한
- 중복 거래 ID 재발급
- 전체 초기화
- 로그인 시 Supabase에 저장되어 새로고침 후에도 데이터 유지

## Supabase 클라우드 동기화 설정

1. Supabase Dashboard → SQL Editor에서 `docs/supabase-setup.sql` 내용을 실행합니다.
2. Authentication → URL Configuration에서 아래를 등록합니다.
   - Site URL: `https://suho-j.github.io/beginner-budget/`
   - Redirect URLs: `https://suho-j.github.io/beginner-budget/`, `http://localhost:8765/`
3. Supabase Authentication → Users에 `ho910728@naver.com` 사용자가 있고 공용 비밀번호가 설정되어 있어야 합니다.
4. 앱의 **클라우드 동기화** 섹션에서 공용 비밀번호로 로그인합니다.
5. 로그인 후 월 시작일, 월별 예산, 항목별 예산, 거래 변경사항은 저장 동작마다 Supabase에 자동 업로드됩니다.
6. 예산 기간 설정은 기존 `budget_settings.category_budgets` JSON에 함께 저장되므로 추가 SQL 마이그레이션은 필요 없습니다.

## 저장 안내

데이터는 브라우저 `localStorage`에 저장하지 않습니다. 공용 비밀번호 로그인 후 저장/추가/삭제/초기화 동작은 Supabase DB에 업로드됩니다. 로그인 전 변경은 현재 화면에만 임시 반영되며 새로고침하면 사라질 수 있습니다. 중요한 변경 전후에는 **JSON 내보내기**로 백업할 수 있습니다.

## 검증

```bash
cd beginner-budget-app
node --check js/storage.js && node --check js/transactions.js && node --check js/ui.js && node --check js/app.js
node tests/run-tests.cjs
```

브라우저 스모크 검증은 로컬 서버 실행 후 Chrome/Playwright로 예산 저장, 쉼표 금액 입력, 거래 추가, 인사이트/검색 업데이트, 콘솔 에러 없음을 확인합니다.
