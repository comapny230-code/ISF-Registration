# Runbook: set up outgoing email (blocker B-06, launch gate LG-06)

Registration codes, sign-in codes and booking confirmations are emailed. **Without working email in staging and production, nobody can register or sign in.** Local and test runs never send real mail (`MAIL_TRANSPORT=log`, or SMTP to a local mail catcher only).

**Who:** the organisers choose the provider and sending address; [INFRA] holds the credentials.

## 1. Choose a sender

| Option | Use when | Limits |
|---|---|---|
| A transactional provider (e.g. Resend, Brevo, Amazon SES) with your own domain | Recommended for the event | High volume, good deliverability, needs DNS records |
| A Google Workspace or Gmail account over SMTP | Short-term or staging | About 500 recipients a day (Gmail), more likely to land in spam |

**Never reuse the leaked Gmail app password** from the repository history (spec §8.1). Revoke it first.

## 2. Domain records (for a provider with your own domain)

In your DNS, add the records the provider shows:
- **SPF:** allows the provider to send for your domain.
- **DKIM:** signs your mail.
- **DMARC:** start with `p=none` and a reporting address, then tighten.

Wait until the provider shows the domain as verified.

## 3. Settings (Vercel environment variables, never in git)

| Variable | Value |
|---|---|
| `MAIL_TRANSPORT` | `smtp` |
| `SMTP_HOST`, `SMTP_PORT` | From the provider. **Port 465** = TLS from the start; **587 or 2525** = STARTTLS, which the app *requires* in staging/production: it refuses to sign in over an unencrypted connection. Any other port is rejected at startup. |
| `SMTP_USER`, `SMTP_PASS` | From the provider (a Gmail **app password**, not the account password; spaces are removed automatically) |
| `NOTIFY_EMAIL_FROM` | e.g. `ISF Startup Jathara <no-reply@your-domain>` (must be a verified sender) |
| `NOTIFY_REPLY_TO` | An inbox the organisers read (recommended; preflight warns if unset) |
| `MAIL_RECIPIENT_ALLOWLIST` | **Staging only:** the test inboxes, e.g. `you@gmail.com,@your-domain`. Must be **unset** in production (startup fails otherwise). |

SMTP settings of common providers (check the provider's current documentation; these change rarely):

| Provider | `SMTP_HOST` | `SMTP_PORT` | `SMTP_USER` | `SMTP_PASS` |
|---|---|---|---|---|
| Resend | `smtp.resend.com` | 465 | `resend` | an API key with sending access |
| Brevo | `smtp-relay.brevo.com` | 587 | your SMTP login (Brevo → SMTP & API) | an SMTP key |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | 465 or 587 | SMTP user name (SES → SMTP settings) | SMTP password (not the IAM secret key) |
| Gmail (stopgap) | `smtp.gmail.com` | 465 | the Gmail address | a **new** app password |

How the app sends: one connection per message, certificates always verified, TLS 1.2 or newer, 15-20 s timeouts. A temporary failure (4xx reply, dropped connection) is retried **once** after one second; permanent rejections (5xx, wrong password) are not retried. Errors are logged as `[DEFERRED TASK ERROR]` / `[REGISTRATION EMAIL ERROR]` with the server's code and message, never the password.

## 4. Check before deploying

On a trusted machine, with the staging settings loaded into the shell's environment (not committed):

```
cd frontend-web
npm run preflight                                         # all settings valid? (names only, never values)
npm run mail:check                                        # connects and signs in; sends nothing
npm run mail:check -- --dns --dkim-selector <selector>    # SPF, DMARC and DKIM of the sender domain (read-only lookups)
npm run mail:check -- --send-to you@gmail.com             # also sends one test email (must be on the allowlist outside production)
```

The DKIM selector is the first label of the DKIM record the provider asked you to add (`<selector>._domainkey.your-domain`, e.g. `resend` for Resend). Expected output:

```
OK  connected and signed in to smtp.<provider>:465 (TLS)
OK    SPF your-domain: v=spf1 include:… ~all
OK    DMARC _dmarc.your-domain: v=DMARC1; p=none; rua=mailto:…
OK    DKIM <selector>._domainkey.your-domain: public key published
OK  test message handed to the mail server for you@gmail.com; check that inbox (and spam)
```

In the received message, use "Show original" (Gmail) to confirm `SPF: PASS`, `DKIM: PASS` and `DMARC: PASS`. Exit code 1 means a check failed and 2 means a setting is missing or invalid. A sender on `gmail.com` fails the DNS check on purpose: it cannot be authenticated for your own domain.

Then, on the **staging deployment**, register with an allowlisted address and sign in once. Both codes must arrive within a minute.

## 5. After go-live

Watch the provider's bounce and complaint figures for the first days, and the app logs for `[MAIL]` and `[DEFERRED TASK ERROR]` lines.
