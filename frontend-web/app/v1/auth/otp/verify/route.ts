import { verifyCodeAndStartSession } from "@/lib/auth/otp";
import { consumeRateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { SESSION_COOKIE, sessionTokenFrom } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  assertSameOriginJson,
  clientAddress,
  handler,
  HttpError,
  json,
  readJsonObject,
  sessionCookie,
  strict,
  v,
} from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = handler(async (request, { requestId }) => {
  assertSameOriginJson(request);
  const body = strict(await readJsonObject(request), {
    email: v.email,
    audience: v.oneOf("leader", "admin"),
    code: v.pattern(/^\d{6}$/),
  });

  const sql = await getDb();
  await consumeRateLimit(sql, LIMITS.otpVerifyPerIp, clientAddress(request));

  const login = await verifyCodeAndStartSession(
    sql,
    body.audience,
    body.email,
    body.code,
    sessionTokenFrom(request, body.audience)
  );
  if (!login) {
    throw new HttpError(400, "INVALID_OR_EXPIRED_CODE", "The code is invalid or has expired. Request a new code and try again.");
  }

  return json(
    { principal: { type: body.audience, displayName: login.displayName }, sessionExpiresAt: login.absoluteExpiresAt },
    200,
    requestId,
    { "Set-Cookie": sessionCookie(SESSION_COOKIE[body.audience], login.token, login.maxAgeSeconds) }
  );
});
