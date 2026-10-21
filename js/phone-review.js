(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./phone-import.js'):root.BudgetPhoneImport);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BudgetPhoneReview=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(phone){
  'use strict';
  const MONEY = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)';
  const ACCOUNT = '생활비 계좌';
  function lines(text){return [...new Set(String(text||'').split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!/^(true|false)$/.test(s)))];}
  function uniqueAmount(matches){
    const values=[...new Set(matches.map(m=>integer(m[1])))];
    return values.length===1&&values[0]>0?values[0]:null;
  }
  function readAmount(text,order=false){
    const money=new RegExp('(?<![\\d,.-])('+MONEY+')\\s*원','g');
    if(order){
      for(const label of ['카드\\s*(?:실제\\s*)?결제\\s*(?:금액)?','(?:최종|총|실제)\\s*결제\\s*(?:금액)?','결제\\s*금액']){
        const matches=[...text.matchAll(new RegExp('(?:^|\\n)\\s*'+label+'\\s*[:：]?\\s*('+MONEY+')\\s*원','g'))];
        if(matches.length)return {amount:uniqueAmount(matches),source:label.startsWith('카드')?'카드 결제액':'최종 결제액'};
      }
      return {amount:null,source:''};
    }
    const labeled=[...text.matchAll(new RegExp('(?:^|\\n)(?:체크카드\\s*|카드\\s*)?(?:승인|출금|입금|결제금액|결제\\s*완료)\\s*[:：]?\\s*('+MONEY+')\\s*원','g'))];
    if(labeled.length)return {amount:uniqueAmount(labeled),source:'알림의 거래 금액'};
    return {amount:uniqueAmount([...text.matchAll(money)]),source:'알림에서 읽은 금액'};
  }
  function notificationDate(text,capturedAt){
    const captured=Date.parse(capturedAt),fallback=Number.isFinite(captured)?new Date(captured+9*3600000).toISOString().slice(0,10):'';
    const dates=[...new Set([...text.matchAll(/\b(20\d{2})[-/.년]\s*(\d{1,2})[-/.월]\s*(\d{1,2})(?:일)?\b/g)].map(m=>m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0')))];
    const valid=d=>Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
    if(dates.length)return {date:dates.length===1&&valid(dates[0])?dates[0]:'',dateSource:'notification'};
    const short=[...new Set([...text.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)].map(m=>m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0')))];
    if(short.length){
      const year=Number(fallback.slice(0,4));
      const choices=[year-1,year,year+1].map(y=>y+'-'+short[0]).filter(valid).sort((a,b)=>Math.abs(Date.parse(a)-captured)-Math.abs(Date.parse(b)-captured));
      return {date:short.length===1&&choices.length&&Math.abs(Date.parse(choices[0])-captured)<7*86400000?choices[0]:'',dateSource:'notification'};
    }
    return {date:fallback,dateSource:'received'};
  }
  function bankBalance(event){
    if(event.kind!=='kbank_notification')return null;
    if(Number.isInteger(event.balance_amount))return event.balance_amount;
    const matches=[...lines(event.text).join('\n').matchAll(/(?:잔액|출금가능액)\s*[:：]?\s*(-?[\d,.]+)\s*원?/g)];
    const values=[...new Set(matches.map(m=>integer(m[1],true)))];
    return values.length===1?values[0]:null;
  }
  function orderInfo(text,platform='eats'){
    const coupang=platform==='coupang';
    const list=coupang?/주문\s*목록|주문내역\s*조회|마이쿠팡/.test(text):/과거 주문 내역|이전에 주문했던 맛집|아직 리뷰를 작성하지 않은 주문/.test(text);
    const valid=!list&&/주문\s*상세|주문번호|결제\s*금액/.test(text);
    const clean=lines(text).filter(s=>!/(?:주문\s*상세|주문번호|주문\s*일시|주문\s*상태|결제|금액|할인|쿠폰|배달비|배송|주소|전화|연락처|요청사항|영수증|재주문|리뷰|도움|배달 완료|홈$|검색$|즐겨찾기$|My 이츠|주문내역|카드|쿠페이|^\d|원$)/.test(s));
    return {valid,list,memo:valid?[coupang?'쿠팡':'쿠팡이츠',...clean.slice(0,4)].join(' · ').slice(0,80):coupang?'쿠팡 주문':'쿠팡이츠 주문 화면'};
  }
  function draft(event){
    const text=lines(phone.redactText(String(event.text||'')).replace(/출금가능액\s*[:：]?\s*-?[\d,.]+\s*원?/g,'[잔액 숨김]')).join('\n');
    const orderPlatform=event.kind==='coupang_order'?'coupang':event.kind==='eats_screen'?'eats':null;
    const isOrder=orderPlatform!==null,order=isOrder?orderInfo(text,orderPlatform):null;
    const parsed=readAmount(text,isOrder);
    const result={...phone.paymentDraft(event),...notificationDate(text,event.captured_at),amount:parsed.amount,amountSource:parsed.source,balanceAmount:bankBalance(event),suggestedAction:'',category:'생활비',notice:false,warning:'',order,quick:false};
    const cleaned=lines(text).map(line=>line.replace(/\[[^\]]*\]/g,'').replace(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/g,'').replace(/\b\d{1,2}\/\d{1,2}\b/g,'').replace(/\d{1,2}:\d{2}(?::\d{2})?/g,'').replace(/[\d,]+\s*원/g,'').replace(/(?:체크)?카드\s*(?:승인|결제)\s*(?:완료)?/g,'').replace(/^(?:승인|출금|입금|결제금액)\s*[:：]?\s*/,'').replace(/\s*\|.*$/,'').trim()).filter(line=>line&&!/^(케이뱅크|승인|완료|카드\(|체크카드\(|생활통장\()/.test(line));
    result.memo=cleaned.join(' · ').slice(0,80);
    if(/\[연결 시험\]/.test(text)){result.notice=true;result.suggestedAction='ignore';result.memo='휴대폰 연결 시험';}
    else if(isOrder){
      result.memo=order.memo;result.category=orderPlatform==='coupang'?'생활비':'배달비';result.suggestedAction='link';
      if(!order.valid){result.amount=null;result.warning=orderPlatform==='coupang'?'주문 목록을 받았어요. 주문 한 건의 상세를 보내 주세요.':'주문 목록을 받았어요. 주문 한 건의 상세 화면에서 다시 보내 주세요.';}
      else if(!result.amount)result.warning='실제 결제금액이 보이지 않아요. 주문 상세의 결제 정보를 확인해 주세요.';
      if(result.dateSource==='received'){result.date='';result.warning='주문일이 보이지 않아요. 실제 주문 날짜를 확인해 주세요.';}
      if(/취소|환불|반환/.test(text)){result.suggestedAction='ignore';result.warning='취소·환불된 주문이에요. 결제 연결 없이 제외해 주세요.';}
    }else if(event.kind==='eats_notification'){
      result.category='배달비';
      if(!result.amount){result.notice=true;result.suggestedAction='ignore';}
      else result.suggestedAction='link';
    }else if(/플러스\s*박스|\+\s*박스/.test(text))result.suggestedAction='transfer';
    else if(/취소|환불|반환|거절|실패/.test(text)){result.warning='취소·환불 여부와 원래 결제 내역을 확인해 주세요.';}
    else if(/입금/.test(text)){result.suggestedAction='income';result.category=/급여|월급/.test(text)?'월급':'기타';}
    else if(/이체|송금/.test(text))result.suggestedAction='transfer';
    else if(/승인|출금|결제\s*완료/.test(text)&&result.amount){result.suggestedAction='expense';}
    if(result.suggestedAction==='expense'&&/의원|병원|약국/.test(result.memo))result.category='비상금';
    result.quick=Boolean(result.canRecordExpense&&result.amount&&result.date&&result.memo);
    return result;
  }
  function linkCandidates(value,transactions,events){
    if(!value.amount||!value.date||value.order?.valid===false)return [];
    const candidates=transactions.filter(t=>t.type==='expense'&&t.amount===value.amount&&t.date===value.date&&/쿠팡|coupang/i.test(t.memo||''))
      .map(t=>({kind:'transaction',id:t.id,date:t.date,amount:t.amount,memo:t.memo,category:t.category}));
    for(const event of events){
      if(event.kind!=='kbank_notification'||event.status!=='pending')continue;
      const d=draft(event);
      if(d.suggestedAction==='expense'&&d.amount===value.amount&&d.date===value.date&&/쿠팡|coupang/i.test(d.memo))candidates.push({kind:'notification',id:event.event_id,date:d.date,amount:d.amount,memo:d.memo,category:d.category});
    }
    return candidates;
  }
  function duplicate(value,transactions){return transactions.some(t=>t.type==='expense'&&t.date===value.date&&t.amount===value.amount);}
  const ACTIONS={expense:'지출',income:'수입',transfer:'내 돈 이동',balance:'잔액만',link:'기존 결제 연결',ignore:'제외'};
  function integer(value,signed=false){
    if(!['number','string'].includes(typeof value))return null;
    const text=String(value).trim();
    if(!(signed?/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/:/^(?:\d+|\d{1,3}(?:,\d{3})+)$/).test(text))return null;
    const n=Number(text.replace(/,/g,''));return Number.isInteger(n)&&Math.abs(n)<=2147483647?n:null;
  }
  function normalizeDecision(raw){
    if(!raw||typeof raw.action!=='string'||!Object.hasOwn(ACTIONS,raw.action))return null;
    const result={action:raw.action,date:'',amount:null,category:'',memo:'',remark:'',include_balance:raw.include_balance===true,balance_amount:null,account_label:'',attachments:[]};
    for(const [key,max] of [['memo',80],['remark',1000]]){
      const value=raw[key]===undefined?'':raw[key];
      if(typeof value!=='string'||value.trim().length>max)return null;
      result[key]=value.trim();
    }
    if(['expense','income','link'].includes(result.action)){
      result.amount=integer(raw.amount);result.date=raw.date;result.category=raw.category;
      if(result.amount===null||result.amount<1||typeof result.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(result.date))return null;
      const date=new Date(result.date+'T00:00:00Z');
      if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==result.date)return null;
      const categories=result.action==='income'?['월급','용돈','부수입','기타']:['생활비','배달비','의류비','비상금','휴가비'];
      if(!categories.includes(result.category))return null;
    }
    if(result.action==='link'){
      if(!['transaction','notification'].includes(raw.target_kind)||typeof raw.target_id!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(raw.target_id)||typeof raw.expected_memo!=='string'||raw.expected_memo.length>80)return null;
      Object.assign(result,{target_kind:raw.target_kind,target_id:raw.target_id,expected_memo:raw.expected_memo});
    }
    if(result.action==='balance'&&!result.include_balance)return null;
    if(result.action==='ignore'&&result.include_balance)return null;
    if(result.include_balance){
      result.balance_amount=integer(raw.balance_amount,true);
      if(result.balance_amount===null||typeof raw.account_label!=='string'||!raw.account_label.trim()||raw.account_label.trim().length>40)return null;
      result.account_label=raw.account_label.trim();
    }
    if(raw.attachments!==undefined){
      if(!Array.isArray(raw.attachments)||raw.attachments.length>3||raw.attachments.some(p=>typeof p!=='string'||p.length>300)||new Set(raw.attachments).size!==raw.attachments.length)return null;
      result.attachments=[...raw.attachments];
    }
    return result;
  }
  return {draft,duplicate,ACTIONS,normalizeDecision,linkCandidates,ACCOUNT};
});
