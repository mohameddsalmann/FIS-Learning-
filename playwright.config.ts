import { defineConfig } from "@playwright/test";

const baseURL = process.env.FIS_TEST_URL || "http://localhost:3100";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure",
    ...(process.env.FIS_PLAYWRIGHT_CHANNEL ? { channel: process.env.FIS_PLAYWRIGHT_CHANNEL } : {}) },
  webServer: process.env.FIS_TEST_URL ? undefined : {
    command: "node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3100",
    url: baseURL, reuseExistingServer: !process.env.CI, timeout: 60_000,
  },
});
