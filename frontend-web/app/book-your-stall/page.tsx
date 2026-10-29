import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getFeatureFlags } from "@/lib/config";
import { getDb } from "@/lib/db";
import { BookingApp } from "./booking-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Book your stall · ISF Startup Jathara" };

/**
 * Server-side gate: hidden unless FEATURE_BOOKING_UI=true, and leaders only.
 * This is navigation convenience; every booking API authorises independently.
 */
export default async function BookYourStallPage() {
  if (!getFeatureFlags().bookingUi) notFound();

  let displayName = "";
  try {
    const cookie = (await headers()).get("cookie") ?? "";
    if (cookie.includes("session=")) {
      const sql = await getDb();
      const session = await getSession(sql, new Request("http://internal/book-your-stall", { headers: { cookie } }), "leader");
      if (session) {
        displayName = session.displayName;
      }
    }
  } catch (err) {
    console.warn("Session check in BookYourStallPage:", err);
  }

  return <BookingApp displayName={displayName} />;
}
