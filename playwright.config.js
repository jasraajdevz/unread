// D16: everything runs headless on Linux at 1x billing.
module.exports = {
  testDir: './tests',
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  use: {
    viewport: { width: 480, height: 900 },
    deviceScaleFactor: 2,
    screenshot: 'only-on-failure',
  },
};
