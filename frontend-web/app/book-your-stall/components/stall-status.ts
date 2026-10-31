import type { SnapshotStall } from "@/lib/booking/client-api";

export function stallLabel(stall: SnapshotStall): string {
  if (stall.heldByYou) return "Held by you";
  if (stall.bookingRef) return "Your booking";
  switch (stall.status) {
    case "available":
      return "Available";
    case "held":
      return "Held by another team";
    case "booked":
      return "Booked";
    default:
      return "Unavailable";
  }
}

/** Text mark shown with the colour so status never depends on colour alone. */
export function stallMark(stall: SnapshotStall): string {
  if (stall.heldByYou) return "★";
  if (stall.status === "booked") return "✓";
  if (stall.status === "held") return "…";
  if (stall.status === "unavailable") return "×";
  return "";
}

export function hasGeometry(stall: SnapshotStall): boolean {
  return typeof stall.x === "number" && typeof stall.y === "number";
}

const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export function formatIst(iso: string | null): string {
  return iso ? `${IST.format(new Date(iso))} IST` : "a time to be announced";
}
