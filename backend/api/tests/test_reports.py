import csv
import io
from datetime import date
from decimal import Decimal
from pathlib import Path

from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import Tenant, Transaction
from api.services.ledger import build_ledger
from api.services.reports import roll_forward

SAMPLE = Path(__file__).parent / 'fixtures' / 'pms_tenants_sample.json'


def add(tenant, pms_id, day, type, amount, description='entry'):
    return Transaction.objects.create(
        tenant=tenant, pms_id=pms_id, date=date.fromisoformat(day),
        type=type, amount=Decimal(amount), description=description,
    )


def two_tenants():
    alice = Tenant.objects.create(name='Alice', unit='A1', pms_tenant_id=1)
    bob = Tenant.objects.create(name='Bob', unit='B2', pms_tenant_id=2)
    add(alice, '1', '2023-01-01', 'charge', '1500.00')
    add(alice, '2', '2023-01-05', 'payment', '1000.00')
    add(alice, '3', '2023-02-01', 'charge', '1500.00')
    add(alice, '4', '2023-02-03', 'payment', '1500.00')
    add(alice, '5', '2023-02-10', 'payment', '-1500.00', 'Returned Payment - NSF')
    add(alice, '6', '2023-02-10', 'charge', '35.00', 'Returned Payment Fee')
    add(bob, '7', '2023-02-01', 'charge', '900.00')
    add(bob, '8', '2023-03-01', 'charge', '900.00')
    add(bob, '9', '2023-03-02', 'payment', '1800.00')
    return alice, bob


def test_tenant_list_as_of_gives_each_balance_at_the_close_of_that_day():
    two_tenants()
    client = APIClient()

    def balances(query=''):
        return {t['name']: t['balance'] for t in client.get(f'/api/tenants/{query}').json()}

    assert balances() == {'Alice': '2035.00', 'Bob': '0.00'}
    assert balances('?as_of=2023-01-31') == {'Alice': '500.00', 'Bob': '0.00'}
    assert balances('?as_of=2023-02-09') == {'Alice': '500.00', 'Bob': '900.00'}
    assert balances('?as_of=2023-02-28') == {'Alice': '2035.00', 'Bob': '900.00'}
    assert client.get('/api/tenants/?as_of=yesterday').status_code == 400


def test_as_of_balance_agrees_with_the_ledger_as_of_the_same_day():
    alice, bob = two_tenants()
    as_of = date(2023, 2, 9)

    by_id = {t.pk: t.balance for t in Tenant.objects.with_balance(as_of=as_of)}

    assert by_id[alice.pk] == build_ledger(alice, end=as_of).balance
    assert by_id[bob.pk] == build_ledger(bob, end=as_of).balance


def test_roll_forward_for_a_month():
    two_tenants()

    body = APIClient().get('/api/reports/roll-forward/?start=2023-02-01&end=2023-02-28').json()

    assert [(r['name'], r['opening'], r['charges'], r['payments'], r['closing']) for r in body['rows']] == [
        # A returned payment nets the month's payments to zero.
        ('Alice', '500.00', '1535.00', '0.00', '2035.00'),
        ('Bob', '0.00', '900.00', '0.00', '900.00'),
    ]
    assert body['totals'] == {'opening': '500.00', 'charges': '2435.00', 'payments': '0.00', 'closing': '2935.00'}
    assert (body['start'], body['end']) == ('2023-02-01', '2023-02-28')


def test_roll_forward_identity_holds_for_every_row_and_the_totals():
    two_tenants()

    statement = roll_forward(date(2023, 2, 1), date(2023, 2, 28))

    for row in statement['rows'] + [statement['totals']]:
        assert row['opening'] + row['charges'] - row['payments'] == row['closing']


