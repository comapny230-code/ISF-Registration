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
| `SMTP_HOST`, `SMTP_PORT` | From the provider (port 465 = TLS; 587 = STARTTLS) |
| `SMTP_USER`, `SMTP_PASS` | From the provider (a Gmail **app password**, not the account password) |
| `NOTIFY_EMAIL_FROM` | e.g. `ISF Startup Jathara <no-reply@your-domain>` (must be a verified sender) |
| `NOTIFY_REPLY_TO` | An inbox the organisers read (optional) |
| `MAIL_RECIPIENT_ALLOWLIST` | **Staging only:** the test inboxes, e.g. `you@gmail.com,@your-domain`. Must be **unset** in production. |

## 4. Check before deploying

On a trusted machine, with the staging settings loaded into the shell's environment (not committed):

```
cd frontend-web
npm run mail:check                                 # connects and signs in; sends nothing
npm run mail:check -- --send-to you@gmail.com      # also sends one test email (must be on the allowlist outside production)
```

Expected: `OK connected and signed in to …` and then `OK test message handed to the mail server …`. Check that the message arrives (including spam) and that its headers show SPF and DKIM `pass`. The script never prints `SMTP_PASS`; exit code 1 means the check failed, 2 means a setting is missing or invalid.

## 5. After go-live

Watch the provider's bounce and complaint figures for the first days, and the app logs for `[MAIL]` and `[DEFERRED TASK ERROR]` lines.
