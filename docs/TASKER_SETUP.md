# 안드로이드 Tasker로 케이뱅크·쿠팡이츠 연결하기

2026-10-16 구현. **운영 Supabase 서버 적용과 실제 HTTP 시험을 완료했습니다.** 실제 휴대폰 알림 수집은 아래 설치·연결 시험 후 폰에서 확인해야 합니다.

## 이번 방식

- 케이뱅크: Android 알림 → Tasker → Supabase 수신함.
- 쿠팡이츠: 알림도 수신함으로 전송. 메뉴가 부족하면 **주문 상세를 열고 Tasker 타일을 눌러 화면 글자를 확인·전송**.
- 쿠팡 쇼핑: Hermes가 로그인한 브라우저의 주문 상세에서 추출할 별도 작업. 이 변경에 Hermes 수집기는 포함하지 않습니다.
- PC나 LDPlayer를 계속 켜 둘 필요 없이 폰에서 Supabase로 직접 보낼 수 있도록 설계했습니다. 폰과 인터넷은 필요합니다.
- 수신 시각을 결제 시각으로, 알림의 첫 금액을 결제 금액으로 추측하지 않습니다. 실제 케이뱅크 알림이 아직 없으므로 **지출 자동 확정은 꺼져 있습니다**.
- 쿠팡이츠 주문 알림·화면은 별도 지출로 더하지 않습니다. 결제 내역을 설명하는 자료입니다.

## 알림 수신과 지출 등록은 다릅니다

현재 Tasker 프로필은 케이뱅크 앱이 Android 상태 표시줄에 띄운 알림을 모읍니다. 앱 안의 거래내역 전체를 읽는 방식은 아닙니다. 입출금 알림이 실제로 뜨면 결제 외 알림도 수신함에 들어올 수 있습니다.

| 알림 내용 | 가계부 처리 |
| --- | --- |
| 플러스박스 원금 넣기·꺼내기 | 내 자금 이동이므로 수입·지출에 넣지 않음 |
| 계좌이체·송금 | 목적이 불명확하므로 지출 등록 버튼 없음. 실제 소비라면 일반 거래 입력에서 기록 |
| 계좌 출금·ATM 인출 | 카드 결제와 중복되거나 자금 이동일 수 있어 보관만 함 |
| 입금·이자·캐시백 | 지출 제외. 수입도 자동 생성하지 않음 |
| 카드 취소·환불·거절·요청·예정 안내 | 새 지출 제외. 원결제 환불 반영은 별도 확인 필요 |
| 명시적인 카드 승인·결제 완료 문구와 원화 금액 | 사용자가 실제 금액·날짜·중복 여부를 확인한 뒤 기록할 후보 |
| 종류를 구분할 수 없는 알림 | 확인 전까지 보관만 하고 합계에서 제외 |

화면과 서버 RPC에 같은 보수적 조건을 적용합니다. 제외 단어가 없다는 이유만으로 결제라고 추정하지 않습니다. 합성 알림 29종으로 조건을 시험했으며 **실제 케이뱅크 알림 형식을 검증한 것은 아닙니다**. 실결제 알림이 후보로 나타나지 않아도 수신함에는 남으므로 실제 문구를 확인한 뒤 조건을 보완할 수 있습니다.

