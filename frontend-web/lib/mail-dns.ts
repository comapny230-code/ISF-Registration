/**
 * Read-only DNS checks for the sending domain (launch gate LG-06): SPF, DMARC and, when the
 * provider's selector is known, DKIM. Used by `npm run mail:check -- --dns`. Changes nothing.
 */
import { promises as dns } from "node:dns";

export interface DnsResolver {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
}

export interface DnsCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** The domain of NOTIFY_EMAIL_FROM, e.g. `"ISF" <no-reply@isf.example>` -> `isf.example`. */
export function senderDomain(from: string): string | null {
  const address = /<([^<>]+)>\s*$/.exec(from)?.[1] ?? from.trim();
  const at = address.lastIndexOf("@");
  if (at < 1) return null;
  const domain = address.slice(at + 1).toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null;
}

const CONSUMER_DOMAINS = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com"]);

async function txt(resolver: DnsResolver, name: string): Promise<string[]> {
  try {
    return (await resolver.resolveTxt(name)).map((parts) => parts.join(""));
  } catch (err: any) {
    if (err?.code === "ENODATA" || err?.code === "ENOTFOUND") return [];
    throw err;
  }
}

export async function checkSenderDns(from: string, options: { dkimSelector?: string; resolver?: DnsResolver } = {}): Promise<DnsCheck[]> {
  const resolver = options.resolver ?? dns;
  const domain = senderDomain(from);
  if (!domain) return [{ name: "sender domain", ok: false, detail: "NOTIFY_EMAIL_FROM has no usable domain" }];
  if (CONSUMER_DOMAINS.has(domain)) {
    return [{
      name: `sender domain ${domain}`,
      ok: false,
      detail: "a consumer mailbox domain: only usable through that provider's own SMTP, with low daily limits; use your own domain for the event",
    }];
  }

  const checks: DnsCheck[] = [];
  const spf = (await txt(resolver, domain)).filter((r) => /^v=spf1(\s|$)/i.test(r));
  checks.push(
    spf.length === 1
      ? { name: `SPF ${domain}`, ok: true, detail: spf[0] }
      : { name: `SPF ${domain}`, ok: false, detail: spf.length === 0 ? "no v=spf1 TXT record" : "more than one v=spf1 record (receivers treat this as an error)" }
  );

  const dmarc = (await txt(resolver, `_dmarc.${domain}`)).filter((r) => /^v=DMARC1(;|\s|$)/i.test(r));
  checks.push(
    dmarc.length === 1
      ? { name: `DMARC _dmarc.${domain}`, ok: true, detail: dmarc[0] }
      : { name: `DMARC _dmarc.${domain}`, ok: false, detail: dmarc.length === 0 ? "no v=DMARC1 TXT record" : "more than one v=DMARC1 record" }
  );

  if (options.dkimSelector) {
    const name = `${options.dkimSelector}._domainkey.${domain}`;
    const key = (await txt(resolver, name)).find((r) => /(^|;)\s*p=[A-Za-z0-9+/=]{20,}/.test(r));
    let cname: string | undefined;
    if (!key) {
      try {
        cname = (await resolver.resolveCname(name))[0];
      } catch {
        cname = undefined;
      }
    }
    checks.push(
      key
        ? { name: `DKIM ${name}`, ok: true, detail: "public key published" }
        : cname
          ? { name: `DKIM ${name}`, ok: true, detail: `CNAME to ${cname} (provider-hosted key)` }
          : { name: `DKIM ${name}`, ok: false, detail: "no DKIM key (TXT with p=...) or CNAME at this selector" }
    );
  }
  return checks;
}
