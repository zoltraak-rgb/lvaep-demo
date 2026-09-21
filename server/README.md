# Access email building block

`access-mail.js` builds invitation/reset template parameters and a server-authorized EmailJS request, based on the [official send API](https://www.emailjs.com/docs/rest-api/send/). It is not imported by the browser and has no public HTTP endpoint. Its transport must be supplied explicitly; tests supply a stub and send no emails.

The local `auth-email-hook.js` verifies Standard Webhooks signatures (including timestamps), permits only invite/recovery events, ignores event redirects in favor of the configured site, and requires injected authorization, durable delivery storage, and sending adapters. Before production use, implement these adapters and configure server secrets. Never pass arbitrary browser input to this module. `buildEmailJsRequest` validates the template contract but assumes URLs came from `buildAccessMessage`. Recovery page paths are reserved design targets, not implemented pages.

A 200 response means provider acceptance, not verified inbox delivery. Ambiguous network/5xx outcomes are marked unknown, never automatically retried. A durable outbox with appropriate deduplication and account-specific private-key enforcement checks is still required. This module does not solve exactly-once delivery on its own. Keep provider throughput within its documented one-request-per-second limit when implementing the dispatcher.

No live transport or credential configuration has been performed. The user manually received two dashboard test emails; do not repeat that delivery test. Browser approval remains blocked by a usage-limit review failure; do not bypass it.

## Hook integration contract

Based on the [Supabase Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook), successful handling returns an empty JSON object. This Node-compatible handler is not yet deployed or packaged for Supabase Edge Functions. Do not enable it until the following dependencies exist:

- Server-owned invitation registry/current-account authorization; never trust user-editable metadata. Check revocation before each delivery, including replay.
- Atomic durable claim keyed by a digest of identity, recipient, action and token. Existing pending, unknown or rejected claims block retry; accepted claims acknowledge without resending. Failed completion writes leave the claim pending. The test Map is a fixture only.
- Dispatcher enforcing the provider rate limit, free quota and private-key configuration. No automatic retry of ambiguous outcomes.
- `/account-access` page consuming the fragment token only after explicit user action, plus functional setup/password recovery pages. The account-access page is implemented locally; replacement-link pages explicitly report that recovery is not connected. Do not send hook links until invitation authorization, activation/revocation, durable delivery and recovery are integrated and tested.

Tests use real signed fixtures and stub all delivery. They establish handler behavior, not durability of a production store, inbox delivery or full account recovery.

## Durable delivery ledger (migration 0002, local only)

`delivery-store.js` wraps service-role-only claim/finish RPCs. Migration 0002 stores hashed delivery keys and outcomes in the private schema, serializes reservations, and blocks pending/unknown/rejected replays. Completion is idempotent for an identical outcome. Ordinary browser roles cannot invoke either function or read the tables.

Sending defaults OFF with allowance zero. Before enabling, an operator must verify the provider's remaining free quota and configure a conservative allowance. Reservations consume allowance even on unknown/rejected outcomes; no automatic refill or refund occurs. Dashboard/manual sends must be accounted for separately. The one-second database reservation interval is not a guarantee about actual network start times when workers are delayed: production dispatch still needs serialized sends/rate-limit handling. Unknown outcomes need reconciliation, not blind retries. No live migration or provider call was made.
