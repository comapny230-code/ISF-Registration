#!/usr/bin/env node
/**
 * Booking invariants (spec §9.3 INV) after a load run. Exit 0 = all hold.
 *   APP_ENV=test|staging LOAD_DATABASE_URL=... PRODUCTION_DB_DENYLIST=... node scripts/load/check-invariants.mts
 */
import { connectLoadDatabase } from "./guard.mts";

const sql = await connectLoadDatabase(process.env).catch((err) => {
  console.error(`ERROR ${err.message}`);
  process.exit(2);
});

try {
  const [inv] = await sql`
    select
      (select count(*) from (select stall_id from booking.reservations where status in ('held','confirmed') group by stall_id having count(*) > 1) x)::int as duplicate_stall_claims,
      (select count(*) from (select team_id from booking.reservations where status in ('held','confirmed') group by team_id having count(*) > 1) x)::int as duplicate_team_claims,
      (select count(*) from booking.reservations where status in ('confirmed','cancelled') and (booking_id is null or booking_ref is null))::int as bookings_without_ids,
      (select count(*) from booking.reservations r join booking.stalls s on s.id = r.stall_id
        where r.status = 'held' and r.expires_at > clock_timestamp() and not s.bookable)::int as live_holds_on_unbookable,
      (select count(*) from booking.reservations r where not exists
        (select 1 from booking.audit_events a where a.reservation_id = r.id and a.action = 'hold_created'))::int as missing_hold_created,
      (select count(*) from booking.reservations r where r.status in ('confirmed','cancelled') and not exists
        (select 1 from booking.audit_events a where a.reservation_id = r.id and a.action = 'booking_confirmed'))::int as missing_booking_confirmed,
      (select count(*) from booking.audit_events where jsonb_typeof(details) <> 'object')::int as non_object_audit_details`;
  const [totals] = await sql`
    select count(*) filter (where status = 'confirmed')::int as confirmed,
           count(*) filter (where status = 'held')::int as held,
           count(*)::int as reservations
      from booking.reservations`;
  console.log(JSON.stringify({ invariants: inv, totals }));
  const violations = Object.values(inv).reduce((a: number, b) => a + Number(b), 0);
  console.log(violations === 0 ? "INVARIANTS HOLD" : `INVARIANTS VIOLATED (${violations})`);
  process.exitCode = violations === 0 ? 0 : 1;
} finally {
  await sql.end();
}
