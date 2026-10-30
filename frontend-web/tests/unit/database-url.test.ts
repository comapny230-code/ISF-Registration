/**
 * DB-URL: Vercel functions have no IPv6, so a direct Supabase host (db.<ref>.supabase.co) is
 * rewritten to the IPv4 transaction pooler; pooler URLs are left alone apart from sslmode.
 * Credentials here are fake.
 */
import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "@/lib/config";

describe("DB-URL resolveDatabaseUrl", () => {
  it("rewrites a direct host to the regional pooler with the project-qualified user", () => {
    expect(resolveDatabaseUrl("postgresql://postgres:fake@db.abcdefgh.supabase.co:5432/postgres", { SUPABASE_REGION: "ap-southeast-1" })).toBe(
      "postgresql://postgres.abcdefgh:fake@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require"
    );
  });

  it("keeps a pooler URL and only adds sslmode when missing", () => {
    const pooler = "postgresql://postgres.abcdefgh:fake@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
    expect(resolveDatabaseUrl(pooler, {})).toBe(`${pooler}?sslmode=require`);
    expect(resolveDatabaseUrl(`${pooler}?sslmode=verify-full`, {})).toBe(`${pooler}?sslmode=verify-full`);
  });

  it("leaves other hosts untouched", () => {
    expect(resolveDatabaseUrl("postgresql://u:p@localhost:5432/isf", {})).toBe("postgresql://u:p@localhost:5432/isf");
  });
});
