import type { Metadata } from "next";
import { safeNextPath } from "@/lib/safe-redirect";
import { AdminLoginForm } from "./admin-login-form";

export const metadata: Metadata = {
  title: "Administrator sign-in · ISF Startup Jathara",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const target = safeNextPath(Array.isArray(next) ? next[0] : next, "/admin");
  return <AdminLoginForm next={target} />;
}
