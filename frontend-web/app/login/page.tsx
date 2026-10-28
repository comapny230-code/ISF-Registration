import type { Metadata } from "next";
import { safeNextPath } from "@/lib/safe-redirect";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Team leader sign-in · ISF Startup Jathara" };

export default async function LeaderLoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const target = safeNextPath(Array.isArray(next) ? next[0] : next);
  return (
    <SignInForm
      audience="leader"
      title="Team leader sign-in"
      intro="Only the registered team leader can sign in. We will email a one-time code to the address used for registration."
      next={target}
      nextLabel={target === "/book-your-stall" ? "Continue to stall booking" : "Continue"}
    />
  );
}
