// Server-only: no default network transport or in-memory production delivery store.
import {Webhook} from 'standardwebhooks';
import {createHash} from 'node:crypto';
import {buildAccessMessage} from './access-mail.js';

const response = (status, message) => new Response(JSON.stringify(message ? {error:{message}} : {}), {
  status, headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
});

// authorize must check current server-owned invitation/account state, never user_metadata.
// deliveries.claim must atomically return 'claimed', 'accepted', or 'blocked'.
// Existing pending/unknown/rejected claims must stay blocked, including after a crash.
// deliveries.finish must durably record the result. Never persist raw tokens/payloads.
export function createAuthEmailHook({secret, appOrigin, authOrigin, authorize, deliveries, send}) {
  if (!secret || typeof authorize !== 'function' || typeof send !== 'function' ||
      typeof deliveries?.claim !== 'function' || typeof deliveries?.finish !== 'function') {
    throw new Error('Complete server hook dependencies required');
  }
  const verifier = new Webhook(secret.replace(/^v1,/, ''));
  // Validate configuration before accepting requests.
  buildAccessMessage({kind:'invitation',recipient:'check@example.test',appOrigin,authOrigin,actionUrl:appOrigin});
  return async request => {
    if(request.method !== 'POST') return response(405,'POST required');
    let payload;
    try {
      // Bound actual streamed bytes, not only the untrusted Content-Length header.
      const reader=request.body?.getReader();
      if(!reader) return response(400,'Missing request');
      const chunks=[];let size=0;
      while(true) {
        const {value,done}=await reader.read();if(done) break;
        size+=value.length;
        if(size>65536) {await reader.cancel();return response(413,'Request too large');}
        chunks.push(value);
      }
      payload=verifier.verify(Buffer.concat(chunks),Object.fromEntries(request.headers));
    } catch {return response(401,'Invalid hook signature');}
    const user=payload?.user, data=payload?.email_data;
    const action=data?.email_action_type;
    if(!['invite','recovery'].includes(action) || typeof user?.id!=='string' ||
       typeof user?.email!=='string' || typeof data?.token_hash!=='string' ||
       !data.token_hash || data.token_hash.length>2048) return response(400,'Unsupported access request');
    try {
      if(!await authorize({userId:user.id,email:user.email,action})) return response(403,'Access request not authorized');
      // Ignore redirect_to/site_url supplied in the event; use the configured site.
      const link=new URL('/account-access',appOrigin);
      link.hash=new URLSearchParams({token_hash:data.token_hash,type:action}).toString();
      const message=buildAccessMessage({kind:action==='invite'?'invitation':'password_reset',
        recipient:user.email,actionUrl:link.href,appOrigin,authOrigin});
      const key=createHash('sha256').update(JSON.stringify([user.id,user.email,action,data.token_hash])).digest('hex');
      const claim=await deliveries.claim(key);
      if(claim==='accepted') return response(200);
      if(claim!=='claimed') return response(503,'Delivery requires reconciliation');
      let outcome;
      try {outcome=await send(message);} catch {outcome={state:'unknown'};}
      if(!['accepted','rejected','unknown'].includes(outcome?.state)) outcome={state:'unknown'};
      await deliveries.finish(key,{state:outcome.state});
      return outcome.state==='accepted' ? response(200) : response(503,'Delivery not confirmed');
    } catch {return response(503,'Access email unavailable');}
  };
}
