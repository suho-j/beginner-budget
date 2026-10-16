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
test('명시된 날짜가 있으면 수신일 대신 쓰고 잘못된 날짜는 보류한다',()=>{
  assert.equal(draft(event('카드 승인\n2026-10-15\n상점 10,000원')).date,'2026-10-15');
  assert.equal(draft(event('카드 승인\n2026-02-31\n상점 10,000원')).quick,false);
  assert.equal(draft(event('카드 승인\n10/16 23:50\n상점 10,000원')).date,'2026-10-16');
});
