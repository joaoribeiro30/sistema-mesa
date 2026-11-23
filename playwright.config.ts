import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

const API_PORT = process.env.E2E_API_PORT || '3001';
const FRONTEND_PORT = process.env.E2E_FRONTEND_PORT || '5174';
const API_URL = process.env.E2E_API_URL || `http://127.0.0.1:${API_PORT}`;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
const REUSE_SERVERS = process.env.E2E_REUSE_SERVERS === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: FRONTEND_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    channel: process.env.E2E_BROWSER_CHANNEL || undefined,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /\.mobile\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testMatch: /\.mobile\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: [
    {
      command: `${npm} run dev:api`,
      url: `${API_URL}/health`,
      reuseExistingServer: REUSE_SERVERS,
      timeout: 30_000,
      env: {
        HOST: '127.0.0.1',
        PORT: API_PORT,
        APP_ORIGIN: API_URL,
        FRONTEND_ORIGIN: FRONTEND_URL,
        CORS_ORIGINS: `${FRONTEND_URL},http://127.0.0.1:${FRONTEND_PORT}`,
      },
    },
    {
      command: `${npm} --prefix frontend run dev -- --port ${FRONTEND_PORT} --strictPort`,
      url: FRONTEND_URL,
      reuseExistingServer: REUSE_SERVERS,
      timeout: 30_000,
      env: {
        VITE_API_BASE_URL: API_URL,
      },
    },
  ],
});
