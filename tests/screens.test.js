import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {showAccountAccess} from '../src/account-access.js';
import * as domain from '../src/domain.js';
const source=(await readFile(new URL('../src/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const tutor='00000000-0000-4000-8000-000000000001';
const student='00000000-0000-4000-8000-000000000002';
const fixture={student_requests:[],lesson_plans:[],planned_occurrences:[],people:[{id:tutor,display_name:'Alex <script>alert(1)</script>',active:true,roles:['tutor']}],students:[{id:student,display_name:'Fictional learner'}],assignments:[{tutor_id:tutor,student_id:student,starts_on:'2020-01-01'}],lessons:[]};
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
  Object.assign(dom.window,domain,{structuredClone,client,rememberSession:()=>{},showAccountAccess:options=>showAccountAccess({...options,document:dom.window.document,location:dom.window.location,history:dom.window.history})});
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
    assert.ok(doc.querySelector('#calendar-records'));
    assert.equal(fixture.lessons.length,0);
  }finally{dom.window.close();}
});
test('uncertain correction freezes values and retries the same versioned update',async()=>{
 fixture.lessons=[{id:'edit-fixture',tutor_id:tutor,lesson_date:`${domain.nyToday().slice(0,7)}-01`,minutes:90,version:1,attendance:[{student_id:student,minutes:90}]}];
 const calls=[];const dom=screen(mockClient({rpc:async(name,payload)=>{calls.push(structuredClone(payload));return calls.length===1?{error:{message:'offline'}}:{data:{status:'saved'}};}}));
 try{
  await settle();const doc=dom.window.document;doc.querySelector('[data-edit-lesson]').click();
  doc.querySelector('#edit-minutes').value='60';doc.querySelector('[data-edit-student]').value='45';
  const form=doc.querySelector('#edit-lesson-form');form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();
  assert.equal(doc.querySelector('#edit-minutes').disabled,true);
  form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();
  assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].p_version,1);assert.equal(calls[0].p_participants[0].minutes,45);
 }finally{dom.window.close();fixture.lessons=[];}
});

test('planned calendar separates attendance and prevents blind repeat after uncertain shift',async()=>{
 const month=domain.nyToday().slice(0,7);
 fixture.lesson_plans=[{id:'plan-test',tutor_id:tutor,version:3}];
 fixture.planned_occurrences=[{id:'occ-test',plan_id:'plan-test',lesson_date:`${month}-12`,minutes:90,student_ids:[student],canceled:false}];
 const calls=[];const dom=screen(mockClient({rpc:async(name,payload)=>{calls.push({name,payload});return {error:{message:'offline'}};}}));
 try {
  await settle();const doc=dom.window.document;
  assert.match(doc.querySelector('[data-date="'+month+'-12"]').textContent,/1 planned/);
  doc.querySelector('#calendar-list-view').click();
  assert.match(doc.querySelector('#calendar-records').textContent,/Planned/);
  assert.match(doc.querySelector('#calendar-records').textContent,/No recorded lessons/);
  doc.querySelector('[data-edit-plan]').click();doc.querySelector('#plan-scope').value='future';
  const form=doc.querySelector('#edit-plan');form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();
  assert.equal(calls[0].name,'change_plan_occurrence');assert.equal(calls[0].payload.p_scope,'future');assert.equal(calls[0].payload.p_version,3);
  assert.match(doc.querySelector('#change-plan-status').textContent,/Reload and check/);
  assert.ok(form.querySelector('button').disabled);
  form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();assert.equal(calls.length,1);
 } finally {dom.window.close();fixture.lesson_plans=[];fixture.planned_occurrences=[];}
});

