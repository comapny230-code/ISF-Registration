import { getCaptchaConfig, getFeatureFlags } from "@/lib/config";
import { handler, json } from "@/lib/http";
import { issueFormToken, REGISTRATION_PAUSED_MESSAGE } from "@/lib/registration/form-guard";

export const dynamic = "force-dynamic";

/**
 * A signed timestamp for the registration form (minimum fill time), and the public CAPTCHA site
 * key if enabled. While registration is paused (REGISTRATION_OPEN), only says so, so the page
 * can show a notice instead of the form.
 */
export const GET = handler(async (_request, { requestId }) => {
  if (!getFeatureFlags().registrationOpen) {
    return json({ registrationOpen: false, message: REGISTRATION_PAUSED_MESSAGE }, 200, requestId);
  }
  return json({ registrationOpen: true, token: issueFormToken(), captchaSiteKey: getCaptchaConfig().siteKey }, 200, requestId);
});