def test_roll_forward_closing_equals_the_ledger_balance_as_of_the_end_date():
    alice, bob = two_tenants()

    rows = {row['tenant_id']: row for row in roll_forward(date(2023, 2, 1), date(2023, 2, 28))['rows']}

    for tenant in (alice, bob):
        ledger = build_ledger(tenant, start=date(2023, 2, 1), end=date(2023, 2, 28))
        assert rows[tenant.pk]['opening'] == ledger.opening_balance
        assert rows[tenant.pk]['closing'] == ledger.balance


def test_roll_forward_leaves_out_tenants_with_nothing_yet_and_removed_entries():
    alice, bob = two_tenants()
    Tenant.objects.create(name='Nobody', pms_tenant_id=9)
    voided = add(bob, '10', '2023-01-15', 'charge', '50.00')
    voided.removed_from_pms_at = timezone.now()
    voided.save()

    body = APIClient().get('/api/reports/roll-forward/?start=2023-01-01&end=2023-01-31').json()

    # Bob's first real entry is in February, and his January entry was removed.
    assert [r['name'] for r in body['rows']] == ['Alice']
    assert body['totals']['closing'] == '500.00'


def test_roll_forward_without_dates_covers_everything_from_a_zero_opening():
    two_tenants()

    body = APIClient().get('/api/reports/roll-forward/').json()

    assert body['totals'] == {'opening': '0.00', 'charges': '4835.00', 'payments': '2800.00', 'closing': '2035.00'}
    assert APIClient().get('/api/reports/roll-forward/?start=2023-03-01&end=2023-01-01').status_code == 400


def test_roll_forward_csv_ends_with_the_control_totals():
    two_tenants()

    response = APIClient().get('/api/reports/roll-forward.csv?start=2023-02-01&end=2023-02-28')

    assert response['Content-Disposition'] == 'attachment; filename="roll-forward-2023-02-01-to-2023-02-28.csv"'
    assert list(csv.reader(io.StringIO(response.content.decode()))) == [
        ['PMS tenant id', 'Name', 'Unit', 'Opening', 'Charges', 'Payments', 'Closing'],
        ['1', 'Alice', 'A1', '500.00', '1535.00', '0.00', '2035.00'],
        ['2', 'Bob', 'B2', '0.00', '900.00', '0.00', '900.00'],
        ['', 'Total', '', '500.00', '2435.00', '0.00', '2935.00'],
    ]


def test_monthly_activity_reports_returns_collection_rate_and_receivable():
    two_tenants()

    body = APIClient().get('/api/reports/monthly-activity/').json()

    assert body == [
        {'month': '2023-01', 'charges': '1500.00', 'payments': '1000.00', 'returned_payments': '0.00',
         'returned_count': 0, 'collection_rate': '0.6667', 'receivable': '500.00'},
        {'month': '2023-02', 'charges': '2435.00', 'payments': '0.00', 'returned_payments': '1500.00',
         'returned_count': 1, 'collection_rate': '0.0000', 'receivable': '2935.00'},
        {'month': '2023-03', 'charges': '900.00', 'payments': '1800.00', 'returned_payments': '0.00',
         'returned_count': 0, 'collection_rate': '2.0000', 'receivable': '2035.00'},
    ]


def test_monthly_activity_range_keeps_the_receivable_cumulative():
    two_tenants()

    body = APIClient().get('/api/reports/monthly-activity/?start=2023-02-15&end=2023-03-31').json()

    # February is included because part of it is in range, and its receivable
    # still counts January.
    assert [(m['month'], m['receivable']) for m in body] == [('2023-02', '2935.00'), ('2023-03', '2035.00')]


def test_month_end_receivable_equals_the_roll_forward_closing_total():
    call_command('seed_data')
    call_command('import_transactions', source=str(SAMPLE))
    client = APIClient()

    months = client.get('/api/reports/monthly-activity/').json()
    january = next(m for m in months if m['month'] == '2023-01')
    statement = client.get('/api/reports/roll-forward/?start=2023-01-01&end=2023-01-31').json()

    # Two reports, two queries, one number.
    assert january['receivable'] == statement['totals']['closing']
    assert months[-1]['receivable'] == '8781.00'  # 2,425 + 1,240 + 5,116
