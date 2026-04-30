# AGENTS.md — beginner-budget-app

이 프로젝트는 **입문자용 정적 가계부 웹 앱**입니다. 모든 에이전트는 아래 워크플로를 우선 적용합니다.

## 기준 위치

- 앱 경로: `/mnt/c/Users/suho.jung/Documents/TKG AI/Source/beginner-budget-app`
- 참고 repo:
  - Superpowers: `/mnt/c/Users/suho.jung/Documents/TKG AI/Source/_agent-repos/superpowers`
  - GSD: `/mnt/c/Users/suho.jung/Documents/TKG AI/Source/_agent-repos/get-shit-done`
  - gstack: `/mnt/c/Users/suho.jung/Documents/TKG AI/Source/_agent-repos/gstack`

## 역할 조합

1. **gstack product/design lens**
   - `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/qa`의 관점으로 사용자 가치, UX, 설계, 테스트를 점검한다.
   - “입문자가 오늘 바로 쓸 수 있는가?”를 최상위 기준으로 둔다.

2. **GSD execution lens**
   - 큰 작업은 작은 workstream으로 나누고, 각 단계마다 pre-flight → implement → verify → document 게이트를 둔다.
   - 미검증 추측, 과한 설계, 범위 확장을 금지한다.

3. **Superpowers engineering lens**
   - 새 기능/버그 수정은 TDD: failing test → minimal fix → refactor.
   - 버그는 systematic debugging: 재현, 원인 추적, 회귀 테스트 이후 수정.
   - 완료 전 verification-before-completion: 자동 테스트 + 브라우저 스모크 + diff 검토.

## 개발 규칙

- 가입/서버/빌드 없는 정적 앱을 유지한다.
- 데이터는 `localStorage`만 사용하며 서버 전송을 추가하지 않는다.
- 사용자 입력/가져오기 데이터는 항상 정규화·검증한다.
- DOM 렌더링은 `textContent` 중심으로 유지해 XSS 위험을 낮춘다.
- 초보자 UX를 우선한다: 쉬운 입력, 되돌리기/수정, 명확한 안내, 안전한 백업.
- 한국어 문구는 짧고 친절하게 작성한다.
- 모바일 360px, 키보드 접근성, 스크린리더 메시지를 고려한다.

## 검증 명령

```bash
node --check js/storage.js && node --check js/transactions.js && node --check js/ui.js && node --check js/app.js
node tests/run-tests.cjs
python3 -m http.server 8765
```

브라우저 스모크는 Chrome/Playwright로 다음을 확인한다.

- 예산 저장
- 쉼표 포함 금액 입력
- 거래 추가
- 요약/인사이트 업데이트
- 검색 필터
- 콘솔 에러 없음
- 모바일 뷰포트 레이아웃

## 품질 게이트

- **Spec gate:** 요구사항을 빠뜨리거나 과하게 만들지 않았는가?
- **TDD gate:** 새 로직에 실패하는 테스트를 먼저 추가했는가?
- **Browser gate:** 실제 브라우저에서 핵심 플로우가 동작하는가?
- **A11y gate:** 라벨, 포커스, live region, 키보드 흐름이 깨지지 않았는가?
- **Docs gate:** README/테스트 문서/개선 로그가 실제 기능과 일치하는가?

## 금지

- 검증 없이 “아마 될 것”이라고 종료하지 않는다.
- `localStorage` 데이터를 외부로 자동 전송하지 않는다.
- 초보자에게 부담되는 개발자 중심 UI를 앞세우지 않는다.
- 관련 없는 리팩터링을 기능 변경과 섞지 않는다.
