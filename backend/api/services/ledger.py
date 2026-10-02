from dataclasses import dataclass
from decimal import Decimal

from api.models import Tenant, Transaction

ZERO = Decimal('0.00')


@dataclass
class LedgerEntry:
    transaction: Transaction
    running_balance: Decimal


@dataclass
class Ledger:
    tenant: Tenant
    entries: list
    total_charges: Decimal
    total_payments: Decimal
    balance: Decimal


def _pms_id_sort_key(pms_id):
    # PMS ids are numeric strings today; sort those numerically ("9" before
    # "10") and fall back to text ordering if that ever stops being true.
    return (0, int(pms_id), '') if pms_id.isdigit() else (1, 0, pms_id)


def build_ledger(tenant):
    """Return the tenant's transactions oldest-first with a running balance.

    A positive balance is money the tenant owes; a negative one is a credit.
    `total_charges` and `total_payments` are net of credits and returned
    payments, so `balance == total_charges - total_payments`.
    """
    transactions = sorted(
        tenant.transactions.all(),
        key=lambda t: (t.date, _pms_id_sort_key(t.pms_id)),
    )

    entries = []
    total_charges = ZERO
    total_payments = ZERO
    balance = ZERO
    for transaction in transactions:
        if transaction.type == Transaction.Type.PAYMENT:
            total_payments += transaction.amount
        else:
            total_charges += transaction.amount
        balance += transaction.balance_effect
        entries.append(LedgerEntry(transaction=transaction, running_balance=balance))

    return Ledger(
        tenant=tenant,
        entries=entries,
        total_charges=total_charges,
        total_payments=total_payments,
        balance=balance,
    )
