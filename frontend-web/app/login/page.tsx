import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Team leader sign-in · ISF Startup Jathara" };

export default function LeaderLoginPage() {
  return (
    <SignInForm
      audience="leader"
      title="Team leader sign-in"
      intro="Only the registered team leader can sign in. We will email a one-time code to the address used for registration."
      next="/"
      nextLabel="Continue"
    />
  );
}
