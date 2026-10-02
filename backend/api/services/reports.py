import csv
from decimal import Decimal

from django.db.models import Count, DecimalField, F, Q, Sum, Value
from django.db.models.functions import Coalesce, TruncMonth

from api.models import Tenant, Transaction
from api.services.ledger_csv import csv_text

MONEY = DecimalField(max_digits=14, decimal_places=2)
ZERO = Decimal('0.00')
CENT = Decimal('0.01')
ACTIVE = Q(removed_from_pms_at__isnull=True)


def _sum(field, condition):
    return Coalesce(Sum(field, filter=condition), Value(ZERO), output_field=MONEY)


def monthly_activity(start=None, end=None):
    """One row per calendar month across all tenants, oldest first.

    `charges` and `payments` are net, the same way a ledger's totals are:
    credits reduce charges and returned payments reduce payments.

    `receivable` is what all tenants together owed at the end of that month.
    It is cumulative from the first transaction, so it is worked out over the
    whole history and only then cut down to the months asked for.
    """
    charge = Q(type=Transaction.Type.CHARGE)
    payment = Q(type=Transaction.Type.PAYMENT)
    months = (
        Transaction.objects
        .filter(ACTIVE)
        .annotate(month=TruncMonth('date'))
        .values('month')
        .annotate(
            charges=_sum('amount', charge),
            payments=_sum('amount', payment),
            # A returned payment arrives as a negative payment.
            returned=_sum('amount', payment & Q(amount__lt=0)),
            returned_count=Count('id', filter=payment & Q(amount__lt=0)),
        )
        .order_by('month')
    )

    rows = []
    receivable = ZERO
    for month in months:
        receivable += month['charges'] - month['payments']
        rows.append({
            'month': month['month'],
            'charges': month['charges'],
            'payments': month['payments'],
            # Shown as a positive amount: "$1,375 of payments were returned".
            'returned_payments': -month['returned'],
            'returned_count': month['returned_count'],
            # Share of the month's net charges that was collected. Not
            # meaningful when nothing was charged.
            'collection_rate': (
                (month['payments'] / month['charges']).quantize(Decimal('0.0001'))
                if month['charges'] > 0 else None
            ),
            'receivable': receivable,
        })

    def in_range(row):
        # A month is included if any part of it falls inside the range.
        first = row['month']
        after_start = start is None or (first.year, first.month) >= (start.year, start.month)
        before_end = end is None or first <= end
        return after_start and before_end

    return [row for row in rows if in_range(row)]


def roll_forward(start=None, end=None):
    """The receivable roll-forward for a period: one row per tenant.

        opening + charges - payments = closing

    `opening` is the tenant's balance before `start`, `closing` their balance
    as of `end`, and charges and payments are net for the period. Returns the
    rows and their control totals; the totals obey the same identity, which is
    what lets the statement be tied to a general ledger control account.

    Tenants with no transactions on or before `end` are left out.
    """
    relation = Q(transactions__removed_from_pms_at__isnull=True)
    if end is not None:
        relation &= Q(transactions__date__lte=end)
    charge = Q(transactions__type=Transaction.Type.CHARGE)
    payment = Q(transactions__type=Transaction.Type.PAYMENT)
    in_period = relation
    opening = {}
    if start is not None:
        in_period = relation & Q(transactions__date__gte=start)
        before = relation & Q(transactions__date__lt=start)
        opening = {
            'opening_charges': _sum('transactions__amount', before & charge),
            'opening_payments': _sum('transactions__amount', before & payment),
        }

    tenants = (
        Tenant.objects
        .annotate(
            entries=Count('transactions', filter=relation),
            charges=_sum('transactions__amount', in_period & charge),
            payments=_sum('transactions__amount', in_period & payment),
            **opening,
        )
        .filter(entries__gt=0)
        .order_by('name', 'id')
    )

    rows = []
    totals = {'opening': ZERO, 'charges': ZERO, 'payments': ZERO, 'closing': ZERO}
    for tenant in tenants:
        # SQLite hands sums back without a fixed scale; pin them to cents.
        # With no start date nothing comes before the period, so it opens at zero.
        opening = (
            (tenant.opening_charges - tenant.opening_payments).quantize(CENT)
            if start is not None else ZERO
        )
        charges = tenant.charges.quantize(CENT)
        payments = tenant.payments.quantize(CENT)
        row = {
            'tenant_id': tenant.pk,
            'pms_tenant_id': tenant.pms_tenant_id,
            'name': tenant.name,
            'unit': tenant.unit,
            'opening': opening,
            'charges': charges,
            'payments': payments,
            'closing': opening + charges - payments,
        }
        rows.append(row)
        for key in totals:
            totals[key] += row[key]
    return {'start': start, 'end': end, 'rows': rows, 'totals': totals}


def write_roll_forward_csv(statement, output):
    writer = csv.writer(output)
    writer.writerow(['PMS tenant id', 'Name', 'Unit', 'Opening', 'Charges', 'Payments', 'Closing'])
    for row in statement['rows']:
        writer.writerow([
            '' if row['pms_tenant_id'] is None else row['pms_tenant_id'],
            csv_text(row['name']), csv_text(row['unit'] or ''),
            row['opening'], row['charges'], row['payments'], row['closing'],
        ])
    totals = statement['totals']
    writer.writerow(['', 'Total', '', totals['opening'], totals['charges'], totals['payments'], totals['closing']])

