# Stall Inventory — Provisional (NOT APPROVED)

Status: **PROVISIONAL. Not approved by the event organisers. Nothing in this file may be used to make a stall bookable.**
Companion to [`STALL_BOOKING_FINAL_SPEC.md`](STALL_BOOKING_FINAL_SPEC.md) §7. Per-stall rows: [`stall_inventory_provisional.csv`](stall_inventory_provisional.csv) (107 rows, all `bookable=false`).

## 1. Source document

| Property | Value (verified by inspection) |
|---|---|
| File | `docs/Map Startup.docx` (note: the space in the name; it is not `Map-Startup.docx`) |
| SHA-256 (first 16 hex) | `e0d5d7b77488adeb` |
| Author / revision | `staff`, revision 18 |
| Created / modified | 2026-10-28T07:57Z / 2026-10-28T09:41Z (a same-day working draft) |
| Approval marking | None. There is no signature, approval note or version label. |
| Structure | Three Word tables used as schematics, plus 6 arrow connectors and 1 photograph. **Not drawn to scale.** There is no north arrow, no legend and no grid. |
| Photograph | Stock photo of a helicopter on a helipad, placed inside the yellow helipad cell. It carries no layout information. |
| Header text | "Startup Jathara -2026", "17-20 December 2026" |

## 2. Confirmed facts (stated explicitly in the document)

### Zone PG: "Play Ground, GIET University, Gunupur-765022" (table 1)

| Element | Text in source | Table position |
|---|---|---|
| Dimension | `402 Feet` | col 0, rows 0–5 merged (left edge label) |
| Dimension | `338 feet` | row 0, cols 1–2 (top edge label) |
| Stall run | `30 Startup (10*10)` | row 1, cols 1–2 |
| Stall run | `180Feet for 18 Startup (10*10)` | row 2, col 1 |
| Landmark | `Stage for Guru Ji (67 Feet)` | row 3, col 1 |
| Landmark | `Road (20 Feet) Towards Guest House` | row 4, col 1 |
| Landmark | `135 Feet of Open Space Towards Agricultural Land` (yellow) | row 5, col 1 |
| Landmark | `Helipad` (yellow; rows 2–5 of col 2 are yellow and merged) | row 5, col 2 |
| Arrows | One ↑ arrow and one → arrow inside the yellow helipad cell. Their meaning is not stated. | row 2, col 2 |

### Zone BB: "Basket ball Ground, GIET University, Gunupur-765022" (table 2)

| Element | Text in source | Table position |
|---|---|---|
| Boundary | `Bus Stand Road` | col 0, rows 0–5 merged (left) |
| Boundary | `Mechanical Block ( 305 feet )` | row 0, cols 1–2 (top) |
| Boundary / reserved | `Rang Munch / 101 Feet / For GIET University` (blue) | col 3, rows 0–5 merged (right) |
| Reserved? | `ISF / 55 Feet` | row 1, col 1 |
| Stall run | `25 Startup (10*10)` | row 1, col 2 |
| Circulation | `Entry` (green, → arrow) | row 2, cols 1–2 |
| Circulation | `Exit` (green, ← arrow) | row 3, cols 1–2 |
| Reserved? | `Meeting Room / 25 Feet` | row 4, col 1 |
| Stall run | `28 Startup (10*10) 305 feet` | row 4, col 2 |
| Boundary | `Towards Play Ground` (light blue) | row 5, cols 1–2 (bottom) |

### Zone AG: outside the agricultural gate (table 3; the document gives no heading)

| Element | Text in source | Table position |
|---|---|---|
| Boundary | `Main Gate Towards the Agricultural Land` | col 0, rows 0–5 merged (left) |
| Area | `Open Space Outside the Agricultural Gate, Towards the Guest House (40 feet)` | row 0 |
| Stall run | `4 Stall 10*10` | row 1 |
| Circulation | `Entry` (→ arrow) | row 2 |
| Circulation | `Exit` (← arrow) | row 3 |
| Stall run | `2 Stall 10*10` | row 4 |
| Boundary | `Road Leading Towards the Guest House` | row 5 |

### Unplaced labels (paragraphs between table 2 and table 3)

`Food Stall`, `Society for Advanced Food Engineering & Research (SAFER)`, `Biotech Department`. These have **no position**. The document does not say whether they are bookable, reserved or just landmarks.

## 3. Derived and assumed (needs organiser verification)

