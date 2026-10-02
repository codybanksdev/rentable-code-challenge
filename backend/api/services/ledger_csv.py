import csv

# Spreadsheets run a cell that starts with one of these as a formula.
FORMULA_PREFIXES = ('=', '+', '-', '@')


def _text(value):
    """Stop a description such as "=HYPERLINK(...)" running as a formula."""
    return f"'{value}" if value.startswith(FORMULA_PREFIXES) else value


def write_ledger_csv(ledger, output):
    """Write a ledger as CSV: one row per entry, oldest first.

    Charge and Payment are separate columns, as on screen, and Balance is the
    running balance. A date-ranged ledger starts with its opening balance.
    """
    writer = csv.writer(output)
    writer.writerow(['Date', 'Description', 'Type', 'Charge', 'Payment', 'Balance', 'PMS transaction id'])
    if ledger.start is not None:
        writer.writerow([ledger.start.isoformat(), 'Opening balance', '', '', '', ledger.opening_balance, ''])
    for entry in ledger.entries:
        transaction = entry.transaction
        is_payment = transaction.type == transaction.Type.PAYMENT
        writer.writerow([
            transaction.date.isoformat(),
            _text(transaction.description),
            transaction.type,
            '' if is_payment else transaction.amount,
            transaction.amount if is_payment else '',
            entry.running_balance,
            transaction.pms_id,
        ])
