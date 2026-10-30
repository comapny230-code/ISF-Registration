-- 0012: remove the starter/test stalls that reset_database.sql (commit 3372dc1, "Starter bookable
-- stalls for manual testing") put into the live project as 'approved', and return the zones it
-- marked 'approved' to 'provisional'. Nothing in them was approved by the organisers
-- (docs/inventory/README.md); confirmed by the read-only inspection on 2026-10-30.
--
-- Why delete rather than retire: stalls_guard forbids approved -> provisional, and a retired row
-- keeps its code (PG-A01, BB-A01, AG-A01, ...), which the real inventory uses. The activation
-- migration only upgrades 'provisional' rows, so a leftover 'approved' starter row would keep its
-- invented position while passing activation's final check.
--
-- Scope: only stalls with source_ref = 'starter', and only zones with source_ref = 'master' (the
-- reset script's) that have no other approved stall. A no-op on a database built from the
-- migrations. Refuses to run if any starter stall has a reservation or an audit entry.

do $$
declare
  referenced int;
begin
  select count(*) into referenced
    from booking.stalls s
   where s.source_ref = 'starter'
     and (exists (select 1 from booking.reservations r where r.stall_id = s.id)
       or exists (select 1 from booking.audit_events a where a.stall_id = s.id));
  if referenced > 0 then
    raise exception '0012 refused: % starter stall(s) have reservations or audit entries; resolve them first', referenced;
  end if;
end
$$;

delete from booking.stalls where source_ref = 'starter';

update booking.zones z
   set inventory_status = 'provisional'
 where z.source_ref = 'master'
   and z.inventory_status = 'approved'
   and not exists (
         select 1 from booking.stalls s
          where s.zone_id = z.id and s.inventory_status = 'approved');

do $$
begin
  if exists (select 1 from booking.stalls where source_ref = 'starter') then
    raise exception '0012: starter stalls remain';
  end if;
end
$$;
