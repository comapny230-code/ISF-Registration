import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";

describe("post-login redirect", () => {
  it("allows same-site paths only", () => {
    expect(safeNextPath("/book-your-stall")).toBe("/book-your-stall");
    expect(safeNextPath("/a?b=1#c")).toBe("/a?b=1#c");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/%0d\nx", "javascript:alert(1)", "", undefined, 5]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});
