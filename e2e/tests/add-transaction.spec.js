const { test, expect } = require('@playwright/test');

// This spec writes to the database, so it runs after the read-only specs
// (see the projects in playwright.config.js) and uses Charlie Chaplin, the
// seeded tenant with no PMS record and no transactions.

test('adding a transaction puts it on the ledger and gives the tenant a balance', async ({ page }) => {
    await page.goto('/');
    const row = page.locator('.tenant-list > table tbody tr').filter({ hasText: 'Charlie Chaplin' });
    await expect(row.locator('td').nth(3)).toHaveText('—');

    await page.getByRole('button', { name: 'View ledger for Charlie Chaplin' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Add a transaction').click();
    await dialog.getByLabel('Date').fill('2023-04-01');
    await dialog.getByLabel('Description').fill('Move-in charge');
    await dialog.getByLabel('Amount').fill('125.50');
    await dialog.getByRole('button', { name: 'Add transaction' }).click();

    const entry = dialog.locator('.ledger-table-scroll tbody tr');
    await expect(entry).toHaveCount(1);
    await expect(entry.locator('td')).toHaveText(['04/01/2023', 'Move-in chargeLocal', '$125.50', '', '$125.50']);
    await expect(dialog.locator('.ledger-balance')).toHaveText('Balance due$125.50');

    // The balance is derived from the transactions, so the list agrees on reload.
    await page.reload();
    await expect(row.locator('td').nth(3)).toHaveText('$125.50');
});

test('a zero amount is rejected with the reason', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'View ledger for Charlie Chaplin' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Add a transaction').click();
    await dialog.getByLabel('Date').fill('2023-04-02');
    await dialog.getByLabel('Description').fill('Nothing');
    await dialog.getByLabel('Amount').fill('0');
    await dialog.getByRole('button', { name: 'Add transaction' }).click();

    await expect(dialog.getByRole('alert')).toHaveText('Could not add the transaction. amount: Amount cannot be zero.');
});
