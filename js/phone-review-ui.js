/* Received notifications remain pending until the user chooses how to apply them. */
(function(window,document){
  'use strict';
  const $=id=>document.getElementById(id),model=()=>window.BudgetPhoneReview,bucket='budget-phone-evidence';
  let userId=null,ready=false,busy=false,loading=false,generation=0,rows=[],history=[],balances=[],transactions=[],editing=false,cleanEditor=()=>{};
  const env=()=>window.BudgetCloud.ENVIRONMENT.name,client=()=>window.BudgetCloud.getClient();
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const money=n=>Number(n).toLocaleString('ko-KR')+'원';
  const time=value=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
  function say(text){$('review-message').textContent=text;}
  function controls(){document.querySelectorAll('#panel-review button, #panel-review input, #panel-review select, #panel-review textarea').forEach(n=>{n.disabled=!ready||busy;});}
  function finishEditor(){cleanEditor();cleanEditor=()=>{};editing=false;}
  function setSession(user,status){
    const id=user&&user.id||null,wasReady=ready;
    if(id!==userId){generation++;finishEditor();userId=id;rows=[];history=[];balances=[];transactions=[];render();say('');}
    ready=Boolean(id)&&status==='ready';controls();if(ready&&!wasReady)refresh();
  }
  function setTransactions(value){transactions=value||[];}
  async function refresh(){
    if(!ready||busy||loading||editing||$('review-list').contains(document.activeElement))return;
    const own=generation,owner=userId;loading=true;
    try{
      const columns='event_id, kind, captured_at, text, status, balance_amount, decision, transaction_id';
      const results=await Promise.all([
        client().from('phone_inbox').select(columns).eq('user_id',owner).eq('environment',env()).eq('status','pending').order('received_at',{ascending:false}).limit(100),
        client().from('phone_inbox').select(columns).eq('user_id',owner).eq('environment',env()).neq('status','pending').order('received_at',{ascending:false}).limit(20),
        client().from('phone_account_balances').select('account_label,balance_amount,captured_at').eq('user_id',owner).eq('environment',env()).order('account_label').limit(100)
      ]);
      for(const result of results)if(result.error)throw result.error;
      if(own!==generation||!ready)return;
      const next=[results[0].data||[],results[1].data||[],results[2].data||[]];
      const changed=JSON.stringify(next)!==JSON.stringify([rows,history,balances]);
      [rows,history,balances]=next;if(changed&&!editing)render();
      $('review-updated').textContent='자동 확인 '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})+' · 미처리 최대 100건 / 처리한 알림 최근 20건';
    }catch(error){if(own===generation)say(['42703','42P01','PGRST202'].includes(error.code)?'알림 선택 기능의 서버 준비가 필요해요. 받은 알림은 그대로 보관되어 있어요.':'알림을 불러오지 못했어요. 새로고침으로 다시 확인해 주세요.');}
    finally{loading=false;controls();if(own!==generation&&ready)refresh();}
  }
  function original(card,row){const details=node('details');details.append(node('summary','알림 원문'));details.append(node('pre',row.text,'phone-raw'));card.append(details);}
  function evidence(card,paths){
    if(!paths?.length)return;
    const button=node('button','첨부 캡처 '+paths.length+'장 보기','secondary');button.type='button';
    const images=node('div',undefined,'review-evidence');
    button.addEventListener('click',async()=>{
      const own=generation;button.disabled=true;
      try{
        const results=await Promise.all(paths.map(path=>client().storage.from(bucket).createSignedUrl(path,300)));
        if(own!==generation||!ready)return;
        images.replaceChildren();
        for(const [i,result] of results.entries()){
          if(result.error)throw result.error;
          const image=node('img');image.src=result.data.signedUrl;image.alt='첨부 캡처 '+(i+1);image.loading='lazy';images.append(image);
        }
        button.textContent='캡처 다시 불러오기';
      }catch(_){if(own===generation)say('캡처를 불러오지 못했어요. 다시 시도해 주세요.');}
      finally{if(own===generation)button.disabled=!ready;}
    });card.append(button,images);
  }
  function render(){
    const list=$('review-list');if(!list)return;list.replaceChildren();$('review-held').replaceChildren();$('review-balances').replaceChildren();
    $('review-count').textContent=String(rows.length);$('review-count').hidden=!rows.length;
    $('review-empty').hidden=rows.length>0;$('review-empty').textContent=userId?'아직 반영하지 않은 알림이 없어요.':'로그인하면 받은 알림을 확인할 수 있어요.';
    $('review-total').textContent=rows.length?rows.length+'건의 반영 방법을 선택해 주세요':'모두 정리됐어요';
    for(const row of rows){
      const value=model().draft(row),card=node('article',undefined,'review-card');card.dataset.eventId=row.event_id;
      const heading=node('h3',value.memo||'받은 알림');heading.tabIndex=-1;card.append(heading);
      card.append(node('p',value.amount!==null?money(value.amount):'거래금액 확인 필요','review-amount'));
      card.append(node('p',(value.date||'날짜 확인 필요')+(value.dateSource==='received'?' · 알림 수신일 기준':''),'muted'));
      if(value.balanceAmount!==null)card.append(node('p','알림에 포함된 잔액 '+money(value.balanceAmount)+' · 아직 반영 전','hint'));
      card.append(node('p',value.canRecordExpense?'카드 결제로 보이는 알림이에요. 반영 방법은 직접 선택해 주세요.':'입출금·이체·주문 알림도 직접 확인해서 반영할 수 있어요.','hint'));
      if(model().duplicate(value,transactions))card.append(node('p','같은 날짜·금액의 지출이 있어요. 중복 여부를 확인해 주세요.','review-attention'));
      const edit=node('button','검토하고 반영','secondary review-edit');edit.type='button';
      edit.addEventListener('click',()=>editCard(card,row,value));card.append(edit);original(card,row);list.append(card);
    }
    for(const row of history){
      const card=node('article',undefined,'review-card'),decision=row.decision||{};
      card.append(node('h3',decision.memo||model().draft(row).memo||'처리한 알림'));
      card.append(node('p',model().ACTIONS[decision.action]||(row.status==='recorded'?'기록한 지출':'보관한 알림'),'hint'));
      if(decision.remark)card.append(node('p',decision.remark,'review-remark'));
      if(row.transaction_id)card.append(node('p','금액·항목명·분류는 내역 탭에서 수정할 수 있어요.','hint'));
      evidence(card,decision.attachments);original(card,row);
      if(decision.action==='ignore'){
        const reopen=node('button','다시 검토','secondary');reopen.type='button';reopen.addEventListener('click',()=>reopenEvent(row));card.append(reopen);
      }
      $('review-held').append(card);
    }
    $('review-held-title').textContent='처리한 알림 · 메모와 캡처 '+history.length+'건';$('review-held-wrap').hidden=!history.length;
    for(const balance of balances){
      const card=node('div',undefined,'review-balance');card.append(node('strong',balance.account_label),node('span',money(balance.balance_amount)),node('small','알림 시각 '+time(balance.captured_at)));$('review-balances').append(card);
    }
    $('review-balance-wrap').hidden=!balances.length;controls();
  }
  function editCard(card,row,value){
    if(editing){say('열려 있는 알림의 반영을 마치거나 취소해 주세요.');return;}editing=true;
    const prior=row.decision||{},form=node('form',undefined,'phone-record-form');form.noValidate=true;
    const fields={},wraps={};
    function field(name,label,type,initial=''){
      const wrap=node('div',undefined,'field'),title=node('label',label),input=node(['select','textarea'].includes(type)?type:'input');input.name=name;
      input.id='review-edit-'+name;title.htmlFor=input.id;
      if(!['select','textarea'].includes(type))input.type=type;
      input.value=initial??'';wrap.append(title,input);form.append(wrap);fields[name]=input;wraps[name]=wrap;return input;
    }
    const action=field('action','반영 방법','select');
    action.append(node('option','선택해 주세요'));action.firstChild.value='';
    for(const [key,label] of Object.entries(model().ACTIONS)){const option=node('option',label);option.value=key;action.append(option);}
    action.required=true;
    field('memo','항목명 / 내용','text',prior.memo??value.memo).maxLength=80;
    field('date','날짜','date',value.date);
    field('amount','금액','text',value.amount).inputMode='numeric';
    field('category','분류','select');
    const remark=field('remark','리마크 / 메모','textarea',prior.remark||'');remark.maxLength=1000;remark.rows=3;remark.placeholder='상품명, 사용 목적, 확인할 내용 등을 남겨 주세요.';
    const balanceLabel=node('label',undefined,'phone-duplicate-check');
    const balanceCheck=node('input');balanceCheck.type='checkbox';balanceCheck.name='include_balance';
    balanceLabel.append(balanceCheck,document.createTextNode('계좌 잔액도 반영'));form.append(balanceLabel);
    field('account_label','잔액을 반영할 계좌 이름','text',prior.account_label||'').maxLength=40;
    fields.account_label.placeholder='예: 케이뱅크 생활비';
    field('balance_amount','확인한 계좌 잔액','text',value.balanceAmount).inputMode='text';
    const balanceHint=node('p',value.balanceAmount===null?'이 알림에는 읽을 수 있는 잔액이 없어요. 필요하면 직접 입력할 수 있어요.':'거래금액과 계좌 잔액은 서로 다른 값이에요.','hint');form.append(balanceHint);
    const fileInput=field('screenshots','캡처 첨부 (선택)','file');fileInput.accept='image/png,image/jpeg,image/webp';fileInput.multiple=true;
    form.append(node('p','PNG·JPG·WebP, 최대 3장·장당 5MB. 저장한 캡처는 본인 로그인으로만 조회할 수 있어요.','hint'));
    const previews=node('div',undefined,'review-evidence');form.append(previews);
    let files=[],objectUrls=[],uploadedPaths=[...(prior.attachments||[])],uploadedSelection=false;
    const revoke=()=>{objectUrls.forEach(url=>URL.revokeObjectURL(url));objectUrls=[];};cleanEditor=revoke;
    if(uploadedPaths.length)form.append(node('p','기존 첨부 '+uploadedPaths.length+'장을 유지해요. 새 파일을 선택하면 교체해요.','hint'));
    fileInput.addEventListener('change',()=>{
      const selected=Array.from(fileInput.files);
      if(selected.length>3||selected.some(file=>!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size<1||file.size>5242880)){
        fileInput.value='';files=[];uploadedPaths=[];uploadedSelection=false;revoke();previews.replaceChildren();say('첨부 선택을 비웠어요. PNG·JPG·WebP 이미지를 3장 이하, 장당 5MB 이하로 선택해 주세요.');return;
      }
      files=selected;uploadedPaths=[];uploadedSelection=false;revoke();previews.replaceChildren();
      for(const [i,file] of files.entries()){const img=node('img');img.alt='첨부할 캡처 '+(i+1);img.src=URL.createObjectURL(file);objectUrls.push(img.src);previews.append(img);}
    });
    const guidance=node('p','반영 방법을 선택해 주세요.','review-attention');form.append(guidance);
    function update(){
      const isTransaction=['expense','income'].includes(action.value);
      for(const key of ['date','amount','category']){wraps[key].hidden=!isTransaction;fields[key].required=isTransaction;}
      const categories=action.value==='income'?window.BudgetStorage.INCOME_CATEGORIES:window.BudgetStorage.EXPENSE_CATEGORIES;
      if(fields.category.dataset.type!==action.value){fields.category.replaceChildren();for(const category of categories){const option=node('option',category);option.value=category;fields.category.append(option);}fields.category.dataset.type=action.value;}
      if(action.value==='balance')balanceCheck.checked=true;
      if(action.value==='ignore')balanceCheck.checked=false;
      balanceLabel.hidden=['balance','ignore',''].includes(action.value);
      for(const key of ['account_label','balance_amount']){wraps[key].hidden=!balanceCheck.checked;fields[key].required=balanceCheck.checked;}
      balanceHint.hidden=!balanceCheck.checked;
      guidance.textContent=action.value==='transfer'?'내 계좌 사이의 이동으로 보관해요. 수입·지출 합계에는 더하지 않아요.':action.value==='ignore'?'가계부와 잔액에 반영하지 않고 정리해요. 처리한 알림에서 다시 검토할 수 있어요.':action.value==='balance'?'계좌의 마지막 확인 잔액만 갱신해요. 수입·지출은 만들지 않아요.':action.value?'입출금·카드 알림이 같은 거래를 가리키는지 확인해 주세요. 캡처와 메모는 이 알림에 함께 보관해요.':'반영 방법을 선택해 주세요.';
    }
    action.addEventListener('change',update);balanceCheck.addEventListener('change',update);update();
    const submit=node('button','선택한 방법으로 반영');submit.type='submit';form.append(submit);
    const cancel=node('button','취소','secondary');cancel.type='button';cancel.addEventListener('click',()=>{finishEditor();render();});form.append(cancel);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(!ready||busy||!form.reportValidity())return;
      const raw=Object.fromEntries(Object.entries(fields).filter(([key])=>key!=='screenshots').map(([key,input])=>[key,input.value]));
      raw.include_balance=balanceCheck.checked;raw.attachments=uploadedPaths;
      let decision=model().normalizeDecision(raw);
      if(!decision){say('반영 방법·날짜·금액·계좌 이름을 확인해 주세요. 잔액은 마이너스도 입력할 수 있어요.');return;}
      const own=generation,owner=userId,environment=env();busy=true;controls();say('선택한 내용을 반영하고 있어요…');
      try{
        if(['income','expense'].includes(decision.action)){
          const duplicate=await client().from(window.BudgetCloud.ENVIRONMENT.transactionsTable).select('id').eq('user_id',owner).eq('type',decision.action).eq('date',decision.date).eq('amount',decision.amount).limit(1);
          if(duplicate.error)throw duplicate.error;
          if(own!==generation||!ready)return;
          if((duplicate.data||[]).length&&!window.confirm('같은 날짜·금액의 기록이 있어요. 별개의 거래로 한 건 더 기록할까요?')){say('입력은 유지했어요. 중복 여부를 확인해 주세요.');return;}
        }
        if(files.length&&!uploadedSelection){
          const hash=Array.from(new Uint8Array(await window.crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.event_id))),b=>b.toString(16).padStart(2,'0')).join('');
          for(let i=uploadedPaths.length;i<files.length;i++){
            if(own!==generation||!ready)return;
            const file=files[i],ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type];
            const path=owner+'/'+environment+'/'+hash+'/'+window.crypto.randomUUID()+'.'+ext;
            const result=await client().storage.from(bucket).upload(path,file,{contentType:file.type,upsert:false});
            if(result.error)throw result.error;uploadedPaths.push(path);
          }
          uploadedSelection=true;
        }
        if(own!==generation||!ready)return;
        decision={...decision,attachments:[...uploadedPaths]};
        const result=await client().rpc('resolve_phone_event',{p_environment:environment,p_event_id:row.event_id,p_decision:decision});
        if(result.error)throw result.error;if(own!==generation)return;
        finishEditor();rows=rows.filter(r=>r.event_id!==row.event_id);render();
        say(result.data?.already_recorded?'이미 처리된 알림이에요. 처리한 알림에서 확인해 주세요.':decision.include_balance&&!result.data?.balance_applied?'반영했어요. 더 최근에 확인한 잔액이 있어 기존 잔액을 유지했어요.':'선택한 방법으로 반영했어요. 메모와 캡처는 처리한 알림에서 볼 수 있어요.');
        if(['expense','income'].includes(decision.action))document.dispatchEvent(new Event('budget:phone-recorded'));
        $('review-message').focus();
      }catch(error){if(own===generation)say(error.code==='PGRST202'?'서버에 알림 선택 기능을 적용해야 해요. 입력은 유지했어요.':'반영을 확인하지 못했어요. 입력과 첨부를 유지했으니 다시 시도해 주세요. 같은 알림은 중복 반영하지 않아요.');}
      finally{busy=false;controls();if(own===generation&&!editing)refresh();}
    });
    card.querySelector('.review-edit').hidden=true;card.append(form);action.focus();controls();
  }
  async function reopenEvent(row){
    if(!ready||busy||editing)return;const own=generation;busy=true;controls();
    try{const result=await client().rpc('reopen_phone_event',{p_environment:env(),p_event_id:row.event_id});if(result.error)throw result.error;if(own===generation)say('다시 검토할 알림으로 옮겼어요.');}
    catch(_){if(own===generation)say('다시 검토로 옮기지 못했어요. 재시도해 주세요.');}
    finally{busy=false;controls();if(own===generation)refresh();}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    $('review-refresh').addEventListener('click',refresh);render();controls();
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
    window.setInterval(()=>{if(!document.hidden&&!$('panel-review').hidden)refresh();},30000);
  });
  window.addEventListener('beforeunload',event=>{if(editing){event.preventDefault();event.returnValue='';}});
  window.BudgetPhoneReviewUI={setSession,setTransactions,open:refresh};
})(window,document);
