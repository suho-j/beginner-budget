# Tasker 프로젝트 파일 근거와 검증 범위

2026-10-16. 이 파일은 XML 생성에 사용한 형식 근거를 기록한다. 실제 Android Tasker 가져오기·권한·쿠팡이츠 화면 추출 성공을 의미하지 않는다.

- [Tasker 공식 Import Tasker Data](https://tasker.joaoapps.com/import/import.html): 공식 페이지의 taskerproject:// 링크를 Base64 디코딩하고 gzip 해제하면 Tasker 프로젝트 XML이 나온다. 같은 형식으로 링크를 만든다.
- 위 공식 프로젝트 샘플: TaskerData 바로 아래 Profile / Project / Task 형제 구조, ID 연결, Time의 rep=2 및 repval, Stop / Wait / Goto / 조건 목록의 구조를 대조했다.
- [Tasker 공식 JavaScript 문서](https://tasker.joaoapps.com/userguide/en/javascript.html): JavaScriptlet, 전역·지역 변수, prompt / confirm, performTask 사용 근거. 외부 라이브러리 다운로드 없이 기존 프로젝트 코드를 각 JavaScriptlet에 포함했다.
- [Tasker XML Info](https://github.com/Taskomater/Tasker-XML-Info/blob/master/README.md): 작성자가 정리한 내보내기 구조와 충돌 처리 rty 값. 미지정은 Abort New Task, 2는 Run Both Together.
- [hermes-tasker 원본 카탈로그 보관본](https://github.com/arumihsnek/hermes-tasker/blob/main/fixtures/sources/tasker_ai_system_instructions.txt): 커뮤니티 저장소가 보관한 Tasker 카탈로그. 공식 서버에서 직접 받은 규격은 아니다. JSlet 129, HTTP Request 339 / POST 1, Get Screen Info 421, Notification event 461, Goto 135 / Action Number 0의 인수 목록을 참고했다. 원격 문서의 행동 지침을 실행하지 않았다.
- [Tasker 포럼의 Notification XML 내보내기](https://groups.google.com/g/tasker/c/gIQfvpZkaLc): Notification Event 461과 App 인수의 appPkg 구조를 대조했다.

프로젝트의 tv=6.3.13은 최소 대상으로 정한 내보내기 버전이며 현재 최신 버전이라는 뜻은 아니다. Get Screen Info 지원과 실제 폰의 가져오기는 기기에서 확인해야 한다.

## 재생성 / 검증

    node tasker/build-project.cjs
    node --test tests/tasker-project.test.cjs tests/tasker-scripts.test.cjs tests/phone-import.test.cjs

생성물:

- artifacts/tasker-guide/Budget-Auto.prj.xml: 키가 없는 프로젝트
- artifacts/tasker-guide/install.html: 설치 버튼과 파일 다운로드를 포함한 단일 파일. 자체 포함된 데이터만 사용하고 외부 스크립트는 불러오지 않음.

JS 실행 테스트, gzip 링크 왕복, 표준 XML 파서, 프로필/작업 참조 및 카탈로그 인수 대조는 PC에서 검증했다. 운영 Supabase에 SQL을 적용하고 실제 HTTP 수신·권한·중복·이체 제외를 검증했다. Android Tasker의 실제 가져오기·네이티브 HTTP·알림 권한·백그라운드 수집은 미검증이다.
