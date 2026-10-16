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
    var reconnect = queue.some(function (event) { return event.connection_id !== config.connection_id; })
      || (queue.length && previous && (previous.endpoint !== config.endpoint
        || previous.device_token !== config.device_token || previous.public_key !== config.public_key));
    if (reconnect) {
      // A new registration revokes the old key. Never require the revoked key to drain the queue.
      // Explicit consent is needed: the phone cannot prove the account owning the new key.
      if (!previous || previous.endpoint !== config.endpoint
        || !/^[0-9a-f]{64}$/.test(previous.connection_id || '')
        || queue.some(function (event) { return event.connection_id !== previous.connection_id; })) {
        flashLong('연결이 서로 달라 자동으로 복구하지 않았어요. 남은 알림은 그대로 보관합니다.');
        return;
      }
      queue.forEach(function (event) { BudgetPhoneImport.normalizeEvent(event); });
      if (!confirm('미전송 알림 ' + queue.length + '개를 방금 붙여 넣은 연결로 보낼까요?\n'
        + '기존과 같은 계정·같은 가계부에서 복사한 설정일 때만 확인을 누르세요.\n'
        + '알림 내용과 ID는 유지하고, 이전 대기열은 휴대폰에 백업합니다. 취소하면 바꾸지 않습니다.')) return;
      queue = queue.map(function (event) {
        return Object.assign({}, event, {connection_id:config.connection_id});
      });
    }
    // An in-flight sender may still acknowledge an old request. Do not change its connection.
    if (taskRunning('BB 보내기')) {
      flashLong('BB 보내기가 실행 중이에요. 실행이 끝난 뒤 다시 시도해 주세요. 연결은 바꾸지 않았어요.');
      return;
    }
    if (global('BUDGETOUTBOX') !== saved || global('BUDGETCONFIG') !== old) {
      flashLong('준비 중 알림 상태가 바뀌었어요. 다시 실행해 주세요. 연결은 바꾸지 않았어요.');
      return;
    }
    var testId = global('BUDGETTESTID');
    var pending = !reconnect && queue.some(function (event) { return event.event_id === testId; });
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
    if (reconnect) setGlobal('BUDGETOUTBOXBACKUP', saved);
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
