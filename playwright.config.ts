import { defineConfig, devices } from "@playwright/test";

const PORT = 4599;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    // The editor uses standard DOM APIs; Chromium covers the e2e surface.
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "node scripts/e2e-serve.mjs",
    url: `${baseURL}/tests/e2e/harness/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
