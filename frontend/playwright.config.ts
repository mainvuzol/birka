import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:5178", trace: "retain-on-failure" },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5178 --strictPort",
    url: "http://127.0.0.1:5178",
    reuseExistingServer: false,
    env: { BIRKA_DEV_API_URL: "http://127.0.0.1:58042" },
  },
});
