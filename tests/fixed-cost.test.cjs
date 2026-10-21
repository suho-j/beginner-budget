const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = vm.createContext({window: {}});
for (const file of ['storage', 'transactions', 'cloud']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + file + '.js'), 'utf8'), context);
const {BudgetStorage: S, BudgetTransactions: T, BudgetCloud: C} = context.window;
const plain = value => JSON.parse(JSON.stringify(value));
const review = {status:'reduce', targetAmount:'30,000', paymentDay:' 25일~말일 ', paymentMethod:' 카드 ', memo:' 약정 확인 후 변경 '};
const fixed = (name, amount, fixedCost) => ({name, kind:'fixed', amount, ...(fixedCost ? {fixedCost} : {})});
const plan = {livingBudget:1000000, items:[
  {name:'급여',kind:'income',amount:3000000},
  fixed('통신비',50000,review),
  fixed('보험',150000,{status:'keep',targetAmount:100000}),
  fixed('구독',10000,{status:'review',targetAmount:0}),
  fixed('기존 항목',20000),
  {name:'용돈',kind:'allowance',amount:200000,fixedCost:review}
]};
const normalized = S.normalizeCashflowPlan(plan);
assert.deepEqual(plain(normalized.items[1].fixedCost), {status:'reduce',targetAmount:30000,paymentDay:'25일~말일',paymentMethod:'카드',memo:'약정 확인 후 변경'});
assert.equal(normalized.items[4].fixedCost,undefined);
assert.equal(normalized.items[5].fixedCost,undefined);
const totals = S.summarizeFixedCosts(plan);
assert.equal(totals.monthly,230000);
assert.equal(totals.monthlySaving,20000, 'only explicitly selected reductions count');
assert.equal(totals.annualSaving,240000);
assert.equal(totals.afterMonthly,210000);
assert.equal(totals.afterAdditionalSaving,1590000);
assert.equal(S.summarizeCashflow(plan).additionalSaving,1570000,'targets never reduce current commitments');
assert.equal(S.summarizeFixedCosts({items:[],livingBudget:0}).incomeRatio,null);
assert.equal(S.summarizeFixedCosts({items:[fixed('해지 예정',10000,{status:'reduce',targetAmount:0})],livingBudget:0}).monthlySaving,10000);
for (const bad of [null, [], 1, {status:'invalid'}, {status:['keep']}, {status:'reduce'}, {targetAmount:-1}, {targetAmount:true}, {targetAmount:[]}, {targetAmount:{}}, {targetAmount:1.5}, {targetAmount:'1e3'}, {paymentDay:42}, {paymentMethod:'x'.repeat(41)}, {memo:'x'.repeat(201)}, {status:'reduce',targetAmount:50001}]) {
  assert.equal(S.normalizeCashflowPlan({livingBudget:0,items:[{...fixed('invalid',50000),fixedCost:bad}]}),null,JSON.stringify(bad));
}
const empty = S.normalizeCashflowPlan({livingBudget:0,items:[fixed('미정',10000,{targetAmount:''})]});
assert.equal(empty.items[0].fixedCost.targetAmount,null);
assert.equal(empty.items[0].fixedCost.status,'keep');
const state = S.normalizeState({cashflowPlans:{'2026-10':plan}});
const remote = C.stateToRemote(state,'test-user');
assert.deepEqual(plain(C.remoteToState(remote.settings,[]).cashflowPlans['2026-10']),plain(normalized));
assert.deepEqual(plain(T.importState(T.exportState(state)).state.cashflowPlans['2026-10']),plain(normalized));
assert.deepEqual(plain(S.normalizeCashflowPlan(normalized)),plain(normalized));
console.log('Fixed-cost tests passed: validation, optional legacy fields, conservative estimates, cloud and backup preservation');
