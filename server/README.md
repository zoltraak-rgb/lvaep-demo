# Access email building block

`access-mail.js` builds invitation/reset template parameters and a server-authorized EmailJS request, based on the [official send API](https://www.emailjs.com/docs/rest-api/send/). It is not imported by the browser and has no public HTTP endpoint. Its transport must be supplied explicitly; tests supply a stub and send no emails.

Before production use, implement signature verification for the Supabase Send Email Hook, resolve recipients from trusted identities, validate provider-generated action links, and configure server secrets. Never pass arbitrary browser input to this module. `buildEmailJsRequest` validates the template contract but assumes URLs came from `buildAccessMessage`. Recovery page paths are reserved design targets, not implemented pages.

A 200 response means provider acceptance, not verified inbox delivery. Ambiguous network/5xx outcomes are marked unknown, never automatically retried. A durable outbox with appropriate deduplication and account-specific private-key enforcement checks is still required. This module does not solve exactly-once delivery on its own. Keep provider throughput within its documented one-request-per-second limit when implementing the dispatcher.

No live transport or credential configuration has been performed; browser approval is currently blocked by a usage-limit review failure. Do not use this module to bypass that block and send the pending test.
