/**
 * CFG-02: application code must not read process.env outside the config module
 * (so no inline fallbacks can reappear) and must not contain credential-shaped literals.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const scanned = ["app", "lib"];
const envReadersAllowed = new Set([path.join("lib", "config.ts")]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const files = scanned.flatMap((d) => sourceFiles(path.join(root, d)));

describe("CFG-02 no secret fallbacks", () => {
  it("scans a non-empty set of files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("only lib/config.ts reads process.env (lib/safety guard takes env as a parameter)", () => {
    const offenders = files
      .filter((f) => !envReadersAllowed.has(path.relative(root, f)))
      .filter((f) => !path.relative(root, f).startsWith(path.join("lib", "safety")))
      .filter((f) => /process\.env\./.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });

  it("contains no credential-shaped literals", () => {
    const patterns = [
      /postgres(ql)?:\/\/[^:\s"'`]+:[^@\s"'`<\[]{6,}@(?!localhost)/i, // URL with an inline password
      /private_[A-Za-z0-9+/=]{16,}/, // ImageKit private key
      /["'][a-z]{16}["']\s*\)\s*\.replace\(/, // Gmail app-password fallback shape
    ];
    const offenders = files.filter((f) => patterns.some((p) => p.test(readFileSync(f, "utf8"))));
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });
});
