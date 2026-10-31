import { getCaptchaConfig } from "@/lib/config";
import { handler, json } from "@/lib/http";
import { issueFormToken } from "@/lib/registration/form-guard";

export const dynamic = "force-dynamic";

/** A signed timestamp for the registration form (minimum fill time), and the public CAPTCHA site key if enabled. */
export const GET = handler(async (_request, { requestId }) =>
  json({ token: issueFormToken(), captchaSiteKey: getCaptchaConfig().siteKey }, 200, requestId)
);
