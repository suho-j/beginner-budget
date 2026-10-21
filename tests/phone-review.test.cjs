const test=require('node:test');
const assert=require('node:assert/strict');
const draft=event=>require('../js/phone-review.js').draft(event);
const event=(text)=>({kind:'kbank_notification',captured_at:'2026-10-16T15:30:00.000Z',text});
test('카드 결제의 한 금액과 수신일을 미리 채우되 수신일임을 구분한다',()=>{
  const value=draft(event('케이뱅크\n체크카드 승인\n테스트 상점 18,900원\n잔액 99,999원'));
  assert.equal(value.amount,18900);assert.equal(value.date,'2026-10-17');
  assert.equal(value.dateSource,'received');assert.equal(value.memo,'테스트 상점');
  assert.equal(value.quick,true);
});
test('이동·시험·취소는 분류 대상으로 만들지 않고 여러 금액은 직접 확인한다',()=>{
  for(const text of ['플러스박스 출금 1원','카드 승인 취소 9,000원','[연결 시험] 실제 결제가 아닙니다.'])assert.equal(draft(event(text)).quick,false);
  assert.equal(draft(event('카드 승인\n상점 10,000원 배송비 3,000원')).amount,null);
  assert.equal(draft(event('카드 승인\n상점 -100원')).amount,null);
  assert.equal(draft(event('카드 승인\n상점 1,00원')).amount,null);
});
const orderEvent=(text)=>({kind:'coupang_order',captured_at:'2026-10-21T11:31:00.000Z',text});
const coupangText=[
  '주문 상세','주문번호 20000009999999','주문일시 2026-10-21 20:31','판매자 로켓배송',
  '합성 세제 리필 2L · 2개','합성 키친타월 6롤 · 1개',
  '상품 금액 21,900원','배송비 3,000원','할인 -3,000원','쿠팡캐시 사용 -3,000원',
  '총 결제 금액 18,900원','카드 결제 금액 15,900원','주문 상태 배송완료'
].join('\n');
test('쿠팡 웹 주문은 카드 결제액·주문일·상품 메모·생활비를 채우고 연결을 제안한다',()=>{
  const value=draft(orderEvent(coupangText));
  assert.equal(value.amount,15900);assert.equal(value.amountSource,'카드 결제액');
  assert.equal(value.date,'2026-10-21');assert.equal(value.category,'생활비');
  assert.equal(value.suggestedAction,'link');
  assert.equal(value.memo,'쿠팡 · 합성 세제 리필 2L · 2개 · 합성 키친타월 6롤 · 1개');
});
test('취소된 쿠팡 주문은 연결하지 않고 제외를 제안한다',()=>{
  const value=draft(orderEvent(coupangText.replace('주문 상태 배송완료','주문 상태 주문 취소')));
  assert.equal(value.suggestedAction,'ignore');assert.match(value.warning,/취소·환불/);
});
test('명시된 날짜가 있으면 수신일 대신 쓰고 잘못된 날짜는 보류한다',()=>{
  assert.equal(draft(event('카드 승인\n2026-10-15\n상점 10,000원')).date,'2026-10-15');
  assert.equal(draft(event('카드 승인\n2026-02-31\n상점 10,000원')).quick,false);
  assert.equal(draft(event('카드 승인\n10/16 23:50\n상점 10,000원')).date,'2026-10-16');
});
