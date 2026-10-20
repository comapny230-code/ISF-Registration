/**
 * Utility functions for frontend-web
 */

export function normalizeLinkedInUrl(input: string): string {
  let val = (input || "").trim();
  if (!val) return "";

  // If already full protocol
  if (/^https?:\/\//i.test(val)) {
    return val;
  }

  // If protocol-relative //
  if (val.startsWith("//")) {
    return `https:${val}`;
  }

  // If starts with www. or linkedin.com or regional subdomain (e.g. in.linkedin.com)
  if (/^([a-z0-9-]+\.)?linkedin\.com/i.test(val)) {
    return `https://${val}`;
  }

  // If starts with in/
  if (/^in\/[a-zA-Z0-9_\-%\.]+/i.test(val)) {
    return `https://www.linkedin.com/${val}`;
  }

  // If general web domain
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(val)) {
    return `https://${val}`;
  }

  // If username / handle (e.g. amartya-sarangee-3351a8241 or @username)
  const cleanUsername = val.replace(/^@/, "");
  return `https://www.linkedin.com/in/${cleanUsername}`;
}
