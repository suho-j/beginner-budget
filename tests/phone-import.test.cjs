const test = require('node:test');
const assert = require('node:assert/strict');

test('알림 수신은 거래 금액으로 추측하지 않고 원문과 수신 시각을 구분한다', () => {
  const phone = require('../js/phone-import.js');
  const event = phone.normalizeEvent({
    version: 1, event_id: 'phone-001', kind: 'kbank_notification',
    package_name: 'com.kbankwith.smartbank', captured_at: '2026-10-16T01:30:00.000Z',
    text: '케이뱅크\n쿠팡 주식회사\n18,900원'
  });
  assert.equal(event.text, '케이뱅크\n쿠팡 주식회사\n18,900원');
  assert.equal(phone.paymentDraft(event).status, 'needs_review');
  assert.equal(phone.paymentDraft(event).amount, null);
});

const sample = (patch = {}) => ({
  version: 1, event_id: 'phone-001', kind: 'kbank_notification',
  package_name: 'com.kbankwith.smartbank', captured_at: '2026-10-16T01:30:00.000Z',
  text: '체크카드 승인\n쿠팡 주식회사 18,900원\n잔액 999,999원', ...patch
});
test('수신 전 잔액·계좌번호를 가리고 인증번호 알림을 거절한다', () => {
  const phone = require('../js/phone-import.js');
  const event = phone.normalizeEvent(sample({text: sample().text + '\n계좌번호: 123-456-789012'}));
  assert.ok(!event.text.includes('999,999'));
  assert.ok(!event.text.includes('123-456-789012'));
  assert.ok(event.text.includes('18,900원'));
  assert.throws(() => phone.normalizeEvent(sample({text:'인증번호 123456'})));
});
test('알림 본문이 중복돼 같은 잔액이 두 번 와도 잔액을 추출하고, 서로 다른 잔액이면 추출하지 않는다', () => {
  const phone = require('../js/phone-import.js');
  const text = '케이뱅크\n입금 9원\n모두 다 캐시백 | 생활통장(8515)\n잔액 1,807,969원';
  const duplicated = phone.normalizeEvent(sample({text: text + '\n' + text + '\ntrue'}));
  assert.equal(duplicated.balance_amount, 1807969);
  assert.ok(!duplicated.text.includes('1,807,969'));
  const conflicting = phone.normalizeEvent(sample({text: text + '\n잔액 1,800,000원'}));
  assert.equal(conflicting.balance_amount, undefined);
  assert.equal(phone.extractBalance('잔액 50,000원\n잔액 50,000원'), 50000);
  assert.equal(phone.extractBalance('잔액 50,000원\n잔액 40,000원'), null);
});
test('다른 앱·빈 본문·잘못된 시각·큰 본문은 수신 대상이 아니다', () => {
  const phone = require('../js/phone-import.js');
  for (const patch of [
    { package_name:'com.other.bank' }, { kind:'anything' }, { version:2 },
    { event_id:'../oops' }, { text:'' }, { text:'x'.repeat(6001) },
    { captured_at:'2026-10-16' }, { captured_at:'2026-02-31T01:00:00.000Z' }
  ]) assert.throws(() => phone.normalizeEvent(sample(patch)));
});

test('주문은 상품 합계가 아닌 실제 카드 결제액·시각·카드로 연결하고 원거래를 바꾸지 않는다', () => {
  const phone = require('../js/phone-import.js');
  const payment = { amount:18900, approved_at:'2026-10-16T10:30:00+09:00', merchant:'쿠팡 주식회사', card_hint:'ONE-1234' };
  const original = JSON.stringify(payment);
  const orders = [{
    id:'eats-1', platform:'coupang_eats', card_paid_amount:18900, total_amount:21900,
    paid_at:'2026-10-16T10:29:00+09:00', card_hint:'ONE-1234', status:'paid',
    store:'테스트 식당', items:['비빔밥 1개']
  }];
  const result = phone.matchOrder(payment, orders);
  assert.equal(result.status, 'matched');
  assert.equal(result.order_id, 'eats-1');
  assert.equal(result.memo, '쿠팡이츠 · 테스트 식당 · 비빔밥 1개');
  assert.equal(JSON.stringify(payment), original);
  assert.equal(phone.matchOrder(payment, [{...orders[0], card_paid_amount:15900}]).status, 'unmatched');
});

