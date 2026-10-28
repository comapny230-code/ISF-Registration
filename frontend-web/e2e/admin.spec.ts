/** E2E-08: administrator workflow with mandatory reasons and step-up sign-in. */
import { expect, test } from "@playwright/test";
import {
  bookAs,
  closeDb,
  createAdminUser,
  createLeader,
  db,
  liveClaimCounts,
  plantAdminCode,
  resetBooking,
  seedStalls,
  signInAdmin,
} from "./support";

const REASON = "Organiser request recorded in the event log";

test.afterEach(async () => {
  expect(await liveClaimCounts()).toEqual({ duplicate_stall_claims: 0, duplicate_team_claims: 0 });
});
test.afterAll(async () => {
  await closeDb();
});

test("the admin page requires an administrator session", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login\?next=(%2F|\/)admin/);
});

test("E2E-08: cancel a booking, disable a stall and approve a team, each with a reason and an audit entry", async ({ page, context, request }) => {
  await resetBooking();
  const [first, second] = await seedStalls(3);
  const owner = await createLeader();
  const pending = await createLeader();
  const booking = await bookAs(request, owner, first.id);
  const admin = await createAdminUser(["reports.view", "booking.cancel", "inventory.manage", "teams.manage"]);
  await signInAdmin(context, admin);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Stall booking administration" })).toBeVisible();

  const row = page.locator(`tr[data-booking-ref="${booking.bookingRef}"]`);
  await row.getByRole("button", { name: "Cancel" }).click();
  const dialog = page.getByRole("dialog", { name: `Cancel booking ${booking.bookingRef}?` });
  await expect(dialog.getByRole("button", { name: "Cancel booking" })).toBeDisabled(); // reason required
  await dialog.getByLabel("Reason (recorded in the audit log)").fill(REASON);
  await dialog.getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByTestId("admin-notice")).toContainText(`Booking ${booking.bookingRef} cancelled.`);
  await expect(row).toContainText(`Cancelled: ${REASON}`);

  await page.getByRole("tab", { name: "Stalls" }).click();
  const stallRow = page.locator(`tr[data-stall-code="${second.code}"]`);
  await stallRow.getByRole("button", { name: "Disable" }).click();
  await page.getByRole("dialog").getByLabel("Reason (recorded in the audit log)").fill(REASON);
  await page.getByRole("dialog").getByRole("button", { name: "Disable stall" }).click();
  await expect(stallRow).toContainText("unavailable");

  await page.getByRole("tab", { name: "Teams" }).click();
  const teamRow = page.locator(`tr[data-team-name="${pending.teamName}"]`);
  await teamRow.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog").getByLabel("Reason (recorded in the audit log)").fill(REASON);
  await page.getByRole("dialog").getByRole("button", { name: "Approve team" }).click();
  await expect(teamRow).toContainText("approved");

  await page.getByRole("tab", { name: "Audit log" }).click();
  await expect(page.getByRole("cell", { name: "booking cancelled" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "stall disabled" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "team approval changed" }).first()).toBeVisible();

  const s = await db();
  const events = await s`
    select action, reason from booking.audit_events
     where actor_admin_id = ${admin.id} order by id`;
  expect(events.map((e) => e.action)).toEqual(["booking_cancelled", "stall_disabled", "team_approval_changed"]);
  expect(events.every((e) => e.reason === REASON)).toBe(true);
});

test("E2E-08: a stale sign-in triggers step-up inside the dialog and the action then completes", async ({ page, context }) => {
  await resetBooking();
  const [stall] = await seedStalls(1);
  const admin = await createAdminUser(["inventory.manage"]);
  await signInAdmin(context, admin);
  const s = await db();
  await s`update app_auth.sessions set reauth_at = clock_timestamp() - interval '11 minutes' where admin_user_id = ${admin.id}`;

  await page.goto("/admin");
  const stallRow = page.locator(`tr[data-stall-code="${stall.code}"]`);
  await stallRow.getByRole("button", { name: "Disable" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason (recorded in the audit log)").fill(REASON);
  await dialog.getByRole("button", { name: "Disable stall" }).click();

  await expect(dialog.getByTestId("reauth")).toBeVisible();
  await dialog.getByRole("button", { name: `Send a code to ${admin.email}` }).click();
  await expect(dialog.getByLabel("6-digit code")).toBeVisible();
  await plantAdminCode(admin.email, "864201");
  await dialog.getByLabel("6-digit code").fill("864201");
  await dialog.getByRole("button", { name: "Confirm and continue" }).click();

  await expect(page.getByTestId("admin-notice")).toContainText(`Stall ${stall.code} disabled.`);
  const [row] = await s`select admin_status from booking.stalls where id = ${stall.id}`;
  expect(row.admin_status).toBe("disabled");
  const [count] = await s`select count(*)::int as n from booking.audit_events where stall_id = ${stall.id} and action = 'stall_disabled'`;
  expect(count.n).toBe(1);
});
