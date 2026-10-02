const { test, expect } = require('@playwright/test');

// Writes labels, so it runs in the "write" project after the read-only specs.
// One test, in order, because each step builds on the last.

function rowFor(page, name) {
    return page.locator('.tenant-list > table tbody tr').filter({ hasText: name });
}

// The "Label" filter. Matched by the start of its label text, because the
// label element also contains the select's option text.
function labelFilter(page) {
    return page.locator('label').filter({ hasText: /^Label/ }).locator('select');
}

test('label tenants, filter by label, and see them grouped on the Labels tab', async ({ page }) => {
    await page.goto('/');

    // The three default labels exist from the start.
    await page.getByRole('button', { name: 'Edit labels for Emma Mitchell' }).click();
    let dialog = page.getByRole('dialog', { name: 'Labels: Emma Mitchell' });
    await expect(dialog.getByRole('checkbox')).toHaveCount(3);
    await dialog.getByRole('checkbox', { name: 'At risk' }).check();
    await dialog.getByRole('checkbox', { name: 'Defaulting' }).check();
    await dialog.getByRole('button', { name: 'Save labels' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(rowFor(page, 'Emma Mitchell').locator('.label-chip')).toHaveText(['At risk', 'Defaulting']);

    // The default colours: red for at risk, black for defaulting.
    const chips = rowFor(page, 'Emma Mitchell').locator('.label-chip');
    await expect(chips.nth(0)).toHaveCSS('background-color', 'rgb(198, 40, 40)');
    await expect(chips.nth(1)).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await expect(chips.nth(1)).toHaveCSS('color', 'rgb(255, 255, 255)');

    // A custom label, created while labelling Bob.
    await page.getByRole('button', { name: 'Edit labels for Bob The Builder' }).click();
    dialog = page.getByRole('dialog', { name: 'Labels: Bob The Builder' });
    await dialog.getByRole('checkbox', { name: 'At risk' }).check();
    await dialog.getByLabel('New label').fill('Payment plan');
    await dialog.getByLabel('Colour').fill('#2a78d6');
    await dialog.getByRole('button', { name: 'Create label' }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Payment plan' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Save labels' }).click();
    await expect(rowFor(page, 'Bob The Builder').locator('.label-chip')).toHaveText(['At risk', 'Payment plan']);

    // Filter the tenant list by label.
    await labelFilter(page).selectOption({ label: 'At risk' });
    await expect(page.getByRole('status')).toHaveText('Showing 2 of 6 tenants');
    await labelFilter(page).selectOption({ label: 'Payment plan' });
    await expect(page.locator('.tenant-list > table tbody tr td:nth-child(2)')).toHaveText(['Bob The Builder']);

    // Labels survive a reload: they are stored, not just on screen.
    await page.reload();
    await expect(rowFor(page, 'Emma Mitchell').locator('.label-chip')).toHaveText(['At risk', 'Defaulting']);

    // The Labels tab groups tenants per label, with what each group owes.
    await page.getByRole('tab', { name: 'Labels' }).click();
    const atRisk = page.getByRole('region', { name: 'At risk' });
    await expect(atRisk).toContainText('2 tenants, $7,541.00 due');
    await expect(atRisk.locator('tbody tr td:nth-child(2)')).toHaveText(['Bob The Builder', 'Emma Mitchell']);
    await expect(page.getByRole('region', { name: 'Requires follow up' })).toContainText('No tenants have this label.');

    await labelFilter(page).selectOption({ label: 'Defaulting' });
    await expect(page.getByRole('region')).toHaveCount(1);
    await page.getByRole('button', { name: 'View ledger for Emma Mitchell' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toHaveText('Ledger: Emma Mitchell (Unit F508)');
});
