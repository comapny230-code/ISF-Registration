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
  const cookie = (await headers()).get("cookie") ?? "";
  let session = null;
  let adminEmail = "admin@startupjathara.com";
  let permissions: any[] = ["booking.cancel", "inventory.manage", "reports.view", "teams.manage"];
  let displayName = "Administrator";

  try {
    const sql = await getDb();
    session = await getSession(sql, new Request("http://internal/admin", { headers: { cookie } }), "admin");
    if (session) {
      displayName = session.displayName || displayName;
      const [admin] = await sql`select email from app_auth.admin_users where id = ${session.principalId}`.catch(() => [null]);
      if (admin?.email) adminEmail = admin.email;
      const perms = await adminPermissions(sql, session.principalId).catch(() => null);
      if (perms && perms.length > 0) permissions = perms;
    }
  } catch (err) {
    console.warn("[AdminPage] DB session check warning:", err);
  }

  if (!session) {
    redirect("/admin/login?next=/admin");
  }

  return <AdminApp displayName={displayName} adminEmail={adminEmail} permissions={permissions} />;
}
