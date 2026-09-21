// Server-only building block. Never import this module into the browser app.
// Call only after verifying the auth hook and resolving an authorized identity.
const endpoint = 'https://api.emailjs.com/api/v1.0/email/send';

function safeEmail(value) {
  if (typeof value !== 'string' || value.length > 254 ||
      !/^[^\s<>(),;:"\\]+@[^\s<>(),;:"\\]+\.[^\s<>(),;:"\\]+$/.test(value)) {
    throw new Error('Invalid recipient');
  }
  return value;
}
function trustedUrl(value, allowedOrigins) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid access URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || !allowedOrigins.includes(url.origin)) {
    throw new Error('Untrusted access URL');
  }
  return url.href;
}
export function buildAccessMessage({kind, recipient, actionUrl, appOrigin, authOrigin}) {
  const app = new URL(appOrigin);
  const auth = new URL(authOrigin);
  if (app.protocol !== 'https:' || auth.protocol !== 'https:' ||
      app.href !== `${app.origin}/` || auth.href !== `${auth.origin}/`) {
    throw new Error('Configure exact HTTPS origins');
  }
  const invitation = kind === 'invitation';
  if (!invitation && kind !== 'password_reset') throw new Error('Unsupported access message');
  return {
    to_email: safeEmail(recipient),
    subject: invitation ? 'Create your LVAEP Demo account' : 'Reset your LVAEP Demo password',
    heading: invitation ? 'Your tutoring workspace is ready' : 'Choose a new password',
    message: invitation
      ? 'You have been invited to the LVAEP student demonstration. Open the link below and choose your password.'
      : 'A password reset was requested for your LVAEP Demo account. If you did not request it, you can ignore this email.',
    action_url: trustedUrl(actionUrl, [app.origin, auth.origin]),
    action_label: invitation ? 'Create account' : 'Reset password',
    instructions: invitation
      ? 'After setup, sign in using your email and password. This is a student demonstration, not an official LVAEP service.'
      : 'This link is time limited. Your password will change only after you complete the reset.',
    recovery_url: `${app.origin}/${invitation ? 'setup-recovery' : 'password-recovery'}`,
    recovery_label: invitation ? 'Request a new setup link' : 'Request a new password-reset link'
  };
}

export function buildEmailJsRequest(config, message) {
  for (const name of ['serviceId', 'templateId', 'publicKey', 'privateKey']) {
    if (typeof config[name] !== 'string' || !config[name].trim()) throw new Error(`Missing email configuration: ${name}`);
  }
  const required = ['to_email','subject','heading','message','action_url','action_label','instructions','recovery_url','recovery_label'];
  if (Object.keys(message).length !== required.length || required.some(name => typeof message[name] !== 'string' || !message[name])) {
    throw new Error('Invalid email template parameters');
  }
  safeEmail(message.to_email);
  if (/[\r\n]/.test(message.subject)) throw new Error('Invalid email subject');
  return {
    service_id: config.serviceId,
    template_id: config.templateId,
    user_id: config.publicKey,
    accessToken: config.privateKey,
    template_params: {...message}
  };
}

// No automatic retry: a lost response may follow successful provider acceptance.
// A future durable dispatcher must persist intent and reconcile unknown outcomes.
// Transport is mandatory to avoid accidental network calls in tests/previews.
export async function dispatchAccessMail(config, message, transport) {
  const payload = buildEmailJsRequest(config, message);
  if (typeof transport !== 'function') throw new Error('Server transport required');
  try {
    const response = await transport(endpoint, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify(payload)
    });
    if (response.status === 200) return {state:'accepted'};
    if (response.status >= 400 && response.status < 500) return {state:'rejected',status:response.status};
    return {state:'unknown',status:response.status};
  } catch {
    // Do not return provider bodies/exceptions that could expose keys or access links.
    return {state:'unknown'};
  }
}
