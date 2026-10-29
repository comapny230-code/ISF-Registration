# Venue layout: organiser review and approval

Booking in production only offers stalls the organisers have approved. Nothing is approved yet.

## What is here

| File | What it is |
|---|---|
| `DRAFT_venue_layout_from_pdf.csv` | All 107 stall codes from the provisional inventory, with **draft** positions read from `Map Startup (18-10-2026).pdf`. Every row is still `PROVISIONAL - NOT APPROVED`. |
| `draft-preview/zone-PG.svg`, `zone-BB.svg`, `zone-AG.svg` | Pictures of the draft, one per area. Open them in a browser. |

The PDF is not drawn to scale. The draft spaces stalls 10 ft apart in the order the PDF shows. Real positions must be checked on the ground.

## Decisions needed before approval

1. **Basketball Ground, right-hand run:** the DOCX says 28 stalls, the PDF shows 25. The draft has no position for BB-B26 to BB-B28.
2. **Outside Agricultural Gate (AG, 6 stalls):** it is in the DOCX but not in the newer PDF. Is this area used?
3. **Positions:** measure on site (or confirm the draft), in feet from the top-left corner of each area.

## Validation of the draft (2026-10-29)

`cli.mjs validate` passes for both `docs/stall_inventory_provisional.csv` and this draft: 107 codes, no duplicates, every run numbered 1..n, every placed stall inside its area, no overlaps, all stalls 10 × 10 ft. **0 approved, 0 bookable.**

| Area | Run | Stalls | Count evidence | Draft position |
|---|---|---|---|---|
| Play Ground (PG) | PG-A | 30 | high (DOCX and PDF both 30) | yes |
| Play Ground (PG) | PG-B | 18 | high (both 18) | yes |
| Basketball Ground (BB) | BB-A | 25 | medium (DOCX only) | yes |
| Basketball Ground (BB) | BB-B | 28 | **CONFLICT: DOCX 28, PDF 25** | BB-B01–B25 only; **none for BB-B26–B28** |
| Agricultural Gate (AG) | AG-A, AG-B | 4 + 2 | low (not in the newer PDF) | **none** |

98 stalls have a draft position; 9 do not (BB-B26–B28, AG-A01–A04, AG-B01–B02). Every draft position is a schematic read from a drawing that is not to scale.

A dry run that approved every placed row produced a valid 98-stall migration, which showed that approval was one column flip away from publishing unmeasured positions. **`activate` now also refuses** (tested):
- any approved row whose `position_confidence` still starts with `DRAFT`;
- any approved row in a run whose `count_confidence` still starts with `CONFLICT`.

The database is the final guard: a stall is bookable only when `inventory_status = 'approved'` (a generated column), a provisional stall cannot be approved without coordinates, and holds on any other stall are rejected (`BK005`).

## What the organisers must provide (approval requirements)

Send all of these together. The developer cannot activate anything without them.

1. **Basketball Ground right-hand run (BB-B):** 25 or 28 stalls? Record the answer in `count_confidence` for every BB-B row (e.g. `decided: 25 (PDF) - <name>, <date>`). If 25, leave BB-B26–B28 unapproved. If 28, give positions for B26–B28.
2. **Agricultural Gate (AG):** used or not? If not, leave all 6 rows unapproved. If yes, give the area's size and every stall's position.
3. **Positions, measured or confirmed on site:** `x_ft`, `y_ft` (feet from the top-left corner of the area, as in the previews) and `rotation_deg` (0, 90, 180 or 270) for every stall to be offered, and `position_confidence` set to how each was confirmed (e.g. `confirmed on site - <name>, <date>`).
4. **Which stalls are offered:** `approval_status` = `APPROVED - <name>, <date>` and `bookable` = `true` on exactly those rows.
5. **One approval line** from someone entitled to approve the layout: `Approved by <name>, <role>, <date>, layout version <n>`.
6. Open decisions that affect booking but are not in this file (decision register D-01..D-26, LG-08): booking opening/closing time, which tracks may book, and stalls reserved for sponsors or ISF.

## How to approve

For each stall that will be offered:

1. Set `x_ft`, `y_ft` and `rotation_deg` to the confirmed position.
2. Set `approval_status` to `APPROVED - <your name>, <date>`.
3. Set `bookable` to `true`.

Leave every other row as it is. Rows that are not approved are never offered.

Then send the file to the developer with one line of approval, for example:
`Approved by <name>, <role>, <date>, layout version <n>`.

## What the developer does

```
node frontend-web/scripts/inventory/cli.mjs validate <approved.csv>
node frontend-web/scripts/inventory/cli.mjs activate <approved.csv> database/migrations/00NN_activate_inventory.sql "<approval line>"
```

`activate` refuses without an approval line, without approved rows, or when an approved stall has no position. The generated migration is reviewed, applied on staging, checked on the booking map, and then applied to production with `docs/runbooks/deploy-migrations.md`.
