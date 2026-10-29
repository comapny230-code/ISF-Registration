# Runbook: rotate the leaked credentials (launch gate LG-01)

**Who:** [INFRA], meaning the account owners of Supabase, Google (Gmail) and ImageKit. Developers never see the new values.
**Why:** the repository's git history is on GitHub (`comapny230-code/ISF-Registration`, `origin/main`) and contains working credentials. Deleting them from the current files does not help: anyone with a clone or a fork has them. **Treat every credential below as known to attackers until it is rotated.**

## What leaked (scan of 2026-10-29)

Scanned with gitleaks 8.21.2 (checksum-verified), using `.gitleaks.toml` plus the default ruleset, over every commit on every branch (`--log-opts=--all`), with a separate pattern sweep for Supabase, AWS, Resend, Brevo, SendGrid, GitHub, Turnstile and private-key formats (none found). Values were never printed. Each secret below is identified by the first 10 hex characters of the SHA-256 of its value, so you can confirm a match without anyone revealing it.

| # | Credential | Fingerprint | Where in history | First commit | Also used with |
|---|---|---|---|---|---|
| 1 | **Supabase database password** (user `postgres.<project ref>`, pooler hosts in ap-south-1, ap-southeast-1, ap-northeast-1) | `95b80a3bf9` | `frontend-web/app/v1/[...route]/route.ts` | `f4c9fdb` (2026-10-20), also `c07f69b`, `b765ba7` | **Two projects:** the connected project `ddrremsyzozutyxbxigf` **and a second project whose ref starts `wdes…`** |
| 2 | Gmail app password | `d71fad0e93` | `.env.example`, `frontend-web/.env.example`, `route.ts` | `86d8b81` (2026-10-20), also `c07f69b` | |
| 3 | Gmail app password (a second one) | `3d1313d5f9` | `.env.example`, `route.ts` | `f4c9fdb` | |
| 4 | ImageKit private API key | `3d0ca935f0` | `.env.example`, `frontend-web/.env.example`, `route.ts` | `86d8b81`, also `c07f69b` | |
| 5 | ImageKit private API key (a second one) | `42bea7a9bd` | `route.ts` | `f4c9fdb` | |

Not leaked: Supabase API keys (anon/publishable, service_role/secret), access tokens, OTP pepper, rate-limit key, hold-token keys, Turnstile keys. Two other database URLs in history hold placeholders (`[YOUR-PASSWORD]`-style), not passwords.

**Current files are clean.** In the working tree (tracked, untracked and git-ignored files), the only matches are random preview keys that Next.js generates into the ignored `.next/` build folder, and example strings in `node_modules` documentation. There are no `.env` files with real values in the repository folder.

To check a fingerprint against a credential you hold (it prints only the hash):
```bash
printf %s '<the credential, spaces removed>' | sha256sum | cut -c1-10
```

## Order

Do these in one sitting, in this order. Each step lists the "old credential rejected" check that LG-01 needs as evidence.

### 1. Supabase database password: both projects

For **`ddrremsyzozutyxbxigf`** and for **the `wdes…` project** (find it in the Supabase dashboard project list; if nobody recognises it, rotate it anyway and ask Supabase support who owns it):

1. Dashboard → Project Settings → Database → **Reset database password**. Generate a long random password in a password manager. Never paste it into chat, git or tickets.
2. Update every place that uses it: Vercel environment variables (`DATABASE_URL`, and `MIGRATION_DATABASE_URL` wherever it is stored), the password manager, and any local env file on operators' machines.
3. Check for unknown sessions: Dashboard → Database → **Roles / connections**, or run read-only `select usename, client_addr, backend_start, application_name from pg_stat_activity where usename like 'postgres%';` and investigate addresses you do not recognise.
4. **Old credential rejected:** from a trusted machine, try to connect with the old URL (`psql "<old url>" -c 'select 1'`). Record "password authentication failed" with the date. Do not paste the URL anywhere.
5. Later, when `isf_app` exists (`database/roles/isf_app_grants.sql`), the app stops using the owner password entirely. The owner password should then live only in the password manager.

### 2. Gmail app passwords (both)

1. Sign in to the Google account that sent the registration mail → Security → **2-Step Verification → App passwords**. **Revoke every app password** listed (both leaked ones and any you cannot account for).
2. Security → **Your devices** and **Recent security activity**: sign out unknown sessions. Check Gmail → Settings → **Forwarding** and **Filters** for rules you did not create (attackers add forwarding).
3. If Gmail stays as a stopgap sender for staging, create **one** new app password and put it only in Vercel (`SMTP_PASS`). For the event itself, use a provider with your own domain (`docs/runbooks/email-provider.md`).
4. **Old credential rejected:** `APP_ENV=staging … SMTP_PASS='<old>' npm run mail:check` must fail with `EAUTH` / `535`. The script never prints the password.

### 3. ImageKit private keys (both)

1. ImageKit dashboard → Developer options → API keys: **generate a new private key**, then **delete or revoke the old ones**. Both fingerprints appear in history, so there may be two keys or two accounts. Check both.
2. Update `IMAGEKIT_PRIVATE_KEY` in Vercel.
3. Media library: look for files uploaded since 2026-10-20 that did not come from registrations (unknown names, very large files, unexpected folders) and delete them.
4. **Old credential rejected:** an authenticated API call with the old key (for example `curl -u '<old key>:' https://api.imagekit.io/v1/files?limit=1`) must return `401`.

### 4. GitHub

1. Repository → Settings → Code security → enable **Secret scanning** and **Push protection**.
2. Check **Insights → Forks** and the repository's visibility. If the repository is public, make it private unless it needs to be public; already-cloned copies still have the old secrets, which is why rotation comes first.
3. Rewriting history (`git filter-repo`) is **optional** and only worth doing after rotation. It needs a force-push to `main`, everyone re-cloning, and GitHub support to purge cached views. It does not remove the secrets from existing forks or clones.

### 5. Record the evidence

Add a dated, signed note to `docs/release/LAUNCH_EVIDENCE.md` (LG-01) with, for each of the 5 fingerprints: who rotated it, when, and the "old credential rejected" result. Never record the credentials themselves.

## Afterwards

- CI's `secret-scan` job (`.github/workflows/ci.yml`) scans the working tree and every pull request's new commits with the same rules.
- Before every release, run locally: `gitleaks dir . --config .gitleaks.toml --redact` and `gitleaks git . --config .gitleaks.toml --redact --log-opts="origin/main..HEAD"`.
