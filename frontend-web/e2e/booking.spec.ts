/** Browser flows E2E-01..07 and LIVE-05 (spec §9.3). */
import { expect, test, type Page } from "@playwright/test";
import { closeDb, createLeader, db, holdAs, liveClaimCounts, plantLoginCode, resetBooking, seedStalls, signIn } from "./support";

test.afterEach(async () => {
  expect(await liveClaimCounts()).toEqual({ duplicate_stall_claims: 0, duplicate_team_claims: 0 });
});
test.afterAll(async () => {
  await closeDb();
});

const stall = (page: Page, code: string) => page.locator(`svg [data-stall-code="${code}"]`);

test("E2E-01: a leader signs in with an emailed code and reaches the booking page", async ({ page }) => {
  await resetBooking();
  await seedStalls(2);
  const leader = await createLeader({ session: false });

  // With the organisers' public map on, a visitor sees the map and signs in from a dialog
  // after picking a stall.
  await (await db())`update booking.settings set public_map = true`;
  await page.goto("/book-your-stall");
  await expect(page.getByRole("heading", { name: "Book your stall" })).toBeVisible();
  await stall(page, "PG-A01").click();
  await page.getByRole("button", { name: "Sign in as Leader to Book Stall PG-A01" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("leader@example.com").fill(leader.email);
  await dialog.getByRole("button", { name: "Send One-Time Code" }).click();
  const codeInput = dialog.locator('input[autocomplete="one-time-code"]');
  await expect(codeInput).toBeVisible();

  await plantLoginCode(leader.email, "246810");
  await codeInput.fill("246810");
  await dialog.getByRole("button", { name: "Verify & Book" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(leader.teamName)).toBeVisible();
  await expect(page.getByRole("button", { name: "Book my stall" })).toBeVisible();
});

test("E2E-02/03: Book my stall reserves the stall, asks to confirm, and confirming gives a reference", async ({ page, context }) => {
  await resetBooking();
  await seedStalls(3);
  const leader = await createLeader();
  await signIn(context, leader);

  await page.goto("/book-your-stall");
  await stall(page, "PG-A02").click();
  await expect(page.getByRole("heading", { name: "Stall PG-A02" })).toBeVisible();
  await page.getByRole("button", { name: "Book my stall" }).click();

  // The stall is reserved at once and the confirmation opens by itself.
  const dialog = page.getByRole("dialog", { name: "Book stall PG-A02?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/reserved for you for [45]:\d\d/);
  await expect(page.getByTestId("hold-panel")).toContainText("Stall PG-A02 is reserved for you");
  await expect(page.getByTestId("countdown")).toHaveText(/^[45]:\d\d$/);
  await expect(stall(page, "PG-A02")).toHaveAttribute("aria-label", /^Stall PG-A02 \(#\d+\), Held by you$/);

  await dialog.getByRole("button", { name: "Confirm booking" }).click();

  // Only a successful confirmation shows the contact popup.
  const contact = page.getByTestId("booked-dialog");
  await expect(contact).toContainText("Please contact Mr Ravi for arrangements.");
  await expect(contact).toContainText("Contact number: 9437432282");
  await contact.getByRole("button", { name: "Close" }).click();

  const booked = page.getByTestId("booking-panel");
  await expect(booked).toContainText("Your stall is booked");
  const ref = (await booked.locator("span").last().textContent())!.trim();
  expect(ref).toMatch(/^SJ26-[0-9A-HJKMNP-TV-Z]{8}$/);
  await expect(stall(page, "PG-A02")).toHaveAttribute("aria-label", /^Stall PG-A02 \(#\d+\), Your booking$/);

  const s = await db();
  const [row] = await s`select status, booking_ref from booking.reservations where booking_ref = ${ref}`;
  expect(row.status).toBe("confirmed");
});

test("E2E-04: an unconfirmed reservation expires, the page says so and the stall becomes available again", async ({ page, context }) => {
  await resetBooking({ hold_seconds: 6 });
  await seedStalls(2);
  const leader = await createLeader();
  await signIn(context, leader);

  await page.goto("/book-your-stall");
  await stall(page, "PG-A01").click();
  await page.getByRole("button", { name: "Book my stall" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click();
  await expect(page.getByTestId("hold-panel")).toBeVisible();

  await expect(page.getByTestId("notice")).toContainText("Your hold expired", { timeout: 15_000 });
  await expect(page.getByTestId("booked-dialog")).toHaveCount(0);
  await expect(page.getByTestId("hold-panel")).toHaveCount(0);
  await expect(stall(page, "PG-A01")).toHaveAttribute("aria-label", /^Stall PG-A01 \(#\d+\), Available$/, { timeout: 10_000 });
});

test("E2E-05: a stale map cannot double-book: the server refuses and the map refreshes", async ({ page, context, request }) => {
  await resetBooking();
  const [, target] = await seedStalls(2);
  const [me, other] = [await createLeader(), await createLeader()];
  await signIn(context, me);

  await page.goto("/book-your-stall");
  await expect(stall(page, "PG-A02")).toHaveAttribute("aria-label", /^Stall PG-A02 \(#\d+\), Available$/);

  // Freeze this page's view: polls fail, so the map keeps showing PG-A02 as available.
  await page.route("**/v1/booking/stalls", (route) => route.abort());
  expect((await holdAs(request, other, target.id)).status()).toBe(201);

  await stall(page, "PG-A02").click();
  await page.getByRole("button", { name: "Book my stall" }).click();
  await expect(page.getByTestId("notice")).toContainText("held by another team");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.unroute("**/v1/booking/stalls");
  await expect(stall(page, "PG-A02")).toHaveAttribute("aria-label", /^Stall PG-A02 \(#\d+\), Held by another team$/, { timeout: 10_000 });
  const s = await db();
  const [row] = await s`select count(*)::int as n from booking.reservations where stall_id = ${target.id}`;
  expect(row.n).toBe(1);
});

test("E2E-06: the whole flow works with the keyboard only", async ({ page, context }) => {
  await resetBooking();
  await seedStalls(3);
  const leader = await createLeader();
  await signIn(context, leader);
  await page.goto("/book-your-stall");
  await expect(stall(page, "PG-A01")).toBeVisible();

  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if ((await page.evaluate(() => document.activeElement?.getAttribute("data-stall-code"))) === "PG-A01") break;
  }
  await expect(stall(page, "PG-A01")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Stall PG-A01" })).toBeVisible();

  const bookButton = page.getByRole("button", { name: "Book my stall" });
  await bookButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Confirm booking" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("hold-panel")).toBeVisible();

  await page.getByTestId("hold-panel").getByRole("button", { name: "Confirm booking" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("booking-panel")).toBeVisible();
});

test("a zone whose layout is not approved is listed without a map", async ({ page, context }) => {
  await resetBooking();
  await seedStalls(3, { geometry: false, zone: "BB" });
  const leader = await createLeader();
  await signIn(context, leader);
  await page.goto("/book-your-stall");

  await expect(page.getByTestId("layout-pending")).toBeVisible();
  await expect(page.locator("svg [data-stall-code]")).toHaveCount(0);
  const row = page.locator('tr[data-stall-code="BB-A01"]');
  await expect(row).toContainText("Unavailable");
  await row.getByRole("button", { name: "Select stall BB-A01" }).click();
  await expect(page.getByRole("button", { name: "Book my stall" })).toBeDisabled();
});

test("LIVE-05: after going offline and back online the map catches up immediately", async ({ page, context, request }) => {
  await resetBooking();
  const [first] = await seedStalls(2);
  const [me, other] = [await createLeader(), await createLeader()];
  await signIn(context, me);
  await page.goto("/book-your-stall");
  await expect(stall(page, "PG-A01")).toHaveAttribute("aria-label", /^Stall PG-A01 \(#\d+\), Available$/);

  await context.setOffline(true);
  expect((await holdAs(request, other, first.id)).status()).toBe(201);
  await page.waitForTimeout(3_000);
  await expect(stall(page, "PG-A01")).toHaveAttribute("aria-label", /^Stall PG-A01 \(#\d+\), Available$/); // still stale while offline

  await context.setOffline(false);
  await expect(stall(page, "PG-A01")).toHaveAttribute("aria-label", /^Stall PG-A01 \(#\d+\), Held by another team$/, { timeout: 5_000 });
});

test("an ineligible team sees why and cannot hold", async ({ page, context }) => {
  await resetBooking({ require_team_approval: true });
  await seedStalls(1);
  const leader = await createLeader();
  await signIn(context, leader);
  await page.goto("/book-your-stall");
  await expect(page.getByTestId("eligibility")).toContainText("awaiting approval");
  await stall(page, "PG-A01").click();
  await expect(page.getByRole("button", { name: "Book my stall" })).toBeDisabled();
});
