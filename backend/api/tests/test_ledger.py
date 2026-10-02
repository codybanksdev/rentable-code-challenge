import csv
import io
from datetime import date
from decimal import Decimal

from django.utils import timezone
from rest_framework.test import APIClient

from api.models import Tenant, Transaction
from api.services.categories import categorize
from api.services.ledger import build_ledger


def add(tenant, pms_id, day, type, amount, description='entry'):
    return Transaction.objects.create(
        tenant=tenant, pms_id=pms_id, date=date.fromisoformat(day),
        type=type, amount=Decimal(amount), description=description,
        category=categorize(description),
    )


def test_payments_reduce_the_balance_and_charges_increase_it():
    tenant = Tenant.objects.create(name='Alice')
    add(tenant, '1', '2023-01-01', 'charge', '1500.00')
    add(tenant, '2', '2023-01-05', 'payment', '1000.00')

    ledger = build_ledger(tenant)

    assert [e.running_balance for e in ledger.entries] == [Decimal('1500.00'), Decimal('500.00')]
    assert ledger.balance == Decimal('500.00')


def test_credits_and_returned_payments_keep_their_sign():
    tenant = Tenant.objects.create(name='Alice')
    add(tenant, '1', '2023-01-01', 'charge', '1500.00')
    add(tenant, '2', '2023-01-02', 'charge', '-80.00', 'Utility Credit')
    add(tenant, '3', '2023-01-05', 'payment', '1420.00')
    add(tenant, '4', '2023-01-07', 'payment', '-1420.00', 'Returned Payment - NSF')

    ledger = build_ledger(tenant)

    assert [e.running_balance for e in ledger.entries] == [
        Decimal('1500.00'), Decimal('1420.00'), Decimal('0.00'), Decimal('1420.00'),
    ]
    assert ledger.total_charges == Decimal('1420.00')
    assert ledger.total_payments == Decimal('0.00')
    assert ledger.balance == ledger.total_charges - ledger.total_payments


def test_entries_are_ordered_by_date_then_numeric_pms_id():
    tenant = Tenant.objects.create(name='Alice')
    add(tenant, '10', '2023-01-01', 'payment', '5.00')
    add(tenant, '9', '2023-01-01', 'charge', '5.00')
    add(tenant, '11', '2022-12-20', 'charge', '1.00')

    ledger = build_ledger(tenant)

    assert [e.transaction.pms_id for e in ledger.entries] == ['11', '9', '10']


def test_tenant_with_no_transactions_has_a_zero_balance():
    ledger = build_ledger(Tenant.objects.create(name='Alice'))

    assert ledger.entries == []
    assert ledger.balance == Decimal('0.00')


def test_ledger_endpoint_returns_only_that_tenants_entries_with_totals():
    alice = Tenant.objects.create(name='Alice', unit='A101')
    bob = Tenant.objects.create(name='Bob')
    add(alice, '1', '2023-01-01', 'charge', '1500.00', 'Rent Charge - January')
    add(alice, '2', '2023-01-05', 'payment', '1000.00')
    add(bob, '3', '2023-01-01', 'charge', '999.00')

    response = APIClient().get(f'/api/tenants/{alice.id}/ledger/')

    assert response.status_code == 200
    body = response.json()
    assert body['tenant']['name'] == 'Alice'
    assert body['total_charges'] == '1500.00'
    assert body['total_payments'] == '1000.00'
    assert body['balance'] == '500.00'
    assert [e['pms_id'] for e in body['entries']] == ['1', '2']
    assert body['entries'][0] == {
        'id': body['entries'][0]['id'], 'pms_id': '1', 'date': '2023-01-01',
        'description': 'Rent Charge - January', 'type': 'charge',
        'category': 'rent_and_fees', 'amount': '1500.00', 'running_balance': '1500.00',
    }


def test_ledger_endpoint_404s_for_an_unknown_tenant():
    assert APIClient().get('/api/tenants/999/ledger/').status_code == 404


def test_tenant_list_balance_matches_the_ledger_balance():
    alice = Tenant.objects.create(name='Alice')
    Tenant.objects.create(name='Zed', pms_tenant_id=9)
    add(alice, '1', '2023-01-01', 'charge', '1500.00')
    add(alice, '2', '2023-01-02', 'charge', '-80.00')
    add(alice, '3', '2023-01-05', 'payment', '1000.00')
    add(alice, '4', '2023-01-06', 'payment', '-1000.00')

    body = APIClient().get('/api/tenants/').json()

    assert [(t['name'], t['balance']) for t in body] == [('Alice', '1420.00'), ('Zed', '0.00')]
    assert Decimal(body[0]['balance']) == build_ledger(alice).balance


def test_transaction_list_filters_by_tenant():
    alice = Tenant.objects.create(name='Alice')
    bob = Tenant.objects.create(name='Bob')
    add(alice, '1', '2023-01-01', 'charge', '1.00')
    add(bob, '2', '2023-01-01', 'charge', '2.00')
    client = APIClient()

    assert len(client.get('/api/transactions/').json()) == 2
    assert [t['pms_id'] for t in client.get(f'/api/transactions/?tenant={bob.id}').json()] == ['2']
    assert client.get('/api/transactions/?tenant=abc').status_code == 400


