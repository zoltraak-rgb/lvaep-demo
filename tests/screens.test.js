import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {showAccountAccess} from '../src/account-access.js';
import * as domain from '../src/domain.js';
const source=(await readFile(new URL('../src/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const tutor='00000000-0000-4000-8000-000000000001';
const student='00000000-0000-4000-8000-000000000002';
const fixture={people:[{id:tutor,display_name:'Alex <script>alert(1)</script>',active:true,roles:['tutor']}],students:[{id:student,display_name:'Fictional learner'}],assignments:[{tutor_id:tutor,student_id:student,starts_on:'2020-01-01'}],lessons:[]};
function mockClient({failReads=false,rpc}={}) {
  return {auth:{getUser:async()=>({data:{user:{id:tutor}}}),onAuthStateChange:()=>{},signOut:async()=>({})},
    from(table){
      let single=false;
      const chain={select(){return chain;},eq(){return chain;},order(){return chain;},range(){return chain;},maybeSingle(){single=true;return chain;},then(resolve,reject){return Promise.resolve(failReads&&table!=='people'?{error:{message:'offline'}}:{data:single?fixture[table][0]:fixture[table]}).then(resolve,reject);}};
      return chain;
    },rpc:rpc||(async()=>({data:{status:'saved'}}))};
}
function screen(client=null) {
  const dom=new JSDOM('<div id="app"></div>',{url:'https://local.test/',runScripts:'outside-only'});
  Object.assign(dom.window,domain,{client,rememberSession:()=>{},showAccountAccess:options=>showAccountAccess({...options,document:dom.window.document,location:dom.window.location,history:dom.window.history})});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  dom.window.alert=()=>{};
  dom.window.eval(source);
  return dom;
}
async function settle() {for(let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve));}
test('unconfigured screen cannot pretend to sign in and inputs have labels',()=>{
  const dom=screen();const doc=dom.window.document;
  assert.match(doc.body.textContent,/No records are being saved/);
  assert.ok(doc.querySelector('#email').disabled);
  assert.ok(doc.querySelector('#signin-form button').disabled);
  assert.equal(doc.querySelector('label[for=email]').textContent,'Email address');
  dom.window.close();
});
test('names are displayed as text; tutor screen does not show staff controls',async()=>{
  const dom=screen(mockClient());await settle();const doc=dom.window.document;
  assert.ok(doc.querySelector('#open-log'));
  assert.equal(doc.querySelector('#roster'),null);
  assert.equal(doc.querySelector('script'),null);
  assert.match(doc.querySelector('.identity').textContent,/<script>/);
  dom.window.close();
});
test('failed roster load shows a connection error rather than missing-student state',async()=>{
  const dom=screen(mockClient({failReads:true}));await settle();
  assert.match(dom.window.document.body.textContent,/couldn’t load your workspace/);
  assert.equal(dom.window.document.querySelector('#open-log'),null);
  dom.window.close();
});
test('lost response freezes input and retry reuses the same logical request',async()=>{
  const requests=[];
  const dom=screen(mockClient({rpc:async(name,payload)=>{
    requests.push(structuredClone(payload));
    return requests.length===1?{error:{message:'Failed to fetch'}}:{data:{status:'saved',replayed:true}};
  }}));await settle();const doc=dom.window.document;
  doc.querySelector('#open-log').click();
  const form=doc.querySelector('#lesson-form');
  form.querySelector('[name=student]').checked=true;
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await settle();
  assert.match(doc.querySelector('#save-status').textContent,/Not saved yet/);
  assert.ok(doc.querySelector('#duration').disabled);
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await settle();
  assert.equal(requests.length,2);
  assert.deepEqual(requests[0],requests[1]);
  assert.equal(doc.querySelector('#lesson-form'),null);
  dom.window.close();
});
test('staff report leads with tutors, shows individual partial attendance, and keeps program totals collapsed',async()=>{
  const oldRoles=fixture.people[0].roles;
  fixture.people[0].roles=['staff'];
  fixture.lessons=[{id:'lesson',tutor_id:tutor,lesson_date:`${domain.previousMonth()}-12`,minutes:90,attendance:[{student_id:student,minutes:45}]}];
  const dom=screen(mockClient());
  try {
    await settle();const doc=dom.window.document;
    const row=doc.querySelector('.tutor-report');assert.ok(row);
    assert.match(row.textContent,/1 hr 30 min taught/);assert.match(row.textContent,/45 min attended/);
    const totals=doc.querySelector('#program-totals');assert.equal(totals.open,false);
    assert.ok(doc.querySelector('#tutor-reports').compareDocumentPosition(totals)&dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    const search=doc.querySelector('#report-search');search.value='fictional learner';search.dispatchEvent(new dom.window.Event('input'));
    assert.equal(row.hidden,false);
    search.value='no match';search.dispatchEvent(new dom.window.Event('input'));assert.equal(row.hidden,true);
    assert.equal(doc.querySelector('#report-no-match').hidden,false);
    assert.match(totals.textContent,/45 min/);
  } finally {dom.window.close();fixture.people[0].roles=oldRoles;fixture.lessons=[];}
});
test('monthly review sends the displayed snapshot and does not claim success on failed confirmation',async()=>{
  const snapshot={students:[student],lessons:[]};const calls=[];
  const dom=screen(mockClient({rpc:async(name,payload)=>{
    calls.push({name,payload});
    return name==='get_month_review'?{data:{snapshot,status:'not_reviewed',can_confirm:true}}:{error:{message:'changed'}};
  }}));
  try {
    await settle();const doc=dom.window.document;
    doc.querySelector('#open-review').click();await settle();
    assert.match(doc.querySelector('#review-body').textContent,/No recorded sessions/);
    doc.querySelector('#confirm-review').click();await settle();
    assert.deepEqual(calls[1].payload.p_snapshot,snapshot);
    assert.match(doc.querySelector('#review-status').textContent,/could not be verified/);
    assert.equal(doc.querySelector('#confirm-review').textContent,'Reload review');
  } finally {dom.window.close();}
});
test('failure to save suggested group never resubmits the saved lesson',async()=>{
  const second='00000000-0000-4000-8000-000000000009';
  fixture.students.push({id:second,display_name:'Second fictional learner'});
  fixture.assignments.push({tutor_id:tutor,student_id:second,starts_on:'2020-01-01'});
  const calls=[];
  const dom=screen(mockClient({rpc:async(name,payload)=>{calls.push({name,payload});return name==='record_lesson'?{data:{status:'saved'}}:{error:{message:'offline'}};}}));
  try{
    await settle();const doc=dom.window.document;doc.querySelector('#open-log').click();
    doc.querySelectorAll('[name=student]').forEach(input=>input.checked=true);
    doc.querySelector('#lesson-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();
    assert.ok(doc.querySelector('#group-form'));doc.querySelector('#group-name').value='Fictional group';
    for(let i=0;i<2;i++){doc.querySelector('#group-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();}
    assert.match(doc.querySelector('#group-status').textContent,/lesson is saved/);
    assert.equal(calls.filter(c=>c.name==='record_lesson').length,1);
    assert.equal(calls[1].payload.p_id,calls[2].payload.p_id);
  }finally{dom.window.close();fixture.students.pop();fixture.assignments.pop();}
});
test('calendar date selection prefills logging without saving and list remains available',async()=>{
  let writes=0;
  const dom=screen(mockClient({rpc:async()=>{writes++;return {data:{}};}}));
  try{
    await settle();const doc=dom.window.document;
    const month=doc.querySelector('#calendar-month');month.value='2026-08';month.dispatchEvent(new dom.window.Event('change'));
    doc.querySelector('[data-date="2026-08-14"]').click();
    assert.match(doc.querySelector('#calendar-day').textContent,/No recorded lessons/);
    doc.querySelector('#log-calendar-day').click();
    assert.equal(doc.querySelector('#lesson-date').value,'2026-08-14');assert.equal(writes,0);
    doc.querySelector('#close-dialog').click();doc.querySelector('#calendar-list-view').click();
    assert.equal(doc.querySelector('.calendar-grid'),null);
    assert.equal(doc.querySelector('#calendar-list-view').getAttribute('aria-pressed'),'true');
  }finally{dom.window.close();}
});
test('weekly plan preview and retry preserve one plan without recording attendance',async()=>{
  const calls=[];
  const dom=screen(mockClient({rpc:async(name,payload)=>{calls.push({name,payload:structuredClone(payload)});return calls.length===1?{error:{message:'offline'}}:{data:{id:payload.p_id}};}}));
  try {
    await settle();const doc=dom.window.document;doc.querySelector('#new-plan').click();
    doc.querySelector('#plan-start').value='2026-09-01';doc.querySelector('#plan-end').value='2026-09-22';
    doc.querySelector('[name=plan-student]').checked=true;
    const form=doc.querySelector('#plan-form');form.dispatchEvent(new dom.window.Event('input'));
    assert.match(doc.querySelector('#plan-preview').textContent,/4 planned lessons/);
    form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();
    assert.equal(doc.querySelector('#plan-start').disabled,true);
    form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();
    assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].name,'create_weekly_plan');
    assert.match(doc.querySelector('#plan-status').textContent,/No attendance has been recorded/);
  }finally{dom.window.close();}
});
