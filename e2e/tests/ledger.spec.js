const { test, expect } = require('@playwright/test');

// The database holds the three seeded tenants plus PMS tenants 1-5 imported
// from backend/api/tests/fixtures/pms_tenants_sample.json. The balances
// asserted here were worked by hand from that file.

function rowFor(page, name) {
    return page.locator('.tenant-list > table tbody tr').filter({ hasText: name });
}

function tenantNames(page) {
    return page.locator('.tenant-list > table tbody tr td:nth-child(2)').allTextContents();
}

async function openLedger(page, name) {
    await page.getByRole('button', { name: `View ledger for ${name}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    return dialog;
}

function ledgerRows(dialog) {
    return dialog.locator('tbody tr');
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveText(/^Showing \d+ of \d+ tenants$/);
});

test('the tenant list shows every tenant with a balance', async ({ page }) => {
    await expect(page.getByRole('status')).toHaveText('Showing 6 of 6 tenants');
    await expect(rowFor(page, 'Daisy Ridley')).toContainText('$1,240.00');
    await expect(rowFor(page, 'Emma Mitchell')).toContainText('$5,116.00');
    await expect(rowFor(page, 'Alice Wonderland')).toContainText('$0.00');
    // The import takes the unit from the PMS: the seed said B202.
    await expect(rowFor(page, 'Bob The Builder')).toContainText('B205');
    // The first column is the PMS id. Charlie has no PMS record, so he has
    // neither an id nor a balance, rather than a misleading $0.00.
    await expect(rowFor(page, 'Daisy Ridley').locator('td')).toHaveText(['3', 'Daisy Ridley', 'C303', '$1,240.00', 'Edit', 'View Ledger']);
    await expect(rowFor(page, 'Charlie Chaplin').locator('td')).toHaveText(['—', 'Charlie Chaplin', 'C303', '—', 'Edit', 'View Ledger']);
    // Charlie has never been synced, and the list says so.
    await expect(page.getByText(/^Most recent ledger sync from the PMS: .* 1 never synced\.$/)).toBeVisible();
});

test('View Ledger shows that tenant\'s transactions with a running balance', async ({ page }) => {
    const dialog = await openLedger(page, 'Daisy Ridley');

    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Ledger: Daisy Ridley (Unit C303)');
    await expect(ledgerRows(dialog)).toHaveCount(10);
    await expect(ledgerRows(dialog).first()).toContainText('12/20/2022');
    await expect(ledgerRows(dialog).first()).toContainText('Security Deposit Charge');
    // A credit arrives from the PMS as a negative charge and lowers the balance.
    const credit = ledgerRows(dialog).filter({ hasText: 'Utility Credit' });
    await expect(credit.locator('td')).toHaveText(['03/05/2023', 'Utility Credit', '($80.00)', '', '$1,240.00']);
    await expect(dialog.locator('.ledger-balance')).toContainText('Balance due$1,240.00');
    await expect(dialog.locator('.ledger-summary')).toContainText('Net charges$4,720.00');
    await expect(dialog.locator('.ledger-summary')).toContainText('Net payments$3,480.00');
});

test('a returned payment adds back to the balance', async ({ page }) => {
    const dialog = await openLedger(page, 'Christopher Jackson');

    const returned = ledgerRows(dialog).filter({ hasText: 'Returned Payment - NSF' });
    await expect(returned.locator('td').nth(3)).toHaveText('($1,375.00)');
    await expect(dialog.locator('.ledger-balance')).toContainText('Paid in full$0.00');
});

test('entries are in date order even when PMS ids are not', async ({ page }) => {
    // Alice's deposit has PMS ids 3 and 4 but is dated before ids 1 and 2.
    const dialog = await openLedger(page, 'Alice Wonderland');

    await expect(ledgerRows(dialog).nth(0)).toContainText('Security Deposit Charge');
    await expect(ledgerRows(dialog).nth(2)).toContainText('Rent Charge - January');
});

test('a local tenant with no PMS record gets no one else\'s ledger', async ({ page }) => {
    // Charlie is local tenant 3; PMS tenant 3 is Daisy Ridley.
    const dialog = await openLedger(page, 'Charlie Chaplin');

    await expect(dialog).toContainText('No transactions found for this tenant.');
    await expect(dialog).toContainText('This tenant is not linked to a PMS record.');
    await expect(dialog.getByText('Paid in full')).toHaveCount(0);
});

test('the ledger closes with Escape, the Close button and a backdrop click', async ({ page }) => {
    await openLedger(page, 'Daisy Ridley');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await openLedger(page, 'Daisy Ridley');
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await openLedger(page, 'Daisy Ridley');
    await page.locator('.ledger-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('column headers sort the list', async ({ page }) => {
    expect(await tenantNames(page)).toEqual([
        'Alice Wonderland', 'Bob The Builder', 'Charlie Chaplin',
        'Christopher Jackson', 'Daisy Ridley', 'Emma Mitchell',
    ]);

    const balance = page.getByRole('columnheader', { name: 'Balance' });
    await balance.getByRole('button').click();
    await expect(balance).toHaveAttribute('aria-sort', 'ascending');
    await balance.getByRole('button').click();
    await expect(balance).toHaveAttribute('aria-sort', 'descending');
    expect((await tenantNames(page)).slice(0, 3)).toEqual(['Emma Mitchell', 'Bob The Builder', 'Daisy Ridley']);

    await page.getByRole('columnheader', { name: 'Unit' }).getByRole('button').click();
    expect(await tenantNames(page)).toEqual([
        'Alice Wonderland', 'Bob The Builder', 'Charlie Chaplin',
        'Daisy Ridley', 'Emma Mitchell', 'Christopher Jackson',
    ]);
});

test('filters by unit prefix and by balance range', async ({ page }) => {
    await page.getByLabel('Unit prefix').selectOption('C');
    expect(await tenantNames(page)).toEqual(['Charlie Chaplin', 'Daisy Ridley']);

    await page.getByLabel('Min balance').fill('1');
    expect(await tenantNames(page)).toEqual(['Daisy Ridley']);
    await expect(page.getByRole('status')).toHaveText('Showing 1 of 6 tenants');

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByLabel('Min balance').fill('1000');
    await page.getByLabel('Max balance').fill('3000');
    expect(await tenantNames(page)).toEqual(['Bob The Builder', 'Daisy Ridley']);

    await page.getByLabel('Min balance').fill('99999');
    await expect(page.getByText('No tenants match these filters.')).toBeVisible();
});

test('the column headers stay visible while the list scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 200 });
    const header = page.getByRole('columnheader', { name: 'Name' });

    await rowFor(page, 'Emma Mitchell').scrollIntoViewIfNeeded();

    await expect(rowFor(page, 'Alice Wonderland')).not.toBeInViewport();
    await expect(header).toBeInViewport();
});

test('the sticky list header does not paint over an open ledger', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 300 });
    await rowFor(page, 'Emma Mitchell').scrollIntoViewIfNeeded();
    const header = page.getByRole('columnheader', { name: 'Name' });
    await expect(header).toBeInViewport();
    const box = await header.boundingBox();

    await openLedger(page, 'Emma Mitchell');

    // Whatever is drawn where the list header sits must belong to the ledger.
    const coveredByLedger = await page.evaluate(
        ({ x, y }) => Boolean(document.elementFromPoint(x, y).closest('.ledger-backdrop')),
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(coveredByLedger).toBe(true);
});

test('the ledger\'s own column headers stay visible while it scrolls', async ({ page }) => {
    // Tall enough for the whole dialog, so only the entries scroll.
    await page.setViewportSize({ width: 900, height: 950 });
    const dialog = await openLedger(page, 'Emma Mitchell');
    const header = dialog.getByRole('columnheader', { name: 'Description' });

    await ledgerRows(dialog).last().scrollIntoViewIfNeeded();

    await expect(ledgerRows(dialog).first()).not.toBeInViewport();
    await expect(header).toBeInViewport();
    await expect(dialog.locator('.ledger-balance')).toBeInViewport();
});

test('the Insights tab charts the portfolio', async ({ page }) => {
    await page.getByRole('tab', { name: 'Insights' }).click();

    // Bob 2,425 + Daisy 1,240 + Emma 5,116.
    await expect(page.locator('.stat-tile').first()).toContainText('Total outstanding, today$8,781.00');
    await expect(page.locator('.stat-tile').first()).toContainText('3 tenants with a balance due');
    const largest = page.getByRole('region', { name: 'Largest balances due, today' });
    await expect(largest.getByRole('listitem')).toHaveText([
        'Emma Mitchell (F508)$5,116.00', 'Bob The Builder (B205)$2,425.00', 'Daisy Ridley (C303)$1,240.00',
    ]);

    const monthly = page.getByRole('region', { name: 'Net charges and payments by month' });
    await monthly.locator('rect[data-month="2023-01"]').hover();
    await expect(monthly.getByRole('status')).toContainText('Jan 2023');
    await expect(monthly.getByRole('status')).toContainText('Net charges:');

    await page.getByRole('tab', { name: 'Tenants' }).click();
    await expect(page.getByRole('status')).toHaveText('Showing 6 of 6 tenants');
});

test('a name under Largest balances due opens that tenant\'s ledger', async ({ page }) => {
    await page.getByRole('tab', { name: 'Insights' }).click();
    const largest = page.getByRole('region', { name: 'Largest balances due, today' });

    await largest.getByRole('button', { name: 'View ledger for Emma Mitchell' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Ledger: Emma Mitchell (Unit F508)');
    await expect(dialog.locator('.ledger-balance')).toContainText('Balance due$5,116.00');
    // Same table styling as when it is opened from the tenant list.
    await expect(dialog.getByRole('columnheader', { name: 'Description' })).toHaveCSS('position', 'sticky');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(largest).toBeVisible();
});

test('the ledger shows how long the tenant has been active and charts the balance', async ({ page }) => {
    const dialog = await openLedger(page, 'Daisy Ridley');

    // First entry 12/20/2022, last 03/05/2023: December to March.
    await expect(dialog.locator('.ledger-summary')).toContainText('Tenant for4 months');
    await expect(dialog.locator('.ledger-summary')).toContainText('12/20/2022 to 03/05/2023');

    const chart = dialog.getByRole('region', { name: 'Balance over time' });
    await expect(chart.getByRole('img')).toHaveAccessibleName(
        'Balance from 12/20/2022 to 03/05/2023, ending at $1,240.00',
    );
    // Hovering the right-hand edge reads out the last entry.
    const box = await chart.locator('svg').boundingBox();
    await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
    await expect(chart.getByRole('status')).toContainText('03/05/2023');
    await expect(chart.getByRole('status')).toContainText('Balance: $1,240.00');
});

test('a date range shows an opening balance and the balance as of the end date', async ({ page }) => {
    const dialog = await openLedger(page, 'Daisy Ridley');

    await dialog.getByLabel('From', { exact: true }).fill('2023-02-01');
    await dialog.getByLabel('To', { exact: true }).fill('2023-02-28');

    // Before February she owed $20.00 (a $100 parking fee less an $80 payment).
    await expect(ledgerRows(dialog).first().locator('td')).toHaveText(['02/01/2023', 'Opening balance', '', '', '$20.00']);
    await expect(ledgerRows(dialog)).toHaveCount(3);
    await expect(dialog.locator('.ledger-balance')).toContainText('Balance as of 02/28/2023$20.00');

    await dialog.getByRole('button', { name: 'All dates' }).click();
    await expect(ledgerRows(dialog)).toHaveCount(10);
    await expect(dialog.locator('.ledger-balance')).toContainText('Balance due$1,240.00');
});

test('Export CSV downloads the ledger that is on screen', async ({ page }) => {
    const dialog = await openLedger(page, 'Daisy Ridley');
    await dialog.getByLabel('From', { exact: true }).fill('2023-03-01');
    await expect(ledgerRows(dialog)).toHaveCount(3);

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        dialog.getByRole('button', { name: 'Export CSV' }).click(),
    ]);

    expect(download.suggestedFilename()).toBe('ledger-pms-3.csv');
    const lines = require('fs').readFileSync(await download.path(), 'utf8').trim().split(/\r?\n/);
    expect(lines).toEqual([
        'Date,Description,Type,Category,Charge,Payment,Balance,PMS transaction id',
        '2023-03-01,Opening balance,,,,,20.00,',
        '2023-03-01,Rent Charge - March,Charge,Rent and fees,1300.00,,1320.00,30',
        '2023-03-05,Utility Credit,Charge,Rent and fees,-80.00,,1240.00,20',
    ]);
});

test('opening the ledger moves focus into it and closing returns it', async ({ page }) => {
    const button = page.getByRole('button', { name: 'View ledger for Daisy Ridley' });
    await button.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
});

test('the ledger separates the deposit held from the balance owed', async ({ page }) => {
    const dialog = await openLedger(page, 'Daisy Ridley');

    // She owes $1,240 of rent and fees. Her $800 deposit is paid, so it is
    // held for her and is no part of what she owes.
    await expect(dialog.locator('.ledger-balance')).toContainText('Rent and fees $1,240.00');
    await expect(dialog.locator('.ledger-balance')).not.toContainText('deposit');
    await expect(dialog.locator('.ledger-summary')).toContainText('Deposit held$800.00');
    await expect(ledgerRows(dialog).nth(0)).toContainText('Security Deposit ChargeDeposit');
    await expect(ledgerRows(dialog).nth(2).locator('.badge')).toHaveCount(0);

    // On the day after the deposit was charged it had not been paid yet:
    // it was owed, and nothing was held.
    await dialog.getByLabel('To', { exact: true }).fill('2022-12-21');
    await expect(dialog.locator('.ledger-balance')).toContainText('Balance as of 12/21/2022$800.00');
    await expect(dialog.locator('.ledger-balance')).toContainText('Rent and fees $0.00, deposit $800.00');
    await expect(dialog.locator('.ledger-summary')).toContainText('Deposit held$0.00');
});

test('Insights totals the deposits held', async ({ page }) => {
    await page.getByRole('tab', { name: 'Insights' }).click();

    // 1,000 + 900 + 800 + 1,150 + 600 for the five PMS tenants.
    const tile = page.locator('.stat-tile').filter({ hasText: 'Deposits held, today' });
    await expect(tile).toContainText('$4,450.00');
    await expect(tile).toContainText('for 5 tenants');
});

test('dragging across the balance chart narrows the ledger to that period', async ({ page }) => {
    const dialog = await openLedger(page, 'Emma Mitchell');
    await expect(ledgerRows(dialog).first()).toContainText('Security Deposit Charge');
    const rowsBefore = await ledgerRows(dialog).count();
    const box = await dialog.getByRole('region', { name: 'Balance over time' }).locator('svg').boundingBox();
    const y = box.y + box.height / 2;

    await page.mouse.move(box.x + box.width * 0.4, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, y, { steps: 5 });
    await page.mouse.up();

    await expect(dialog.getByLabel('From', { exact: true })).not.toHaveValue('');
    await expect(dialog.getByLabel('To', { exact: true })).not.toHaveValue('');
    await expect(ledgerRows(dialog).first()).toContainText('Opening balance');
    await expect.poll(() => ledgerRows(dialog).count()).toBeLessThan(rowsBefore);
    await expect(dialog.locator('.ledger-balance')).toContainText('Balance as of');

    await dialog.getByRole('button', { name: 'All dates' }).click();
    await expect(ledgerRows(dialog)).toHaveCount(rowsBefore);
});

test('the roll-forward ties to the total outstanding, for all time and for a period', async ({ page }) => {
    await page.getByRole('tab', { name: 'Insights' }).click();
    const statement = page.getByRole('region', { name: 'Receivable roll-forward' });
    const totals = statement.locator('tfoot td');

    // All time: nothing carried in, and the closing total is what is owed
    // net of the tenants in credit (none in this sample).
    await expect(statement.locator('tfoot th')).toHaveText('Total, 5 tenants');
    await expect(totals.nth(0)).toHaveText('$0.00');
    await expect(totals.nth(3)).toHaveText('$8,781.00');

    await page.getByLabel('From', { exact: true }).fill('2023-02-01');
    await page.getByLabel('To', { exact: true }).fill('2023-02-28');

    const tile = page.locator('.stat-tile').first();
    await expect(tile).toContainText('Total outstanding, as of 02/28/2023');
    await expect(statement).toContainText('02/01/2023 to 02/28/2023.');
    // Two different queries must agree. The closing total is net of tenants
    // in credit, so it is total outstanding less credits held.
    const dollars = async locator => Number((await locator.textContent()).replace(/[$,]/g, ''));
    const outstanding = await dollars(tile.locator('.stat-value'));
    const credits = await dollars(page.locator('.stat-tile').filter({ hasText: 'Credits held' }).locator('.stat-value'));
    await expect.poll(() => dollars(totals.nth(3))).toBe(outstanding - credits);
    // Daisy carried $20.00 into February and it was still $20.00 at the end.
    const daisy = statement.locator('tbody tr').filter({ hasText: 'Daisy Ridley' }).locator('td');
    await expect(daisy.nth(3)).toHaveText('$20.00');
    await expect(daisy.nth(6)).toHaveText('$20.00');

    await page.getByRole('button', { name: 'All dates' }).click();
    await expect(totals.nth(3)).toHaveText('$8,781.00');
});

test('the roll-forward exports as CSV with a totals row', async ({ page }) => {
    await page.getByRole('tab', { name: 'Insights' }).click();
    const statement = page.getByRole('region', { name: 'Receivable roll-forward' });
    await expect(statement.locator('tfoot th')).toHaveText('Total, 5 tenants');

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        statement.getByRole('button', { name: 'Export CSV' }).click(),
    ]);

    expect(download.suggestedFilename()).toBe('roll-forward-start-to-latest.csv');
    const lines = require('fs').readFileSync(await download.path(), 'utf8').trim().split(/\r?\n/);
    expect(lines[0]).toBe('PMS tenant id,Name,Unit,Opening,Charges,Payments,Closing');
    expect(lines).toHaveLength(7);
    expect(lines[6]).toMatch(/^,Total,,0\.00,[\d.]+,[\d.]+,8781\.00$/);
});

test('Insights charts the receivable and returned payments, and tabulates the collection rate', async ({ page }) => {
    await page.getByRole('tab', { name: 'Insights' }).click();

    const receivable = page.getByRole('region', { name: 'Total receivable at month end' });
    await receivable.locator('rect[data-month]').last().hover();
    // The last month's receivable is the total outstanding.
    await expect(receivable.getByRole('status')).toContainText('Receivable: $8,781.00');
    await expect(page.getByRole('region', { name: 'Returned payments by month' }).getByRole('img')).toBeVisible();
    // The comparison of charges and payments is drawn as bars, two per month.
    const activity = page.getByRole('region', { name: 'Net charges and payments by month' });
    const months = await activity.locator('rect[data-month]').count();
    await expect(activity.locator('rect:not([data-month])')).toHaveCount(months * 2);

    const table = page.getByRole('region', { name: 'Monthly figures' });
    await expect(table.getByRole('columnheader', { name: 'Collection rate' })).toBeVisible();
    await expect(table.locator('tbody tr').last().locator('td').last()).toHaveText('$8,781.00');
});

test('the tenant list can show balances as of a past date', async ({ page }) => {
    await expect(rowFor(page, 'Daisy Ridley')).toContainText('$1,240.00');

    await page.getByLabel('Balances as of').fill('2023-02-28');

    await expect(rowFor(page, 'Daisy Ridley')).toContainText('$20.00');
    await expect(page.getByRole('note')).toHaveText('Balances are as of 02/28/2023, not today.');

    await page.getByLabel('Balances as of').fill('');
    await expect(rowFor(page, 'Daisy Ridley')).toContainText('$1,240.00');
    await expect(page.getByRole('note')).toHaveCount(0);
});

test('the roll-forward sorts by closing balance, with the totals row staying last', async ({ page }) => {
    await page.getByRole('tab', { name: 'Insights' }).click();
    const statement = page.getByRole('region', { name: 'Receivable roll-forward' });
    const names = statement.locator('tbody tr td:nth-child(2)');
    await expect(names).toHaveText([
        'Alice Wonderland', 'Bob The Builder', 'Christopher Jackson', 'Daisy Ridley', 'Emma Mitchell',
    ]);

    const closing = statement.getByRole('columnheader', { name: 'Closing' });
    await closing.getByRole('button').click();
    await closing.getByRole('button').click();

    await expect(closing).toHaveAttribute('aria-sort', 'descending');
    await expect(names.first()).toHaveText('Emma Mitchell');
    await expect(names.nth(1)).toHaveText('Bob The Builder');
    await expect(statement.locator('tfoot td').nth(3)).toHaveText('$8,781.00');
});
