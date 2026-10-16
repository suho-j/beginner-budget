/* Run after acknowledge.js. Only a matching server acknowledgement enables capture. */
(function () {
  'use strict';
  if (typeof budget_ack !== 'string' || budget_ack !== '1') {
    setGlobal('BUDGETSTATUS', '전송 대기: 인터넷과 가계부 연결을 확인해 주세요.');
    if (typeof budget_event_id === 'string' && budget_event_id === global('BUDGETTESTID')) {
      flashLong('연결 시험이 아직 성공하지 않았어요. BB 상태에서 확인하세요. 15분마다 다시 시도합니다.');
    }
    return;
  }
  setGlobal('BUDGETSTATUS', '마지막 전송 성공: ' + new Date().toISOString());
  if (typeof budget_event_id === 'string' && budget_event_id === global('BUDGETTESTID')) {
    var config = JSON.parse(global('BUDGETCONFIG') || 'null');
    if (!config || !/^[0-9a-f]{64}$/.test(config.connection_id || '')) return;
    setGlobal('BUDGETREADY', config.connection_id);
    setGlobal('BUDGETTESTID', '');
    flashLong('서버 연결 시험 성공! 이제 알림 접근 권한을 허용하면 새 알림을 모읍니다.');
  }
})();
