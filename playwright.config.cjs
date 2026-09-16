const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
    testDir: './tests/browser',
    fullyParallel: false,
    workers: 1,
    timeout: 45000,
    expect: { timeout: 10000 },
    reporter: [['list'], ['json', { outputFile: 'test-results/browser-results.json' }]],
    use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium',
        launchOptions: { executablePath: '/usr/bin/google-chrome', args: ['--disable-background-networking'] },
        viewport: { width: 1024, height: 768 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
    webServer: { command: 'node tests/local-preview.cjs', url: 'http://127.0.0.1:4173', reuseExistingServer: true, timeout: 15000 }
});
