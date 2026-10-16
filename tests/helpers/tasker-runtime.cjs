const vm = require('node:vm');

// Model the documented JavaScriptlet Auto Exit boundary, not an Android emulator:
// Tasker locals are copied into JS before the action and copied back after it.
// setLocal writes the external store; it does not assign the injected JS binding.
function taskerRuntime(globals = {}, locals = {}) {
  const calls = [];
  return {globals, locals, calls, run(source, additions = {}) {
    const context = vm.createContext({...locals,
      global:name => globals[name] || '',
      setGlobal:(name,value) => {globals[name]=String(value);},
      setLocal:(name,value) => {locals[name]=String(value);},
      flashLong:() => {}, performTask:(...args) => calls.push(args),
      ...additions
    });
    vm.runInContext(source,context);
    for(const [name,value] of Object.entries(context)) {
      if(/^[a-z][a-z0-9_]{2,}$/.test(name) && ['string','number','boolean'].includes(typeof value)) {
        locals[name]=String(value);
      }
    }
  }};
}
module.exports = {taskerRuntime};
