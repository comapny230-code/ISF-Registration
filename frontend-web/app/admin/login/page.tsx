import type { Metadata } from "next";
import { SignInForm } from "../../login/sign-in-form";

export const metadata: Metadata = {
  title: "Administrator sign-in · ISF Startup Jathara",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return (
    <SignInForm
      audience="admin"
      title="Administrator sign-in"
      intro="For event organisers only. A one-time code will be emailed to your administrator address."
      next="/"
      nextLabel="Continue"
    />
  );
}
