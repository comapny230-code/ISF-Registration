import { afterResponse } from "@/lib/after-response";
import { findPrincipal, issueLoginCode, otpBindingCookie, otpBindingFor, sendLoginCodeEmail } from "@/lib/auth/otp";
import { consumeRateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { getDb } from "@/lib/db";
import { assertSameOriginJson, clientAddress, handler, json, readJsonObject, strict, v } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Identical for every address so the response never reveals whether an account exists. */
const ACCEPTED = "If this address belongs to an eligible account, a sign-in code has been sent.";

export const POST = handler(async (request, { requestId }) => {
  assertSameOriginJson(request);
  const body = strict(await readJsonObject(request), {
    email: v.email,
    audience: v.oneOf("leader", "admin"),
  });

  const sql = await getDb();
  await consumeRateLimit(sql, LIMITS.otpRequestPerIp, clientAddress(request));
  await consumeRateLimit(sql, LIMITS.otpRequestPerEmail, `${body.audience}:${body.email}`);
  await consumeRateLimit(sql, LIMITS.otpRequestPerEmailDaily, `${body.audience}:${body.email}`);

  // Every caller gets the binding cookie, so its presence says nothing about the account.
  const binding = otpBindingFor(request);
  const principal = await findPrincipal(sql, body.audience, body.email);
  if (principal) {
    const code = await issueLoginCode(sql, body.audience, body.email, principal, binding);
    try {
      await sendLoginCodeEmail(body.email, code, body.audience);
      console.log(`[OTP] Successfully dispatched sign-in code email to ${body.email} (${body.audience})`);
    } catch (mailErr) {
      console.error("[OTP MAIL ERROR] Failed to send email via SMTP:", mailErr);
    }
  } else {
    console.warn(`[OTP] Principal not found in database for ${body.email} (${body.audience})`);
  }

  return json({ message: ACCEPTED }, 202, requestId, { "Set-Cookie": otpBindingCookie(binding) });
});
