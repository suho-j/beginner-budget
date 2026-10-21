/* One notification at a time. Swiping navigates; only an explicit button writes. */
(function(window,document){
  'use strict';
  const $=id=>document.getElementById(id),model=()=>window.BudgetPhoneReview,bucket='budget-phone-evidence';
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const money=n=>Number.isFinite(Number(String(n).replace(/,/g,'')))?Number(String(n).replace(/,/g,'')).toLocaleString('ko-KR')+'원':'금액 확인 필요';
  const time=value=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
  const env=()=>window.BudgetCloud.ENVIRONMENT.name,client=()=>window.BudgetCloud.getClient();
  let userId=null,ready=false,busy=false,loading=false,generation=0,rows=[],history=[],balances=[],transactions=[],budgetState=null,selectedId=null,filter='main';
  const editors=new Map();
  const dirty=()=>[...editors.values()].some(e=>e.dirty);
  function say(text){$('review-message').textContent=text;}
  function button(text,fn,cls='secondary'){const b=node('button',text,cls);b.type='button';b.addEventListener('click',fn);return b;}
  function controls(){document.querySelectorAll('#panel-review button, #panel-review input, #panel-review select, #panel-review textarea').forEach(n=>{n.disabled=!ready||busy||n.dataset.blocked==='true';});}
  function dispose(id){const editor=editors.get(id);if(editor)editor.clean();editors.delete(id);}
  function clearEditors(){for(const id of editors.keys())dispose(id);}
  function setSession(user,status){
    const id=user&&user.id||null,wasReady=ready;
    if(id!==userId){generation++;clearEditors();userId=id;rows=[];history=[];balances=[];transactions=[];budgetState=null;selectedId=null;render();say('');}
    ready=Boolean(id)&&status==='ready';controls();if(ready&&!wasReady)refresh();
  }
  function setTransactions(value){
    if(JSON.stringify(transactions)===JSON.stringify(value||[]))return;
    transactions=value||[];
    for(const [id,editor] of editors)if(!editor.dirty)dispose(id);
    if(ready&&rows.length)renderDeck();
  }
  function setBudgetState(value){budgetState=value;}
  async function refresh(force=false){
    if(!ready||busy||loading||(!force&&(dirty()||$('review-list').contains(document.activeElement))))return;
    const own=generation,owner=userId;loading=true;
    try{
      const columns='event_id,kind,captured_at,text,status,balance_amount,decision,transaction_id';
      const results=await Promise.all([
        client().from('phone_inbox').select(columns).eq('user_id',owner).eq('environment',env()).eq('status','pending').order('received_at',{ascending:false}).limit(100),
        client().from('phone_inbox').select(columns).eq('user_id',owner).eq('environment',env()).neq('status','pending').order('received_at',{ascending:false}).limit(20),
        client().from('phone_account_balances').select('account_label,balance_amount,captured_at').eq('user_id',owner).eq('environment',env()).order('captured_at',{ascending:false}).limit(100)
      ]);
      for(const result of results)if(result.error)throw result.error;
      if(own!==generation||!ready)return;
      [rows,history,balances]=results.map(r=>r.data||[]);
      for(const id of editors.keys())if(!rows.some(r=>r.event_id===id))dispose(id);
      render();$('review-updated').textContent='최근 확인 '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
    }catch(error){if(own===generation)say(['42703','42P01','PGRST202'].includes(error.code)?'서버 준비가 필요해요. 받은 알림은 보관되어 있어요.':'알림을 불러오지 못했어요. 새로고침으로 다시 확인해 주세요.');}
    finally{loading=false;controls();if(own!==generation&&ready)refresh();}
  }
  function original(card,row){const details=node('details',undefined,'review-original');details.append(node('summary','알림 원문 보기'),node('pre',row.text,'phone-raw'));card.append(details);}
  function evidence(card,paths){
    if(!paths?.length)return;
    const images=node('div',undefined,'review-evidence');
    const b=button('첨부 캡처 '+paths.length+'장 보기',async()=>{
      const own=generation;b.disabled=true;
      try{
        const results=await Promise.all(paths.map(path=>client().storage.from(bucket).createSignedUrl(path,300)));
        if(own!==generation||!ready)return;images.replaceChildren();
        for(const [i,result] of results.entries()){if(result.error)throw result.error;const img=node('img');img.src=result.data.signedUrl;img.alt='첨부 캡처 '+(i+1);img.loading='lazy';images.append(img);}
      }catch(_){if(own===generation)say('캡처를 불러오지 못했어요. 다시 시도해 주세요.');}
      finally{if(own===generation)b.disabled=!ready;}
    });card.append(b,images);
  }
  function queue(){return rows.filter(row=>model().draft(row).notice===(filter==='notice'));}
  function navigate(delta){
    if(busy||!ready)return;
    const visible=queue(),index=visible.findIndex(r=>r.event_id===selectedId),next=visible[index+delta];
    if(!next)return;selectedId=next.event_id;renderDeck();
    $('review-progress').focus({preventScroll:true});
  }
  function renderDeck(){
    const list=$('review-list');if(!list)return;
    const visible=queue();if(!visible.some(r=>r.event_id===selectedId))selectedId=visible[0]?.event_id||null;
    const index=visible.findIndex(r=>r.event_id===selectedId);list.replaceChildren();
    $('review-empty').hidden=visible.length>0;
    $('review-empty').textContent=!userId?'로그인하면 받은 알림을 확인할 수 있어요.':filter==='notice'?'정리할 안내 알림이 없어요.':'거래와 주문을 모두 확인했어요.';
    $('review-nav').hidden=!visible.length;
    $('review-progress').textContent=visible.length?(index+1)+' / '+visible.length:'';
    $('review-prev').dataset.blocked=String(index<=0);$('review-next').dataset.blocked=String(index>=visible.length-1);
    $('review-dismiss-notices').hidden=filter!=='notice'||!visible.length;
    if(selectedId){
      let editor=editors.get(selectedId);
      if(!editor){editor=createEditor(visible[index]);editors.set(selectedId,editor);}
      list.append(editor.card);
    }
    controls();
  }
  function renderBalances(){
    const latest=balances.find(b=>b.account_label===model().ACCOUNT)||balances[0];
    $('review-balances').replaceChildren();$('review-balance-wrap').hidden=!latest;
    if(latest){const card=node('div',undefined,'review-balance');card.append(node('strong',model().ACCOUNT),node('span',money(latest.balance_amount)),node('small','최근 알림 기준 · '+time(latest.captured_at)));$('review-balances').append(card);}
    if($('account-observed-amount')){
      $('account-observed-amount').textContent=latest?money(latest.balance_amount):'아직 확인 전';
      $('account-observed-at').textContent=latest?'잔액 / 출금가능액 · '+time(latest.captured_at):'케이뱅크 알림을 반영하면 마지막 확인 금액을 표시해요.';
    }
  }
  function render(){
    if(!$('review-list'))return;
    const mainCount=rows.filter(r=>!model().draft(r).notice).length,noticeCount=rows.length-mainCount;
    $('review-count').textContent=String(mainCount);$('review-count').hidden=!mainCount;
    $('review-total').textContent=mainCount?'확인할 거래·주문 '+mainCount+'건':'거래·주문 정리 완료';
    for(const [key,label,count] of [['main','거래·주문',mainCount],['notice','안내',noticeCount]]){
      const b=$('review-filter-'+key);b.textContent=label+' '+count;b.setAttribute('aria-pressed',String(filter===key));
    }
    $('review-dismiss-notices').textContent='안내 '+noticeCount+'건 제외';
    renderDeck();renderBalances();$('review-held').replaceChildren();
    for(const row of history){
      const card=node('article',undefined,'review-history-card'),d=row.decision||{};
      card.append(node('h3',d.memo||model().draft(row).memo||'처리한 알림'));
      card.append(node('p',(model().ACTIONS[d.action]||(row.status==='recorded'?'기록한 지출':'보관한 알림'))+(d.amount?' · '+money(d.amount):''),'hint'));
      if(d.remark)card.append(node('p',d.remark,'review-remark'));
      if(row.transaction_id)card.append(node('p','내역 탭에서 내용을 수정할 수 있어요.','hint'));
      evidence(card,d.attachments);original(card,row);
      if(d.action==='ignore')card.append(button('다시 검토',()=>reopenEvent(row)));
      $('review-held').append(card);
    }
    $('review-held-title').textContent='처리한 알림 '+history.length+'건 · 메모와 캡처';$('review-held-wrap').hidden=!history.length;controls();
  }
  function categoryLabel(category,date){
    if(!budgetState||!date)return category;
    const storage=window.BudgetStorage,month=storage.monthKeyForDate(date,budgetState.monthStartDay),budget=storage.budgetForMonth(budgetState,month).categoryBudgets[category];
    if(!budget)return category;
    const spent=transactions.filter(t=>t.type==='expense'&&t.category===category&&storage.isDateInBudgetMonth(t.date,month,budgetState.monthStartDay)).reduce((sum,t)=>sum+t.amount,0);
    return category+' · '+money(budget-spent)+' 남음';
  }
  function createEditor(row){
    const value=model().draft(row),prior=row.decision||{},card=node('article',undefined,'review-card review-focus-card');card.dataset.eventId=row.event_id;
    const editor={card,dirty:false,clean:()=>objectUrls.forEach(url=>URL.revokeObjectURL(url))};
    const source=node('div',undefined,'review-source');source.append(node('span',row.kind==='kbank_notification'?'케이뱅크 · 생활비 계좌':row.kind==='eats_screen'?'쿠팡이츠 · 주문 화면':row.kind==='coupang_order'?'쿠팡 · 주문 상세':'쿠팡이츠 · 알림','review-source-name'));
    source.append(node('span','미반영','review-state'));card.append(source);
    const form=node('form',undefined,'review-form');form.noValidate=true;card.append(form);
    const fields={},wraps={};
    function field(name,label,type,initial='',parent=form){
      const wrap=node('div',undefined,'field review-field review-field-'+name),title=node('label',label),input=node(['select','textarea'].includes(type)?type:'input');input.name=name;input.id='review-edit-'+name;
      title.htmlFor=input.id;if(!['select','textarea'].includes(type))input.type=type;input.value=initial??'';
      wrap.append(title,input);parent.append(wrap);fields[name]=input;wraps[name]=wrap;return input;
    }
    field('amount','금액','text',value.amount===null?'':Number(value.amount).toLocaleString('ko-KR')).inputMode='numeric';
    fields.amount.placeholder='금액 확인 필요';wraps.amount.append(node('span','원','review-currency'));
    const amountHelp=node('p',value.amount?value.amountSource+' · 필요하면 바로 수정하세요':'알림에 거래금액이 없거나 여러 금액을 확인해야 해요.','review-amount-help');form.append(amountHelp);
    field('memo','항목명 / 내용','text',prior.memo??value.memo).maxLength=80;
    fields.memo.placeholder='어디에 쓴 돈인가요?';
    const basics=node('div',undefined,'review-basic-grid');form.append(basics);
    field('date','날짜','date',value.date,basics);
    field('category','카테고리','select','',basics);
    const categoryHint=node('p',undefined,'review-category-balance');basics.append(categoryHint);
    const action=field('action','반영 방법','hidden',value.suggestedAction);wraps.action.hidden=true;
    const methods=node('details',undefined,'review-methods'),methodSummary=node('summary');methods.append(methodSummary);methods.open=!action.value;
    const actions=node('fieldset',undefined,'review-action-options');actions.append(node('legend','반영 방법'));
    const actionButtons=new Map();
    for(const [key,label] of Object.entries(model().ACTIONS)){
      if(key==='link'&&row.kind==='kbank_notification')continue;
      const b=button(label,()=>{action.value=key;editor.dirty=true;methods.open=false;update();});b.dataset.action=key;b.setAttribute('aria-pressed','false');actionButtons.set(key,b);actions.append(b);
    }
    methods.append(actions);form.append(methods);
    const matchBox=node('section',undefined,'review-match-box');form.append(matchBox);
    const target=field('target','연결할 결제','select','',matchBox);
    const matchHint=node('p',undefined,'hint');matchBox.append(matchHint);
    let candidates=[],chosen=null;
    function refreshCandidates(){
      const date=fields.date.value,amount=model().normalizeDecision({action:'expense',date,amount:fields.amount.value,category:'생활비',memo:'',remark:'',include_balance:false,attachments:[]})?.amount;
      candidates=model().linkCandidates({...value,date,amount},transactions,rows);target.replaceChildren();
      const placeholder=node('option',candidates.length>1?'연결할 결제를 선택하세요':candidates.length?'일치하는 결제를 찾았어요':'일치하는 결제 없음');placeholder.value='';target.append(placeholder);
      for(const [index,candidate] of candidates.entries()){
        const option=node('option',(candidate.kind==='transaction'?'기록됨':'미반영 알림')+' · '+candidate.memo+' · '+money(candidate.amount));option.value=String(index);target.append(option);
      }
      if(candidates.length===1)target.value='0';chosen=candidates[Number(target.value)]||null;if(target.value==='')chosen=null;
      matchHint.textContent=candidates.length===1?'날짜·금액·쿠팡 결제가 일치해요. 이 결제의 항목명과 카테고리를 채워요.':candidates.length>1?'같은 금액의 결제가 여러 건이에요. 어느 결제인지 골라 주세요.':'주문 날짜와 결제금액을 확인해 주세요. 결제 알림이 도착하면 다시 찾을 수 있어요.';
    }
    refreshCandidates();target.addEventListener('change',()=>{chosen=target.value===''?null:candidates[Number(target.value)];editor.dirty=true;update();});
    matchBox.append(button('결제 다시 찾기',()=>{refreshCandidates();update();}));
    if(value.warning)form.append(node('p',value.warning,'review-attention'));
    if(value.dateSource==='received')form.append(node('p','날짜는 알림을 받은 날로 채웠어요.','hint'));
    if(model().duplicate(value,transactions))form.append(node('p','같은 날짜·금액의 내역이 있어요. 중복 여부를 확인해 주세요.','review-attention'));
    const extra=node('details',undefined,'review-extras');extra.append(node('summary','메모·캡처·잔액'));form.append(extra);
    const remark=field('remark','리마크 / 메모','textarea',prior.remark||'',extra);remark.maxLength=1000;remark.rows=3;remark.placeholder='사용 목적이나 기억할 내용을 남겨 주세요.';
    const balanceLabel=node('label',undefined,'phone-duplicate-check'),balanceCheck=node('input');balanceCheck.type='checkbox';balanceCheck.name='include_balance';balanceCheck.checked=value.balanceAmount!==null;
    balanceLabel.append(balanceCheck,document.createTextNode('생활비 계좌 잔액도 함께 갱신'));extra.append(balanceLabel);
    field('balance_amount','확인한 계좌 잔액','text',value.balanceAmount,extra).inputMode='text';
    const balanceHint=node('p','계좌는 하나로 관리해요. 알림의 잔액·출금가능액이며, 오래된 알림은 최신 금액을 덮어쓰지 않아요.','hint');extra.append(balanceHint);
    const balanceSummary=node('p',undefined,'review-balance-summary');form.append(balanceSummary);
    const fileInput=field('screenshots','캡처 첨부 (선택)','file','',extra);fileInput.accept='image/png,image/jpeg,image/webp';fileInput.multiple=true;
    extra.append(node('p','최대 3장 · 장당 5MB · PNG, JPG, WebP','hint'));
    const previews=node('div',undefined,'review-evidence');extra.append(previews);
    let files=[],objectUrls=[],uploadedPaths=[...(prior.attachments||[])],uploadedSelection=false;
    if(uploadedPaths.length)extra.append(node('p','기존 캡처 '+uploadedPaths.length+'장을 유지해요.','hint'));
    fileInput.addEventListener('change',()=>{
      const selected=Array.from(fileInput.files);
      if(selected.length>3||selected.some(f=>!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size<1||f.size>5242880)){fileInput.value='';say('PNG·JPG·WebP를 3장 이하, 장당 5MB 이하로 선택해 주세요. 기존 선택은 유지했어요.');return;}
      editor.clean();objectUrls=[];files=selected;uploadedPaths=[];uploadedSelection=false;previews.replaceChildren();editor.dirty=true;
      for(const [i,file] of files.entries()){const img=node('img');img.alt='첨부할 캡처 '+(i+1);img.src=URL.createObjectURL(file);objectUrls.push(img.src);previews.append(img);}
    });
    const guidance=node('p',undefined,'review-guidance');form.append(guidance);
    const footer=node('div',undefined,'review-commit-bar');
    const submit=node('button','확인하고 반영','review-submit');submit.type='submit';
    const skip=button('다음에 확인',()=>navigate(1));footer.append(skip,submit);form.append(footer);
    function update(){
      const type=action.value,isTransaction=['expense','income'].includes(type),link=type==='link';
      methodSummary.textContent=(model().ACTIONS[type]||'반영 방법 선택')+' · 변경';
      for(const key of ['amount','date','category']){wraps[key].hidden=!(isTransaction||link);fields[key].required=isTransaction||link;}
      amountHelp.hidden=!(isTransaction||link)||!value.amount;matchBox.hidden=!link;target.required=link;
      const categories=type==='income'?window.BudgetStorage.INCOME_CATEGORIES:window.BudgetStorage.EXPENSE_CATEGORIES;
      const oldCategory=fields.category.value;
      fields.category.replaceChildren();for(const category of categories){const option=node('option',category);option.value=category;fields.category.append(option);}
      fields.category.value=categories.includes(oldCategory)?oldCategory:categories.includes(value.category)?value.category:categories[0];
      categoryHint.textContent=categoryLabel(fields.category.value,fields.date.value);categoryHint.hidden=!(isTransaction||link)||type==='income'||categoryHint.textContent===fields.category.value;
      if(type==='balance')balanceCheck.checked=true;if(type==='ignore'||link)balanceCheck.checked=false;
      balanceLabel.hidden=['balance','ignore','link'].includes(type);
      wraps.balance_amount.hidden=!balanceCheck.checked;fields.balance_amount.required=balanceCheck.checked;balanceHint.hidden=!balanceCheck.checked;
      balanceSummary.hidden=!balanceCheck.checked;balanceSummary.textContent='생활비 계좌 잔액 '+money(fields.balance_amount.value)+'도 함께 갱신';
      for(const [key,b] of actionButtons)b.setAttribute('aria-pressed',String(key===type));
      const labels={expense:'지출 반영',income:'수입 반영',transfer:'내 돈 이동으로 보관',balance:'계좌 잔액 갱신',ignore:'이 알림 제외',link:'주문 내용 연결'};
      submit.textContent=labels[type]||'반영 방법을 골라 주세요';submit.dataset.blocked=String(!type||(link&&!chosen));
      skip.dataset.blocked=String(queue().at(-1)?.event_id===row.event_id);
      guidance.textContent=type==='link'?'기존 지출의 금액은 그대로 유지해요. 미반영 결제 알림이면 그 결제 한 건만 기록해요.':type==='transfer'?'계좌 사이에 옮긴 돈이에요. 수입·지출에 더하지 않아요.':type==='ignore'?'처리한 알림에서 다시 검토할 수 있어요.':type==='balance'?'생활비 계좌의 마지막 확인 금액만 갱신해요.':'내용이 맞으면 아래 버튼 한 번으로 반영해요.';
      controls();
    }
    form.addEventListener('input',()=>{editor.dirty=true;});
    for(const key of ['amount','date'])fields[key].addEventListener('change',()=>{refreshCandidates();update();});
    fields.category.addEventListener('change',update);balanceCheck.addEventListener('change',update);fields.balance_amount.addEventListener('input',update);update();
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(!ready||busy)return;
      const invalid=[...form.elements].find(input=>input.willValidate&&!input.checkValidity());
      if(invalid){for(let p=invalid.parentElement;p&&p!==form;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;invalid.reportValidity();return;}
      const raw=Object.fromEntries(Object.entries(fields).filter(([key])=>!['screenshots','target'].includes(key)).map(([key,input])=>[key,input.value]));
      Object.assign(raw,{include_balance:balanceCheck.checked,account_label:model().ACCOUNT,attachments:uploadedPaths});
      if(raw.action==='link'&&chosen)Object.assign(raw,{target_kind:chosen.kind,target_id:chosen.id,expected_memo:chosen.memo});
      let decision=model().normalizeDecision(raw);if(!decision){say('날짜·금액·반영 방법을 확인해 주세요.');return;}
      const own=generation,owner=userId,environment=env();busy=true;controls();say('반영하고 있어요…');
      try{
        if(['income','expense'].includes(decision.action)){
          const duplicate=await client().from(window.BudgetCloud.ENVIRONMENT.transactionsTable).select('id').eq('user_id',owner).eq('type',decision.action).eq('date',decision.date).eq('amount',decision.amount).limit(1);
          if(duplicate.error)throw duplicate.error;if(own!==generation||!ready)return;
          if(duplicate.data?.length&&!window.confirm('같은 날짜·금액의 기록이 있어요. 별개의 거래로 한 건 더 기록할까요?')){say('입력은 유지했어요. 중복 여부를 확인해 주세요.');return;}
        }
        if(files.length&&!uploadedSelection){
          const hash=Array.from(new Uint8Array(await window.crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.event_id))),b=>b.toString(16).padStart(2,'0')).join('');
          for(let i=uploadedPaths.length;i<files.length;i++){
            if(own!==generation||!ready)return;const file=files[i],ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type];
            const path=owner+'/'+environment+'/'+hash+'/'+window.crypto.randomUUID()+'.'+ext;
            const result=await client().storage.from(bucket).upload(path,file,{contentType:file.type,upsert:false});if(result.error)throw result.error;uploadedPaths.push(path);
          }uploadedSelection=true;
        }
        if(own!==generation||!ready)return;decision={...decision,attachments:[...uploadedPaths]};
        const result=await client().rpc(decision.action==='link'?'link_phone_order':'resolve_phone_event',{p_environment:environment,p_event_id:row.event_id,p_decision:decision});
        if(result.error)throw result.error;if(own!==generation)return;
        const removed=new Set([row.event_id]);if(decision.target_kind==='notification')removed.add(decision.target_id);
        for(const id of removed)dispose(id);rows=rows.filter(r=>!removed.has(r.event_id));selectedId=null;render();
        say(result.data?.already_recorded?'이미 반영된 알림이에요.':decision.action==='link'?'주문 내용을 결제에 연결했어요. 중복 지출은 만들지 않았어요.':decision.include_balance&&!result.data?.balance_applied?'반영했어요. 잔액은 더 최근에 확인한 금액을 유지했어요.':'반영했어요. 다음 내역을 확인해 주세요.');
        if(['expense','income','link'].includes(decision.action))document.dispatchEvent(new Event('budget:phone-recorded'));
      }catch(error){if(own===generation){if(error.code==='40001')document.dispatchEvent(new Event('budget:phone-recorded'));say(error.code==='40001'?'연결할 결제가 변경됐어요. 결제 다시 찾기를 눌러 확인해 주세요.':error.code==='PGRST202'?'서버 연결 기능을 준비 중이에요. 입력은 유지했어요.':'반영을 확인하지 못했어요. 입력과 첨부를 유지했으니 다시 시도해 주세요.');}}
      finally{busy=false;controls();if(own===generation)refresh(true);}
    });
    original(card,row);
    let touch=null;
    card.addEventListener('touchstart',event=>{if(event.touches.length!==1||event.target.closest('input,textarea,select,button,summary,a'))return;const t=event.touches[0];touch={x:t.clientX,y:t.clientY};},{passive:true});
    card.addEventListener('touchend',event=>{if(!touch)return;const t=event.changedTouches[0],dx=t.clientX-touch.x,dy=t.clientY-touch.y;touch=null;if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5)navigate(dx<0?1:-1);},{passive:true});
    card.addEventListener('touchcancel',()=>{touch=null;});
    return editor;
  }
  async function reopenEvent(row){
    if(!ready||busy)return;const own=generation;busy=true;controls();
    try{const result=await client().rpc('reopen_phone_event',{p_environment:env(),p_event_id:row.event_id});if(result.error)throw result.error;if(own===generation)say('다시 검토할 알림으로 옮겼어요.');}
    catch(_){if(own===generation)say('다시 검토로 옮기지 못했어요. 재시도해 주세요.');}
    finally{busy=false;controls();if(own===generation)refresh(true);}
  }
  async function dismissNotices(){
    if(!ready||busy)return;const selected=rows.filter(r=>model().draft(r).notice&&!editors.get(r.event_id)?.dirty);if(!selected.length){say('수정 중인 안내는 개별 반영해 주세요.');return;}
    if(!window.confirm('배달 상태·리뷰 요청·연결 시험 등 안내 '+selected.length+'건을 제외할까요? 수정 중인 안내는 유지하고, 처리한 알림에서 다시 검토할 수 있어요.'))return;
    const own=generation;busy=true;controls();let count=0;
    try{for(const row of selected){if(own!==generation||!ready)return;const decision=model().normalizeDecision({action:'ignore',memo:model().draft(row).memo,remark:'',include_balance:false,attachments:[]});const result=await client().rpc('resolve_phone_event',{p_environment:env(),p_event_id:row.event_id,p_decision:decision});if(result.error)throw result.error;count++;dispose(row.event_id);}if(own===generation)say('안내 '+count+'건을 정리했어요.');}
    catch(_){if(own===generation)say(count+'건 정리 후 멈췄어요. 남은 안내를 다시 확인해 주세요.');}
    finally{busy=false;controls();if(own===generation)refresh(true);}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    $('review-refresh').addEventListener('click',()=>refresh(true));$('review-prev').addEventListener('click',()=>navigate(-1));$('review-next').addEventListener('click',()=>navigate(1));
    for(const key of ['main','notice'])$('review-filter-'+key).addEventListener('click',()=>{filter=key;selectedId=null;render();});
    $('review-dismiss-notices').addEventListener('click',dismissNotices);
    $('review-list').addEventListener('keydown',event=>{if(event.target.closest('input,textarea,select,button,summary,a'))return;if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();navigate(event.key==='ArrowLeft'?-1:1);}});
    render();controls();document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
    window.setInterval(()=>{if(!document.hidden&&!$('panel-review').hidden)refresh();},30000);
  });
  window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
  window.BudgetPhoneReviewUI={setSession,setTransactions,setBudgetState,open:()=>refresh()};
})(window,document);
