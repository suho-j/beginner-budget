# 처음 가계부 구현 계획

> **Hermes 작업 방식:** 서브에이전트로 조사, 구현, 검토를 분리하고 메인 에이전트가 설계와 품질 게이트를 관리한다.

## 목표

입문자가 가입이나 설치 없이 바로 사용할 수 있는 간단한 가계부 웹 앱을 만든다. 사용자는 수입과 지출을 기록하고, 선택한 달의 수입·지출·잔액·예산 남은 금액을 한 화면에서 확인할 수 있어야 한다.

## 아키텍처

- 기존 부모 프로젝트를 수정하지 않고 `beginner-budget-app/` 안에 독립 정적 앱으로 구성한다.
- HTML, CSS, Vanilla JavaScript만 사용한다.
- 데이터는 브라우저 `localStorage`에 버전이 있는 JSON으로 저장한다.
- 서버, 회원가입, 데이터베이스, 빌드 도구는 MVP 범위에서 제외한다.

## 설계 조사 요약

- 첫 화면은 “얼마가 들어왔고, 얼마를 썼고, 얼마가 남았는지”를 즉시 보여줘야 한다.
- 입력 필드는 날짜, 유형, 카테고리, 금액, 메모 정도로 제한한다.
- 초보자에게 어려운 계좌 연동, 카드 관리, 할부, 반복 거래, 태그, 영수증 OCR, 투자 관리는 제외한다.
- 모바일에서 바로 기록할 수 있도록 버튼과 입력 영역을 크게 둔다.
- 색상만으로 수입/지출/위험 상태를 전달하지 않고 텍스트를 함께 제공한다.

## 구현 범위

- 수입/지출 추가
- 월 예산 저장
- 월별/유형별 필터
- 수입 합계, 지출 합계, 잔액, 예산 남은 금액 표시
- 예산 사용률 진행바
- 거래 삭제 전 확인
- 샘플 데이터 추가 및 기존 샘플 교체
- JSON 내보내기/가져오기
- 가져오기 스키마 검증, 빈 가져오기 차단, 잘못된 거래 제외
- 중복 거래 ID 재발급
- 1MB 초과 가져오기 파일 차단
- 전체 초기화
- localStorage 저장 실패/손상 데이터 복구 처리
- 자동 테스트와 수동 체크리스트

## 파일 구조

```text
beginner-budget-app/
├─ index.html
├─ css/style.css
├─ js/storage.js
├─ js/transactions.js
├─ js/ui.js
├─ js/app.js
├─ tests/run-tests.cjs
├─ docs/README.md
├─ docs/REQUIREMENTS.md
├─ docs/DESIGN.md
├─ docs/DATA_MODEL.md
├─ docs/TEST_PLAN.md
├─ docs/SUBAGENT_NOTES.md
├─ docs/IMPROVEMENT_LOG.md
└─ manual-test-checklist.md
```

## 품질 게이트

- JS 문법 검사: `node --check js/storage.js && node --check js/transactions.js && node --check js/ui.js && node --check js/app.js`
- 자동 테스트: `node tests/run-tests.cjs`
- 정적 서버 확인: `python3 -m http.server 8765`
- 브라우저 확인: 콘솔 오류 없음, 모바일 360px 폭 가로 스크롤 없음, 주요 버튼/폼 동작 확인

## 개선 반복 기록

1. 초기 구현 후 독립 리뷰에서 저장소 예외, UTC 날짜, 느슨한 복구 검증, 접근성 오류 연결 부족을 발견했다.
2. `storage.js`에 저장/삭제 예외 처리와 strict date/category 검증을 추가했다.
3. 기본 날짜와 월을 로컬 날짜 기준으로 변경했다.
4. 필드별 `aria-invalid`, `aria-describedby`, 첫 오류 포커스를 추가했다.
5. 샘플 데이터 중복 방지를 위해 샘플 출처와 교체 흐름을 추가했다.
6. JSON 내보내기/가져오기를 추가해 localStorage 삭제 리스크를 완화했다.
7. Node 기반 자동 테스트를 추가했다.
8. 2차 리뷰에서 발견된 JSON 가져오기 데이터 손실 리스크를 줄이기 위해 스키마 검증, 빈 가져오기 차단, 중복 ID 재발급, 1MB 파일 크기 제한을 추가했다.
9. 여러 오류 필드의 `aria-invalid` 표시와 예산 progressbar의 `aria-valuetext`를 보강했다.
