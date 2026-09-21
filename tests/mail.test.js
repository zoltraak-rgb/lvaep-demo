import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildAccessMessage,buildEmailJsRequest,dispatchAccessMail} from '../server/access-mail.js';
const options={kind:'invitation',recipient:'fixture@example.test',actionUrl:'https://auth.example.test/auth/v1/verify?token=fixture',appOrigin:'https://app.example.test',authOrigin:'https://auth.example.test'};
const config={serviceId:'fixture-service',templateId:'fixture-template',publicKey:'fixture-public',privateKey:'fixture-private'};
test('invitation and reset have distinct actions and stable recovery pages',()=>{
  const invitation=buildAccessMessage(options);
  assert.equal(invitation.action_label,'Create account');
  assert.equal(invitation.recovery_url,'https://app.example.test/setup-recovery');
  const reset=buildAccessMessage({...options,kind:'password_reset'});
  assert.equal(reset.action_label,'Reset password');
  assert.equal(reset.recovery_url,'https://app.example.test/password-recovery');
  assert.ok(!reset.recovery_url.includes('token'));
});
test('rejects injected recipients and untrusted action links',()=>{
  for(const recipient of ['a@example.test\r\nBcc: victim@example.test','a@example.test,b@example.test']) {
    assert.throws(()=>buildAccessMessage({...options,recipient}),/recipient/);
  }
  for(const actionUrl of ['javascript:alert(1)','https://auth.example.test.evil.test/x','https://name:pass@auth.example.test/x','http://auth.example.test/x']) {
    assert.throws(()=>buildAccessMessage({...options,actionUrl}),/access URL/);
  }
  assert.throws(()=>buildAccessMessage({...options,appOrigin:'https://app.example.test/subpath'}),/origins/);
});
test('requires private key and exact parameters before contacting provider',async()=>{
  let calls=0; const transport=async()=>{calls++;return {status:200};};
  await assert.rejects(dispatchAccessMail({...config,privateKey:''},buildAccessMessage(options),transport),/configuration/);
  assert.equal(calls,0);
  assert.throws(()=>buildEmailJsRequest(config,{...buildAccessMessage(options),subject:'bad\nheader'}),/subject/);
});
test('accepted is not delivered; request uses private-key server authorization',async()=>{
  const result=await dispatchAccessMail(config,buildAccessMessage(options),async(url,request)=>{
    assert.equal(url,'https://api.emailjs.com/api/v1.0/email/send');
    assert.equal(request.redirect,'error');
    const payload=JSON.parse(request.body);
    assert.equal(payload.accessToken,'fixture-private');
    assert.equal(payload.template_params.to_email,'fixture@example.test');
    return {status:200};
  });
  assert.deepEqual(result,{state:'accepted'});
});
test('unknown outcomes never auto-retry or leak provider exception details',async()=>{
  let calls=0;
  const result=await dispatchAccessMail(config,buildAccessMessage(options),async()=>{calls++;throw new Error('private-key and token must not leak');});
  assert.equal(calls,1);assert.deepEqual(result,{state:'unknown'});
  assert.deepEqual(await dispatchAccessMail(config,buildAccessMessage(options),async()=>({status:503})),{state:'unknown',status:503});
  assert.deepEqual(await dispatchAccessMail(config,buildAccessMessage(options),async()=>({status:429})),{state:'rejected',status:429});
});
