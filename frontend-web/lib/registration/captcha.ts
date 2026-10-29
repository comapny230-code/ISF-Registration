/**
 * Optional Cloudflare Turnstile check on registration. Off unless TURNSTILE_SECRET_KEY and
 * TURNSTILE_SITE_KEY are set (lib/config.ts). When on, a registration needs a token that
 * Cloudflare confirms; when Cloudflare cannot be reached, registration is refused (503)
 * rather than let through.
 */
import { getCaptchaConfig } from "../config";
import { HttpError } from "../http";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type Env = Record<string, string | undefined>;

export function captchaEnabled(env?: Env): boolean {
  return Boolean(getCaptchaConfig(env).secretKey);
}

export async function checkCaptcha(
  token: unknown,
  remoteIp: string,
  { env, fetchImpl = fetch }: { env?: Env; fetchImpl?: typeof fetch } = {}
): Promise<void> {
  const { secretKey } = getCaptchaConfig(env);
  if (!secretKey) return;
  const failed = () => new HttpError(400, "CAPTCHA_FAILED", "Please complete the human check above the submit button and submit again.");
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) throw failed();

  let success = false;
  try {
    const res = await fetchImpl(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: secretKey, response: token, ...(remoteIp && remoteIp !== "unknown" ? { remoteip: remoteIp } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    success = res.ok && (await res.json())?.success === true;
  } catch {
    throw new HttpError(503, "CAPTCHA_UNAVAILABLE", "The human check could not be completed right now. Please try again in a moment.");
  }
  if (!success) throw failed();
}
