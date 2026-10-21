const test=require('node:test'),assert=require('node:assert/strict');
const review=require('../js/phone-review.js');
const bank=text=>({event_id:'bank-a',kind:'kbank_notification',captured_at:'2026-10-21T08:40:00.000Z',text});
const order=text=>({...bank(text),event_id:'order-a',kind:'eats_screen'});
const detail='주문 상세\n테스트 치킨\n2026-10-20 오후 11:28\n주문번호 EATS123\n바삭치킨 1개\n메뉴금액 29,000원\n쿠폰 할인 -3,000원\n총 결제금액 26,000원\n결제수단 케이뱅크 카드';
test('승인 금액과 출금가능액을 분리하고 반복된 은행 알림을 한 번만 읽는다',()=>{
  const text='케이뱅크\n승인 700원\n테스트 의원\n카드(1111) | 10/21 17:40\n출금가능액 123,456원';
  const d=review.draft(bank(text+'\n'+text+'\ntrue'));
  assert.equal(d.amount,700);assert.equal(d.balanceAmount,123456);assert.equal(d.memo,'테스트 의원');assert.equal(d.suggestedAction,'expense');assert.equal(d.date,'2026-10-21');
});
test('입금·플러스박스·안내는 서로 다른 기본 선택을 제공한다',()=>{
  assert.equal(review.draft(bank('입금 4원\n모두 다 캐시백 | 생활통장(1111)')).suggestedAction,'income');
  assert.equal(review.draft(bank('플러스박스 빼기 완료 100,000원')).suggestedAction,'transfer');
  const info=review.draft({...bank('음식을 픽업했습니다.\n배달 현황을 확인하세요.'),kind:'eats_notification'});
  assert.equal(info.notice,true);assert.equal(info.suggestedAction,'ignore');
});
test('반복 금액은 채우되 배송비·할인액을 결제 금액으로 오인하지 않는다',()=>{
  assert.equal(review.draft(bank('승인 10,000원\n결제금액 10,000원')).amount,10000);
  assert.equal(review.draft(bank('상품 10,000원 배송비 3,000원')).amount,null);
  assert.equal(review.draft(bank('승인 -100원')).amount,null);
  assert.equal(review.draft(bank('승인 1,00원')).amount,null);
});
test('쿠팡이츠 상세의 최종 결제액·실제 주문일·가게와 메뉴를 채운다',()=>{
  const d=review.draft(order(detail));
  assert.equal(d.amount,26000);assert.equal(d.date,'2026-10-20');assert.equal(d.suggestedAction,'link');assert.equal(d.category,'배달비');
  assert.match(d.memo,/테스트 치킨/);assert.match(d.memo,/바삭치킨/);assert.ok(!d.memo.includes('쿠폰'));
});
test('복합 결제는 카드 실결제액을 우선하고 모호한 결제액은 고르지 않는다',()=>{
  const d=review.draft(order(detail+'\n쿠페이머니 6,000원\n카드 결제금액 20,000원'));
  assert.equal(d.amount,20000);
  assert.equal(review.draft(order(detail+'\n카드 결제금액 20,000원\n카드 결제금액 21,000원')).amount,null);
});
test('추천 광고가 있는 주문 목록과 주문 상세를 구분한다',()=>{
  const d=review.draft(order('과거 주문 내역\n이전에 주문했던 맛집을 추천드려요\n광고 식당\n26,000원\n재주문하기\n배달이 완료되었습니다.\n다른 식당\n2026-10-20 오후 11:28'));
  assert.equal(d.amount,null);assert.equal(d.order.valid,false);assert.match(d.warning,/상세/);
});
test('기존 지출과 아직 미반영인 결제 알림에서 같은 날짜·금액의 쿠팡 결제를 찾는다',()=>{
  const value=review.draft(order(detail));
  const tx={id:'tx-a',type:'expense',date:'2026-10-20',amount:26000,memo:'쿠팡 주식회사',category:'생활비'};
  const pending={...bank('승인 26,000원\n쿠팡 주식회사\n카드(1111) | 10/20 23:28'),status:'pending',captured_at:'2026-10-20T14:28:28.000Z'};
  assert.equal(review.linkCandidates(value,[tx],[])[0].id,'tx-a');
  assert.equal(review.linkCandidates(value,[],[pending])[0].kind,'notification');
  assert.equal(review.linkCandidates(value,[tx,{...tx,id:'tx-b'}],[]).length,2);
  assert.equal(review.linkCandidates(value,[{...tx,date:'2026-10-19'},{...tx,memo:'다른 상점'}],[]).length,0);
  assert.equal(review.linkCandidates(value,[],[{...pending,status:'recorded',transaction_id:'tx-a'}]).length,0);
});
test('주문 연결은 대상·날짜·금액이 있어야 하고 수입으로 연결하지 않는다',()=>{
  const d={action:'link',target_kind:'transaction',target_id:'tx-a',expected_memo:'쿠팡 주식회사',date:'2026-10-20',amount:26000,category:'배달비',memo:'쿠팡이츠 · 테스트 치킨',remark:'',include_balance:false,attachments:[]};
  assert.equal(review.normalizeDecision(d).target_id,'tx-a');
  for(const patch of [{target_id:''},{target_kind:'income'},{amount:0},{date:'2026-02-31'}])assert.equal(review.normalizeDecision({...d,...patch}),null);
});
