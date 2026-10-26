/* Tasker JavaScript action. Library: local phone-import.js. Auto Exit: on. */
(function () {
  'use strict';
  var kind = typeof budget_kind === 'string' ? budget_kind : '';
  var text = '';
  if (kind === 'eats_screen') {
    var screen = JSON.parse(typeof ai_texts === 'string' ? ai_texts : 'null');
    if (!Array.isArray(screen)) throw new Error('화면 글자를 읽지 못했어요.');
    text = screen.map(function (entry) {
      return entry && typeof entry.text === 'string' ? entry.text : '';
    }).filter(Boolean).join('\n');
    if (!text || !confirm('쿠팡이츠 주문 상세 화면이 맞나요? 주소·전화번호 등 보내지 않을 내용이 있으면 취소하세요.\n\n' + text)) {
      setLocal('budget_queued', '0');
      return;
    }
  } else {
    var values = typeof evtprm !== 'undefined' && Array.isArray(evtprm) ? evtprm : [];
    text = values.slice(1).filter(function (value, index, all) {
      return typeof value === 'string' && value.trim() && value.charAt(0) !== '%' && all.indexOf(value) === index;
    }).join('\n');
  }
  var event = BudgetPhoneImport.normalizeEvent({
    version:1,
    event_id:'phone-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
    kind:kind, package_name:BudgetPhoneImport.PACKAGES[kind],
    captured_at:new Date().toISOString(), text:text
  });
  var saved = global('BUDGETOUTBOX');
  var queue = !saved || saved === '%BUDGETOUTBOX' ? [] : JSON.parse(saved);
  if (!Array.isArray(queue) || queue.length >= 200) {
    flashLong('가계부 전송 대기가 가득 찼어요. 연결 상태를 확인해 주세요.');
    throw new Error('전송 대기열을 확인해 주세요.');
  }
  var config = JSON.parse(global('BUDGETCONFIG') || 'null');
  if (!config || !/^[0-9a-f]{64}$/.test(config.connection_id || '')) {
    throw new Error('가계부에서 연결 설정을 먼저 만들어 주세요.');
  }
  event.connection_id = config.connection_id;
  queue.push(event);
  setGlobal('BUDGETOUTBOX', JSON.stringify(queue));
  setLocal('budget_queued', '1');
})();