| ID | Item | Derivation / assumption | Confidence |
|---|---|---|---|
| V-01 | Total of 107 stalls | 30 + 18 + 25 + 28 + 4 + 2, all stated as 10 × 10 ft | Counts: high. Whether *all* are bookable: unknown. |
| V-02 | BB rows fill 305 ft | 55 + 250 = 305 and 25 + 280 = 305 | Medium (consistent arithmetic, but not stated) |
| V-03 | AG-A fills 40 ft | 4 × 10 = 40 | Medium |
| V-04 | PG-A spacing | 30 × 10 = 300 ft of the 338 ft side; 38 ft unaccounted for (gaps, aisles, corners?) | Low |
| V-05 | PG-B axis | The 180 ft run could run parallel or perpendicular to PG-A | Low |
| V-06 | PG overall orientation | Is 402 ft the N–S or E–W side? Is the 338 ft side the one PG-A sits on? | Low |
| V-07 | Row type | Single row or back-to-back rows; which way stalls face (toward the aisle, a stage, or a road?) | Unknown |
| V-08 | Entry/Exit | Do the BB/AG Entry/Exit rows mean an aisle *between* the two runs? What do the arrow directions mean physically? | Low |
| V-09 | ISF 55 ft, Meeting Room 25 ft, Rang Manch 101 ft | Assumed **not bookable** (reserved for organisers/GIET) | Assumption |
| V-10 | Food Stall, SAFER, Biotech | Position and bookability unknown | Unknown |
| V-11 | Helipad arrows | Possibly an approach path or keep-clear zone; meaning unknown | Unknown |
| V-12 | Relative location of zones | The document doesn't say how PG, BB and AG relate to each other on campus, or how far apart they are | Unknown |
| V-13 | Colour meaning | Yellow, blue, green and light-blue fills have no legend | Unknown |
| V-14 | Zone codes and stall numbering | `PG`, `BB`, `AG` and `<zone>-<run letter><nn>` were **invented by the developer** for traceability. Numbering direction within a run is unknown. | Provisional |
| V-15 | AG zone name | The table has no heading; the name was taken from its row 0 text | Provisional |
| V-16 | Electricity, furniture, accessibility | Not in the document | Unknown |

## 4. Date discrepancy (not resolved here)

| Source | Dates shown |
|---|---|
| `Map Startup.docx` header | 17–20 December 2026 |
| www.startupjathara.com page body (scraped 2026-10-28) | 17–20 December 2026 |
| www.startupjathara.com meta/OG description (same scrape) | 18–20 December 2026 |
| Registration app: `frontend-web/app/page.tsx:18`, `app/layout.tsx:9`, confirmation email in `route.ts` | 18–20 December 2026 (pre-event 17 Dec) |
| `database/schema.sql:10-12` (`event_editions` defaults) | pre-event 17 Dec, event 18–20 Dec |

Which days the stalls operate (17, 18, 19, 20 December) is an **organiser decision** (decision D-20 in the spec). Booking logic doesn't depend on it; confirmation text and emails do.

## 5. Coordinate collection and validation process

Coordinates **must not** be inferred from the schematic. The process is:

1. **Source.** The organisers provide either (a) an approved to-scale drawing (CAD, PDF with a scale bar), or (b) an on-site survey.
2. **Reference frame per zone.** Origin at a named physical corner (e.g. the "PG south-west corner post"), +x along a named edge, distances in feet, rotation in degrees clockwise from +x. Record the frame definition in the zone row.
3. **Per-run survey.** For each run: start point (x, y), direction, stall pitch, gaps (with reasons), facing direction, and the order in which stall numbers increase.
4. **Data entry.** Fill `x_ft`, `y_ft`, `rotation_deg`, `facing` for every row in `stall_inventory_provisional.csv`. Rename codes if the organisers prefer another scheme, and record the old-to-new mapping.
5. **Automated validation** (a developer script, Phase 8 of the spec):
   - codes unique, matching `^[A-Z]{2}-[A-Z][0-9]{2}$`
   - counts per run equal the organiser-approved counts
   - no rectangles overlap, including reserved areas modelled as obstacles
   - every stall lies inside its zone's extent
   - pitch is consistent within a run
   - entry/exit and landmark polygons are present
6. **Visual proof.** Render an SVG preview, labelled with codes, for each zone. The organisers compare it to the physical layout.
7. **Sign-off.** Record it below: approver name, role, date, SHA-256 of the CSV, and SHA-256 of the preview.
8. **Activation.** A reviewed migration generated from the signed CSV sets `inventory_status='approved'` and the geometry. Until then every seeded stall is `provisional`, with null geometry and `bookable=false`. The DB CHECK enforces this.

## 6. Organiser sign-off checklist

- [ ] V-01: Final list of bookable stalls and their count per zone
- [ ] V-09, V-10: Status of ISF 55 ft, Meeting Room, Rang Manch, Food Stall, SAFER, Biotech (bookable / reserved / landmark)
- [ ] Reserved stalls for sponsors, GIET, ISF or departments, if any
- [ ] V-04 to V-08: Orientation, spacing, facing, row type, aisles, Entry/Exit meaning
- [ ] V-12: How the zones relate to each other on campus, for the map overview
- [ ] V-14: Stall code scheme (accept `PG-A01` style, or supply official codes)
- [ ] Coordinates collected and validated (§5); previews approved
- [ ] D-20: Stall operating days
- [ ] Accessibility, power and furniture notes to show on the map (optional)

| Approver | Role | Date | CSV SHA-256 | Preview SHA-256 |
|---|---|---|---|---|
| *(pending)* | | | | |