test('같은 금액 후보가 두 개면 시간상 가까워도 임의로 고르지 않는다', () => {
  const phone = require('../js/phone-import.js');
  const payment = {amount:18900, approved_at:'2026-10-16T10:30:00+09:00', merchant:'쿠팡 주식회사', card_hint:'ONE-1234'};
  const order = {id:'a', platform:'coupang_eats', card_paid_amount:18900, paid_at:'2026-10-16T10:29:00+09:00', card_hint:'ONE-1234', status:'paid', items:['메뉴']};
  assert.equal(phone.matchOrder(payment, [order, {...order, id:'b', platform:'coupang'}]).status, 'ambiguous');
  assert.equal(phone.matchOrder(payment, [{...order, status:'refunded'}]).status, 'unmatched');
  assert.equal(phone.matchOrder(payment, [{...order, card_hint:'모임-5678'}]).status, 'unmatched');
  assert.equal(phone.matchOrder({...payment, card_hint:''}, [order]).status, 'needs_review');
  assert.equal(phone.matchOrder(payment, [{...order, paid_at:'2026-10-16'}]).status, 'unmatched');
});

test('존재하지 않는 날짜를 정상 날짜로 보정해서 주문과 연결하지 않는다', () => {
  const phone = require('../js/phone-import.js');
  const payment = {amount:18900, approved_at:'2026-02-31T10:30:00+09:00', merchant:'쿠팡 주식회사', card_hint:'ONE-1234'};
  const order = {id:'a', platform:'coupang_eats', card_paid_amount:18900, paid_at:'2026-03-03T10:30:00+09:00', card_hint:'ONE-1234', status:'paid', items:['메뉴']};
  assert.equal(phone.matchOrder(payment, [order]).status, 'needs_review');
});

test('쿠팡 웹 주문은 www.coupang.com 출처로만 수신하고 지출로 기록하지 않는다', () => {
  const phone = require('../js/phone-import.js');
  const event = phone.normalizeEvent({
    version: 1, event_id: 'coupang-20000009999999', kind: 'coupang_order',
    package_name: 'www.coupang.com', captured_at: '2026-10-21T11:31:00.000Z',
    text: '주문 상세\n주문번호 20000009999999\n카드 결제 금액 18,900원'
  });
  assert.equal(event.kind, 'coupang_order');
  assert.equal(event.package_name, 'www.coupang.com');
  assert.equal(phone.paymentDraft(event).canRecordExpense, false);
  for (const patch of [
    { package_name:'com.coupang.mobile.eats' },
    { package_name:'com.coupang.mobile' },
    { kind:'eats_screen', package_name:'www.coupang.com' }
  ]) assert.throws(() => phone.normalizeEvent({
    version: 1, event_id: 'coupang-20000009999999', kind: 'coupang_order',
    package_name: 'www.coupang.com', captured_at: '2026-10-21T11:31:00.000Z',
    text: '주문 상세', ...patch
  }));
});

test('자금이동·이체·출금·미확인 알림은 지출 후보에서 제외하고 명시적 카드 승인만 확인한다', () => {
  const phone = require('../js/phone-import.js');
  const cases = require('./fixtures/phone-notifications.cjs');
  for (const item of cases) {
    const draft = phone.paymentDraft(phone.normalizeEvent(sample({text:item.text})));
    assert.equal(draft.canRecordExpense, item.eligible, item.name);
    assert.equal(draft.amount, null, item.name + ': 금액은 아직 추측하지 않음');
    assert.ok(draft.reason, item.name + ': 사용자에게 처리 이유 표시');
  }
  assert.equal(phone.paymentDraft({kind:'eats_notification', text:'카드 승인 18,900원'}).canRecordExpense, false);
});
