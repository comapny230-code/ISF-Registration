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

  const cookie = (await headers()).get("cookie") ?? "";
  const session = await getSession(await getDb(), new Request("http://internal/book-your-stall", { headers: { cookie } }), "leader");
  if (!session) redirect("/login?next=/book-your-stall");

  return <BookingApp displayName={session.displayName} />;
}
