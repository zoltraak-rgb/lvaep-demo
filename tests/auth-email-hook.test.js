import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Webhook} from 'standardwebhooks';
import {createAuthEmailHook} from '../server/auth-email-hook.js';
const secret=Buffer.from('test-only-signing-secret-32-bytes!').toString('base64');
const signer=new Webhook(secret);
const event={user:{id:'fixture-user',email:'fixture@example.test'},email_data:{email_action_type:'invite',token_hash:'fixture-token',redirect_to:'https://evil.example'}};
function request(value=event,{id='fixture-id',date=new Date(),bad=false}={}) {
  const body=JSON.stringify(value);
  return new Request('https://server.example/hook',{method:'POST',body,headers:{
    'webhook-id':id,'webhook-timestamp':String(Math.floor(date.getTime()/1000)),
    'webhook-signature':bad?'v1,invalid':signer.sign(id,date,body)
  }});
}
function fixture({authorize=async()=>true,send=async()=>({state:'accepted'}),finishFails=false}={}) {
  const states=new Map(),messages=[];
  const hook=createAuthEmailHook({secret:`v1,whsec_${secret}`,appOrigin:'https://app.example',authOrigin:'https://auth.example',authorize,
    deliveries:{async claim(key){if(states.has(key)) return states.get(key)==='accepted'?'accepted':'blocked';states.set(key,'pending');return 'claimed';},
      async finish(key,outcome){if(finishFails) throw Error('storage failure');states.set(key,outcome.state);}},
    send:async message=>{messages.push(message);return send(message);}});
  return {hook,messages,states};
}
test('invalid and expired signatures cannot send',async()=>{
  const f=fixture();
  assert.equal((await f.hook(request(event,{bad:true}))).status,401);
  assert.equal((await f.hook(request(event,{date:new Date(Date.now()-600000)}))).status,401);
  assert.equal(f.messages.length,0);
});
test('authorization and supported actions are required before claiming delivery',async()=>{
  const f=fixture({authorize:async()=>false});
  assert.equal((await f.hook(request())).status,403);
  assert.equal((await f.hook(request({...event,email_data:{...event.email_data,email_action_type:'signup'}}))).status,400);
  assert.equal(f.states.size,0);
});
test('concurrent events and new webhook IDs share one durable token claim',async()=>{
  const f=fixture();
  await Promise.all([f.hook(request()),f.hook(request(event,{id:'retry-id'}))]);
  assert.equal((await f.hook(request(event,{id:'third-id'}))).status,200);
  assert.equal(f.messages.length,1);
  const link=new URL(f.messages[0].action_url);
  assert.equal(link.origin,'https://app.example');assert.equal(link.search,'');
  assert.equal(new URLSearchParams(link.hash.slice(1)).get('token_hash'),'fixture-token');
  assert.ok([...f.states.keys()].every(key=>!key.includes('fixture')));
});
test('unknown outcomes and failed completion writes never automatically resend',async()=>{
  for(const options of [{send:async()=>{throw Error('private provider details');}},{finishFails:true}]) {
    const f=fixture(options);
    const first=await f.hook(request());assert.equal(first.status,503);
    assert.ok(!(await first.text()).includes('private'));
    assert.equal((await f.hook(request())).status,503);assert.equal(f.messages.length,1);
  }
});
