import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { adminPermissions } from "@/lib/auth/guards";
import { getSession } from "@/lib/auth/session";
import { getFeatureFlags } from "@/lib/config";
import { getDb } from "@/lib/db";
import { AdminApp } from "./admin-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Stall booking administration · ISF Startup Jathara",
  robots: { index: false, follow: false },
};

/** Navigation gate only: every admin API authorises (and step-up checks) independently. */
export default async function AdminPage() {
  if (!getFeatureFlags().bookingUi) notFound();
  const sql = await getDb();
  const cookie = (await headers()).get("cookie") ?? "";
  const session = await getSession(sql, new Request("http://internal/admin", { headers: { cookie } }), "admin");
  if (!session) redirect("/admin/login?next=/admin");

  const [admin] = await sql`select email from app_auth.admin_users where id = ${session.principalId}`;
  return <AdminApp displayName={session.displayName} adminEmail={admin.email} permissions={await adminPermissions(sql, session.principalId)} />;
}
