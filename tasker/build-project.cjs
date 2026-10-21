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
const statusPage = 'https://suho-j.github.io/beginner-budget/artifacts/tasker-guide/diagnose.html';

function statusTask(id, name, source) {
  const fallback = statusPage + '#v=2&connection=script_error&queue=invalid&last=unknown&at=';
  return '<Task sr="task' + id + '"><id>' + id + '</id><nme>' + esc(name) + '</nme><pri>10</pri>'
    + '<Action sr="act0" ve="7"><code>547</code>' + str(0,'%budget_status_url') + str(1,fallback)
    + int(2,0) + int(3,0) + int(4,0) + int(5,3) + int(6,0) + '</Action>'
    + '<Action sr="act1" ve="7"><code>129</code><se>false</se>' + str(0,source) + str(1)
    + int(2,1) + int(3,10) + '</Action>'
    + '<Action sr="act2" ve="7"><code>104</code>' + str(0,'%budget_status_url')
    + '</Action></Task>';
}

function buildStatusProject() {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<TaskerData sr="" dvi="1" tv="6.3.13">\n'
    + '<Project sr="proj0" ve="2"><name>가계부 연결 진단</name><tids>5301</tids></Project>\n'
    + statusTask(5301,'BB 연결 확인',read('tasker/status-report.js')) + '\n</TaskerData>\n';
  return {xml, uri:'taskerproject://' + zlib.gzipSync(Buffer.from(xml)).toString('base64')};
}

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
    prepare:library + '\nvar budget_send = "0";\nvar budget_body = "";\nvar http_data = "";\n'
      + 'var http_response_code = "0";\n'
      + 'var budget_batch = typeof budget_batch === "undefined" ? "0" : budget_batch;\n'
      + 'try { if (Number.isFinite(Number(budget_batch)) && Number(budget_batch) < 20) {\n'
      + read('tasker/prepare-send.js')
      + '\nbudget_batch = String(Number(budget_batch) + 1);\n'
      + '} } catch (_) { setGlobal("BUDGETSTATUS", "연결 설정 또는 이전 연결의 대기 알림을 확인해 주세요."); }',
    acknowledge:read('tasker/acknowledge.js'),
    connectionStatus,
    status:read('tasker/status-report.js')
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
  const senderTask = task(5204,'BB 보내기',sender);
  const tasks = task(5201,'BB 시작',js(0,scripts.setup,120))
    + task(5202,'BB 케이뱅크 받기',js(0,scripts.bank),true)
    + task(5203,'BB 쿠팡이츠 받기',js(0,scripts.eats),true)
    + senderTask
    + task(5205,'BB 주문 화면',wait(0)+action(1,421,bundle(0))+js(2,scripts.screen))
    + statusTask(5206,'BB 상태',scripts.status);
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<TaskerData sr="" dvi="1" tv="6.3.13">\n'
    + profiles + '\n<Project sr="proj0" ve="2"><name>가계부 자동수집</name>'
    + '<pids>5101,5102,5103</pids><tids>5201,5202,5203,5204,5205,5206</tids></Project>\n'
    + tasks + '\n</TaskerData>\n';
  return {xml, uri:'taskerproject://' + zlib.gzipSync(Buffer.from(xml)).toString('base64'), scripts, senderTask};
}

function buildRepairProject() {
  const project=buildProject();
  const xml='<?xml version="1.0" encoding="UTF-8"?>\n<TaskerData sr="" dvi="1" tv="6.3.13">\n'
    + '<Project sr="proj0" ve="2"><name>가계부 연결 수정</name><tids>5301,5204,5302</tids></Project>\n'
    + statusTask(5301,'BB 연결 확인',project.scripts.status) + '\n' + project.senderTask
    + '\n<Task sr="task5302"><id>5302</id><nme>BB 연결 복구</nme><pri>10</pri>'
    + '<Action sr="act0" ve="7"><code>129</code>' + str(0,project.scripts.setup) + str(1)
    + int(2,1) + int(3,120) + '</Action></Task>\n</TaskerData>\n';
  return {xml,uri:'taskerproject://' + zlib.gzipSync(Buffer.from(xml)).toString('base64')};
}

