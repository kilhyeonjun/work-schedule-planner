import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {timeout: 10_000},
  use: {baseURL: 'http://127.0.0.1:18787', trace: 'retain-on-failure'},
  webServer: {
    command: 'uv run python scripts/demo_server.py --port 18787',
    cwd: '../..',
    url: 'http://127.0.0.1:18787/demo/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
});
