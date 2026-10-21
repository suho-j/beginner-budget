(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./phone-import.js'):root.BudgetPhoneImport);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BudgetPhoneReview=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(phone){
  'use strict';
  function draft(event){
    const result={...phone.paymentDraft(event),quick:false,dateSource:'',balanceAmount:Number.isInteger(event.balance_amount)?event.balance_amount:phone.extractBalance(event.text||'')};
    const text=[...new Set(phone.redactText(event.text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean))].join('\n');
    const amounts=[...text.matchAll(/(?<![\d,.-])(\d{1,3}(?:,\d{3})+|\d+)\s*원/g)];
    if(amounts.length===1){const n=Number(amounts[0][1].replace(/,/g,''));if(Number.isInteger(n)&&n>0&&n<=2147483647)result.amount=n;}
    const captured=Date.parse(event.captured_at);
    if(Number.isFinite(captured)){
      result.date=new Date(captured+9*3600000).toISOString().slice(0,10);result.dateSource='received';
    }
    const dates=[...text.matchAll(/\b(20\d{2})[-/.](\d{2})[-/.](\d{2})\b/g)];
    if(dates.length){
      const d=dates[0].slice(1).join('-'),time=Date.parse(d+'T00:00:00Z');
      if(dates.length===1&&Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===d){result.date=d;result.dateSource='notification';}
      else {result.date='';result.dateSource='';}
    }else{
      const short=[...text.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)];
      if(short.length){
        const year=Number(result.date.slice(0,4));
        const choices=[year-1,year,year+1].map(y=>y+'-'+short[0][1].padStart(2,'0')+'-'+short[0][2].padStart(2,'0'))
          .filter(d=>Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d)
          .sort((a,b)=>Math.abs(Date.parse(a)-captured)-Math.abs(Date.parse(b)-captured));
        result.date=short.length===1&&choices.length&&Math.abs(Date.parse(choices[0])-captured)<7*86400000?choices[0]:'';
        result.dateSource=result.date?'notification':'';
      }
    }
    result.memo=text.split('\n').map(line=>line
      .replace(/\[[^\]]*\]/g,'').replace(/20\d{2}[-/.]\d{2}[-/.]\d{2}/g,'').replace(/\b\d{1,2}\/\d{1,2}\b/g,'')
      .replace(/\d{1,2}:\d{2}(?::\d{2})?/g,'').replace(/[\d,]+\s*원/g,'')
      .replace(/(?:체크)?카드\s*(?:승인|결제)\s*(?:완료)?/g,'').trim())
      .filter(line=>line&&!/^(케이뱅크|true|false|승인|완료)$/.test(line)).join(' · ').slice(0,80);
    result.quick=Boolean(result.canRecordExpense&&result.amount&&result.date&&result.memo);
    return result;
  }
  function duplicate(value,transactions){return transactions.some(t=>t.type==='expense'&&t.date===value.date&&t.amount===value.amount);}
  const ACTIONS={expense:'지출로 기록',income:'수입으로 기록',transfer:'내 계좌 이체로 보관',balance:'잔액만 반영',ignore:'반영하지 않음'};
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
    if(['expense','income'].includes(result.action)){
      result.amount=integer(raw.amount);result.date=raw.date;result.category=raw.category;
      if(result.amount===null||result.amount<1||typeof result.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(result.date))return null;
      const date=new Date(result.date+'T00:00:00Z');
      if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==result.date)return null;
      const categories=result.action==='income'?['월급','용돈','부수입','기타']:['생활비','배달비','의류비','비상금','휴가비'];
      if(!categories.includes(result.category))return null;
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
  return {draft,duplicate,ACTIONS,normalizeDecision};
});
