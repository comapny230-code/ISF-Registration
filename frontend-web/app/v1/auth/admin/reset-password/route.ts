import {
  findPrincipal,
  issueLoginCode,
  otpBindingCookie,
  otpBindingFor,
  otpBindingFrom,
  sendLoginCodeEmail,
} from "@/lib/auth/otp";
import { hashPassword } from "@/lib/auth/password";
import { consumeRateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { constantTimeEqual, hmac, sha256 } from "@/lib/auth/crypto";
import { getAuthConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import {
  assertSameOriginJson,
  clientAddress,
  handler,
  HttpError,
  json,
  readJsonObject,
  strict,
  v,
} from "@/lib/http";

export const dynamic = "force-dynamic";

function codeMac(challengeId: string, code: string): Buffer {
  return hmac(getAuthConfig().otpPepper, `${challengeId}:${code}`);
}

export const POST = handler(async (request, { requestId }) => {
  assertSameOriginJson(request);
  const rawBody = await readJsonObject(request);
  const action = String((rawBody as any)?.action || "request");

  const sql = await getDb();
  await consumeRateLimit(sql, LIMITS.otpRequestPerIp, clientAddress(request));

  if (action === "request") {
    const body = strict(rawBody, {
      action: v.string(1, 20),
      email: v.email,
    });
    const emailNorm = body.email.toLowerCase().trim();

    const principal = await findPrincipal(sql, "admin", emailNorm);
    if (!principal) {
      // Don't disclose whether admin email exists, return success message
      return json({ ok: true, message: "If an administrator account exists for this address, a reset code has been sent." }, 200, requestId);
    }

    const binding = otpBindingFor(request);
    const code = await issueLoginCode(sql, "admin", emailNorm, principal, binding);
    await sendLoginCodeEmail(emailNorm, code, "admin");

    return json(
      { ok: true, message: "If an administrator account exists for this address, a reset code has been sent." },
      200,
      requestId,
      [["Set-Cookie", otpBindingCookie(binding)]]
    );
  }

  if (action === "confirm") {
    const body = strict(rawBody, {
      action: v.string(1, 20),
      email: v.email,
      code: v.pattern(/^\d{6}$/),
      newPassword: v.string(12, 100),
    });
    const emailNorm = body.email.toLowerCase().trim();
    const binding = otpBindingFrom(request);

    if (!binding) {
      throw new HttpError(400, "INVALID_CHALLENGE", "No active password reset challenge found. Please request a new code.");
    }

    const bindingHash = sha256(binding);
    const newHash = hashPassword(body.newPassword);

    const updated = await sql.begin(async (tx) => {
      const [challenge] = await tx`
        update app_auth.login_challenges set attempts = attempts + 1
         where id = (
                 select id from app_auth.login_challenges
                  where audience = 'admin' and email = ${emailNorm} and binding_hash = ${bindingHash}
                    and consumed_at is null and superseded_at is null
                  order by created_at desc limit 1)
           and attempts < 5
           and expires_at > clock_timestamp()
           and consumed_at is null and superseded_at is null
        returning id, code_mac, admin_user_id`;

      if (!challenge) return false;
      if (!constantTimeEqual(Buffer.from(challenge.code_mac), codeMac(challenge.id, body.code))) return false;

      // Consume the challenge
      await tx`
        update app_auth.login_challenges set consumed_at = clock_timestamp()
         where id = ${challenge.id}`;

      // Update password hash for admin
      const res = await tx`
        update app_auth.admin_users
           set password_hash = ${newHash}
         where id = ${challenge.admin_user_id} and status = 'active'
        returning id`;

      return res.length === 1;
    });

    if (!updated) {
      throw new HttpError(400, "INVALID_CODE", "The verification code is invalid, expired, or has exceeded attempts. Please request a new code.");
    }

    return json({ ok: true, message: "Administrator password updated successfully! You can now sign in." }, 200, requestId);
  }

  throw new HttpError(400, "INVALID_ACTION", "Action must be 'request' or 'confirm'.");
});
