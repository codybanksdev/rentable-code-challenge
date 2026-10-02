import json
import logging
from decimal import Decimal
from pathlib import Path

import pytest
import requests
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError

from api.logging import JsonFormatter
from api.models import Tenant, Transaction
from api.services import pms_import
from api.services.ledger import build_ledger
from api.services.pms_import import import_tenants

# PMS tenants 1-5 exactly as the live API returned them.
SAMPLE = Path(__file__).parent / 'fixtures' / 'pms_tenants_sample.json'


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


def test_a_linked_tenant_takes_its_name_and_unit_from_the_pms():
    bob = Tenant.objects.create(name='Bob The Builder', unit='B202', pms_tenant_id=2)

    result = import_tenants([pms_tenant(2, 'Robert The Builder', [entry('1')], unit='B205')])

    bob.refresh_from_db()
    assert (bob.name, bob.unit) == ('Robert The Builder', 'B205')
    assert Tenant.objects.count() == 1
    assert result.tenants_created == 0


def test_a_same_named_local_tenant_is_not_assumed_to_be_the_pms_tenant():
    local = Tenant.objects.create(name='John Smith', unit='A1')

    import_tenants([pms_tenant(5, 'John Smith', [entry('1')], unit='H9')])

    # Two John Smiths: the local one keeps no ledger and no PMS id.
    local.refresh_from_db()
    assert (local.pms_tenant_id, local.unit, local.transactions.count()) == (None, 'A1', 0)
    assert Tenant.objects.get(pms_tenant_id=5).transactions.count() == 1


def test_seed_data_links_known_tenants_to_their_pms_ids():
    # A database seeded before PMS ids existed.
    Tenant.objects.create(name='Alice Wonderland', unit='A101')

    call_command('seed_data')
    call_command('seed_data')

    assert list(Tenant.objects.order_by('name').values_list('name', 'pms_tenant_id')) == [
        ('Alice Wonderland', 1), ('Bob The Builder', 2), ('Charlie Chaplin', None),
    ]


def test_same_transaction_id_under_two_tenants_does_not_collide():
    import_tenants([
        pms_tenant(1, 'Alice', [entry('1', amount=100.0)]),
        pms_tenant(2, 'Bob', [entry('1', amount=200.0)]),
    ])

    assert Tenant.objects.get(pms_tenant_id=1).transactions.get().amount == Decimal('100.00')
    assert Tenant.objects.get(pms_tenant_id=2).transactions.get().amount == Decimal('200.00')


def counts(result):
    return (
        result.transactions_created, result.transactions_updated,
        result.transactions_removed, result.transactions_restored,
    )


def test_reimport_is_idempotent_and_applies_changes():
    import_tenants([pms_tenant(1, 'Alice', [entry('1'), entry('2', 'payment')])])
    local_ids = dict(Transaction.objects.values_list('pms_id', 'id'))

    unchanged = import_tenants([pms_tenant(1, 'Alice', [entry('1'), entry('2', 'payment')])])
    assert counts(unchanged) == (0, 0, 0, 0)

    changed = import_tenants([pms_tenant(1, 'Alice', [entry('1', amount=1600.0), entry('2', 'payment')])])
    assert counts(changed) == (0, 1, 0, 0)
    assert dict(Transaction.objects.values_list('pms_id', 'id')) == local_ids
    assert Transaction.objects.get(pms_id='1').amount == Decimal('1600.00')


def test_entry_gone_from_the_pms_is_kept_but_stops_counting_and_can_come_back():
    import_tenants([pms_tenant(1, 'Alice', [entry('1'), entry('2', amount=50.0)])])
    tenant = Tenant.objects.get(pms_tenant_id=1)

    removed = import_tenants([pms_tenant(1, 'Alice', [entry('1')])])

    assert counts(removed) == (0, 0, 1, 0)
    gone = Transaction.objects.get(pms_id='2')
    assert gone.removed_from_pms_at is not None
    assert build_ledger(tenant).balance == Decimal('1500.00')
    # A later import does not count the same removal again.
    assert counts(import_tenants([pms_tenant(1, 'Alice', [entry('1')])])) == (0, 0, 0, 0)

    restored = import_tenants([pms_tenant(1, 'Alice', [entry('1'), entry('2', amount=50.0)])])

    assert counts(restored) == (0, 0, 0, 1)
    assert Transaction.objects.get(pms_id='2').pk == gone.pk
    assert build_ledger(tenant).balance == Decimal('1550.00')


