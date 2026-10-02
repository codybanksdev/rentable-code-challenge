import csv

# Spreadsheets run a cell that starts with one of these as a formula.
FORMULA_PREFIXES = ('=', '+', '-', '@')


def _text(value):
    """Stop text such as "=HYPERLINK(...)" running as a formula.

    Applied to every cell that holds PMS text. Leading whitespace is ignored
    when checking, because a spreadsheet ignores it too.
    """
    value = str(value)
    return f"'{value}" if value.lstrip().startswith(FORMULA_PREFIXES) else value


def ledger_csv_filename(ledger):
    """Named by the PMS tenant id, which is the id shown on screen."""
    tenant = ledger.tenant
    name = f'pms-{tenant.pms_tenant_id}' if tenant.pms_tenant_id is not None else f'local-{tenant.pk}'
    return f'ledger-{name}.csv'


def write_ledger_csv(ledger, output):
    """Write a ledger as CSV: one row per entry, oldest first.

    Charge and Payment are separate columns, as on screen, and Balance is the
    running balance. A date-ranged ledger starts with its opening balance.
    Amounts are written as plain numbers so a spreadsheet can add them up.
    """
    writer = csv.writer(output)
    writer.writerow(['Date', 'Description', 'Type', 'Category', 'Charge', 'Payment', 'Balance', 'PMS transaction id'])
    if ledger.start is not None:
        writer.writerow([ledger.start.isoformat(), 'Opening balance', '', '', '', '', ledger.opening_balance, ''])
    for entry in ledger.entries:
        transaction = entry.transaction
        is_payment = transaction.type == transaction.Type.PAYMENT
        writer.writerow([
            transaction.date.isoformat(),
            _text(transaction.description),
            transaction.type,
            transaction.get_category_display(),
            '' if is_payment else transaction.amount,
            transaction.amount if is_payment else '',
            entry.running_balance,
            _text(transaction.pms_id),
        ])
