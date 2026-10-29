/**
 * Conservative single-address check used before any address reaches the mailer.
 *
 * Rejects quotes, angle brackets, commas, semicolons, parentheses and whitespace,
 * which are what the nodemailer address-parser advisories (GHSA-8c8m-p3m8-cjg8,
 * GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h, GHSA-g73g-hqqh-jr95) rely on to turn
 * display text into extra recipients. Ordinary addresses are unaffected.
 */
const SAFE_ADDRESS = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+$/;

export function isSafeEmailAddress(value: string): boolean {
  return value.length <= 254 && SAFE_ADDRESS.test(value);
}
