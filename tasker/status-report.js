/* Auto Exit exports this JS binding; setLocal alone would leave its injected value stale. */
var budget_status_url = (function () {
  'use strict';
  function read(name) {
    var value = global(name);
    return typeof value === 'string' && value !== '%' + name ? value : '';
  }
  var connection = 'missing';
  var savedConfig = read('BUDGETCONFIG');
  if (savedConfig) {
    connection = 'invalid';
    try {
      var config = JSON.parse(savedConfig);
      if (config && /^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\/rpc\/receive_phone_event$/.test(config.endpoint || '')
        && typeof config.public_key === 'string' && /^[A-Za-z0-9._-]{10,4096}$/.test(config.public_key)
        && /^[0-9a-f]{64}$/.test(config.device_token || '')
        && /^[0-9a-f]{64}$/.test(config.connection_id || '')) {
        connection = read('BUDGETREADY') === config.connection_id ? 'ready' : 'waiting';
      }
    } catch (_) {}
  }
  var queued = 'invalid';
  try {
    var queue = JSON.parse(read('BUDGETOUTBOX') || '[]');
    if (Array.isArray(queue) && queue.length <= 200) queued = String(queue.length);
  } catch (_) {}
  var savedStatus = read('BUDGETSTATUS');
  var last = 'unknown';
  var at = '';
  var sent = savedStatus.match(/^마지막 전송 성공: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/);
  if (sent && Number.isFinite(Date.parse(sent[1])) && new Date(sent[1]).toISOString() === sent[1]) {
    last = 'sent'; at = sent[1];
  } else if (savedStatus.indexOf('전송 대기:') === 0) last = 'send_wait';
  else if (savedStatus.indexOf('알림을 보관하지 못했어요.') === 0) last = 'capture_error';
  else if (savedStatus === '연결 설정 또는 이전 연결의 대기 알림을 확인해 주세요.') last = 'config_error';
  else if (savedStatus === '연결 시험 중') last = 'testing';
  var report = 'v=2&connection=' + connection + '&queue=' + queued + '&last=' + last + '&at=' + encodeURIComponent(at);
  return 'https://suho-j.github.io/beginner-budget/artifacts/tasker-guide/diagnose.html#' + report;
})();