def test_monthly_activity_nets_credits_and_returned_payments_per_month():
    alice = Tenant.objects.create(name='Alice')
    bob = Tenant.objects.create(name='Bob')
    add(alice, '1', '2023-01-01', 'charge', '1500.00')
    add(alice, '2', '2023-01-20', 'charge', '-80.00')
    add(bob, '3', '2023-01-31', 'payment', '1000.00')
    add(bob, '4', '2023-02-01', 'payment', '-1000.00')
    add(bob, '5', '2023-03-15', 'charge', '35.00')

    body = APIClient().get('/api/reports/monthly-activity/').json()

    assert body == [
        {'month': '2023-01', 'charges': '1420.00', 'payments': '1000.00'},
        {'month': '2023-02', 'charges': '0.00', 'payments': '-1000.00'},
        {'month': '2023-03', 'charges': '35.00', 'payments': '0.00'},
    ]


def test_tenant_with_no_pms_record_and_no_transactions_has_no_balance():
    Tenant.objects.create(name='Charlie')
    Tenant.objects.create(name='Linked', pms_tenant_id=4)

    body = APIClient().get('/api/tenants/').json()

    # Unlinked and empty is "nothing on file", not "settled at $0.00".
    assert [(t['name'], t['balance']) for t in body] == [('Charlie', None), ('Linked', '0.00')]


def test_date_range_carries_an_opening_balance_and_gives_the_balance_as_of_the_end():
    tenant = Tenant.objects.create(name='Alice')
    add(tenant, '1', '2023-01-01', 'charge', '1500.00')
    add(tenant, '2', '2023-01-05', 'payment', '1000.00')
    add(tenant, '3', '2023-02-01', 'charge', '1500.00')
    add(tenant, '4', '2023-02-03', 'payment', '1500.00')
    add(tenant, '5', '2023-03-01', 'charge', '1500.00')

    body = APIClient().get(f'/api/tenants/{tenant.id}/ledger/?start=2023-02-01&end=2023-02-28').json()

    assert body['opening_balance'] == '500.00'
    assert [(e['pms_id'], e['running_balance']) for e in body['entries']] == [('3', '2000.00'), ('4', '500.00')]
    # Totals are for the period; the balance is the true balance on Feb 28.
    assert (body['total_charges'], body['total_payments'], body['balance']) == ('1500.00', '1500.00', '500.00')
    assert (body['start'], body['end']) == ('2023-02-01', '2023-02-28')


def test_as_of_date_alone_gives_the_balance_on_that_day():
    tenant = Tenant.objects.create(name='Alice')
    add(tenant, '1', '2023-01-01', 'charge', '1500.00')
    add(tenant, '2', '2023-03-01', 'charge', '1500.00')

    body = APIClient().get(f'/api/tenants/{tenant.id}/ledger/?end=2023-01-31').json()

    assert (body['opening_balance'], body['balance'], len(body['entries'])) == ('0.00', '1500.00', 1)


def test_range_with_no_entries_still_reports_the_carried_balance():
    tenant = Tenant.objects.create(name='Alice')
    add(tenant, '1', '2023-01-01', 'charge', '1500.00')

    body = APIClient().get(f'/api/tenants/{tenant.id}/ledger/?start=2023-06-01').json()

    assert (body['opening_balance'], body['balance'], body['entries']) == ('1500.00', '1500.00', [])


def test_bad_date_parameters_are_rejected():
    tenant = Tenant.objects.create(name='Alice')
    client = APIClient()

    assert client.get(f'/api/tenants/{tenant.id}/ledger/?start=01/02/2023').status_code == 400
    assert client.get(f'/api/tenants/{tenant.id}/ledger/?start=20230102').status_code == 400
    assert client.get(f'/api/tenants/{tenant.id}/ledger/?start=2023-03-01&end=2023-01-01').status_code == 400


def test_entries_removed_from_the_pms_are_listed_but_do_not_count():
    tenant = Tenant.objects.create(name='Alice', pms_tenant_id=1)
    add(tenant, '1', '2023-01-01', 'charge', '1500.00')
    voided = add(tenant, '2', '2023-01-02', 'charge', '50.00', 'Late Fee Charge')
    voided.removed_from_pms_at = timezone.now()
    voided.save()
    client = APIClient()

    body = client.get(f'/api/tenants/{tenant.id}/ledger/').json()

    assert [e['pms_id'] for e in body['entries']] == ['1']
    assert body['balance'] == '1500.00'
    assert [e['description'] for e in body['removed_entries']] == ['Late Fee Charge']
    assert client.get('/api/tenants/').json()[0]['balance'] == '1500.00'
    assert client.get('/api/reports/monthly-activity/').json() == [
        {'month': '2023-01', 'charges': '1500.00', 'payments': '0.00'},
    ]


