import { afterResponse } from "@/lib/after-response";
import { findPrincipal, issueLoginCode, sendLoginCodeEmail } from "@/lib/auth/otp";
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

  const principal = await findPrincipal(sql, body.audience, body.email);
  if (principal) {
    const code = await issueLoginCode(sql, body.audience, body.email, principal);
    await afterResponse(() => sendLoginCodeEmail(body.email, code, body.audience));
  }

  return json({ message: ACCEPTED }, 202, requestId);
});
