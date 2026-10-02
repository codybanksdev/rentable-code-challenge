from decimal import Decimal

import pytest
import requests
from django.core.management import call_command
from django.core.management.base import CommandError

from api.models import Tenant, Transaction
from api.services import pms_import
from api.services.pms_import import import_tenants


def entry(id, type='charge', amount=1500.0, date='2023-01-01', description='Rent Charge'):
    return {'id': id, 'date': date, 'description': description, 'type': type, 'amount': amount}


def pms_tenant(tenant_id, name, ledger, unit='A101'):
    return {'tenant_id': tenant_id, 'name': name, 'unit': unit, 'ledger': ledger}


def test_import_stores_type_and_exact_decimal_amounts():
    import_tenants([pms_tenant(7, 'Alice', [entry('1', amount=1500.1), entry('2', 'payment', -80.0)])])

    rows = list(Transaction.objects.order_by('pms_id').values_list('pms_id', 'type', 'amount'))
    assert rows == [('1', 'charge', Decimal('1500.10')), ('2', 'payment', Decimal('-80.00'))]


def test_ledger_attaches_by_pms_tenant_id_not_local_id():
    # Local id 1 belongs to someone who is not PMS tenant 1.
    charlie = Tenant.objects.create(name='Charlie Chaplin', unit='C303')

    import_tenants([pms_tenant(charlie.id, 'Daisy Ridley', [entry('1')], unit='C303')])

    assert charlie.transactions.count() == 0
    daisy = Tenant.objects.get(pms_tenant_id=charlie.id)
    assert daisy.name == 'Daisy Ridley'
    assert daisy.transactions.count() == 1


def test_unlinked_local_tenant_is_adopted_by_name_and_takes_pms_unit():
    bob = Tenant.objects.create(name='Bob The Builder', unit='B202')

    result = import_tenants([pms_tenant(2, 'Bob The Builder', [entry('1')], unit='B205')])

    bob.refresh_from_db()
    assert (bob.pms_tenant_id, bob.unit) == (2, 'B205')
    assert Tenant.objects.count() == 1
    assert (result.tenants_linked, result.tenants_created) == (1, 0)


def test_ambiguous_name_match_creates_a_new_tenant():
    Tenant.objects.create(name='Sam Smith')
    Tenant.objects.create(name='Sam Smith')

    import_tenants([pms_tenant(5, 'Sam Smith', [entry('1')])])

    assert Tenant.objects.count() == 3
    assert Tenant.objects.get(pms_tenant_id=5).transactions.count() == 1


def test_same_transaction_id_under_two_tenants_does_not_collide():
    import_tenants([
        pms_tenant(1, 'Alice', [entry('1', amount=100.0)]),
        pms_tenant(2, 'Bob', [entry('1', amount=200.0)]),
    ])

    assert Tenant.objects.get(pms_tenant_id=1).transactions.get().amount == Decimal('100.00')
    assert Tenant.objects.get(pms_tenant_id=2).transactions.get().amount == Decimal('200.00')


def test_reimport_is_idempotent_and_applies_changes_and_removals():
    import_tenants([pms_tenant(1, 'Alice', [entry('1'), entry('2', 'payment'), entry('3')])])
    local_ids = dict(Transaction.objects.values_list('pms_id', 'id'))

    unchanged = import_tenants([pms_tenant(1, 'Alice', [entry('1'), entry('2', 'payment'), entry('3')])])
    assert (unchanged.transactions_created, unchanged.transactions_updated, unchanged.transactions_deleted) == (0, 0, 0)

    changed = import_tenants([pms_tenant(1, 'Alice', [entry('1', amount=1600.0), entry('2', 'payment')])])
    assert (changed.transactions_created, changed.transactions_updated, changed.transactions_deleted) == (0, 1, 1)
    assert dict(Transaction.objects.values_list('pms_id', 'id')) == {'1': local_ids['1'], '2': local_ids['2']}
    assert Transaction.objects.get(pms_id='1').amount == Decimal('1600.00')


@pytest.mark.parametrize('bad', [
    entry('2', type='refund'),
    entry('2', amount='abc'),
    entry('2', amount=10.005),
    entry('2', date='01/05/2023'),
    {'id': '2', 'date': '2023-01-01', 'type': 'charge'},
    entry('1'),
])
def test_invalid_entry_leaves_that_tenants_ledger_untouched(bad):
    import_tenants([pms_tenant(1, 'Alice', [entry('1')])])

    result = import_tenants([
        pms_tenant(1, 'Alice Renamed', [entry('1', amount=9.0), bad]),
        pms_tenant(2, 'Bob', [entry('1')]),
    ])

    alice = Tenant.objects.get(pms_tenant_id=1)
    assert alice.name == 'Alice'
    assert alice.transactions.get().amount == Decimal('1500.00')
    assert Tenant.objects.get(pms_tenant_id=2).transactions.count() == 1
    assert len(result.errors) == 1 and 'PMS tenant 1' in result.errors[0]
    assert result.transactions_created == 1


def test_missing_ledger_key_does_not_wipe_existing_transactions():
    import_tenants([pms_tenant(1, 'Alice', [entry('1')])])

    result = import_tenants([{'tenant_id': 1, 'name': 'Alice', 'unit': 'A101'}])

    assert Transaction.objects.count() == 1
    assert len(result.errors) == 1


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


def test_command_requests_ledgers_and_imports_them(monkeypatch):
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append((url, params, timeout))
        return FakeResponse([pms_tenant(1, 'Alice', [entry('1')])])

    monkeypatch.setattr(pms_import.requests, 'get', fake_get)

    call_command('import_transactions')

    assert calls == [(pms_import.PMS_TENANTS_URL, {'includeLedgers': 'true'}, pms_import.REQUEST_TIMEOUT_SECONDS)]
    assert Transaction.objects.count() == 1


def test_command_fails_loudly_when_the_api_is_unreachable(monkeypatch):
    def fake_get(*args, **kwargs):
        raise requests.exceptions.ConnectionError('boom')

    monkeypatch.setattr(pms_import.requests, 'get', fake_get)

    with pytest.raises(CommandError, match='Error fetching data'):
        call_command('import_transactions')


def test_command_exits_non_zero_when_a_ledger_was_skipped(monkeypatch):
    monkeypatch.setattr(
        pms_import.requests, 'get',
        lambda *a, **k: FakeResponse([pms_tenant(1, 'Alice', [entry('1', type='refund')])]),
    )

    with pytest.raises(CommandError, match='1 error'):
        call_command('import_transactions')
