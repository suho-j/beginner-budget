/* Synthetic data only; never connects to the live backend. */
(function(){
  const texts=['체크카드 승인 테스트 상점 18,900원','플러스박스 빼기 완료 100,000원','계좌이체 완료 100,000원','출금 18,900원 쿠팡 주식회사','쿠팡 주식회사 18,900원','입금 1,000원','<script>throw Error("XSS")</script>'];
  const rows=texts.map((text,i)=>({event_id:'event-'+i,kind:'kbank_notification',status:'pending',captured_at:'2026-10-21T01:30:00.000Z',text,balance_amount:i===3?50000:null}));
  let transactions=[],balances=[],user={id:'11111111-1111-4111-8111-111111111111'};
  const fixture=window.reviewFixture={fail:false,calls:[],uploads:[],downloads:0,rows};
  window.BudgetCloud={
    ENVIRONMENT:{name:'preview-v2',isPreview:true,transactionsTable:'preview_v2_transactions'},
    SUPABASE_URL:'https://example.invalid',SUPABASE_ANON_KEY:'public-test-key',
    isConfigured:()=>true,currentUser:async()=>user,signOut:async()=>{user=null;},
    downloadState:async()=>{fixture.downloads++;return window.BudgetStorage.normalizeState({transactions});},
    saveSettings:async()=>{},isDuplicateTransactionError:()=>false,
    getClient:()=>({
      rpc:async(name,args)=>{
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
