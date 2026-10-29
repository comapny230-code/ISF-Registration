/** MAIL-02: sender-domain DNS checks used by `npm run mail:check -- --dns` (no real DNS lookups). */
import { describe, expect, it } from "vitest";
import { checkSenderDns, senderDomain, type DnsResolver } from "@/lib/mail-dns";

function resolver(txt: Record<string, string[]>, cname: Record<string, string> = {}): DnsResolver {
  return {
    async resolveTxt(name) {
      if (!(name in txt)) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
      return txt[name].map((r) => [r]);
    },
    async resolveCname(name) {
      if (!(name in cname)) throw Object.assign(new Error("not found"), { code: "ENODATA" });
      return [cname[name]];
    },
  };
}

const FROM = '"ISF · Startup Jathara 2026" <no-reply@mail.isf.example>';

describe("MAIL-02 sender DNS", () => {
  it("takes the domain from a display-name sender or a bare address", () => {
    expect(senderDomain(FROM)).toBe("mail.isf.example");
    expect(senderDomain("no-reply@ISF.example")).toBe("isf.example");
    expect(senderDomain("no address")).toBeNull();
  });

  it("passes with one SPF, one DMARC and a DKIM key or provider CNAME", async () => {
    const r = resolver(
      {
        "mail.isf.example": ["google-site-verification=x", "v=spf1 include:amazonses.com ~all"],
        "_dmarc.mail.isf.example": ["v=DMARC1; p=none; rua=mailto:dmarc@isf.example"],
        "k1._domainkey.mail.isf.example": ["v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA"],
      },
      { "s2._domainkey.mail.isf.example": "s2.domainkey.u1.provider.example" }
    );
    expect((await checkSenderDns(FROM, { resolver: r, dkimSelector: "k1" })).every((c) => c.ok)).toBe(true);
    const viaCname = await checkSenderDns(FROM, { resolver: r, dkimSelector: "s2" });
    expect(viaCname.at(-1)).toMatchObject({ ok: true, detail: expect.stringContaining("CNAME") });
  });

  it("fails on missing records, duplicate SPF, and a consumer mailbox domain", async () => {
    const missing = await checkSenderDns(FROM, { resolver: resolver({}), dkimSelector: "k1" });
    expect(missing.map((c) => c.ok)).toEqual([false, false, false]);

    const duplicate = await checkSenderDns(FROM, {
      resolver: resolver({ "mail.isf.example": ["v=spf1 include:a.example ~all", "v=spf1 include:b.example ~all"], "_dmarc.mail.isf.example": ["v=DMARC1; p=none"] }),
    });
    expect(duplicate[0]).toMatchObject({ ok: false, detail: expect.stringContaining("more than one") });
    expect(duplicate[1].ok).toBe(true);

    const gmail = await checkSenderDns("ISF <isf.events@gmail.com>", { resolver: resolver({}) });
    expect(gmail).toEqual([expect.objectContaining({ ok: false, detail: expect.stringContaining("consumer mailbox") })]);
  });
});
