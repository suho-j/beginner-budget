const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = vm.createContext({window: {}});
for (const file of ['storage', 'transactions', 'cloud']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + file + '.js'), 'utf8'), context);
const {BudgetStorage: S, BudgetTransactions: T, BudgetCloud: C} = context.window;
const plan = {items: [
  {name:'급여', kind:'income', amount:5000000},
  {name:'납부', kind:'fixed', amount:1200000},
  {name:'용돈', kind:'allowance', amount:400000},
  {name:'연간비용', kind:'reserve', amount:100000},
  {name:'저축', kind:'saving', amount:300000}
], livingBudget:1500000};
assert.equal(S.summarizeCashflow(plan).additionalSaving,1500000);
assert.equal(S.summarizeCashflow({...plan,livingBudget:4000000}).additionalSaving,-1000000);
assert.equal(S.normalizeCashflowPlan({...plan,livingBudget:'1,500,000'}).livingBudget,1500000);
for (const bad of [-1, 1.5, '', null, true, '1e6', '12abc']) assert.equal(S.normalizeCashflowPlan({...plan,livingBudget:bad}),null);
assert.equal(S.normalizeCashflowPlan({...plan,items:[{name:'x',kind:'income',amount:-1}]}),null);
const state = S.normalizeState({cashflowPlans:{'2026-10':plan,'bad':plan},transactions:[]});
assert.equal(Object.keys(state.cashflowPlans).length,1);
const remote = C.stateToRemote(state,'user');
assert.equal(C.remoteToState(remote.settings,[]).cashflowPlans['2026-10'].livingBudget,1500000);
assert.equal(T.importState(T.exportState(state)).state.cashflowPlans['2026-10'].items.length,5);
assert.deepEqual(JSON.parse(JSON.stringify(S.normalizeState({}).cashflowPlans)),{});
console.log('Cashflow model, validation, cloud and backup tests passed');
