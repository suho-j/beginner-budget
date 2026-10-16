/* Embedded in BB 시작. Connection secrets are entered only on the phone. */
(function () {
  'use strict';
  var input = prompt('가계부에서 복사한 연결 설정을 붙여 넣으세요.\n설정 → 휴대폰 알림 연결 → 연결 설정 만들기', '');
  if (input === null || !String(input).trim()) return;
  try {
    var config = JSON.parse(input);
    if (!config || !/^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\/rpc\/receive_phone_event$/.test(config.endpoint)
      || typeof config.public_key !== 'string' || !/^[A-Za-z0-9._-]{10,4096}$/.test(config.public_key)
      || !/^[0-9a-f]{64}$/.test(config.device_token || '')
      || !/^[0-9a-f]{64}$/.test(config.connection_id || '')) throw new Error('invalid config');
    // Store only the fields used by the sender.
    config = {endpoint:config.endpoint, public_key:config.public_key,
      device_token:config.device_token, connection_id:config.connection_id};
    var saved = global('BUDGETOUTBOX');
    var queue = !saved || saved === '%BUDGETOUTBOX' ? [] : JSON.parse(saved);
    if (!Array.isArray(queue) || queue.length >= 200) throw new Error('invalid queue');
    var old = global('BUDGETCONFIG');
    var previous = !old || old === '%BUDGETCONFIG' ? null : JSON.parse(old);
    if (queue.some(function (event) { return event.connection_id !== config.connection_id; })
      || (queue.length && previous && (previous.endpoint !== config.endpoint
        || previous.device_token !== config.device_token || previous.public_key !== config.public_key))) {
      flashLong('이전 연결의 미전송 알림이 있어요. 기존 연결에서 먼저 전송한 뒤 연결을 바꿔 주세요.');
      return;
    }
    var testId = global('BUDGETTESTID');
    var pending = queue.some(function (event) { return event.event_id === testId; });
    if (!pending) {
      var event = BudgetPhoneImport.normalizeEvent({
        version:1, event_id:'phone-test-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
        kind:'eats_notification', package_name:BudgetPhoneImport.PACKAGES.eats_notification,
        captured_at:new Date().toISOString(), text:'[연결 시험] 실제 결제가 아닙니다. 지출에 더하지 않습니다.'
      });
      event.connection_id = config.connection_id;
      queue.push(event);
      testId = event.event_id;
    }
    setGlobal('BUDGETCONFIG', JSON.stringify(config));
    setGlobal('BUDGETOUTBOX', JSON.stringify(queue));
    setGlobal('BUDGETTESTID', testId);
    setGlobal('BUDGETREADY', '');
    setGlobal('BUDGETSTATUS', '연결 시험 중');
    flashLong('연결 시험을 보내고 있어요. 성공한 뒤부터 새 알림을 수집합니다.');
    performTask('BB 보내기', 5, '', '', '', false, false, '', false);
  } catch (_) {
    flashLong('연결 설정을 저장하지 않았어요. 가계부에서 복사한 설정 전체를 다시 붙여 넣어 주세요.');
  }
})();
