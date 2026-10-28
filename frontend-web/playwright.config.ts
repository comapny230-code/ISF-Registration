import { defineConfig, devices } from "@playwright/test";
import { E2E_ENV, E2E_ORIGIN, E2E_PORT, e2eDatabaseUrl } from "./e2e/env";

/**
 * Browser tests against the BUILT app (`npm run build` first), started in test
 * mode against a dedicated, guarded database. Locally on Windows the installed
 * Microsoft Edge is used; CI uses Playwright's bundled Chromium.
 */
const channel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "msedge" : undefined);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./e2e/global-setup.ts",
  reporter: [["list"]],
  use: { baseURL: E2E_ORIGIN, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", testIgnore: /mobile\.spec\.ts/, use: { ...devices["Desktop Chrome"], channel } },
    { name: "mobile", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 7"], channel } },
  ],
  webServer: {
    command: `npx next start -p ${E2E_PORT}`,
    url: `${E2E_ORIGIN}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...E2E_ENV, TEST_DATABASE_URL: e2eDatabaseUrl() },
  },
});
