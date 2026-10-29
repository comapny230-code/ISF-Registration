-- 0007: bind each sign-in code to the browser that requested it.
--
-- Without this, anyone who knew a leader's email could burn the leader's live code with
-- five wrong guesses, or cancel it by requesting a new one, and so keep a rival team from
-- signing in while booking opens. The request now sets a random HttpOnly cookie; only its
-- SHA-256 is stored here. Verification considers only challenges whose binding matches the
-- caller's cookie, and a new request supersedes only that browser's earlier challenge.
--
-- Additive. Rows without a binding (codes issued before this migration, at most 15 minutes
-- old) can no longer be used; the person simply requests a new code.

alter table app_auth.login_challenges add column binding_hash bytea
  check (binding_hash is null or octet_length(binding_hash) = 32);

create index login_challenges_binding_ix on app_auth.login_challenges (audience, email, binding_hash, created_at desc)
  where consumed_at is null and superseded_at is null;
