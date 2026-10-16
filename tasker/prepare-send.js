/* Tasker JavaScript action. Library: local phone-import.js. Auto Exit: on. */
var budget_send = '0';
var budget_body = '';
var budget_event_id = '';
var budget_url = '';
var budget_headers = '';
(function () {
  'use strict';
  var saved = global('BUDGETOUTBOX');
  var queue = !saved || saved === '%BUDGETOUTBOX' ? [] : JSON.parse(saved);
  if (!Array.isArray(queue)) throw new Error('전송 대기열이 올바르지 않아요.');
  if (!queue.length) return;
  var config = JSON.parse(global('BUDGETCONFIG') || 'null');
  if (!config || !/^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\/rpc\/receive_phone_event$/.test(config.endpoint)
    || typeof config.public_key !== 'string' || !/^[A-Za-z0-9._-]+$/.test(config.public_key)
    || !/^[0-9a-f]{64}$/.test(config.device_token || '')) {
    throw new Error('가계부에서 만든 연결 설정을 확인해 주세요.');
  }
  if (!/^[0-9a-f]{64}$/.test(config.connection_id || '')
    || queue[0].connection_id !== config.connection_id) {
    throw new Error('이전 연결의 대기 알림이 남아 있어요. 확인 없이 새 연결로 전송하지 않아요.');
  }
  var event = BudgetPhoneImport.normalizeEvent(queue[0]);
  budget_event_id = event.event_id;
  budget_url = config.endpoint;
  budget_headers = 'Content-Type:application/json\napikey:' + config.public_key;
  budget_body = JSON.stringify({p_token:config.device_token, p_event:event});
  budget_send = '1';
})();
