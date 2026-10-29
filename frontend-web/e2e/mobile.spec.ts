/** E2E-07: phone-sized screens default to the accessible list view. */
import { expect, test } from "@playwright/test";
import { closeDb, createLeader, liveClaimCounts, resetBooking, seedStalls, signIn } from "./support";

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
