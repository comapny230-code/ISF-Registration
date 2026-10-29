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
