/* Shared by the static ledger, Tasker scripts and Node tests. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BudgetPhoneImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PACKAGES = Object.freeze({
    kbank_notification: 'com.kbankwith.smartbank',
    eats_notification: 'com.coupang.mobile.eats',
    eats_screen: 'com.coupang.mobile.eats',
    coupang_order: 'www.coupang.com'
  });

  function redactText(text) {
    return text
      .replace(/(?:잔액|잔여한도|누적사용액)\s*[:：]?\s*-?[\d,.]+\s*원?/g, '[잔액 숨김]')
      .replace(/(?:계좌번호|카드번호)\s*[:：]?\s*[\d* -]{8,}/g, '[번호 숨김]')
      .replace(/\b\d{3,6}-\d{2,6}-\d{3,8}\b/g, '[번호 숨김]')
      .replace(/\b(?:\d[ -]?){15}\d\b/g, '[번호 숨김]');
  }

  function extractBalance(text) {
    const matches = [...text.matchAll(/잔액\s*[:：]?\s*(-?[\d,.]+)\s*원?/g)];
    if (matches.length !== 1 || !/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(matches[0][1])) return null;
    const amount = Number(matches[0][1].replace(/,/g, ''));
    return Number.isInteger(amount) && Math.abs(amount) <= 2147483647 ? amount : null;
  }

  function normalizeEvent(input) {
    if (!input || input.version !== 1
      || !Object.prototype.hasOwnProperty.call(PACKAGES, input.kind)
      || input.package_name !== PACKAGES[input.kind]
      || typeof input.event_id !== 'string'
      || !/^[a-zA-Z0-9._:-]{1,128}$/.test(input.event_id)
      || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 6000
      || typeof input.captured_at !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.captured_at)
      || !Number.isFinite(Date.parse(input.captured_at))
      || new Date(input.captured_at).toISOString() !== input.captured_at
      || /인증\s*번호|일회용\s*비밀번호|\bOTP\b|보안\s*코드/i.test(input.text)) {
      throw new Error('수신할 알림 정보가 올바르지 않아요.');
    }
    const result = {
      version: 1, event_id: input.event_id, kind: input.kind,
      package_name: input.package_name, captured_at: input.captured_at,
      text: redactText(input.text.replace(/\r\n?/g, '\n').trim())
    };
    const balance = input.balance_amount === undefined ? extractBalance(input.text) : input.balance_amount;
    if (input.balance_amount !== undefined && (typeof balance !== 'number' || !Number.isInteger(balance) || Math.abs(balance) > 2147483647)) {
      throw new Error('잔액이 올바르지 않아요.');
    }
    // Preserve the original v1 payload when there is no balance, including old retries.
    if (balance !== null && input.kind === 'kbank_notification') result.balance_amount = balance;
    return result;
  }

  function paymentDraft(event) {
    const draft = {status:'needs_review', amount:null, date:'', memo:'', canRecordExpense:false};
    const text = typeof event.text === 'string' ? event.text : '';
    if (event.kind !== 'kbank_notification') {
      draft.reason = '주문 정보는 결제 내역의 설명에만 사용해요. 별도 지출로 더하지 않아요.';
    } else if (/취소|환불|반환/.test(text)) {
      draft.reason = '취소·환불은 새 지출로 기록하지 않아요. 원래 결제와 따로 확인해 주세요.';
    } else if (/이자|캐시백|리워드|적립/.test(text)) {
      draft.reason = '이자·혜택 알림은 지출로 기록하지 않아요. 수입으로도 자동 등록하지 않아요.';
    } else if (/플러스\s*박스|\+\s*박스/.test(text)) {
      draft.reason = '플러스박스의 원금 이동은 내 돈을 옮기는 것이에요. 수입·지출에 더하지 않아요.';
    } else if (/이체|송금/.test(text)) {
      draft.reason = '이체·송금은 지출로 분류하지 않아요. 실제 소비라면 거래 입력에서 직접 기록해 주세요.';
    } else if (/입금|출금|인출/.test(text)) {
      draft.reason = '계좌 입출금은 카드 결제와 중복될 수 있어 여기서 지출로 기록하지 않아요.';
    } else if (/거절|실패|예정|요청|신청|대기|안내|발급|등록|결제일|혜택/.test(text)) {
      draft.reason = '결제가 완료된 알림으로 확인되지 않아 보관만 해요. 지출 합계에 더하지 않아요.';
    } else if (/카드[\s:：]*(승인(\s*완료)?|결제\s*완료)($|[\s:：0-9])/.test(text)
      && /[0-9][0-9,]*\s*원/.test(text)) {
      // A review candidate, not a verified bank transaction. Keep SQL's gate in sync.
      draft.canRecordExpense = true;
      draft.reason = '카드 결제 후보예요. 실제 금액·날짜와 중복 여부를 확인한 뒤 기록해 주세요.';
    } else {
      draft.reason = '카드 결제로 확인되지 않아 보관만 해요. 지출 합계에는 더하지 않아요.';
    }
    return draft;
  }

  function instant(value) {
    if (typeof value !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/.test(value)) return NaN;
    const day = new Date(value.slice(0, 10) + 'T00:00:00.000Z');
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
    return Date.parse(value);
  }

  function matchOrder(payment, orders) {
    if (!payment || !Number.isInteger(payment.amount) || payment.amount <= 0
      || !/쿠팡|coupang/i.test(payment.merchant || '')
      || !Array.isArray(orders) || !Number.isFinite(instant(payment.approved_at))
      || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(payment.approved_at || '')) {
      return { status: 'needs_review' };
    }
    const candidates = orders.filter(order => order
      && ['coupang', 'coupang_eats'].includes(order.platform)
      && typeof order.id === 'string' && order.id.length > 0
      && order.status === 'paid'
      && Number.isInteger(order.card_paid_amount)
      && order.card_paid_amount === payment.amount
      && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(order.paid_at || '')
      && Math.abs(instant(order.paid_at) - instant(payment.approved_at)) <= 15 * 60 * 1000
      && !(payment.card_hint && order.card_hint && payment.card_hint !== order.card_hint));
    if (!candidates.length) return { status: 'unmatched' };
    if (candidates.length !== 1) return { status: 'ambiguous' };
    const order = candidates[0];
    const label = order.platform === 'coupang_eats' ? '쿠팡이츠' : '쿠팡';
    const items = Array.isArray(order.items) ? order.items.filter(item => typeof item === 'string' && item.trim()) : [];
    const memo = [label, typeof order.store === 'string' ? order.store : '', ...items]
      .filter(Boolean).join(' · ').replace(/\s+/g, ' ').slice(0, 80);
    return {
      status: payment.card_hint && order.card_hint && items.length ? 'matched' : 'needs_review',
      order_id: order.id, platform: order.platform, memo,
      category: order.platform === 'coupang_eats' ? '배달비' : '생활비',
      original_merchant: payment.merchant
    };
  }

  return { PACKAGES, normalizeEvent, redactText, extractBalance, paymentDraft, matchOrder };
});
