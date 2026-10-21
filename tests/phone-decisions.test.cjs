const test=require('node:test');
const assert=require('node:assert/strict');
const phone=require('../js/phone-import.js');
const review=require('../js/phone-review.js');
const event=text=>({version:1,event_id:'decision-test',kind:'kbank_notification',package_name:'com.kbankwith.smartbank',captured_at:'2026-10-21T01:00:00.000Z',text});
test('잔액은 구조화해 보존하고 거래 금액과 구별하며 전송 재시도에서도 유지한다',()=>{
  const result=phone.normalizeEvent(event('출금 18,900원\n잔액 999,999원\n계좌번호 123-456-789012'));
  assert.equal(result.balance_amount,999999);
  assert.ok(!result.text.includes('999,999')&&!result.text.includes('123-456-789012'));
  assert.deepEqual(phone.normalizeEvent(result),result);
  const draft=review.draft(result);
  assert.equal(draft.amount,18900);assert.equal(draft.balanceAmount,999999);assert.equal(draft.quick,false);
});
test('마이너스 잔액·0원·여러 계좌·잔여한도와 잘못된 값을 구분한다',()=>{
  assert.equal(phone.normalizeEvent(event('잔액 -1,000원')).balance_amount,-1000);
  assert.equal(phone.normalizeEvent(event('잔액 0원')).balance_amount,0);
  for(const text of ['잔여한도 50,000원','누적사용액 50,000원','잔액 1,00원','잔액 1,000.50원','잔액 10원\n잔액 20원']) assert.equal(phone.normalizeEvent(event(text)).balance_amount,undefined,text);
  for(const balance_amount of ['100',true,1.5,2147483648])assert.throws(()=>phone.normalizeEvent({...event('출금 100원'),balance_amount}));
});
test('출금·이체·주문·미확인 알림도 사용자가 검토할 정보를 제공한다',()=>{
  for(const text of ['출금 18,900원','계좌이체 18,900원','알 수 없는 알림 18,900원']){
    const draft=review.draft(event(text));assert.equal(draft.amount,18900);assert.equal(draft.date,'2026-10-21');assert.equal(draft.quick,false);
  }
  const draft=review.draft({...event('주문 완료 18,900원'),kind:'eats_notification'});
  assert.equal(draft.amount,18900);assert.equal(draft.quick,false);
});
test('사용자가 고른 처리 방식만 정규화하며 미선택·잘못된 거래·잔액은 거절한다',()=>{
  const raw={action:'expense',date:'2026-10-21',amount:'18,900',category:'생활비',memo:'항목 수정',remark:'별도 리마크',include_balance:false,attachments:[]};
  assert.equal(review.normalizeDecision(raw).amount,18900);
  assert.equal(review.normalizeDecision({...raw,action:'income',category:'기타'}).action,'income');
  for(const action of ['transfer','ignore'])assert.equal(review.normalizeDecision({...raw,action,amount:'',date:''}).action,action);
  const balance=review.normalizeDecision({...raw,action:'balance',amount:'',date:'',include_balance:true,balance_amount:'-50,000',account_label:'생활비 통장'});
  assert.equal(balance.balance_amount,-50000);
  for(const patch of [{action:''},{amount:0},{amount:'1e3'},{date:'2026-02-31'},{remark:'x'.repeat(1001)},{memo:'x'.repeat(81)},{include_balance:true,balance_amount:0,account_label:''},{action:'balance',include_balance:false},{attachments:['a','b','c','d']}])assert.equal(review.normalizeDecision({...raw,...patch}),null,JSON.stringify(patch));
});