test('held plan prefills confirmation and uses linked save without automatically recording',async()=>{
 const month=domain.nyToday().slice(0,7);fixture.lesson_plans=[{id:'held-plan',version:2,tutor_id:tutor}];
 fixture.planned_occurrences=[{id:'held-occurrence',plan_id:'held-plan',lesson_date:`${month}-05`,minutes:60,student_ids:[student],canceled:false,lesson_id:null}];
 const calls=[];const dom=screen(mockClient({rpc:async(name,payload)=>{calls.push({name,payload});return {error:{code:'P0001',message:'test validation'}};}}));
 try {
  await settle();const doc=dom.window.document;doc.querySelector('#calendar-list-view').click();doc.querySelector('[data-held-plan]').click();
  assert.equal(calls.length,0);assert.equal(doc.querySelector('#duration').value,'60');assert.ok(doc.querySelector('[name=student]').checked);
  doc.querySelector('[data-student]').value='45';doc.querySelector('#lesson-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();
  assert.equal(calls[0].name,'record_planned_lesson');assert.equal(calls[0].payload.p_occurrence,'held-occurrence');assert.equal(calls[0].payload.p_plan_version,2);assert.equal(calls[0].payload.p_participants[0].minutes,45);
 }finally {dom.window.close();fixture.lesson_plans=[];fixture.planned_occurrences=[];}
});

test('staff review filter preserves unknown status and ignores stale month responses',async()=>{
 const original=fixture.people[0].roles;fixture.people[0].roles=['staff'];
 const requests=[];const dom=screen(mockClient({rpc:(name,payload)=>new Promise(resolve=>requests.push({payload,resolve}))}));
 try {
  await settle();const doc=dom.window.document;assert.equal(requests.length,1);
  const month=doc.querySelector('#report-month');month.value='2026-07';month.dispatchEvent(new dom.window.Event('change'));await settle();
  requests[1].resolve({data:{status:'updated',can_confirm:true}});await settle();
  requests[0].resolve({data:{status:'reviewed',can_confirm:true}});await settle();
  assert.match(doc.querySelector('.review-state').textContent,/Updated since review/);
  const filter=doc.querySelector('#needs-review');filter.checked=true;filter.dispatchEvent(new dom.window.Event('change'));assert.equal(doc.querySelector('.tutor-report').hidden,false);
  month.value='2026-06';month.dispatchEvent(new dom.window.Event('change'));await settle();
  requests[2].resolve({error:{message:'offline'}});await settle();
  const unknown=doc.querySelector('#needs-review');unknown.checked=true;unknown.dispatchEvent(new dom.window.Event('change'));
  assert.equal(doc.querySelector('.tutor-report').hidden,false);assert.match(doc.querySelector('.review-state').textContent,/unavailable/);
  month.value='2026-05';month.dispatchEvent(new dom.window.Event('change'));await settle();
  requests[3].resolve({data:{status:'reviewed',can_confirm:true}});await settle();
  const complete=doc.querySelector('#needs-review');complete.checked=true;complete.dispatchEvent(new dom.window.Event('change'));
  assert.equal(doc.querySelector('.tutor-report').hidden,true);assert.match(doc.querySelector('#review-counts').textContent,/1 reviewed/);
 }finally{fixture.people[0].roles=original;dom.window.close();}
});

test('missing request form checks existing requests and freezes uncertain retries',async()=>{
 const calls=[];const dom=screen(mockClient({rpc:async(name,payload)=>{calls.push({name,payload:structuredClone(payload)});return calls.length===1?{error:{message:'offline'}}:{data:{id:payload.p_id}};}}));
 try{
  await settle();const doc=dom.window.document;doc.querySelector('#missing-student').click();await settle();
  doc.querySelector('#missing-name').value='Fictional learner';const form=doc.querySelector('#missing-form');form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();
  assert.ok(doc.querySelector('#missing-name').disabled);form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();
  assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].name,'request_missing_student');assert.match(doc.querySelector('#missing-status').textContent,/Request saved/);
 }finally{dom.window.close();}
});

test('pending-only lesson retries exact partial attendance and appears separately in review',async()=>{
 fixture.student_requests=[{id:'request-one',tutor_id:tutor,display_name:'Pending <learner>',status:'pending',version:1}];
 const calls=[];const dom=screen(mockClient({rpc:async(name,payload)=>{
  calls.push({name,payload:structuredClone(payload)});
  if(name==='get_month_review')return {data:{status:'not_reviewed',can_confirm:true,snapshot:{students:[],lessons:[{id:'pending-lesson',date:'2026-08-02',minutes:90,attendance:[],pending:[{request_id:'request-one',minutes:45}]}]}}};
  return calls.filter(c=>c.name==='record_mixed_lesson').length===1?{error:{message:'offline'}}:{data:{status:'saved'}};
 }}));
 try{
  await settle();const doc=dom.window.document;doc.querySelector('#open-log').click();
  doc.querySelector('[name=pending-student]').checked=true;doc.querySelector('[data-pending]').value='45';
  const form=doc.querySelector('#lesson-form');form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();
  assert.equal(calls[0].name,'record_mixed_lesson');assert.equal(calls[0].payload.p_pending[0].minutes,45);assert.deepEqual(calls[0].payload.p_participants,[]);
  form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();assert.deepEqual(calls[0],calls[1]);
  doc.querySelector('#open-review').click();await settle();
  assert.ok(doc.querySelector('#confirm-review'));assert.match(doc.querySelector('.pending-details').textContent,/Pending <learner>/);assert.match(doc.querySelector('.pending-details').textContent,/separate from official/);
 }finally{fixture.student_requests=[];dom.window.close();}
});

test('pending lesson correction rejects too-long attendance before sending',async()=>{
 fixture.lessons=[{id:'pending-edit',tutor_id:tutor,lesson_date:'2026-08-02',minutes:90,version:1,attendance:[],pending_attendance:[{request_id:'req',minutes:75}]}];
 const calls=[];const dom=screen(mockClient({rpc:async(name,payload)=>{calls.push({name,payload});return {data:{status:'saved'}};}}));
 try{
  await settle();const doc=dom.window.document;doc.querySelector('[data-edit-lesson]').click();doc.querySelector('#edit-minutes').value='60';
  const form=doc.querySelector('#edit-lesson-form');form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();assert.equal(calls.length,0);
  doc.querySelector('[data-edit-pending]').value='50';form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();assert.equal(calls[0].name,'correct_mixed_lesson');assert.equal(calls[0].payload.p_pending[0].minutes,50);
 }finally{fixture.lessons=[];dom.window.close();}
});

