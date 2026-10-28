import type { Metadata } from "next";
import { safeNextPath } from "@/lib/safe-redirect";
import { SignInForm } from "../../login/sign-in-form";

export const metadata: Metadata = {
  title: "Administrator sign-in · ISF Startup Jathara",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const target = safeNextPath(Array.isArray(next) ? next[0] : next, "/admin");
  return (
    <SignInForm
      audience="admin"
      title="Administrator sign-in"
      intro="For event organisers only. A one-time code will be emailed to your administrator address."
      next={target}
      nextLabel="Continue to administration"
    />
  );
}
