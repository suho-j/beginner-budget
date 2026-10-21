// Synthetic local UI fixture only. Never used by the production page.
(function(window){
  const s=window.BudgetStorage.defaultState();
  const item=(name,kind,amount,day,rule='next')=>({name,kind,amount,schedule:{day,rule,account:'테스트 계좌',note:'화면 검증용'}});
  s.cashflowPlans={'2026-10':{items:[item('테스트 급여','income',3000000,'10','previous'),item('테스트 납부','fixed',100000,'5'),item('테스트 연금','fixed',90000,'last'),item('날짜 미정 테스트','fixed',20000,'')],livingBudget:1000000}};
  window.BudgetCloud={ENVIRONMENT:{name:'preview-v2',isPreview:true},isConfigured:()=>true,currentUser:async()=>({id:'synthetic'}),downloadState:async()=>structuredClone(s),saveSettings:async next=>Object.assign(s,next),signOut:async()=>{}};
})(window);
