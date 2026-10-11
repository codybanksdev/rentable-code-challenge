from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Optional

from api.models import Tenant, Transaction

ZERO = Decimal('0.00')


@dataclass
class LedgerEntry:
    transaction: Transaction
    running_balance: Decimal


@dataclass
class Ledger:
    tenant: Tenant
    start: Optional[date]
    end: Optional[date]
    # The balance carried in from before `start`; zero when there is no start.
    opening_balance: Decimal
    entries: list
    # Totals for the entries shown, i.e. for the period.
    total_charges: Decimal
    total_payments: Decimal
    # The balance after the last entry shown: the balance as of `end`.
    balance: Decimal
    # `balance` split by what kind of money it is, as of `end`:
    # rent and fees the tenant owes, and security deposit the tenant still
    # owes. They add up to `balance`.
    rent_and_fees_receivable: Decimal
    deposit_due: Decimal
    # Deposit money received and not refunded, as of `end`. This is the
    # tenant's money, held by the landlord: a liability, not a receivable.
    deposit_held: Decimal
    # Entries the PMS has since removed. Listed for audit, counted nowhere.
    removed_entries: list


def _sort_key(transaction):
    # Date first, then PMS id. PMS ids are numeric strings today; sort those
    # numerically ("9" before "10") and fall back to text if that changes.
    pms_id = transaction.pms_id
    if pms_id.isdigit():
        return (transaction.date, 0, int(pms_id), '')
    return (transaction.date, 1, 0, pms_id)


def build_ledger(tenant, start=None, end=None):
    """Return the tenant's transactions oldest-first with a running balance.

    A positive balance is money the tenant owes; a negative one is a credit.

    With a date range, entries before `start` are rolled into
    `opening_balance` and the running balance carries on from there, so every
    row still shows the tenant's true balance on that day rather than a sum of
    the visible rows. Entries after `end` are left out, which makes `balance`
    the balance as of `end`.
    """
    transactions = sorted(tenant.transactions.all(), key=_sort_key)

    opening_balance = ZERO
    total_charges = ZERO
    total_payments = ZERO
    entries = []
    removed_entries = []
    balance = ZERO
    deposit_due = ZERO
    deposit_held = ZERO
    for transaction in transactions:
        if transaction.removed_from_pms_at is not None:
            removed_entries.append(transaction)
            continue
        if end is not None and transaction.date > end:
            continue
        balance += transaction.balance_effect
        # Standing figures, so they count everything up to `end`, including
        # entries before `start`.
        if transaction.category == Transaction.Category.DEPOSIT:
            deposit_due += transaction.balance_effect
            if transaction.type == Transaction.Type.PAYMENT:
                deposit_held += transaction.amount
        if start is not None and transaction.date < start:
            opening_balance = balance
            continue
        if transaction.type == Transaction.Type.PAYMENT:
            total_payments += transaction.amount
        else:
            total_charges += transaction.amount
        entries.append(LedgerEntry(transaction=transaction, running_balance=balance))

    return Ledger(
        tenant=tenant,
        start=start,
        end=end,
        opening_balance=opening_balance,
        entries=entries,
        total_charges=total_charges,
        total_payments=total_payments,
        balance=balance,
        rent_and_fees_receivable=balance - deposit_due,
        deposit_due=deposit_due,
        deposit_held=deposit_held,
        removed_entries=removed_entries,
    )
