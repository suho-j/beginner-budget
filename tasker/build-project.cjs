/* Native action/event IDs and arguments: see tasker/XML_SOURCES.md. */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n').trim();
const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const str = (index, value = '') => '<Str sr="arg' + index + '" ve="3">' + esc(value) + '</Str>';
const int = (index, value) => '<Int sr="arg' + index + '" val="' + value + '"/>';
const bundle = index => '<Bundle sr="arg' + index + '"><Vals sr="val"/></Bundle>';
const condition = (lhs, rhs) => '<ConditionList sr="if"><Condition sr="c0" ve="3"><lhs>'
  + esc(lhs) + '</lhs><op>2</op><rhs>' + esc(rhs) + '</rhs></Condition></ConditionList>';

function buildProject() {
  const library = read('js/phone-import.js') + '\n';
  const capture = read('tasker/capture.js');
  const connectionStatus = read('tasker/connection-status.js');
  function intake(kind) {
    return library + '(function () {\n'
      + 'var budget_kind = ' + JSON.stringify(kind) + ';\n'
      + 'try {\nvar config = JSON.parse(global("BUDGETCONFIG") || "null");\n'
      + 'if (!config || !config.connection_id || global("BUDGETREADY") !== config.connection_id) return;\n'
      + (kind === 'eats_screen'
        ? 'if (typeof ai_app_package !== "string" || ai_app_package !== "com.coupang.mobile.eats") { flashLong("쿠팡이츠 주문 상세 화면에서 실행해 주세요."); return; }\n' : '')
      + 'var before = global("BUDGETOUTBOX");\n' + capture + '\nif (global("BUDGETOUTBOX") !== before) '
      + 'performTask("BB 보내기", 5, "", "", "", false, false, "", false);\n'
      + '} catch (_) { setGlobal("BUDGETSTATUS", "알림을 보관하지 못했어요. 내용 또는 연결 상태를 확인해 주세요."); }\n})();';
  }
  const scripts = {
    setup:library + read('tasker/setup.js'),
    bank:intake('kbank_notification'),
    eats:intake('eats_notification'),
    screen:intake('eats_screen'),
    prepare:library + '\nsetLocal("budget_send", "0");\nsetLocal("http_data", "");\n'
      + 'setLocal("http_response_code", "0");\n'
      + '(function () { try {\n'
      + 'var count = typeof budget_batch === "undefined" ? 0 : Number(budget_batch);\n'
      + 'if (!Number.isFinite(count) || count >= 20) return;\n'
      + read('tasker/prepare-send.js')
      + '\nsetLocal("budget_batch", String(count + 1));\n'
      + '} catch (_) { setGlobal("BUDGETSTATUS", "연결 설정 또는 이전 연결의 대기 알림을 확인해 주세요."); } })();',
    acknowledge:read('tasker/acknowledge.js'),
    connectionStatus,
    status:'(function () { var saved = global("BUDGETOUTBOX"); var count = "?";'
      + 'try { count = JSON.parse(saved && saved !== "%BUDGETOUTBOX" ? saved : "[]").length; } catch (_) {}'
      + 'var config; try { config = JSON.parse(global("BUDGETCONFIG") || "null"); } catch (_) {}'
      + 'var ready = config && config.connection_id && global("BUDGETREADY") === config.connection_id;'
      + 'alert("가계부 연결\\n" + (ready ? "서버 연결 확인됨" : "연결 시험 전 또는 대기 중")'
      + ' + "\\n미전송 알림: " + count + "개\\n" + (global("BUDGETSTATUS") || "BB 시작을 실행해 주세요.")'
      + ' + "\\n\\n알림 권한과 케이뱅크 실제 수신은 별도로 확인해야 합니다."); })();'
  };
  const action = (index, code, args, extra = '') =>
    '<Action sr="act' + index + '" ve="7"><code>' + code + '</code>'
      + (extra.startsWith('<ConditionList') ? args + extra : extra + args) + '</Action>';
  const js = (index, source, timeout = 45) => action(index,129,str(0,source)+str(1)+int(2,1)+int(3,timeout));
  const stop = (index, variable) => action(index,137,int(0,0)+str(1),condition(variable,'0'));
  const wait = index => action(index,30,[0,1,0,0,0].map((v,i)=>int(i,v)).join(''));
  const task = (id, name, actions, concurrent = false) => '<Task sr="task' + id + '"><id>' + id
    + '</id><nme>' + esc(name) + '</nme><pri>10</pri>' + (concurrent?'<rty>2</rty>':'')
    + actions + '</Task>';
  const notification = (id, taskId, name, label, pkg) => '<Profile sr="prof' + id
    + '" ve="2"><flags>40</flags><id>' + id + '</id><mid0>' + taskId + '</mid0><nme>' + esc(name)
    + '</nme><Event sr="con0" ve="2"><code>461</code><pri>0</pri><App sr="arg0">'
    + '<appClass></appClass><appPkg>' + pkg + '</appPkg><label>' + label + '</label></App>'
    + [1,2,3,4,5,6].map(i=>str(i)).join('') + int(7,0) + '</Event></Profile>';
  const profiles = notification(5101,5202,'BB 케이뱅크 알림','케이뱅크','com.kbankwith.smartbank')
    + notification(5102,5203,'BB 쿠팡이츠 알림','쿠팡이츠','com.coupang.mobile.eats')
    + '<Profile sr="prof5103" ve="2"><flags>40</flags><id>5103</id><mid0>5204</mid0><nme>BB 15분 재전송</nme>'
    + '<Time sr="con0"><fh>-1</fh><fm>-1</fm><rep>2</rep><repval>15</repval><th>-1</th><tm>-1</tm></Time></Profile>';
  const sender = js(0,scripts.prepare) + stop(1,'%budget_send')
    + action(2,339,bundle(0)+int(1,1)+str(2,'%budget_url')+str(3,'%budget_headers')
      + str(4)+str(5,'%budget_body')+str(6)+str(7)+int(8,30)+int(9,0)+int(10,0)+int(11,0)+int(12,0),'<se>false</se>')
    + js(3,scripts.acknowledge) + js(4,scripts.connectionStatus) + stop(5,'%budget_ack') + wait(6)
    + action(7,135,int(0,0)+int(1,1)+str(2));
  const tasks = task(5201,'BB 시작',js(0,scripts.setup))
    + task(5202,'BB 케이뱅크 받기',js(0,scripts.bank),true)
    + task(5203,'BB 쿠팡이츠 받기',js(0,scripts.eats),true)
    + task(5204,'BB 보내기',sender)
    + task(5205,'BB 주문 화면',wait(0)+action(1,421,bundle(0))+js(2,scripts.screen))
    + task(5206,'BB 상태',js(0,scripts.status));
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<TaskerData sr="" dvi="1" tv="6.3.13">\n'
    + profiles + '\n<Project sr="proj0" ve="2"><name>가계부 자동수집</name>'
    + '<pids>5101,5102,5103</pids><tids>5201,5202,5203,5204,5205,5206</tids></Project>\n'
    + tasks + '\n</TaskerData>\n';
  return {xml, uri:'taskerproject://' + zlib.gzipSync(Buffer.from(xml)).toString('base64'), scripts};
}

if (require.main === module) {
  const out = path.join(root,'artifacts/tasker-guide');
  fs.mkdirSync(out,{recursive:true});
  const project = buildProject();
  fs.writeFileSync(path.join(out,'Budget-Auto.prj.xml'),project.xml);
  const template = read('tasker/install-template.html');
  fs.writeFileSync(path.join(out,'install.html'),template.replaceAll('{{TASKER_URI}}',project.uri)
    .replaceAll('{{XML_BASE64}}',Buffer.from(project.xml).toString('base64')));
  console.log('Created Budget-Auto.prj.xml and install.html; no connection keys included.');
}
module.exports = {buildProject};
