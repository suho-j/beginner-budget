/* Synthetic data only; never connects to the live backend. */
(function(){
  const texts=['체크카드 승인 테스트 상점 18,900원','플러스박스 빼기 완료 100,000원','계좌이체 완료 100,000원','출금 18,900원 쿠팡 주식회사','쿠팡 주식회사 18,900원','입금 1,000원','<script>throw Error("XSS")</script>'];
  const rows=texts.map((text,i)=>({event_id:'event-'+i,kind:'kbank_notification',status:'pending',captured_at:'2026-10-21T01:30:00.000Z',text,balance_amount:i===3?50000:null}));
  rows.push(
    {event_id:'order-7',kind:'eats_screen',status:'pending',captured_at:'2026-10-21T01:30:00.000Z',text:'주문 상세\n테스트 치킨\n2026-10-20 오후 11:28\n주문번호 EATS123\n바삭치킨 1개\n메뉴금액 29,000원\n쿠폰 할인 -3,000원\n총 결제금액 26,000원'},
    {event_id:'bank-8',kind:'kbank_notification',status:'pending',captured_at:'2026-10-20T14:28:28.000Z',text:'케이뱅크\n승인 26,000원\n쿠팡 주식회사\n카드(1111) | 10/20 23:28\n출금가능액 123,456원'},
    {event_id:'notice-9',kind:'eats_notification',status:'pending',captured_at:'2026-10-21T01:30:00.000Z',text:'음식을 픽업했습니다. 배달 현황을 확인하세요.'}
  );
  let transactions=[],balances=[],user={id:'11111111-1111-4111-8111-111111111111'};
  const fixture=window.reviewFixture={fail:false,calls:[],uploads:[],downloads:0,rows};
  window.BudgetCloud={
    ENVIRONMENT:{name:'preview-v2',isPreview:true,transactionsTable:'preview_v2_transactions'},
    SUPABASE_URL:'https://example.invalid',SUPABASE_ANON_KEY:'public-test-key',
    isConfigured:()=>true,currentUser:async()=>user,signOut:async()=>{user=null;},
    downloadState:async()=>{fixture.downloads++;return window.BudgetStorage.normalizeState({monthlyBudget:500000,categoryBudgets:{생활비:200000,배달비:100000,의류비:100000,비상금:50000,휴가비:50000},transactions});},
    saveSettings:async()=>{},isDuplicateTransactionError:()=>false,
    getClient:()=>({
      rpc:async(name,args)=>{
        if(name==='link_phone_order'){
          fixture.calls.push(args);if(fixture.fail)return{error:{code:'503'}};
          const row=rows.find(r=>r.event_id===args.p_event_id),d=args.p_decision;
          if(row.status!=='pending')return{data:{already_recorded:true},error:null};
          let tx;
          if(d.target_kind==='notification'){
            const payment=rows.find(r=>r.event_id===d.target_id);payment.status='recorded';payment.transaction_id='phone-'+payment.event_id;
            tx={id:payment.transaction_id,type:'expense',source:'user',date:d.date,amount:d.amount,category:d.category,memo:d.memo};transactions.push(tx);
          }else {tx=transactions.find(t=>t.id===d.target_id);tx.memo=d.memo;tx.category=d.category;}
          row.status='recorded';row.transaction_id=tx.id;row.decision=d;return{data:{id:tx.id,linked:true},error:null};
        }
        if(name==='resolve_phone_event'){
          fixture.calls.push(args);if(fixture.fail)return{error:{code:'503'}};
          const row=rows.find(r=>r.event_id===args.p_event_id),d=args.p_decision;
          if(row.status!=='pending')return{data:{already_recorded:true},error:null};
          row.decision=d;row.status=['income','expense'].includes(d.action)?'recorded':'ignored';
          if(row.status==='recorded'){row.transaction_id='phone-'+row.event_id;transactions.push({id:row.transaction_id,type:d.action,source:'user',date:d.date,amount:d.amount,category:d.category,memo:d.memo});}
          if(d.include_balance)balances=[{account_label:d.account_label,balance_amount:d.balance_amount,captured_at:row.captured_at}];
          return{data:{id:row.transaction_id,already_recorded:false,balance_applied:d.include_balance},error:null};
        }
        if(name==='reopen_phone_event')rows.find(r=>r.event_id===args.p_event_id).status='pending';
        return{data:null,error:null};
      },
      storage:{from:()=>({upload:async(path,file)=>{fixture.uploads.push({path,type:file.type,size:file.size});return{data:{path},error:null};},createSignedUrl:async()=>({data:{signedUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Jx8AAAAASUVORK5CYII='},error:null})})},
      from:table=>{
        const filters=[];
        const query={select:()=>query,eq:(k,v)=>{filters.push(r=>r[k]===v||['user_id','environment'].includes(k));return query;},neq:(k,v)=>{filters.push(r=>r[k]!==v);return query;},order:()=>query,
          limit:async n=>({data:JSON.parse(JSON.stringify((table==='phone_inbox'?rows:table==='phone_account_balances'?balances:transactions).filter(r=>filters.every(f=>f(r))).slice(0,n))),error:null})};return query;
      }
    })
  };
})();
