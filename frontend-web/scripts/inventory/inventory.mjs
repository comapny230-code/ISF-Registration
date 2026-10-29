/**
 * Stall inventory tooling (docs/STALL_INVENTORY_PROVISIONAL.md §5).
 * Pure functions, no dependencies: parse the inventory CSV, validate it, generate
 * the provisional development seed, and render previews for organiser review.
 * Coordinates are never invented: zones without surveyed coordinates are drawn as
 * an explicitly labelled schematic.
 */

export const REQUIRED_COLUMNS = [
  "provisional_stall_code", "zone_code", "zone_name", "run_code", "index_in_run", "run_count_in_source",
  "intended_position", "width_ft", "depth_ft", "x_ft", "y_ft", "rotation_deg", "facing", "source_evidence",
  "count_confidence", "position_confidence", "approval_status", "bookable",
];

/** Zone metadata from the source documents (labelled dimensions only; drawings are not to scale). */
export const ZONES = {
  PG: {
    name: "Play Ground",
    extentWidthFt: 338,
    extentDepthFt: 402,
    landmarks: [
      { label: "Stage for Guru Ji (67 ft)", kind: "stage" },
      { label: "Field Entry", kind: "entry" },
      { label: "Road (20 ft) towards Guest House", kind: "road" },
      { label: "135 ft open space towards agricultural land", kind: "open_space" },
      { label: "Helipad", kind: "restricted" },
    ],
  },
  BB: {
    name: "Basketball Ground",
    extentWidthFt: 101,
    extentDepthFt: 305,
    landmarks: [
      { label: "Rang Manch (101 ft, GIET University)", kind: "stage" },
      { label: "Entry lane", kind: "entry" },
      { label: "Exit lane", kind: "exit" },
      { label: "ISF stall (55 ft)", kind: "reserved" },
      { label: "Meeting Room", kind: "reserved" },
      { label: "Mechanical Road", kind: "road" },
      { label: "Bus-Stand Road", kind: "road" },
    ],
  },
  AG: {
    name: "Outside Agricultural Gate",
    extentWidthFt: null,
    extentDepthFt: null,
    landmarks: [
      { label: "Main Gate towards the agricultural land", kind: "entry" },
      { label: "Entry", kind: "entry" },
      { label: "Exit", kind: "exit" },
      { label: "Road leading towards the Guest House", kind: "road" },
    ],
  },
};

const CODE_PATTERN = /^([A-Z]{2})-([A-Z])([0-9]{2})$/;

/** RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF or LF). Returns rows as objects. */
export function parseCsv(text) {
  const records = [];
  let field = "";
  let record = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      if (record.length > 1 || record[0] !== "") records.push(record);
      record = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const [header = [], ...data] = records;
  return { header, rows: data.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]))) };
}

const isBlank = (value) => value === undefined || value === null || String(value).trim() === "";

/** Corners of a stall rectangle rotated (degrees, clockwise) about its (x, y) origin corner. */
export function stallPolygon(row) {
  const x = Number(row.x_ft);
  const y = Number(row.y_ft);
  const w = Number(row.width_ft);
  const d = Number(row.depth_ft);
  const r = (Number(row.rotation_deg) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [
    [0, 0],
    [w, 0],
    [w, d],
    [0, d],
  ].map(([px, py]) => [x + px * cos - py * sin, y + px * sin + py * cos]);
}

/** True when two convex polygons overlap with positive area (separating axis theorem). */
export function polygonsOverlap(a, b, epsilon = 1e-6) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const axis = [y1 - y2, x2 - x1];
      const project = (p) => p.map(([x, y]) => x * axis[0] + y * axis[1]);
      const pa = project(a);
      const pb = project(b);
      if (Math.max(...pa) <= Math.min(...pb) + epsilon || Math.max(...pb) <= Math.min(...pa) + epsilon) return false;
    }
  }
  return true;
}

/**
 * Validates inventory rows. Errors block seeding/activation; warnings are
 * surfaced for organiser review (e.g. source conflicts).
 */
