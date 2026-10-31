const postgres = require('postgres');
const url = process.env.DATABASE_URL || 'postgresql://postgres.ddrremsyzozutyxbxigf:B8o6kylXR1hbFk0G@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require';
const sql = postgres(url);

async function seed() {
  console.log('Connecting to database...');

  // 1. Ensure settings
  await sql`
    insert into booking.settings (
      edition_id, booking_enabled, opens_at, closes_at,
      hold_seconds, eligible_tracks, require_team_approval,
      rehold_cooldown_seconds, max_new_holds_per_hour, public_map, updated_by
    )
    values (
      2026, true, '2026-01-01 00:00:00+00', '2026-12-31 23:59:59+00',
      300, array['senior', 'junior']::text[], false, 600, 6, true, 'seed-script'
    )
    on conflict (edition_id) do update set
      booking_enabled = true,
      public_map = true,
      require_team_approval = false;
  `;
  console.log('Updated booking.settings');

  // 2. Retire AG zone if exists
  await sql`
    update booking.zones set inventory_status = 'retired' where edition_id = 2026 and code = 'AG';
  `;

  // 3. Upsert Zones PG and BB
  await sql`
    insert into booking.zones (edition_id, code, name, extent_width_ft, extent_depth_ft, landmarks, inventory_status, source_ref)
    values
      (2026, 'PG', 'Playground GIET University', 338, 402, '[{"label":"67 FT Stage","kind":"stage","x":2,"y":180,"w":14,"d":67},{"label":"FIELD ENTRY","kind":"entry","x":0,"y":250,"w":20,"d":15},{"label":"135 FT OPEN SPACE TOWARDS AGRICULTURE LAND","kind":"open_space","x":2,"y":270,"w":35,"d":125},{"label":"HELIPAD","kind":"restricted","x":220,"y":305,"w":105,"d":85}]'::jsonb, 'approved', 'pdf-map'),
      (2026, 'BB', 'Rang Manch / Basketball Ground', 101, 305, '[{"label":"RANG MANCH (101 FT)","kind":"stage","x":25,"y":0,"w":51,"d":18},{"label":"MECHANICAL ROAD 305 FT","kind":"road","x":2,"y":15,"w":10,"d":260},{"label":"ENTRY","kind":"entry","x":44,"y":18,"w":4,"d":260},{"label":"EXIT","kind":"exit","x":53,"y":18,"w":4,"d":260},{"label":"ISF STALL","kind":"reserved","x":12,"y":265,"w":30,"d":18},{"label":"MEETING ROOM","kind":"reserved","x":52,"y":265,"w":45,"d":18},{"label":"BUS-STAND ROAD 101 FT","kind":"road","x":0,"y":286,"w":101,"d":19}]'::jsonb, 'approved', 'pdf-map')
    on conflict (edition_id, code) do update set
      name = excluded.name,
      extent_width_ft = excluded.extent_width_ft,
      extent_depth_ft = excluded.extent_depth_ft,
      landmarks = excluded.landmarks,
      inventory_status = 'approved';
  `;
  console.log('Upserted booking.zones (PG and BB)');

  // 4. Stalls PG: 30 horizontal (A01..A30) + 18 vertical (B01..B18)
  await sql`
    insert into booking.stalls (edition_id, zone_id, code, width_ft, depth_ft, x_ft, y_ft, rotation_deg, inventory_status, source_ref)
    select 2026, z.id, 'PG-A' || to_char(i, 'FM00'), 10, 10, 16 + (i - 1) * 10, 0, 0, 'approved', 'pdf-map'
    from booking.zones z, generate_series(1, 30) as i
    where z.code = 'PG' and z.edition_id = 2026
    on conflict (edition_id, code) do update set
      x_ft = excluded.x_ft,
      y_ft = excluded.y_ft,
      width_ft = excluded.width_ft,
      depth_ft = excluded.depth_ft,
      rotation_deg = 0,
      inventory_status = 'approved';
  `;

  await sql`
    insert into booking.stalls (edition_id, zone_id, code, width_ft, depth_ft, x_ft, y_ft, rotation_deg, inventory_status, source_ref)
    select 2026, z.id, 'PG-B' || to_char(i, 'FM00'), 10, 10, 6, (i - 1) * 10, 0, 'approved', 'pdf-map'
    from booking.zones z, generate_series(1, 18) as i
    where z.code = 'PG' and z.edition_id = 2026
    on conflict (edition_id, code) do update set
      x_ft = excluded.x_ft,
      y_ft = excluded.y_ft,
      width_ft = excluded.width_ft,
      depth_ft = excluded.depth_ft,
      rotation_deg = 0,
      inventory_status = 'approved';
  `;
  console.log('Seeded PG stalls (48 total)');

  // 5. Stalls BB: 25 left (A01..A25) + 25 right (B01..B25)
  await sql`
    insert into booking.stalls (edition_id, zone_id, code, width_ft, depth_ft, x_ft, y_ft, rotation_deg, inventory_status, source_ref)
    select 2026, z.id, 'BB-A' || to_char(i, 'FM00'), 10, 10, 16, 12 + (i - 1) * 10, 0, 'approved', 'pdf-map'
    from booking.zones z, generate_series(1, 25) as i
    where z.code = 'BB' and z.edition_id = 2026
    on conflict (edition_id, code) do update set
      x_ft = excluded.x_ft,
      y_ft = excluded.y_ft,
      width_ft = excluded.width_ft,
      depth_ft = excluded.depth_ft,
      rotation_deg = 0,
      inventory_status = 'approved';
  `;

  await sql`
    insert into booking.stalls (edition_id, zone_id, code, width_ft, depth_ft, x_ft, y_ft, rotation_deg, inventory_status, source_ref)
    select 2026, z.id, 'BB-B' || to_char(i, 'FM00'), 10, 10, 72, 12 + (i - 1) * 10, 0, 'approved', 'pdf-map'
    from booking.zones z, generate_series(1, 25) as i
    where z.code = 'BB' and z.edition_id = 2026
    on conflict (edition_id, code) do update set
      x_ft = excluded.x_ft,
      y_ft = excluded.y_ft,
      width_ft = excluded.width_ft,
      depth_ft = excluded.depth_ft,
      rotation_deg = 0,
      inventory_status = 'approved';
  `;
  console.log('Seeded BB stalls (50 total)');
  console.log('Seeded BB stalls (50 total)');

  const counts = await sql`
    select z.code, z.name, count(s.id) as stall_count
    from booking.zones z
    left join booking.stalls s on s.zone_id = z.id and s.inventory_status = 'approved'
    where z.edition_id = 2026 and z.inventory_status = 'approved'
    group by z.code, z.name
    order by z.code;
  `;
  console.log('Final counts:', counts);

  await sql.end();
  console.log('Done!');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
