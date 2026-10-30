/** E2E-07: phone-sized screens default to the accessible list view. */
import { expect, test } from "@playwright/test";
import { closeDb, createAdminUser, createLeader, liveClaimCounts, resetBooking, seedStalls, signIn, signInAdmin } from "./support";

test.afterAll(async () => {
  await closeDb();
});

test("E2E-07: on a phone the list is the default view and booking works from it", async ({ page, context }) => {
  await resetBooking();
  await seedStalls(3);
  const leader = await createLeader();
  await signIn(context, leader);

  await page.goto("/book-your-stall");
  const row = page.locator('tr[data-stall-code="PG-A03"]');
  await expect(row).toBeVisible();
  await expect(page.locator("svg [data-stall-code]")).toHaveCount(0);

  await row.getByRole("button", { name: "Select stall PG-A03" }).click();
  await page.getByRole("button", { name: "Book my stall" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click();
  await expect(page.getByTestId("hold-panel")).toContainText("PG-A03");
  await expect(row).toContainText("Held by you");

  await page.getByRole("button", { name: "Map" }).click();
  await expect(page.locator('svg [data-stall-code="PG-A03"]')).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const viewport = page.viewportSize()!.width;
  expect(scrollWidth).toBeLessThanOrEqual(viewport + 1); // no horizontal page scroll
  expect(await liveClaimCounts()).toEqual({ duplicate_stall_claims: 0, duplicate_team_claims: 0 });
});

test("LAYOUT: every page fits phone and tablet widths without horizontal scrolling or script errors", async ({ page, context }) => {
  await resetBooking();
  await seedStalls(3);
  const admin = await createAdminUser(["reports.view", "booking.cancel", "inventory.manage", "teams.manage"]);
  await signInAdmin(context, admin);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));

  for (const width of [390, 820]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/register", "/login", "/book-your-stall", "/admin/login", "/admin"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} at ${width}px overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  }
  expect(errors).toEqual([]);
});
