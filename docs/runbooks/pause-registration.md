# Runbook: pause or reopen registration

**Who:** whoever manages the Vercel project ([INFRA]), on the organisers' decision.
**Switch:** the environment variable `REGISTRATION_OPEN`. Registration is open **only** when it is exactly `true`; unset, `false` or anything else pauses it. A typo therefore pauses rather than opens.

## What "paused" does

| Part | While paused |
|---|---|
| `/register` page | Shows "Registration is paused" instead of the form |
| Registration submissions (`POST /v1/auth/register`, `/v1/public/signup`) | `503 REGISTRATION_PAUSED` with `Retry-After: 3600`, before any database work |
| Registration email codes (`POST /v1/auth/register/email-code`, feature branch) | `503`, and no email is sent |
| Status for the page | `GET /v1/registration/status` (hotfix on `main`) or `GET /v1/auth/register/form-token` (feature branch) reports `registrationOpen: false` |
| Existing registrations, sign-in, booking, admin | Unaffected |

A form a visitor opened before the pause cannot be submitted after it.

## Pause

1. Vercel → Project → Settings → Environment Variables → `REGISTRATION_OPEN` = `false` for **Production** (and Preview).
2. Deployments → latest production deployment → **Redeploy** (environment changes apply only to new deployments).
3. Check: `curl -s https://<site>/v1/registration/status` returns `{"registrationOpen":false}`, and `/register` shows the notice.

The code that reads this switch must be deployed first: `hotfix/pause-registration` for the current site, or the `feature/book-your-stall` release later. Code without it ignores the variable.

## Reopen

Only after the launch gates in `docs/release/LAUNCH_EVIDENCE.md` allow it: set `REGISTRATION_OPEN` = `true`, redeploy, and register once with a test address.
