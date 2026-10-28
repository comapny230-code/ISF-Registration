import { revokeSessionToken, SESSION_COOKIE, sessionTokenFrom } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { assertSameOriginJson, clearedCookie, handler, noContent, readJsonObject, strict, v } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = handler(async (request, { requestId }) => {
  assertSameOriginJson(request);
  const { audience } = strict(await readJsonObject(request), { audience: v.oneOf("leader", "admin") });

  const token = sessionTokenFrom(request, audience);
  if (token) await revokeSessionToken(await getDb(), token, "logout");

  return noContent(requestId, { "Set-Cookie": clearedCookie(SESSION_COOKIE[audience]) });
});
