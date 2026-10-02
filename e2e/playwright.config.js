const path = require('path');
const { defineConfig } = require('@playwright/test');

const backend = path.join(__dirname, '..', 'backend');
const frontend = path.join(__dirname, '..', 'frontend');
// A throwaway database, so the suite never touches backend/db.sqlite3.
const database = path.join(backend, 'e2e.sqlite3');
// PMS tenants 1-5 as the live API returned them. Importing from this file
// keeps the suite deterministic and off the network.
const sample = path.join(backend, 'api', 'tests', 'fixtures', 'pms_tenants_sample.json');

module.exports = defineConfig({
    testDir: './tests',
    fullyParallel: true,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: 'http://localhost:3009',
        trace: 'retain-on-failure',
    },
    // The frontend's dev proxy is fixed to port 8009, so the suite uses the
    // same ports as ./start.sh and refuses to run against servers it did not
    // start: stop ./start.sh first.
    webServer: [
        {
            command: [
                `rm -f "${database}"`,
                'python manage.py migrate --verbosity 0',
                'python manage.py seed_data',
                `python manage.py import_transactions --source "${sample}"`,
                'python manage.py runserver 127.0.0.1:8009 --noreload',
            ].join(' && '),
            cwd: backend,
            env: { DJANGO_DB_PATH: database },
            url: 'http://127.0.0.1:8009/api/tenants/',
            reuseExistingServer: false,
            timeout: 60_000,
        },
        {
            command: 'npm start',
            cwd: frontend,
            env: { PORT: '3009', BROWSER: 'none' },
            url: 'http://localhost:3009',
            reuseExistingServer: false,
            timeout: 120_000,
        },
    ],
});