export function validateInventory(header, rows) {
  const errors = [];
  const warnings = [];
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) errors.push(`missing columns: ${missing.join(", ")}`);
  if (rows.length === 0) errors.push("no stalls");

  const codes = new Set();
  const runs = new Map();
  for (const [index, row] of rows.entries()) {
    const at = `row ${index + 2} (${row.provisional_stall_code || "?"})`;
    const match = CODE_PATTERN.exec(row.provisional_stall_code);
    if (!match) {
      errors.push(`${at}: code must match AA-A00`);
      continue;
    }
    if (codes.has(row.provisional_stall_code)) errors.push(`${at}: duplicate code`);
    codes.add(row.provisional_stall_code);
    if (match[1] !== row.zone_code) errors.push(`${at}: code prefix does not match zone ${row.zone_code}`);
    if (!ZONES[row.zone_code]) errors.push(`${at}: unknown zone ${row.zone_code}`);
    if (row.run_code !== `${match[1]}-${match[2]}`) errors.push(`${at}: run_code must be ${match[1]}-${match[2]}`);
    if (Number(match[3]) !== Number(row.index_in_run)) errors.push(`${at}: code number does not match index_in_run`);
    for (const dim of ["width_ft", "depth_ft"]) {
      if (!(Number(row[dim]) > 0)) errors.push(`${at}: ${dim} must be positive`);
    }

    const coordinates = ["x_ft", "y_ft", "rotation_deg"].map((c) => row[c]);
    const present = coordinates.filter((v) => !isBlank(v)).length;
    if (present !== 0 && present !== 3) errors.push(`${at}: x_ft, y_ft and rotation_deg must be all set or all blank`);
    if (present === 3) {
      if (coordinates.some((v) => !Number.isFinite(Number(v)))) errors.push(`${at}: coordinates must be numbers`);
      const rot = Number(row.rotation_deg);
      if (!(rot >= 0 && rot < 360)) errors.push(`${at}: rotation_deg must be in [0, 360)`);
    }

    const approved = /^APPROVED\b/.test(row.approval_status);
    if (approved && present !== 3) errors.push(`${at}: an approved stall needs surveyed coordinates`);
    if (!approved && row.bookable !== "false") errors.push(`${at}: an unapproved stall must have bookable=false`);
    if (/CONFLICT/i.test(row.count_confidence)) warnings.push(`${row.run_code}: ${row.count_confidence}`);

    const run = runs.get(row.run_code) ?? { declared: new Set(), indexes: [] };
    run.declared.add(row.run_count_in_source);
    run.indexes.push(Number(row.index_in_run));
    runs.set(row.run_code, run);
  }

  for (const [code, run] of runs) {
    if (run.declared.size !== 1) {
      errors.push(`${code}: inconsistent run_count_in_source`);
      continue;
    }
    const declared = Number([...run.declared][0]);
    const sorted = [...run.indexes].sort((a, b) => a - b);
    const contiguous = sorted.every((value, i) => value === i + 1);
    if (!contiguous || sorted.length !== declared) {
      errors.push(`${code}: expected stalls 1..${declared}, found ${sorted.length} (${contiguous ? "contiguous" : "gaps or duplicates"})`);
    }
  }

  const placed = rows.filter((r) => ["x_ft", "y_ft", "rotation_deg"].every((c) => !isBlank(r[c])));
  for (let i = 0; i < placed.length; i++) {
    const zone = ZONES[placed[i].zone_code];
    const poly = stallPolygon(placed[i]);
    if (zone?.extentWidthFt && zone?.extentDepthFt) {
      const outside = poly.some(([x, y]) => x < -1e-6 || y < -1e-6 || x > zone.extentWidthFt + 1e-6 || y > zone.extentDepthFt + 1e-6);
      if (outside) errors.push(`${placed[i].provisional_stall_code}: lies outside zone ${placed[i].zone_code}`);
    }
    for (let j = i + 1; j < placed.length; j++) {
      if (placed[i].zone_code === placed[j].zone_code && polygonsOverlap(poly, stallPolygon(placed[j]))) {
        errors.push(`${placed[i].provisional_stall_code} overlaps ${placed[j].provisional_stall_code}`);
      }
    }
  }

  const byZone = {};
  for (const row of rows) byZone[row.zone_code] = (byZone[row.zone_code] ?? 0) + 1;
  return {
    errors,
    warnings: [...new Set(warnings)],
    summary: {
      stalls: rows.length,
      byZone,
      withCoordinates: placed.length,
      approved: rows.filter((r) => /^APPROVED\b/.test(r.approval_status)).length,
      bookable: rows.filter((r) => r.bookable === "true").length,
    },
  };
}

