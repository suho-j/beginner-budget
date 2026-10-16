/* Run after HTTP Request, including errors. Never remove an unacknowledged item. */
(function () {
  'use strict';
  setLocal('budget_ack', '0');
  setLocal('budget_body', '');
  var code = Number(typeof http_response_code !== 'undefined' ? http_response_code : 0);
  var response;
  try { response = JSON.parse(typeof http_data === 'string' ? http_data : 'null'); }
  catch (_) { return; }
  var sentId = typeof budget_event_id === 'string' ? budget_event_id : '';
  if (code < 200 || code >= 300 || !response || response.ok !== true
    || !sentId || response.event_id !== sentId) return;
  var queue = JSON.parse(global('BUDGETOUTBOX') || '[]');
  if (!Array.isArray(queue)) throw new Error('전송 대기열이 올바르지 않아요.');
  setGlobal('BUDGETOUTBOX', JSON.stringify(queue.filter(function (event) {
    return event.event_id !== sentId;
  })));
  setLocal('budget_ack', '1');
})();
