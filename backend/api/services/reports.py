from decimal import Decimal

from django.db.models import DecimalField, Q, Sum, Value
from django.db.models.functions import Coalesce, TruncMonth

from api.models import Transaction

MONEY = DecimalField(max_digits=14, decimal_places=2)


def _total(transaction_type):
    return Coalesce(Sum('amount', filter=Q(type=transaction_type)), Value(Decimal('0')), output_field=MONEY)


def monthly_activity():
    """Charges and payments per calendar month across all tenants, oldest first.

    Both totals are net, the same way a ledger's totals are: credits reduce
    charges and returned payments reduce payments.
    """
    return list(
        Transaction.objects
        .filter(removed_from_pms_at__isnull=True)
        .annotate(month=TruncMonth('date'))
        .values('month')
        .annotate(
            charges=_total(Transaction.Type.CHARGE),
            payments=_total(Transaction.Type.PAYMENT),
        )
        .order_by('month')
    )