const sqlText = (value) => `'${String(value).replace(/'/g, "''")}'`;

/**
 * Development/staging seed: every stall provisional, no geometry, never bookable.
 * Refuses to run unless the operator first sets isf.seed_environment to
 * local, test or staging, so it cannot be applied to production by accident.
 */
export function generateProvisionalSeedSql(rows, { sourceRef }) {
  const zones = [...new Set(rows.map((r) => r.zone_code))];
  const lines = [
    "-- GENERATED by frontend-web/scripts/inventory/cli.mjs seed. Do not edit by hand.",
    `-- Source: ${sourceRef}`,
    "-- PROVISIONAL inventory for local/test/staging only: no coordinates, inventory_status = 'provisional',",
    "-- so no stall is bookable. Never run in production; activation uses an approved migration instead.",
    "--   psql ... -c \"set isf.seed_environment = 'local'\" -f dev_stall_inventory_provisional.sql",
    "begin;",
    "do $$",
    "begin",
    "  if coalesce(current_setting('isf.seed_environment', true), '') not in ('local', 'test', 'staging') then",
    "    raise exception 'Refusing to seed provisional stalls: set isf.seed_environment to local, test or staging first. Never run this in production.';",
    "  end if;",
    "end",
    "$$;",
  ];
  for (const code of zones) {
    const z = ZONES[code];
    lines.push(
      `insert into booking.zones (edition_id, code, name, extent_width_ft, extent_depth_ft, landmarks, inventory_status, source_ref)`,
      `values (2026, ${sqlText(code)}, ${sqlText(z.name)}, ${z.extentWidthFt ?? "null"}, ${z.extentDepthFt ?? "null"}, ${sqlText(JSON.stringify(z.landmarks))}::jsonb, 'provisional', ${sqlText(sourceRef)})`,
      `on conflict (edition_id, code) do nothing;`
    );
  }
  lines.push("insert into booking.stalls (edition_id, zone_id, code, width_ft, depth_ft, inventory_status, source_ref)");
  lines.push("select 2026, z.id, v.code, v.width_ft, v.depth_ft, 'provisional', v.source_ref");
  lines.push("  from (values");
  lines.push(
    rows
      .map((r) => `    (${sqlText(r.zone_code)}, ${sqlText(r.provisional_stall_code)}, ${Number(r.width_ft)}, ${Number(r.depth_ft)}, ${sqlText(`${sourceRef}; ${r.run_code} #${r.index_in_run}`)})`)
      .join(",\n")
  );
  lines.push("  ) as v(zone_code, code, width_ft, depth_ft, source_ref)");
  lines.push("  join booking.zones z on z.edition_id = 2026 and z.code = v.zone_code");
  lines.push("on conflict (edition_id, code) do nothing;");
  lines.push("commit;");
  return lines.join("\n") + "\n";
}

/**
 * Production activation migration for the stalls the organisers APPROVED (rows whose
 * approval_status starts with "APPROVED", each with surveyed x/y/rotation). Rows that are not
 * approved are left out entirely. Inserts the zone and stall rows as 'approved', or upgrades
 * provisional rows already present (e.g. on staging); never touches anything else, and
 * fails the whole migration unless every approved stall ends up approved and bookable-ready.
 */
export function generateActivationMigrationSql(rows, { sourceRef, approvalRef }) {
  if (!approvalRef || !String(approvalRef).trim()) throw new Error("an approval reference (who approved, when, document) is required");
  const approved = rows.filter((r) => /^APPROVED\b/.test(r.approval_status));
  if (approved.length === 0) throw new Error("no rows are APPROVED; nothing to activate");
  for (const r of approved) {
    if (["x_ft", "y_ft", "rotation_deg"].some((c) => isBlank(r[c]))) throw new Error(`${r.provisional_stall_code}: approved without coordinates`);
    // The draft layout's positions are a schematic read from the PDF, not measurements: approving
    // a row must come with confirming its position (docs/inventory/README.md, "How to approve").
    if (/^\s*DRAFT\b/i.test(r.position_confidence ?? "")) {
      throw new Error(`${r.provisional_stall_code}: approved with a DRAFT position; set position_confidence to how it was confirmed (e.g. "confirmed on site - <name>, <date>")`);
    }
    // An unresolved count conflict (e.g. Basketball Ground right-hand run: DOCX 28 vs PDF 25)
    // means the organisers have not yet said which stalls exist.
    if (/^\s*CONFLICT\b/i.test(r.count_confidence ?? "")) {
      throw new Error(`${r.provisional_stall_code}: run ${r.run_code} still has an unresolved count conflict (${r.count_confidence}); record the decision in count_confidence first`);
    }
  }
  const ref = `${String(approvalRef).trim()}; ${sourceRef}`;
  const zones = [...new Set(approved.map((r) => r.zone_code))];
  const lines = [
    "-- GENERATED by frontend-web/scripts/inventory/cli.mjs activate. Do not edit by hand.",
    `-- Source: ${sourceRef}`,
    `-- Approval: ${String(approvalRef).trim().replace(/\n/g, " ")}`,
    `-- Activates ${approved.length} organiser-approved stall(s) in ${zones.join(", ")}. Unapproved rows are not included.`,
    "-- Apply with scripts/migrate.mts (docs/runbooks/deploy-migrations.md) after review.",
  ];
  for (const code of zones) {
    const z = ZONES[code];
    lines.push(
      `insert into booking.zones (edition_id, code, name, extent_width_ft, extent_depth_ft, landmarks, inventory_status, source_ref)`,
      `values (2026, ${sqlText(code)}, ${sqlText(z.name)}, ${z.extentWidthFt ?? "null"}, ${z.extentDepthFt ?? "null"}, ${sqlText(JSON.stringify(z.landmarks))}::jsonb, 'approved', ${sqlText(ref)})`,
      `on conflict (edition_id, code) do update set inventory_status = 'approved', source_ref = excluded.source_ref`,
      `  where booking.zones.inventory_status = 'provisional';`
    );
  }
  lines.push("insert into booking.stalls (edition_id, zone_id, code, width_ft, depth_ft, x_ft, y_ft, rotation_deg, inventory_status, source_ref)");
  lines.push("select 2026, z.id, v.code, v.width_ft, v.depth_ft, v.x_ft, v.y_ft, v.rotation_deg, 'approved', v.source_ref");
  lines.push("  from (values");
  lines.push(
    approved
      .map(
        (r) =>
          `    (${sqlText(r.zone_code)}, ${sqlText(r.provisional_stall_code)}, ${Number(r.width_ft)}, ${Number(r.depth_ft)}, ${Number(r.x_ft)}, ${Number(r.y_ft)}, ${Number(r.rotation_deg)}, ${sqlText(`${ref}; ${r.run_code} #${r.index_in_run}`)})`
      )
      .join(",\n")
  );
  lines.push("  ) as v(zone_code, code, width_ft, depth_ft, x_ft, y_ft, rotation_deg, source_ref)");
  lines.push("  join booking.zones z on z.edition_id = 2026 and z.code = v.zone_code");
  lines.push("on conflict (edition_id, code) do update");
  lines.push("  set width_ft = excluded.width_ft, depth_ft = excluded.depth_ft, x_ft = excluded.x_ft, y_ft = excluded.y_ft,");
  lines.push("      rotation_deg = excluded.rotation_deg, inventory_status = 'approved', source_ref = excluded.source_ref, updated_at = now()");
  lines.push("  where booking.stalls.inventory_status = 'provisional';");
  const codes = approved.map((r) => sqlText(r.provisional_stall_code)).join(", ");
  lines.push(
    "do $$",
    "begin",
    `  if (select count(*) from booking.stalls where edition_id = 2026 and inventory_status = 'approved' and code in (${codes})) <> ${approved.length} then`,
    "    raise exception 'activation incomplete: an approved stall is missing, retired, or has a different status';",
    "  end if;",
    "end",
    "$$;"
  );
  return lines.join("\n") + "\n";
}

const xml = (value) =>
  String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

/** SVG preview for one zone: to scale when every stall has coordinates, otherwise a labelled schematic. */
export function renderZonePreview(rows, zoneCode) {
  const zone = ZONES[zoneCode];
  const stalls = rows.filter((r) => r.zone_code === zoneCode);
  const placed = stalls.every((r) => ["x_ft", "y_ft", "rotation_deg"].every((c) => !isBlank(r[c])));

  if (placed && stalls.length > 0 && zone.extentWidthFt && zone.extentDepthFt) {
    const scale = 2;
    const w = zone.extentWidthFt * scale;
    const h = zone.extentDepthFt * scale;
    const shapes = stalls.map((r) => {
      const points = stallPolygon(r).map(([x, y]) => `${(x * scale).toFixed(1)},${(y * scale).toFixed(1)}`).join(" ");
      const [cx, cy] = stallPolygon(r).reduce(([sx, sy], [x, y]) => [sx + x / 4, sy + y / 4], [0, 0]);
      return `<polygon points="${points}" fill="#faeee8" stroke="#c25022"/><text x="${cx * scale}" y="${cy * scale}" font-size="7" text-anchor="middle" dominant-baseline="middle">${xml(r.provisional_stall_code)}</text>`;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -40 ${w + 20} ${h + 50}" font-family="sans-serif">
<text x="0" y="-20" font-size="14" font-weight="bold">${xml(zone.name)} (${zoneCode}) – to scale, ${zone.extentWidthFt} × ${zone.extentDepthFt} ft</text>
<rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="#57534e"/>
${shapes.join("\n")}
</svg>
`;
  }

  const runs = [...new Set(stalls.map((r) => r.run_code))];
  const box = 26;
  const rowsSvg = runs.map((run, i) => {
    const runRows = stalls.filter((r) => r.run_code === run).sort((a, b) => Number(a.index_in_run) - Number(b.index_in_run));
    const y = 70 + i * 90;
    const cells = runRows
      .map((r, j) => `<rect x="${j * box}" y="${y}" width="${box - 2}" height="${box - 2}" fill="#f7f4ec" stroke="#57534e"/><text x="${j * box + 11}" y="${y + 15}" font-size="8" text-anchor="middle">${Number(r.index_in_run)}</text>`)
      .join("");
    const first = runRows[0];
    return `<text x="0" y="${y - 22}" font-size="11" font-weight="bold">${xml(run)} – ${runRows.length} stalls (${xml(first.count_confidence)})</text>
<text x="0" y="${y - 8}" font-size="9">${xml(first.intended_position)}</text>
${cells}`;
  });
  const width = Math.max(600, ...runs.map((run) => stalls.filter((r) => r.run_code === run).length * box));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 ${width + 20} ${80 + runs.length * 90}" font-family="sans-serif">
<text x="0" y="12" font-size="14" font-weight="bold">${xml(zone.name)} (${zoneCode})</text>
<text x="0" y="30" font-size="11" fill="#c25022">SCHEMATIC – NOT TO SCALE – coordinates pending survey and organiser approval</text>
${rowsSvg.join("\n")}
</svg>
`;
}