def test_import_records_when_each_ledger_was_synced():
    result = import_tenants([
        pms_tenant(1, 'Alice', [entry('1')]),
        pms_tenant(2, 'Bob', [entry('1', type='refund')]),
    ])

    assert Tenant.objects.get(pms_tenant_id=1).ledger_synced_at is not None
    # Bob's ledger was rejected, so nothing claims it is fresh.
    assert not Tenant.objects.filter(pms_tenant_id=2).exists()
    assert len(result.errors) == 1


def test_dry_run_reports_the_changes_and_writes_nothing():
    result = import_tenants([pms_tenant(1, 'Alice', [entry('1'), entry('2')])], dry_run=True)

    assert (result.tenants_created, result.transactions_created) == (1, 2)
    assert Tenant.objects.count() == 0
    assert Transaction.objects.count() == 0


def test_dry_run_flag_on_the_command(capsys):
    call_command('import_transactions', source=str(SAMPLE), dry_run=True)

    assert 'Dry run: nothing was written.' in capsys.readouterr().out
    assert Transaction.objects.count() == 0


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
    status_code = 200
    content = b'[]'

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


def test_real_pms_sample_imports_to_the_hand_checked_balances():
    # The seeded local tenants, whose ids must not be mistaken for PMS ids.
    call_command('seed_data')

    call_command('import_transactions', source=str(SAMPLE))

    balances = {
        t.pms_tenant_id: build_ledger(t).balance
        for t in Tenant.objects.filter(pms_tenant_id__isnull=False)
    }
    # Worked by hand from the PMS response; see docs/decisions.md.
    assert balances == {
        1: Decimal('0.00'),     # Alice: charges 5,920, payments 5,920
        2: Decimal('2425.00'),  # Bob: charges 4,025, payments 1,600
        3: Decimal('1240.00'),  # Daisy: an $80 credit arrives as a negative charge
        4: Decimal('0.00'),     # Christopher: a returned payment nets out
        5: Decimal('5116.00'),  # Emma: partial payments and a returned payment
    }
    assert Tenant.objects.get(name='Charlie Chaplin').transactions.count() == 0
    # Deposits are told apart from rent: Alice paid a $1,000 deposit.
    alice = build_ledger(Tenant.objects.get(pms_tenant_id=1))
    assert (alice.deposit_held, alice.deposit_due, alice.rent_and_fees_receivable) == (
        Decimal('1000.00'), Decimal('0.00'), Decimal('0.00'),
    )
    held = sum(build_ledger(t).deposit_held for t in Tenant.objects.filter(pms_tenant_id__isnull=False))
    assert held == Decimal('4450.00')  # 1,000 + 900 + 800 + 1,150 + 600
    assert Tenant.objects.get(name='Bob The Builder').unit == 'B205'
    first = build_ledger(Tenant.objects.get(pms_tenant_id=1)).entries[0].transaction
    assert (first.date.isoformat(), first.description) == ('2022-12-20', 'Security Deposit Charge')


def test_source_file_that_cannot_be_read_fails_the_command(tmp_path):
    with pytest.raises(CommandError, match='Error reading'):
        call_command('import_transactions', source=str(tmp_path / 'missing.json'))


def test_import_logs_a_summary_event_and_each_skipped_ledger(caplog):
    caplog.set_level(logging.INFO, logger='api')
    logging.getLogger('api').propagate = True
    try:
        import_tenants([
            pms_tenant(1, 'Alice', [entry('1')]),
            pms_tenant(2, 'Bob', [entry('1', type='refund')]),
        ])
    finally:
        logging.getLogger('api').propagate = False

    events = {record.getMessage(): record for record in caplog.records}
    assert events['pms.import.ledger_skipped'].pms_tenant_id == 2
    summary = events['pms.import.finished']
    assert (summary.transactions_created, summary.ledgers_skipped, summary.dry_run) == (1, 1, False)


