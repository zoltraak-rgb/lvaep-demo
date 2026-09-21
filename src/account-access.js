// Links carry their short-lived token in the fragment, never the query string.
// Opening a link does not consume it: the user explicitly chooses Continue.
export function showAccountAccess({client, shell, location=window.location, history=window.history, document=window.document}) {
  if(['/setup-recovery','/password-recovery'].includes(location.pathname)) {
    shell('<section class="card signin"><h1>Recovery setup is still in progress</h1><p>Replacement emails are not connected yet. No email has been requested or sent.</p><a href="/">Back to sign in</a></section>');
    return true;
  }
  if(location.pathname!=='/account-access') return false;
  const params=new URLSearchParams(location.hash.slice(1));
  let token=params.get('token_hash');
  const type=params.get('type');
  history.replaceState(null,'','/account-access');
  const invitation=type==='invite';
  const recovery=invitation?'/setup-recovery':'/password-recovery';
  const unavailable=()=>shell(`<section class="card signin"><h1>This link could not be opened</h1><p>The link may have expired or already been used. You can request a replacement.</p><a href="${recovery}">Request a new ${invitation?'setup':'password-reset'} link</a><p><a href="/">Back to sign in</a></p></section>`);
  if(!['invite','recovery'].includes(type)||!token||token.length>2048) {token=null;unavailable();return true;}
  if(!client) {token=null;shell('<section class="card signin"><h1>Account service unavailable</h1><p>Please try the link from your email again once the account service is connected.</p><a href="/">Back to sign in</a></section>');return true;}
  shell(`<section class="card signin"><h1>${invitation?'Set up your account':'Reset your password'}</h1><p>Continue to verify the link from your email. Your password will change only after you save a new one.</p><button class="primary" id="verify-access">Continue</button><p id="access-status" role="status"></p><a href="/">Back to sign in</a></section>`);
  document.querySelector('#verify-access').onclick=async()=>{
    const button=document.querySelector('#verify-access');button.disabled=true;
    document.querySelector('#access-status').textContent='Checking your link…';
    let verified;
    try {
      const result=await client.auth.verifyOtp({token_hash:token,type});
      token=null;
      if(result.error||!result.data?.user?.id||!result.data?.session) throw Error('Invalid link');
      verified=result.data.user.id;
    } catch {token=null;unavailable();return;}
    shell(`<section class="card signin"><h1>Choose your password</h1><p>Use at least 12 characters. A few unrelated words can be easier to remember.</p><form id="new-password-form"><label for="new-password">New password</label><input id="new-password" type="password" autocomplete="new-password" minlength="12" required><label for="confirm-password">Confirm password</label><input id="confirm-password" type="password" autocomplete="new-password" minlength="12" required><button class="primary full">Save password</button><p id="password-status" role="alert"></p></form></section>`);
    const form=document.querySelector('#new-password-form');
    form.onsubmit=async event=>{
      event.preventDefault();const password=document.querySelector('#new-password'),confirmation=document.querySelector('#confirm-password');
      const status=document.querySelector('#password-status'),save=form.querySelector('button');
      if(save.disabled) return;
      if(password.value.length<12) {status.textContent='Use at least 12 characters.';password.focus();return;}
      if(password.value!==confirmation.value) {status.textContent='The passwords do not match.';confirmation.focus();return;}
      save.disabled=true;status.textContent='Saving your password…';
      try {
        // Prevent a different tab's sign-in from changing the wrong account.
        const current=await client.auth.getUser();
        if(current.error||current.data?.user?.id!==verified) {
          password.value='';confirmation.value='';unavailable();return;
        }
        const result=await client.auth.updateUser({password:password.value});
        if(result.error) throw result.error;
        password.value='';confirmation.value='';
        shell('<section class="card signin"><h1>Password saved</h1><p>Use your email and this password for future visits.</p><a class="primary" href="/">Open your workspace</a></section>');
      } catch {
        password.value='';confirmation.value='';
        status.textContent='We could not confirm the password change. Enter your chosen password again to retry, or use password recovery if the session has expired.';
        save.disabled=false;password.focus();
      }
    };
    document.querySelector('#new-password').focus();
  };
  return true;
}
