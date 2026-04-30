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

## 주요 기능

- 날짜, 유형, 카테고리, 금액, 메모로 수입/지출 추가
- 월 예산 저장(기본값 500,000원)
- 월별 필터와 유형별 필터
- 수입/지출/잔액/예산 남은 금액 요약
- 예산 사용률 진행바
- 거래 삭제 전 확인 창 표시
- 샘플 데이터 채우기와 기존 샘플 교체
- JSON 내보내기/가져오기
- 가져오기 스키마 검증, 빈 가져오기 차단, 1MB 파일 크기 제한
- 중복 거래 ID 재발급
- 전체 초기화
- `localStorage` 저장으로 새로고침 후에도 데이터 유지

## 저장 안내

데이터는 서버로 전송되지 않고 현재 브라우저의 `localStorage`에만 저장됩니다. 저장 키는 `beginner-budget-app:v1`입니다. 브라우저 데이터를 삭제하면 가계부 데이터도 사라질 수 있으므로 중요한 데이터는 **JSON 내보내기**로 백업하세요.

## 검증

```bash
cd beginner-budget-app
node --check js/storage.js && node --check js/transactions.js && node --check js/ui.js && node --check js/app.js
node tests/run-tests.cjs
```