def test_ledger_csv_matches_the_ledger():
    tenant = Tenant.objects.create(name='Alice')
    add(tenant, '1', '2023-01-01', 'charge', '1500.00', 'Rent Charge - January')
    add(tenant, '2', '2023-01-05', 'payment', '1000.00', 'Rent Payment, partial')
    add(tenant, '3', '2023-02-01', 'charge', '-80.00', '=SUM(A1:A9)')
    add(tenant, '=1+1', '2023-02-02', 'charge', '5.00', '  +cmd')

    response = APIClient().get(f'/api/tenants/{tenant.id}/ledger.csv?start=2023-01-05')

    assert response.status_code == 200
    assert response['Content-Type'] == 'text/csv; charset=utf-8'
    # No PMS id here, so the file is named by the local id and says so.
    assert response['Content-Disposition'] == f'attachment; filename="ledger-local-{tenant.id}.csv"'
    rows = list(csv.reader(io.StringIO(response.content.decode())))
    assert rows == [
        ['Date', 'Description', 'Type', 'Category', 'Charge', 'Payment', 'Balance', 'PMS transaction id'],
        ['2023-01-05', 'Opening balance', '', '', '', '', '1500.00', ''],
        ['2023-01-05', 'Rent Payment, partial', 'payment', 'Rent and fees', '', '1000.00', '500.00', '2'],
        # A description that looks like a formula is exported as text.
        ['2023-02-01', "'=SUM(A1:A9)", 'charge', 'Rent and fees', '-80.00', '', '420.00', '3'],
        # So is a PMS id that does, and text that hides the prefix behind spaces.
        ['2023-02-02', "'  +cmd", 'charge', 'Rent and fees', '5.00', '', '425.00', "'=1+1"],
    ]


def deposit_ledger():
    tenant = Tenant.objects.create(name='Daisy', pms_tenant_id=3)
    add(tenant, '1', '2022-12-20', 'charge', '800.00', 'Security Deposit Charge')
    add(tenant, '2', '2022-12-22', 'payment', '800.00', 'Security Deposit Payment')
    add(tenant, '3', '2023-01-01', 'charge', '1300.00', 'Rent Charge - January')
    add(tenant, '4', '2023-01-03', 'payment', '1000.00', 'Rent Payment - January')
    return tenant


def test_balance_is_split_into_rent_receivable_and_deposit_with_deposit_held_apart():
    ledger = build_ledger(deposit_ledger())

    # The tenant owes $300 of rent. The $800 deposit is fully paid, so none
    # of the balance is deposit, and the landlord is holding $800 of theirs.
    assert ledger.balance == Decimal('300.00')
    assert ledger.rent_and_fees_receivable == Decimal('300.00')
    assert ledger.deposit_due == Decimal('0.00')
    assert ledger.deposit_held == Decimal('800.00')
    assert ledger.rent_and_fees_receivable + ledger.deposit_due == ledger.balance


def test_a_deposit_charged_but_not_yet_paid_is_owed_not_held():
    tenant = deposit_ledger()

    body = APIClient().get(f'/api/tenants/{tenant.id}/ledger/?end=2022-12-21').json()

    assert (body['balance'], body['deposit_due'], body['deposit_held'], body['rent_and_fees_receivable']) == (
        '800.00', '800.00', '0.00', '0.00',
    )


def test_deposit_figures_stand_as_of_the_end_date_even_when_the_range_starts_later():
    tenant = deposit_ledger()

    body = APIClient().get(f'/api/tenants/{tenant.id}/ledger/?start=2023-01-01').json()

    # The deposit entries are before the range, but the money is still held.
    assert [e['description'] for e in body['entries']] == ['Rent Charge - January', 'Rent Payment - January']
    assert (body['deposit_held'], body['rent_and_fees_receivable']) == ('800.00', '300.00')
    assert [e['category'] for e in body['entries']] == ['rent_and_fees', 'rent_and_fees']


def test_a_refunded_deposit_is_no_longer_held():
    tenant = deposit_ledger()
    add(tenant, '5', '2023-06-30', 'payment', '-800.00', 'Security Deposit Refund')
    add(tenant, '6', '2023-06-30', 'charge', '-800.00', 'Security Deposit Released')

    ledger = build_ledger(tenant)

    assert ledger.deposit_held == Decimal('0.00')
    assert ledger.deposit_due == Decimal('0.00')
    assert ledger.balance == Decimal('300.00')


def test_tenant_list_reports_deposit_held_and_ignores_removed_entries():
    tenant = deposit_ledger()
    Tenant.objects.create(name='Nobody', pms_tenant_id=9)
    extra = add(tenant, '7', '2023-02-01', 'payment', '50.00', 'Security Deposit Payment')
    extra.removed_from_pms_at = timezone.now()
    extra.save()

    body = APIClient().get('/api/tenants/').json()

    assert [(t['name'], t['deposit_held']) for t in body] == [('Daisy', '800.00'), ('Nobody', '0.00')]
    assert Decimal(body[0]['deposit_held']) == build_ledger(tenant).deposit_held


def test_csv_for_a_pms_tenant_is_named_by_its_pms_id():
    tenant = Tenant.objects.create(name='Daisy', pms_tenant_id=3)

    response = APIClient().get(f'/api/tenants/{tenant.id}/ledger.csv')

    assert response['Content-Disposition'] == 'attachment; filename="ledger-pms-3.csv"'
