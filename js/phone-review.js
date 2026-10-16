(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./phone-import.js'):root.BudgetPhoneImport);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BudgetPhoneReview=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(phone){
  'use strict';
  function draft(event){
    const result={...phone.paymentDraft(event),quick:false,dateSource:''};
    if(!result.canRecordExpense)return result;
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
    result.quick=Boolean(result.amount&&result.date&&result.memo);
    return result;
  }
  function duplicate(value,transactions){return transactions.some(t=>t.type==='expense'&&t.date===value.date&&t.amount===value.amount);}
  return {draft,duplicate};
});
