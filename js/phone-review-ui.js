/* The review queue is cloud-owned; no ledger or notification data is stored in the browser. */
(function(window,document){
  'use strict';
  const $=id=>document.getElementById(id), model=()=>window.BudgetPhoneReview;
  let userId=null,ready=false,busy=false,loading=false,generation=0,rows=[],transactions=[],editing=false;
  let forcedReview=new Set(),saved=new Set();
  const env=()=>window.BudgetCloud.ENVIRONMENT.name;
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  function say(text){$('review-message').textContent=text;}
  function controls(){document.querySelectorAll('#panel-review button, #panel-review input, #panel-review select').forEach(n=>{n.disabled=!ready||busy;});}
  function setSession(user,status){
    const id=user&&user.id||null,wasReady=ready;
    if(id!==userId){generation++;userId=id;rows=[];transactions=[];saved=new Set();forcedReview=new Set();editing=false;render();say('');}
    ready=Boolean(id)&&status==='ready';controls();
    if(ready&&!wasReady)refresh();
  }
  function setTransactions(value){transactions=value||[];}
  async function refresh(){
    if(!ready||busy||loading||editing||$('review-list').contains(document.activeElement))return;
    const own=generation,owner=userId;loading=true;
    try{
      const result=await window.BudgetCloud.getClient().from('phone_inbox')
        .select('event_id, kind, captured_at, text, status').eq('user_id',owner).eq('environment',env())
        .eq('status','pending').order('received_at',{ascending:false}).limit(100);
      if(result.error)throw result.error;
      if(own!==generation||!ready)return;
      const next=(result.data||[]).filter(r=>r.status==='pending'&&!saved.has(r.event_id));
      const changed=JSON.stringify(next)!==JSON.stringify(rows);rows=next;
      if(!editing&&changed)render();
      $('review-updated').textContent='자동 확인 '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})+' · 최근 미처리 알림 최대 100건';
    }catch(_){if(own===generation)say('알림을 불러오지 못했어요. 잠시 후 다시 확인합니다.');}
    finally{loading=false;controls();if(own!==generation&&ready)refresh();}
  }
  function original(card,row){const details=node('details');details.append(node('summary','알림 원문'));details.append(node('pre',row.text,'phone-raw'));card.append(details);}
  function needsCheck(row,value){return !value.quick||forcedReview.has(row.event_id)||model().duplicate(value,transactions)
    ||rows.some(other=>other.event_id!==row.event_id&&model().draft(other).quick&&model().draft(other).date===value.date&&model().draft(other).amount===value.amount);}
  function render(){
    const list=$('review-list');if(!list)return;list.replaceChildren();$('review-held').replaceChildren();
    const pending=rows.filter(r=>!saved.has(r.event_id)&&model().draft(r).canRecordExpense);
    $('review-count').textContent=String(pending.length);$('review-count').hidden=!pending.length;
    $('review-empty').hidden=pending.length>0;$('review-empty').textContent=userId?'지금 분류할 결제가 없어요. 새 알림이 오면 여기에 모아둘게요.':'로그인하면 분류할 결제를 확인할 수 있어요.';
    $('review-total').textContent=pending.length?pending.length+'건만 분류하면 끝':'모두 정리됐어요';
    let held=0;
    rows.filter(r=>!saved.has(r.event_id)).forEach(row=>{
      const value=model().draft(row),card=node('article',undefined,'review-card');
      if(!value.canRecordExpense){held++;card.append(node('p',value.reason));original(card,row);$('review-held').append(card);return;}
      const heading=node('h3',value.memo||'내용을 확인해 주세요');heading.tabIndex=-1;card.append(heading);
      card.append(node('p',value.amount?value.amount.toLocaleString('ko-KR')+'원':'금액 확인 필요','review-amount'));
      card.append(node('p',(value.date||'결제일 확인 필요')+(value.dateSource==='received'?' · 알림 수신일 기준':''),'muted'));
      if(/쿠팡/.test(row.text))card.append(node('p','상품·메뉴는 아직 연결되지 않았어요.','hint'));
      const check=needsCheck(row,value);
      if(check)card.append(node('p',value.quick?'같은 날짜·금액의 기록이 있거나 추가 확인이 필요해요.':'금액·내용을 확인한 뒤 기록해 주세요.','review-attention'));
      else{
        card.append(node('p','분류를 누르면 바로 기록돼요.','hint'));
        const choices=node('div',undefined,'review-choices');
        window.BudgetStorage.EXPENSE_CATEGORIES.forEach(category=>{
          const button=node('button',category);button.type='button';button.setAttribute('aria-label',value.memo+' '+category+'로 기록');
          button.addEventListener('click',()=>save(row,{date:value.date,amount:value.amount,memo:value.memo,category},false));choices.append(button);
        });card.append(choices);
      }
      const edit=node('button',check?'확인하고 분류':'금액·내용 수정','secondary review-edit');edit.type='button';
      edit.addEventListener('click',()=>editCard(card,row,value,check));card.append(edit);original(card,row);list.append(card);
    });
    $('review-held-title').textContent='지출로 더하지 않은 알림 '+held+'건';$('review-held-wrap').hidden=!held;controls();
  }
  function editCard(card,row,value,check){
    if(editing)return;editing=true;
    const form=node('form',undefined,'phone-record-form');
    const fields={};
    [['date','결제일','date'],['amount','결제금액','text'],['memo','내용','text'],['category','분류','select']].forEach(([name,label,type])=>{
      const wrap=node('label',label),input=node(type==='select'?'select':'input');input.name=name;
      if(type!=='select'){input.type=type;input.value=value[name]||'';}else window.BudgetStorage.EXPENSE_CATEGORIES.forEach(c=>{const o=node('option',c);o.value=c;input.append(o);});
      input.required=name!=='memo';if(name==='amount')input.inputMode='numeric';if(name==='memo')input.maxLength=80;
      wrap.append(input);form.append(wrap);fields[name]=input;
    });
    const consent=node('input');consent.type='checkbox';consent.required=true;
    const label=node('label',undefined,'phone-duplicate-check');label.append(consent,document.createTextNode('금액·날짜와 중복 여부를 확인했어요.'));form.append(label);
    const submit=node('button','분류해서 기록');submit.type='submit';form.append(submit);
    const cancel=node('button','취소','secondary');cancel.type='button';cancel.addEventListener('click',()=>{editing=false;render();});form.append(cancel);
    form.addEventListener('submit',e=>{e.preventDefault();if(!form.reportValidity())return;
      const amount=Number(fields.amount.value.replace(/,/g,'')),date=fields.date.value;
      if(!Number.isInteger(amount)||amount<1||amount>2147483647||!window.BudgetStorage.isValidDateString(date)){say('금액과 날짜를 확인해 주세요.');return;}
      save(row,{amount,date,memo:fields.memo.value.trim(),category:fields.category.value},true);
    });
    card.querySelectorAll('button').forEach(b=>{b.hidden=true;});card.append(form);fields[check&&!value.amount?'amount':'category'].focus();
  }
  async function save(row,value,confirmed){
    if(!ready||busy)return;const own=generation;busy=true;controls();say('기록하고 있어요…');
    try{
      // Refresh existing expenses before a one-touch write, including records made on another device.
      const latest=await window.BudgetCloud.downloadState();
      if(own!==generation||!ready)return;
      transactions=latest.transactions||[];
      if(!confirmed&&model().duplicate(value,transactions)){
        forcedReview.add(row.event_id);editing=false;render();say('같은 날짜·금액의 지출이 있어요. 확인하고 분류해 주세요.');return;
      }
      const result=await window.BudgetCloud.getClient().rpc('record_phone_event',{p_environment:env(),p_event_id:row.event_id,p_transaction:value});
      if(result.error)throw result.error;if(own!==generation)return;
      const already=Boolean(result.data&&result.data.already_recorded);
      saved.add(row.event_id);editing=false;if(!already)transactions.push({...value,type:'expense'});render();
      say(already?'이미 기록된 알림이에요. 내역 탭에서 확인해 주세요.':value.category+'로 기록했어요. 내역 탭에서 수정할 수 있어요.');
      ($('review-list').querySelector('h3')||$('review-message')).focus();
      document.dispatchEvent(new Event('budget:phone-recorded'));
    }catch(_){if(own===generation)say('기록 여부를 확인하지 못했어요. 다시 누르면 같은 알림은 중복 기록하지 않아요.');}
    finally{busy=false;controls();}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    $('review-refresh').addEventListener('click',refresh);render();controls();
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
    window.setInterval(()=>{if(!document.hidden&&!$('panel-review').hidden)refresh();},30000);
  });
  window.BudgetPhoneReviewUI={setSession,setTransactions,open:refresh};
})(window,document);