def test_json_formatter_writes_the_event_and_its_fields_as_one_object():
    record = logging.makeLogRecord({
        'name': 'api.services.pms_import', 'levelname': 'INFO',
        'msg': 'pms.import.finished', 'transactions_created': 12,
    })

    line = json.loads(JsonFormatter().format(record))

    assert line['event'] == 'pms.import.finished'
    assert line['level'] == 'INFO'
    assert line['logger'] == 'api.services.pms_import'
    assert line['transactions_created'] == 12
    assert 'timestamp' in line


def test_a_database_error_on_one_tenant_does_not_undo_the_tenants_before_it(monkeypatch):
    real_sync = pms_import._sync_ledger

    def sync_that_fails_for_bob(tenant, ledger, result, synced_at):
        if tenant.pms_tenant_id == 2:
            raise IntegrityError('constraint failed')
        return real_sync(tenant, ledger, result, synced_at)

    monkeypatch.setattr(pms_import, '_sync_ledger', sync_that_fails_for_bob)

    result = import_tenants([
        pms_tenant(1, 'Alice', [entry('1')]),
        pms_tenant(2, 'Bob', [entry('1')]),
        pms_tenant(3, 'Daisy', [entry('1')]),
    ])

    # Alice and Daisy are committed; Bob is rolled back and reported.
    assert sorted(Tenant.objects.values_list('pms_tenant_id', flat=True)) == [1, 3]
    assert Transaction.objects.count() == 2
    assert len(result.errors) == 1 and 'PMS tenant 2' in result.errors[0]


def test_a_negative_tenant_id_is_skipped_and_reported():
    result = import_tenants([pms_tenant(-1, 'Negative', [entry('1')]), pms_tenant(1, 'Alice', [entry('1')])])

    assert list(Tenant.objects.values_list('pms_tenant_id', flat=True)) == [1]
    assert '-1' in result.errors[0]


def test_an_amount_too_large_to_store_is_rejected_at_import():
    result = import_tenants([pms_tenant(1, 'Alice', [entry('1', amount=1e9)])])

    assert Transaction.objects.count() == 0
    assert 'too large' in result.errors[0]


def test_a_tenant_listed_twice_keeps_its_first_ledger():
    result = import_tenants([
        pms_tenant(1, 'Alice', [entry('1')]),
        pms_tenant(1, 'Alice again', [entry('2')]),
    ])

    tenant = Tenant.objects.get(pms_tenant_id=1)
    assert tenant.name == 'Alice'
    assert list(tenant.transactions.values_list('pms_id', 'removed_from_pms_at')) == [('1', None)]
    assert 'more than once' in result.errors[0]


def test_a_rejected_ledger_keeps_its_previous_sync_time():
    import_tenants([pms_tenant(1, 'Alice', [entry('1')])])
    before = Tenant.objects.get(pms_tenant_id=1).ledger_synced_at

    import_tenants([pms_tenant(1, 'Alice', [entry('1', type='refund')])])

    assert Tenant.objects.get(pms_tenant_id=1).ledger_synced_at == before


def test_an_empty_ledger_for_a_tenant_with_history_is_refused():
    import_tenants([pms_tenant(1, 'Alice', [entry('1'), entry('2')])])

    result = import_tenants([pms_tenant(1, 'Alice', [])])

    # Nothing is marked removed on the strength of an empty response.
    assert Transaction.objects.filter(removed_from_pms_at__isnull=True).count() == 2
    assert 'empty ledger' in result.errors[0]


def test_a_new_tenant_with_an_empty_ledger_is_fine():
    result = import_tenants([pms_tenant(1, 'Alice', [])])

    assert Tenant.objects.filter(pms_tenant_id=1).exists()
    assert result.errors == []
