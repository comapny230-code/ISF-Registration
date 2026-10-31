import { afterResponse } from "@/lib/after-response";
import { otpBindingCookie, otpBindingFor } from "@/lib/auth/otp";
import { consumeRateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { getDb } from "@/lib/db";
import { assertSameOriginJson, clientAddress, handler, HttpError, json, readJsonObject, strict, v } from "@/lib/http";
import { issueRegistrationCode, sendRegistrationCodeEmail } from "@/lib/registration/email-verification";

export const dynamic = "force-dynamic";

/**
 * Sends the registration email code. The code is bound to this browser (cookie), so it can
 * only be used by the form that asked for it.
 */
export const POST = handler(async (request, { requestId }) => {
  assertSameOriginJson(request);
  const { email } = strict(await readJsonObject(request), { email: v.email });

  const sql = await getDb();
  await consumeRateLimit(sql, LIMITS.registrationCodePerIp, clientAddress(request));
  await consumeRateLimit(sql, LIMITS.registrationCodePerEmail, email);
  await consumeRateLimit(sql, LIMITS.registrationCodePerEmailDaily, email);

  // Registration already answers 409 for these addresses; saying so now saves the form-filling.
  const [existing] = await sql`
    select exists (
      select 1 from user_accounts u
       where lower(u.email) = ${email}
         and (exists (select 1 from startup_team_leaders l where l.user_id = u.id)
           or exists (select 1 from student_innovators s where s.user_id = u.id))) as registered`;
  if (existing.registered) {
    throw new HttpError(409, "ALREADY_REGISTERED", "This email address is already registered. To book your stall, sign in instead.");
  }

  const binding = otpBindingFor(request);
  const code = await issueRegistrationCode(sql, email, binding);
  await afterResponse(() => sendRegistrationCodeEmail(email, code));
  return json({ message: "We have sent a 6-digit code to this email address." }, 202, requestId, { "Set-Cookie": otpBindingCookie(binding) });
});