[케이뱅크 공식 플러스박스 안내](https://brand.kbanknow.com/)는 연결 계좌를 통한 입출금만 허용하고 카드·공과금 결제 계좌로 사용할 수 없다고 설명합니다. 원금 이동과 별도로 받은 이자는 구분해야 합니다. **앱을 사용하는 중에는 푸시 알림이 생략되는지, 플러스박스 이동 때 정확히 어떤 알림이 뜨는지는 공개 자료로 확인하지 못했습니다.** 알림이 안 올 것이라는 가정에 의존하지 않습니다.

## 1. 가계부 연결 설정 만들기

연결 후 평소에는 **분류** 탭을 사용합니다. 로그인·탭 진입·화면 복귀 시 자동으로 미처리 알림을 가져오며, 보이는 동안 30초마다 확인합니다. 날짜·금액·설명을 확인하고 분류 버튼을 누르면 기록됩니다. 같은 날짜·금액의 지출이 있거나 정보가 부족하면 **확인하고 분류**에서 검토합니다. 최근 미처리 알림 최대 100건 기준이며, 카드 후보가 아닌 알림은 접힌 보관 영역에 있습니다. 주문 상세·카테고리 자동 확정은 아직 제공하지 않습니다.

1. [웹 가계부](https://suho-j.github.io/beginner-budget/)에 로그인합니다.
2. **설정 → 휴대폰 알림 연결 → 연결 설정 만들기**를 누릅니다.
3. 표시되는 JSON을 폰에서 복사하고, 아래 일괄 설치 후 **BB 시작**의 입력창에 붙여 넣습니다. 변수를 직접 만들 필요가 없습니다.

운영 서버에는 [supabase-phone-import.sql](supabase-phone-import.sql)을 이미 적용했습니다. 다시 실행할 필요가 없습니다. 다른 Supabase 프로젝트에 설치할 때만 기존 기본 테이블 준비 후 한 번 적용합니다. 기존 거래를 복사하거나 덮어쓰지 않는 별도 수신함·함수입니다.

운영 주소는 정확히 https://suho-j.github.io/beginner-budget/ 입니다. 로컬·다른 경로는 기존 정책대로 preview-v2입니다. **연결을 만든 화면의 환경에만 수신**되며, 폰이 보내는 JSON으로 사용자나 환경을 바꿀 수 없습니다.

전송키는 수신만 허용합니다. 가계부 읽기·수정 권한, 로그인 비밀번호, Supabase service_role 키를 폰에 주지 않습니다. 서버에는 키의 SHA-256만 저장됩니다. 연결 설정에는 비밀 전송키가 있으므로 공개 Tasker 공유/백업에 포함하지 마세요.

## 2. 한 번에 가져오기 — 권장

작업·프로필을 하나씩 만들지 않습니다. 설치 파일에는 개인 연결키가 없습니다.

1. 갤럭시에서 [설치 화면](https://suho-j.github.io/beginner-budget/artifacts/tasker-guide/install.html)을 열고 **Tasker로 한 번에 가져오기**를 누릅니다. 파일 이동은 필요 없습니다.
2. Tasker의 **가계부 자동수집** 프로젝트 추가와 프로필 활성화를 허용합니다. 자동 링크가 열리지 않으면 같은 화면에서 프로젝트 파일을 받고, Tasker 하단 프로젝트 탭을 길게 눌러 Import에서 Budget-Auto.prj.xml을 선택합니다.
3. 갤럭시에서 Tasker의 **알림 접근 권한**을 허용하고 배터리를 **제한 없음**으로 설정합니다. 케이뱅크 카드 알림과 쿠팡이츠 알림도 허용합니다.
4. 웹 가계부에서 만든 연결 설정을 복사한 뒤 Tasker의 **BB 시작** 작업을 열고 ▶를 눌러 붙여 넣습니다.
5. **BB 상태 → ▶**로 열리는 브라우저에서 연결 시험 기록을 확인하고 웹 수신함의 **[연결 시험]**을 확인합니다. 시험 성공 전에는 새 알림을 수집하지 않습니다.

설치되는 것은 알림 프로필 2개, 15분 재전송 프로필 1개, 작업 6개입니다. 스크립트 파일 4개를 따로 복사하지 않습니다. 이전 설치본의 실제 Tasker 가져오기와 연결 시험의 서버 수신을 확인했습니다. **케이뱅크 실제 알림 수신과 이번 브라우저 진단 작업의 Android 실행은 아직 확인이 필요합니다.**

이츠 상세가 필요하면 Quick Settings Tasks의 빈 칸에 **BB 주문 화면**을 지정하고 빠른 설정 타일에 추가합니다. 주문 상세를 열고 타일을 누르면 읽은 글자를 확인 후 전송합니다. 실제 앱 화면이 글자를 제공하는지와 어시스턴트 권한은 폰에서 검증해야 합니다.

같은 이름의 프로젝트가 이미 있으면 중복으로 가져오지 마세요. 미전송 알림이 남은 연결 변경은 수정판 3에서 명시적으로 확인한 뒤 복구하며, 세부 절차는 아래 연결 복구 설명을 따릅니다. 재전송은 한 실행에서 최대 20건씩, 나머지는 다음 실행에 처리합니다.

[XML 형식 근거와 검증 범위](../tasker/XML_SOURCES.md)

## 상태창이 안 뜰 때

### 전체 프로젝트를 지우고 수정판 3만 남은 경우

[자동수집 복원](https://suho-j.github.io/beginner-budget/artifacts/tasker-guide/restore.html)을 한 번 가져옵니다. **가계부 연결 수정**은 유지합니다. 이 파일은 수정판 3과 이름·ID가 겹치지 않는 프로필 3개와 수집·주문 화면·재전송 연결 작업만 추가하며, 기존 BB 보내기를 호출합니다. 연결 설정·대기열을 초기화하지 않고 BB 시작도 포함하지 않습니다. 연결을 다시 만들지 마세요. 가져온 뒤 세 프로필 활성화와 BB 연결 확인 결과를 확인합니다.

사용자 폰에서는 같은 프로젝트 이름의 가져오기가 거부돼 덮어쓰기 안내대로 진행할 수 없었습니다. 중복 이름 오류가 나면 삭제를 반복하지 않고 실제 남은 프로젝트를 먼저 확인합니다. 복원 파일은 원래 자동수집 프로필이 없는 경우에만 한 번 추가합니다.

▶가 ■로 바뀌었다가 다시 ▶가 되면 실행이 끝난 것입니다. 전송 성공 여부는 버튼 모양으로 알 수 없습니다.

### 이미 진단을 설치했는데 오류 화면이 남는 경우

1. [수정 작업 가져오기](https://suho-j.github.io/beginner-budget/artifacts/tasker-guide/repair.html)에서 **가계부 연결 수정**을 가져옵니다.
2. **BB 연결 확인**, **BB 보내기**를 교체할지 묻는 경우 덮어쓰기를 허용합니다. 기존 프로젝트·프로필·연결키를 지우거나 전체 설정을 복원하지 않습니다.
3. **BB 연결 확인 → ▶** 결과에서 **진단 수정판 2** 표시와 세 항목을 확인합니다. 이 작업은 상태만 읽습니다. **BB 보내기**는 기존 대기 알림이 있을 때 같은 서버로 재전송합니다.

이전 진단은 JavaScriptlet에서 바꾼 Tasker 지역 변수가 Auto Exit 때 기존 JavaScript 값으로 다시 반영되어 초기 오류 URL이 남을 수 있었습니다. 같은 변수 전달 방식을 사용한 송신 준비·응답 확인도 수정했습니다. 3번 URL 찾아보기의 빈 App 객체는 사용자 폰에서 패키지/앱이름 `%`로 표시됐으므로, 수정 파일은 URL만 지정하고 기본 브라우저를 사용합니다. 수동으로 확인한다면 **패키지/앱이름의 `%`만 지우고 위 URL의 `%budget_status_url`은 유지**합니다.

공식 문서는 URL 가져오기에서 같은 이름의 작업을 교체하는 흐름을 안내합니다. 실제 수정 파일의 교체 성공과 이 문제가 알림 미수신을 전부 설명하는지는 폰에서 확인해야 합니다. 초기 오류 화면만으로 JavaScriptlet 실행 오류나 서버 연결 실패를 확정하지 않습니다.

### 진단을 처음 추가하는 경우

1. 휴대폰에서 [연결 확인 화면](https://suho-j.github.io/beginner-budget/artifacts/tasker-guide/diagnose.html)의 **연결 확인 작업 추가하기**를 누릅니다.
2. **가계부 연결 진단** 프로젝트만 추가합니다. 기존 자동수집 프로젝트는 그대로 둡니다.
3. Tasker의 **작업 → BB 연결 확인 → ▶**를 누릅니다. 브라우저에 **연결 시험 / 미전송 알림 / 마지막 처리 상태**가 표시됩니다.

연결키를 다시 입력하지 않습니다. 이 작업은 기존 전역 변수만 읽으며 연결 설정·대기열·프로필을 바꾸거나 서버로 알림을 보내지 않습니다. URL의 fragment에는 정해진 상태값·개수·마지막 성공 시각만 넣고 비밀키나 알림 본문은 넣지 않습니다. JavaScriptlet이 실패해도 다음 기본 브라우저 액션이 오류 안내 화면을 열도록 구성했습니다.

- **통과 기록 있음 + 미전송 0개:** 로컬 연결 시험 성공 기록입니다. 현재 서버 접속이나 알림 접근 권한까지 증명하지 않습니다. 실제 케이뱅크 알림이 웹에 없으면 알림 접근 권한과 새 알림 발생 여부를 확인합니다.
- **미전송 1개 이상:** 기존 **BB 보내기**를 실행하고 다시 확인합니다.
- **진단 결과가 전달되지 않음:** 이전 진단이면 위 수정 작업을 가져옵니다. 수정판 2에서도 같다면 **BB 연결 확인**의 2번 JavaScriptlet 오류와 3번의 패키지/앱이름을 확인합니다. 설정을 지우지 않습니다.

[Tasker 공식 안내](https://tasker.joaoapps.com/knownissues.html)에 따라 **⋮ → More → Android Settings → Notification Listener**에서 Tasker를 허용합니다. 갤럭시 설정에서 ‘알림 접근’을 검색해도 됩니다. 허용한 뒤 새로 온 케이뱅크 앱 알림으로 확인합니다. Tasker 자체 Notify로 만든 알림은 Notification 이벤트 대상이 아닙니다.

진단 코드와 320/360/800px Chrome 화면·다운로드·오류 상태를 PC에서 검증했습니다. 실제 Android에서 새 진단 작업의 가져오기와 브라우저 열기는 별도 확인이 필요합니다. 진단 파일 추가만으로 알림 수집 문제가 해결된 것은 아닙니다.

## 아래는 수동 구성 참고

일괄 설치를 사용했다면 아래 작업을 추가로 만들지 않습니다.

## 수동 방식: 폰 준비

1. 케이뱅크 앱과 Android 설정에서 케이뱅크의 알림을 허용합니다.
2. 케이뱅크 앱의 **카드 승인·취소 알림**을 우선 켭니다. 입출금 알림도 사용할 수 있지만, 출금 알림은 수신함에만 보관해 같은 결제가 두 번 지출로 잡히지 않게 합니다. 카드 승인 알림 자체의 반복 수신은 기록 전에 중복 여부를 확인해야 합니다.
3. 잔액 표시를 끌 수 있다면 끕니다. 추가로 수집 코드가 알려진 잔액·번호 표기를 가리지만 모든 형식을 보장하지는 않습니다.
4. Tasker의 **알림 접근 권한**을 허용하고, Tasker를 활성화합니다. Android 배터리 설정에서 Tasker의 백그라운드 실행 제한을 풀어 주세요.
5. 쿠팡이츠 앱 알림도 허용합니다.
6. 아래 네 파일을 폰의 Tasker/budget 폴더에 복사합니다.
   - js/phone-import.js → Tasker/budget/phone-import.js
   - tasker/capture.js → Tasker/budget/capture.js
   - tasker/prepare-send.js → Tasker/budget/prepare-send.js
   - tasker/acknowledge.js → Tasker/budget/acknowledge.js

**기존 Tasker 설정 전체를 가져오기/덮어쓰기 하지 않습니다.** 수동으로 구성할 때만 아래 작업과 프로필을 만듭니다. 권장 일괄 설치는 위 항목을 따르세요.

## 3. 공통 작업: 가계부 보내기

Tasker의 Tasks에 **가계부 보내기**를 만듭니다. 작업 속성의 Collision Handling은 **Abort New Task**로 설정해 동시 전송을 막습니다.

순서대로 액션을 추가합니다.

1. Code → JavaScript
   - Path: Tasker/budget/prepare-send.js
   - Libraries: file:///storage/emulated/0/Tasker/budget/phone-import.js
   - Auto Exit: 켬
2. Task → Stop, 조건: **%budget_send = 0**
3. Variables → Variable Clear: **%http_data**
4. Variables → Variable Clear: **%http_response_code**
5. Net → HTTP Request
   - Method: POST
   - URL: **%budget_url**
   - Headers: **%budget_headers**
   - Body: **%budget_body**
   - Timeout: 30초
   - Trust Any Certificate: 끔
   - Continue Task After Error: 켬
6. Code → JavaScript
   - Path: Tasker/budget/acknowledge.js
   - Auto Exit: 켬
7. Task → Stop, 조건: **%budget_ack != 1**
8. Task → Wait: 1초
9. Task → Goto: 액션 1

파일 경로는 실제 저장한 경로로 선택합니다. Libraries의 file URL도 실제 저장 위치에 맞춥니다. 폰에서 다른 외부 저장소를 쓰면 /storage/emulated/0 경로가 다를 수 있습니다.

실패한 전송은 **%BUDGETOUTBOX**에 남습니다. 성공 코드만으로 삭제하지 않고 서버가 같은 event_id를 확인한 경우에만 제거합니다. HTTP 응답을 받기 전에 앱이 꺼져도 다음 전송은 같은 ID를 사용합니다.

Profiles → Time에 15분 반복을 만들고 **가계부 보내기**를 연결합니다. 이 타이머는 전송 대기 알림을 재시도하는 용도이며 과거 주문 내역을 조회하지 않습니다. Android 절전 중에는 실행이 늦어질 수 있습니다.

연결 설정을 다시 만들면 서버는 이전 키를 즉시 무효화합니다. 이미 재발급했다면 이전 키로 먼저 보내라는 안내는 해결 방법이 아닙니다. [연결 복구 수정판 3](https://suho-j.github.io/beginner-budget/artifacts/tasker-guide/repair.html)을 가져와 **BB 연결 복구**에서 가장 최근 설정을 붙여 넣으세요. 기존과 같은 계정·가계부에서 복사한 설정일 때만 이전 알림을 옮기는 확인창을 승인합니다.

복구는 원래 대기열을 폰의 `BUDGETOUTBOXBACKUP`에 보관하고 알림 내용·ID를 유지한 채 새 연결로 재시도합니다. 백업은 가장 최근 복구 직전 대기열 한 개이며 자동 재전송하지 않습니다. 같은 서버라도 계정·환경이 같은지는 폰에서 검증할 수 없어 사용자 확인을 받습니다. 다른 서버, 혼합 연결 대기열, 손상된 알림, 진행 중인 BB 보내기는 변경하지 않고 멈춥니다. 취소하면 설정·대기열을 바꾸지 않습니다. 기존 프로젝트와 변수를 삭제하지 마세요.

## 4. 케이뱅크 알림 프로필

Profiles → + → Event → UI → Notification:

- Owner Application: **케이뱅크** 하나만 선택.
- 패키지: com.kbankwith.smartbank
- Title / Text: 비워 둠.
- New Only: **끔**. 앱이 같은 알림을 갱신할 수 있어 초기에는 놓치지 않고 모읍니다. 같은 내용의 갱신이 여러 건 잡힐 수 있으므로 모두 별도 지출로 확정하지 않습니다.

연결할 수집 작업의 Collision Handling은 **Run Both Together**로 설정합니다. 전송 작업이 기다리는 동안 새 알림이 와도 수집 작업이 버려지지 않게 합니다. 공통 전송 작업만 Abort New Task를 사용합니다.

연결할 작업의 액션:

1. Variable Set: **%budget_kind** = **kbank_notification**
2. JavaScript: Tasker/budget/capture.js
   - Libraries: file:///storage/emulated/0/Tasker/budget/phone-import.js
   - Auto Exit: 켬
3. Perform Task: **가계부 보내기**, 조건 **%budget_queued = 1**

Notification 이벤트의 %evtprm 배열에서 제목과 본문 등 문자열을 수집합니다. 전역 %NTITLE보다 이벤트별 변수를 우선 사용합니다. OTP/인증번호 내용은 거절합니다. 이 단계는 결제 알림의 특정 문구를 가정하지 않습니다.

## 5. 쿠팡이츠 알림 프로필

케이뱅크 프로필과 동일하게 만들되:

- Owner Application: **쿠팡이츠** 하나만 선택.
- 패키지: com.coupang.mobile.eats
- %budget_kind = **eats_notification**

배달 진행 알림에 메뉴·결제액이 없다면 그것만으로 메뉴를 만들지 않습니다. 실제 알림 내용은 아직 검증하지 않았습니다.

## 6. 쿠팡이츠 상세 — 우선 한 번 눌러 보내기

**가계부 이츠 화면** 작업을 만듭니다.

1. Wait: 1초. 빠른 설정 패널이 닫힌 뒤 실행되도록 합니다.
2. Display → **Get Screen Info (Assistant)**.
3. Variable Set: **%budget_kind** = **eats_screen**.
4. JavaScript: Tasker/budget/capture.js, 위와 같은 Library.
5. Perform Task: **가계부 보내기**, 조건 **%budget_queued = 1**.

Tasker의 Setup Quick Setting Tile / 빠른 설정 작업 기능으로 이 작업을 타일에 연결합니다. **쿠팡이츠 주문 상세를 화면에 열어 둔 상태**에서 타일을 누릅니다. Tasker가 요청하는 어시스턴트 설정을 허용하고 화면 텍스트 사용 권한을 켭니다. 기존 기본 어시스턴트 설정이 바뀔 수 있습니다.

스크립트는 %ai_texts의 text 필드만 사용하고 extras, 링크, 화면 이미지 등은 보내지 않습니다. 전송 전 확인창에서 쿠팡이츠 주문 화면인지 확인합니다. 주소·전화번호 또는 다른 앱 화면이 보이면 취소하세요.

화면 글자가 비거나 메뉴/실결제액이 빠지면 **상세 수집 성공이 아닙니다**. 앱 화면 구현에 따라 읽히지 않을 수 있습니다. 잠긴 폰에서 과거 주문 화면을 스스로 돌아다니는 기능은 구현하지 않았습니다. 추가 유료 AutoInput은 이 시험 뒤에 판단합니다.

## 7. 실제 결제 없이 연결 시험

Tasker의 Notify로 만든 알림은 Notification 이벤트를 트리거하지 않습니다. 시험용 작업을 별도로 만드세요.

1. Variable Set: %budget_kind = eats_notification.
2. Array Set: %evtprm, Values = 쿠팡이츠|[연결 시험]|실제 결제가 아닙니다., Splitter = |.
3. capture.js 실행, 같은 Library.
4. Perform Task: 가계부 보내기.

가계부의 **받은 알림 불러오기**에 시험 알림이 보이고 대기열에서 없어져야 통신 시험이 완료됩니다. 이 주문 자료에는 지출 등록 버튼이 없어 시험 지출이 생성되지 않습니다.

다음 실제 사용 때 별도로 확인할 사항:

- 케이뱅크 승인/출금/취소 각각의 제목·본문이 수신되는가?
- 앱을 열어 둔 상태, 잠금 화면, 백그라운드, 재부팅 후에도 수신되는가?
- 평소 이체·플러스박스 원금 이동 때 어떤 알림이 오는가? 수신함에 보여도 지출 버튼과 합계에는 반영되지 않는가? 시험만을 위해 금융거래를 만들 필요는 없습니다.
- 인터넷을 끊었다가 연결하면 같은 ID로 재전송되는가?
- 쿠팡이츠 주문 화면에 가게, 메뉴, 주문번호, 주문일시, **실제 카드 결제액**이 잡히는가?
- 쿠폰·쿠페이 사용액·배달비·부분취소를 구분할 수 있는가?

실제 휴대폰의 연결 시험은 서버에서 수신했지만 케이뱅크·쿠팡이츠 알림은 아직 확인하지 못했습니다. 위 실기기 검증은 미완료이며 공개 자료를 실제 사용자 알림인 것처럼 테스트하지 않았습니다.

## 8. 주문 매칭 계약

js/phone-import.js의 matchOrder(payment, orders)는 준비된 순수 함수이며 아직 실제 수집·DB 자동 갱신 작업에 연결하지 않았습니다.

- 결제: amount, approved_at(시간대 포함), merchant, card_hint.
- 주문: id, platform(coupang/coupang_eats), card_paid_amount, paid_at(시간대 포함), card_hint, status(paid), store, items.
- 실제 카드 결제액이 같고 승인 시각과 15분 이내인 후보를 찾습니다. 이 시간 범위는 초기 보수적 설정이며 실제 자료로 재검증해야 합니다.
- 양쪽 카드 식별값이 서로 다르면 제외합니다. 카드 식별값이나 메뉴가 빠지면 확인 대기로 둡니다.
- 후보가 여러 개면 가까운 시각 하나를 임의로 선택하지 않습니다.
- 환불/취소 주문은 자동 연결하지 않습니다.
- 결과는 주문번호·설명·분류 제안입니다. 원래 결제 금액·일시·가맹점과 사용자 수정값을 덮어쓰지 않습니다.
- 쿠팡의 생활비 분류는 제안이며 의류 등 실제 내용에 따라 수정해야 합니다.

실알림 계약 확정, 중복 승인/출금 통합, 승인번호 기반 연계, 취소·부분환불 처리, Hermes 주문 수집 및 자동 설명 갱신은 후속 작업입니다.

## 확인한 근거

- [Tasker Notification 공식 도움말](https://tasker.joaoapps.com/userguide/en/help/eh_new_notification.html): 앱 필터, 갱신 알림, Tasker 자체 알림 제외.
- [Tasker 변수 공식 설명](https://tasker.joaoapps.com/userguide_summary.html): Notification에서는 %NTITLE보다 %evtprm2 등 이벤트 변수를 권장.
- [Tasker HTTP Request 공식 도움말](https://tasker.joaoapps.com/userguide/en/help/ah_http_request.html): POST·헤더·JSON 본문.
- [Tasker JavaScript 공식 문서](https://tasker.joaoapps.com/userguide/en/javascript.html): 로컬 라이브러리·배열·전역 변수·확인창.
- [Tasker Get Screen Info 공식 도움말](https://tasker.joaoapps.com/userguide/en/help/ah_get_screen_info_assistant.html): 현재 화면의 %ai_texts. 앱마다 제공 정보가 다름.
- [Tasker 공식 이슈 Q&A](https://tasker.helprace.com/i1468-assistance-request-targetted-to-a-specific-app-is-always-running-for-every-app): 화면 텍스트 사용 설정이 필요하다는 보고와 개발자 답변.
- [케이뱅크 공식 Android 앱](https://play.google.com/store/apps/details?id=com.kbankwith.smartbank&hl=ko): 앱 패키지 확인.
- [케이뱅크 설정 화면을 캡처한 2023년 사용기](https://pjhhh.tistory.com/1280): 카드 승인·취소와 입출금 알림 설정 구분, 잔액 옵션. **현재 메뉴나 알림 본문 형식의 증거는 아님**.
- [다른 2023년 설정 사용기](https://laystory.tistory.com/627): 계좌 관리 → 입출금통지 → 푸시 알림. 최신 화면과 다를 수 있음.

현재 케이뱅크 카드 알림의 정확한 전문과 쿠팡이츠 알림에 포함되는 메뉴 목록은 공개 자료만으로 확인하지 못했습니다.
