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