test('staff connects only an explicitly verified student and freezes uncertain retry',async()=>{
 const roles=fixture.people[0].roles;fixture.people[0].roles=['staff'];fixture.student_requests=[{id:'connect-request',tutor_id:tutor,display_name:'Pending learner',context:'Fictional library',status:'pending',version:1}];
 const calls=[];const dom=screen(mockClient({rpc:async(name,payload)=>{if(name!=='resolve_student_request')return {data:{status:'not_reviewed',can_confirm:true}};calls.push(structuredClone(payload));return calls.length===1?{error:{message:'offline'}}:{data:{status:'resolved'}};}}));
 try{
  await settle();const doc=dom.window.document;doc.querySelector('#student-requests').click();await settle();doc.querySelector('[data-connect-request]').click();
  doc.querySelector('#connect-student').value=student;const form=doc.querySelector('#connect-request-form');form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();assert.equal(calls.length,0);
  doc.querySelector('#verified-match').checked=true;form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();assert.ok(doc.querySelector('#connect-student').disabled);
  form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();assert.deepEqual(calls[0],calls[1]);assert.match(doc.querySelector('#connect-status').textContent,/Connected/);
 }finally{fixture.people[0].roles=roles;fixture.student_requests=[];dom.window.close();}
});

test('print snapshot includes filtered-out tutors and expanded details without editing controls',async()=>{
 const roles=fixture.people[0].roles;fixture.people[0].roles=['staff'];
 fixture.lessons=[{id:'print-lesson',tutor_id:tutor,lesson_date:domain.previousMonth()+'-05',minutes:90,attendance:[{student_id:student,minutes:45}]}];
 const dom=screen(mockClient({rpc:async()=>({data:{status:'updated',can_confirm:true}})}));
 try{
  await settle();const doc=dom.window.document;
  assert.match(doc.querySelector('#teaching-chart').textContent,/1 hr 30 min/);
  doc.querySelector('#report-search').value='no match';doc.querySelector('#report-search').dispatchEvent(new dom.window.Event('input'));
  assert.equal(doc.querySelector('.tutor-report').hidden,true);
  let printed=false;dom.window.print=()=>{printed=true;};doc.querySelector('#print-report').click();
  const snapshot=doc.querySelector('#printable-report');assert.equal(printed,true);assert.ok(snapshot);
  assert.equal(snapshot.querySelector('.tutor-report').hidden,false);assert.ok([...snapshot.querySelectorAll('details')].every(d=>d.open));assert.equal(snapshot.querySelector('button'),null);
  assert.match(snapshot.textContent,/45 min/);assert.match(snapshot.textContent,/Updated since review/);assert.match(snapshot.textContent,/Exported/);assert.match(snapshot.textContent,/search filters do not apply/);
  assert.equal(snapshot.querySelector('script'),null);
  dom.window.dispatchEvent(new dom.window.Event('afterprint'));assert.equal(doc.querySelector('#printable-report'),null);
 }finally{fixture.people[0].roles=roles;fixture.lessons=[];dom.window.close();}
});

test('staff student edit retains identity and version and freezes uncertain archive retry',async()=>{
 const roles=fixture.people[0].roles;fixture.people[0].roles=['staff'];fixture.students[0].version=4;
 const calls=[];const dom=screen(mockClient({rpc:async(name,payload)=>{if(name!=='save_student')return {data:{status:'reviewed',can_confirm:true}};calls.push(structuredClone(payload));return calls.length===1?{error:{message:'offline'}}:{data:{id:student}};}}));
 try{
  await settle();const doc=dom.window.document;doc.querySelector('.edit-student').click();doc.querySelector('#student-name').value='Corrected name';doc.querySelector('#student-archived').checked=true;
  const form=doc.querySelector('#student-form');form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();assert.ok(doc.querySelector('#student-name').disabled);
  form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].p_id,student);assert.equal(calls[0].p_version,4);assert.equal(calls[0].p_archived,true);
 }finally{fixture.people[0].roles=roles;delete fixture.students[0].version;dom.window.close();}
});
test('staff history renders original values as text and tutors have no history control',async()=>{
 const roles=fixture.people[0].roles;fixture.people[0].roles=['staff'];fixture.audit_events=[{id:1,entity:'student',entity_id:student,action:'saved',actor_id:tutor,created_at:'2026-09-22T16:00:00Z',before_value:{display_name:'Old'},after_value:{display_name:'<script>unsafe</script>',archived:true}}];
 const dom=screen(mockClient());try{await settle();const doc=dom.window.document;doc.querySelector('#open-history').click();await settle();assert.match(doc.querySelector('#history-records').textContent,/Old/);assert.match(doc.querySelector('#history-records').textContent,/<script>unsafe/);assert.equal(doc.querySelector('script'),null);assert.equal(doc.querySelector('#history-more').hidden,true);}finally{dom.window.close();fixture.people[0].roles=roles;delete fixture.audit_events;}
 const tutorScreen=screen(mockClient());await settle();assert.equal(tutorScreen.window.document.querySelector('#open-history'),null);tutorScreen.window.close();
});
