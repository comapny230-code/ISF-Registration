/**
 * The whole leader journey in a real browser: register → success popup → booking page
 * (no email code) → Book my stall → confirm → contact popup → ticket PDF download.
 */
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { withAadhaarCheckDigit } from "../lib/registration/aadhaar";
import { plantRegistrationCode, resetBooking, seedStalls } from "./support";

// A 1×1 PNG; the form compresses it to a JPEG data URL (uploads are off in tests).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let n = 0;
async function fillRegistration(page: Page) {
  n += 1;
  const id = `${Date.now().toString(36)}${n}`;
  const team = `Journey Team ${id}`;
  await page.goto("/register");
  await page.locator("#teamName").fill(team);
  await page.locator("#fullName").fill(`Journey Leader ${id}`);
  await page.locator("#domain").selectOption({ index: 1 });
  await page.locator("#projectDetails").fill("A working prototype for farm-to-market logistics.");
  const email = `journey-${id}@example.test`;
  await page.locator("#email").fill(email);
  // Verify the email the way a person does: send the code, then type it in.
  await page.getByTestId("send-email-code").click();
  await expect(page.getByText(`We sent a 6-digit code to ${email}`)).toBeVisible();
  await plantRegistrationCode(email, "482916");
  await page.getByLabel("Email verification code").fill("482916");
  await page.locator("#mobile").fill("9876543210");
  await page.locator("#altMobile").fill("9876543211");
  await page.locator("#city").fill("Gunupur");
  await page.locator("#state").fill("Odisha");
  await page.locator("#linkedinUrl").fill("linkedin.com/in/journey");
  await page.locator("#aadharNumber").fill(withAadhaarCheckDigit(`2${String(Date.now()).slice(-6)}${String(n).padStart(4, "0")}`));
  await page.locator('input[type="file"][accept="image/*"]:not([id^="member-photo"])').setInputFiles({ name: "lead.png", mimeType: "image/png", buffer: PNG });
  await page.getByPlaceholder("e.g. Priya Sharma").fill("Journey Member");
  await page.getByPlaceholder("+91 98765 00000").fill("9123456780");
  await page.getByPlaceholder("priya@company.com").fill(`journey-member-${id}@example.test`);
  await page.locator("#member-photo-1").setInputFiles({ name: "member.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Uploaded")).toBeVisible();
  await page.locator("button.btn-submit-summit").click();
  return team;
}

test("REG-E2E: registration leads straight to booking, and a confirmed booking gives a contact popup and a PDF ticket", async ({ page }) => {
  await resetBooking();
  const [stall] = await seedStalls(2);
  await page.clock.install();
  const team = await fillRegistration(page);

  // The details stay on screen: a clear next step at the bottom, no popup yet and no redirect.
  const section = page.getByTestId("book-stall-section");
  await expect(section).toContainText("Next step: book your stall");
  const popup = page.getByRole("dialog", { name: "Registration successful — Book your stall now" });
  await page.clock.fastForward("00:29");
  await expect(popup).toHaveCount(0);
  await expect(page).toHaveURL(/\/register/);

  // After 30 seconds the reminder appears; the cross closes it and the page stays.
  await page.clock.fastForward("00:02");
  await expect(popup).toBeVisible();
  await popup.getByRole("button", { name: "Close" }).click();
  await expect(popup).toHaveCount(0);
  await page.clock.fastForward("05:00");
  await expect(page).toHaveURL(/\/register/);

  // Only the button takes the leader to booking.
  await section.getByRole("link", { name: "Book your stall now" }).click();

  // Signed in by the registration itself: no sign-in code was requested or entered.
  await expect(page).toHaveURL(/\/book-your-stall$/);
  await expect(page.getByRole("heading", { name: "Book your stall" })).toBeVisible();
  await expect(page.getByText(team)).toBeVisible();

  await page.locator(`svg [data-stall-code="${stall.code}"]`).click();
  await page.getByRole("button", { name: "Book my stall" }).click();
  await page.getByRole("dialog", { name: `Book stall ${stall.code}?` }).getByRole("button", { name: "Confirm booking" }).click();

  const booked = page.getByRole("dialog", { name: `Stall ${stall.code} is booked` });
  await expect(booked).toBeVisible();
  await expect(booked).toContainText("Please contact Mr Ravi for arrangements.");
  await expect(booked).toContainText("Contact number: 9437432282");
  await expect(booked.getByRole("link", { name: "9437432282" })).toHaveAttribute("href", "tel:+919437432282");

  const [download] = await Promise.all([page.waitForEvent("download"), booked.getByRole("button", { name: "Download ticket (PDF)" }).click()]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^startup-jathara-stall-${stall.code}-SJ26-[0-9A-Z]{8}\\.pdf$`));
  const pdf = (await readFile((await download.path())!)).toString("latin1");
  expect(pdf.startsWith("%PDF-1.4")).toBe(true);
  expect(pdf).toContain(`(${stall.code}) Tj`);
  expect(pdf).toContain("(Contact number: 9437432282) Tj");

  await booked.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("booking-panel")).toContainText("Contact number: 9437432282");
});

test("REG-E2E: with organiser approval required, a new team is told it is awaiting approval and cannot book", async ({ page }) => {
  await resetBooking({ require_team_approval: true });
  const [stall] = await seedStalls(1);
  await page.clock.install();
  await fillRegistration(page);

  // The popup's button also goes to booking (the 30-second timer starts once registration is saved).
  await expect(page.getByTestId("book-stall-section")).toBeVisible();
  await page.clock.fastForward("00:31");
  await page.getByRole("dialog", { name: "Registration successful — Book your stall now" }).getByRole("link", { name: "Book your stall now" }).click();
  await expect(page).toHaveURL(/\/book-your-stall$/);
  await expect(page.getByTestId("eligibility")).toContainText("awaiting approval");
  await page.locator(`svg [data-stall-code="${stall.code}"]`).click();
  await expect(page.getByRole("button", { name: "Book my stall" })).toBeDisabled();
});