function buildCaptureRestoreProject() {
  // Keep the already installed repair sender. Do not import duplicate task names or reset pairing.
  const full=buildProject().xml;
  const profiles=full.match(/<Profile\s[\s\S]*?<\/Profile>/g).join('\n')
    .replace('<mid0>5204</mid0>','<mid0>5404</mid0>');
  const tasks=[5202,5203,5205].map(id=>full.match(new RegExp('<Task sr="task'+id+'">[\\s\\S]*?<\\/Task>'))[0]).join('\n');
  const retry='<Task sr="task5404"><id>5404</id><nme>BB 자동 재전송</nme><pri>10</pri>'
    + '<Action sr="act0" ve="7"><code>129</code>'
    + str(0,'performTask("BB 보내기", 5, "", "", "", false, false, "", false);')
    + str(1) + int(2,1) + int(3,45) + '</Action></Task>';
  const xml='<?xml version="1.0" encoding="UTF-8"?>\n<TaskerData sr="" dvi="1" tv="6.3.13">\n'
    + profiles + '\n<Project sr="proj0" ve="2"><name>가계부 자동수집 복원</name>'
    + '<pids>5101,5102,5103</pids><tids>5202,5203,5205,5404</tids></Project>\n'
    + tasks + '\n' + retry + '\n</TaskerData>\n';
  return {xml,uri:'taskerproject://' + zlib.gzipSync(Buffer.from(xml)).toString('base64')};
}

function buildCleanProject() {
  // Project imports do not reliably offer replacement for existing named tasks.
  // Give the full new installation its own names, IDs, pairing state and outbox.
  const legacy=buildProject();
  const rename=text=>text.replaceAll('BB ','가계부21 ').replaceAll('BUDGET','BUDGET21');
  let xml=rename(legacy.xml).replace('<name>가계부 자동수집</name>','<name>처음가계부 21</name>');
  const ids={5101:8101,5102:8102,5103:8103,5201:8201,5202:8202,5203:8203,5204:8204,5205:8205,5206:8206};
  xml=xml.replace(/(sr="(?:prof|task))(\d+)(")/g,(_,before,id,after)=>before+(ids[id]||id)+after)
    .replace(/<(id|mid0|pids|tids)>([\d,]+)<\/\1>/g,(_,tag,value)=>'<'+tag+'>'+value.split(',').map(id=>ids[id]||id).join(',')+'</'+tag+'>');
  return {xml,uri:'taskerproject://'+zlib.gzipSync(Buffer.from(xml)).toString('base64'),
    scripts:Object.fromEntries(Object.entries(legacy.scripts).map(([key,value])=>[key,rename(value)]))};
}

if (require.main === module) {
  const out = path.join(root,'artifacts/tasker-guide');
  fs.mkdirSync(out,{recursive:true});
  const project = buildProject();
  fs.writeFileSync(path.join(out,'Budget-Auto.prj.xml'),project.xml);
  const template = read('tasker/install-template.html');
  fs.writeFileSync(path.join(out,'install.html'),template.replaceAll('{{TASKER_URI}}',project.uri)
    .replaceAll('{{XML_BASE64}}',Buffer.from(project.xml).toString('base64')));
  const diagnostic = buildStatusProject();
  fs.writeFileSync(path.join(out,'Budget-Status.prj.xml'),diagnostic.xml);
  fs.writeFileSync(path.join(out,'diagnose.html'),read('tasker/diagnose-template.html')
    .replaceAll('{{STATUS_URI}}',diagnostic.uri).replaceAll('{{STATUS_XML}}',Buffer.from(diagnostic.xml).toString('base64')));
  const repair=buildRepairProject();
  fs.writeFileSync(path.join(out,'Budget-Repair.prj.xml'),repair.xml);
  fs.writeFileSync(path.join(out,'repair.html'),read('tasker/repair-template.html')
    .replaceAll('{{REPAIR_URI}}',repair.uri).replaceAll('{{REPAIR_XML}}',Buffer.from(repair.xml).toString('base64')));
  const restore=buildCaptureRestoreProject();
  fs.writeFileSync(path.join(out,'Budget-Capture.prj.xml'),restore.xml);
  fs.writeFileSync(path.join(out,'restore.html'),read('tasker/restore-template.html')
    .replaceAll('{{RESTORE_URI}}',restore.uri).replaceAll('{{RESTORE_XML}}',Buffer.from(restore.xml).toString('base64')));
  const clean=buildCleanProject();
  fs.writeFileSync(path.join(out,'Budget-Clean-21.prj.xml'),clean.xml);
  fs.writeFileSync(path.join(out,'reset.html'),read('tasker/reset-template.html')
    .replaceAll('{{TASKER_URI}}',clean.uri).replaceAll('{{XML_BASE64}}',Buffer.from(clean.xml).toString('base64')));
  console.log('Created capture, status and repair projects and installer pages; no connection keys included.');
}
module.exports = {buildProject,buildStatusProject,buildRepairProject,buildCaptureRestoreProject,buildCleanProject};
