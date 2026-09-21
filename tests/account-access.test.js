import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {showAccountAccess} from '../src/account-access.js';
async function settle(){for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));}
function setup({type='invite',verifyError=false,otherUser=false,saveError=false}={}) {
  const dom=new JSDOM('<main id="app"></main>',{url:`https://app.example/account-access#token_hash=secret-fixture&type=${type}`});
  const calls=[];
  const client={auth:{
    async verifyOtp(input){calls.push(['verify',input]);return verifyError?{error:{message:'expired'}}:{data:{user:{id:'invited'},session:{access_token:'fixture'}}};},
    async getUser(){return {data:{user:{id:otherUser?'other':'invited'}}};},
    async updateUser(input){calls.push(['update',input]);return saveError?{error:{message:'provider details'}}:{data:{}};}
  }};
  const doc=dom.window.document;
  showAccountAccess({client,document:doc,location:dom.window.location,history:dom.window.history,shell:html=>{doc.querySelector('#app').innerHTML=html;}});
  return {dom,doc,calls};
}
function submit(f,password='correct horse phrase',confirmation=password){
  f.doc.querySelector('#new-password').value=password;
  f.doc.querySelector('#confirm-password').value=confirmation;
  f.doc.querySelector('form').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));
}
test('opening a link removes its token and requires explicit action before verification',async()=>{
  const f=setup();assert.equal(f.dom.window.location.hash,'');assert.equal(f.calls.length,0);
  assert.ok(!f.doc.body.innerHTML.includes('secret-fixture'));
  f.doc.querySelector('#verify-access').click();await settle();
  assert.deepEqual(f.calls,[['verify',{type:'invite',token_hash:'secret-fixture'}]]);
  assert.equal(f.doc.activeElement.id,'new-password');
  f.dom.window.close();
});
test('invitation and reset save a password through auth only after confirmation',async()=>{
  for(const type of ['invite','recovery']) {
    const f=setup({type});f.doc.querySelector('button').click();await settle();
    submit(f,'short');await settle();assert.equal(f.calls.length,1);
    submit(f,'correct horse phrase','different password');await settle();assert.equal(f.calls.length,1);
    submit(f);await settle();assert.equal(f.calls[1][0],'update');
    assert.match(f.doc.body.textContent,/Password saved/);
    assert.equal(f.doc.querySelector('input[type=password]'),null);
    f.dom.window.close();
  }
});
test('expired links show the matching recovery path and cannot update passwords',async()=>{
  for(const type of ['invite','recovery']) {
    const f=setup({type,verifyError:true});f.doc.querySelector('button').click();await settle();
    assert.equal(f.doc.querySelector('a').getAttribute('href'),type==='invite'?'/setup-recovery':'/password-recovery');
    assert.equal(f.doc.querySelector('form'),null);assert.equal(f.calls.length,1);f.dom.window.close();
  }
});
test('a changed signed-in identity cannot receive another user’s password',async()=>{
  const f=setup({otherUser:true});f.doc.querySelector('button').click();await settle();submit(f);await settle();
  assert.equal(f.calls.length,1);assert.match(f.doc.body.textContent,/could not be opened/);f.dom.window.close();
});
test('uncertain password save never claims success and clears sensitive inputs',async()=>{
  const f=setup({saveError:true});f.doc.querySelector('button').click();await settle();submit(f);await settle();
  assert.match(f.doc.body.textContent,/could not confirm/);assert.ok(!f.doc.body.textContent.includes('provider details'));
  assert.equal(f.doc.querySelector('#new-password').value,'');assert.equal(f.doc.querySelector('button').disabled,false);f.dom.window.close();
});
test('unfinished recovery pages do not fall through to workspace or promise email',()=>{
  for(const route of ['/setup-recovery','/password-recovery']) {
    const dom=new JSDOM('<main></main>',{url:`https://app.example${route}`});
    const handled=showAccountAccess({client:null,document:dom.window.document,location:dom.window.location,history:dom.window.history,shell:html=>{dom.window.document.querySelector('main').innerHTML=html;}});
    assert.equal(handled,true);assert.match(dom.window.document.body.textContent,/No email has been requested or sent/);dom.window.close();
  }
});
