# 처음 가계부

입문자가 가입이나 설치 없이 브라우저에서 바로 사용할 수 있는 정적 가계부 웹 앱입니다. 수입과 지출을 기록하고, 선택한 달의 수입 합계·지출 합계·잔액·예산 남은 금액·예산 사용률을 한 화면에서 확인합니다.

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

정적 앱이라 GitHub Pages, Netlify, Cloudflare Pages, Vercel 무료 플랜에 그대로 올릴 수 있습니다. 서버가 없으므로 방문자별 데이터는 각 브라우저의 `localStorage`에만 저장됩니다.

### GitHub Pages 예시

1. 이 폴더를 GitHub 저장소로 푸시합니다.
2. GitHub 저장소의 **Settings → Pages**에서 배포 소스를 `Deploy from a branch`로 선택합니다.
3. 브랜치는 `master` 또는 `main`, 폴더는 `/root`를 선택하고 저장합니다.
4. 표시되는 `https://계정명.github.io/저장소명/` 주소로 접속합니다.

## 주요 기능

- 날짜, 유형, 카테고리, 금액, 메모로 수입/지출 추가
- 쉼표가 포함된 금액 입력 지원(예: 12,000)
- 월 예산 저장(기본값 500,000원)
- 항목별 월 예산 저장과 항목별 남은 금액 표시
- 선택형 Supabase 클라우드 동기화(이메일 매직 링크 로그인)
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
- `localStorage` 저장으로 새로고침 후에도 데이터 유지

## Supabase 클라우드 동기화 설정

1. Supabase Dashboard → SQL Editor에서 `docs/supabase-setup.sql` 내용을 실행합니다.
2. Authentication → URL Configuration에서 아래를 등록합니다.
   - Site URL: `https://suho-j.github.io/beginner-budget/`
   - Redirect URLs: `https://suho-j.github.io/beginner-budget/`, `http://localhost:8765/`
3. 앱의 **클라우드 동기화** 섹션에서 이메일로 로그인 링크를 받아 로그인합니다.
4. **클라우드에 저장**은 현재 브라우저 데이터를 Supabase로 업로드합니다.
5. **클라우드에서 불러오기**는 현재 브라우저 데이터를 Supabase 데이터로 교체합니다. 필요하면 먼저 JSON 내보내기로 백업하세요.

## 저장 안내

데이터는 기본적으로 현재 브라우저의 `localStorage`에 저장됩니다. 저장 키는 `beginner-budget-app:v1`입니다. Supabase에 로그인한 뒤 **클라우드에 저장**을 누르면 같은 데이터가 사용자 계정의 Supabase DB에도 저장됩니다. 브라우저 데이터를 삭제하면 로컬 데이터는 사라질 수 있으므로 중요한 변경 뒤에는 클라우드 저장 또는 **JSON 내보내기**로 백업하세요.

## 검증

```bash
cd beginner-budget-app
node --check js/storage.js && node --check js/transactions.js && node --check js/ui.js && node --check js/app.js
node tests/run-tests.cjs
```

브라우저 스모크 검증은 로컬 서버 실행 후 Chrome/Playwright로 예산 저장, 쉼표 금액 입력, 거래 추가, 인사이트/검색 업데이트, 콘솔 에러 없음을 확인합니다.
