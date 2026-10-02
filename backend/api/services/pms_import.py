"""Sync tenants and their ledgers from the PMS integration API.

See api/integration-data/PMS_API_SPEC.md for the upstream contract.
"""
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation

import requests
from django.db import Error as DatabaseError
from django.db import transaction as db_transaction
from django.utils import timezone

from api.models import Tenant, Transaction
from api.services.categories import categorize

PMS_TENANTS_URL = (
    'https://kpsaflrfjmhwomxiqrtiplvqem0hfmec.lambda-url.us-east-2.on.aws'
    '/api/simulated-pms-integration-api/tenants/'
)
REQUEST_TIMEOUT_SECONDS = 30
CENT = Decimal('0.01')
# Transaction.amount holds 8 digits before the decimal point.
MAX_AMOUNT = Decimal('99999999.99')

logger = logging.getLogger(__name__)
TRANSACTION_FIELDS = ['date', 'description', 'type', 'amount', 'category']


class PMSImportError(Exception):
    """The PMS response could not be fetched or is not shaped as the spec says."""


class InvalidLedgerEntry(ValueError):
    pass


@dataclass
class ImportResult:
    tenants_created: int = 0
    tenants_linked: int = 0
    transactions_created: int = 0
    transactions_updated: int = 0
    transactions_removed: int = 0
    transactions_restored: int = 0
    # One message per tenant whose ledger was left untouched.
    errors: list = field(default_factory=list)


def fetch_tenants_with_ledgers():
    # Without includeLedgers the API returns tenants with no `ledger` key.
    started = time.monotonic()
    try:
        response = requests.get(
            PMS_TENANTS_URL,
            params={'includeLedgers': 'true'},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.exceptions.RequestException, ValueError) as exc:
        logger.error('pms.fetch.failed', extra={
            'error': type(exc).__name__,
            'duration_ms': round((time.monotonic() - started) * 1000),
        })
        raise PMSImportError(f'Error fetching data from integration API: {exc}') from exc
    logger.info('pms.fetch.succeeded', extra={
        'status': response.status_code,
        'bytes': len(response.content),
        'duration_ms': round((time.monotonic() - started) * 1000),
    })
    return _require_tenant_list(payload)


def load_tenants_from_file(path):
    """Read a saved PMS tenants response instead of calling the API."""
    try:
        with open(path, encoding='utf-8') as source:
            payload = json.load(source)
    except (OSError, ValueError) as exc:
        raise PMSImportError(f'Error reading {path}: {exc}') from exc
    return _require_tenant_list(payload)


def _require_tenant_list(payload):
    if not isinstance(payload, list):
        raise PMSImportError('PMS data is not a list of tenants.')
    return payload


def parse_ledger_entry(entry):
    """Validate one PMS ledger entry and return Transaction field values."""
    try:
        pms_id = entry['id']
        if pms_id is None or str(pms_id) == '':
            raise InvalidLedgerEntry('missing id')
        entry_type = entry['type']
        if entry_type not in Transaction.Type.values:
            raise InvalidLedgerEntry(f'unknown type {entry_type!r}')
        # str() first: Decimal(1500.1) would carry the float's binary error.
        amount = Decimal(str(entry['amount']))
        if not amount.is_finite() or amount != amount.quantize(CENT):
            raise InvalidLedgerEntry(f'amount {entry["amount"]!r} is not a whole number of cents')
        if abs(amount) > MAX_AMOUNT:
            raise InvalidLedgerEntry(f'amount {entry["amount"]!r} is too large to store')
        description = entry.get('description') or ''
        return {
            'pms_id': str(pms_id),
            'date': date.fromisoformat(entry['date']),
            'description': description,
            'type': entry_type,
            'amount': amount.quantize(CENT),
            'category': categorize(description),
        }
    except InvalidLedgerEntry:
        raise
    except (KeyError, TypeError, ValueError, InvalidOperation) as exc:
        raise InvalidLedgerEntry(f'{type(exc).__name__}: {exc}') from exc


def _resolve_tenant(tenant_data, result):
    """Find or create the local tenant for a PMS tenant.

    Local ids are not PMS ids, so the only safe key is `pms_tenant_id`. A
    local tenant that predates the link is adopted when exactly one unlinked
    tenant has the same name; otherwise a new tenant is created rather than
    risk putting a ledger on the wrong person.
    """
    pms_tenant_id = tenant_data['tenant_id']
    name = tenant_data.get('name') or ''
    tenant = Tenant.objects.filter(pms_tenant_id=pms_tenant_id).first()
    if tenant is None:
        unlinked = list(Tenant.objects.filter(pms_tenant_id__isnull=True, name=name)[:2])
        if len(unlinked) == 1:
            tenant = unlinked[0]
            tenant.pms_tenant_id = pms_tenant_id
            result.tenants_linked += 1
            logger.info('pms.import.tenant_linked_by_name', extra={
                'tenant_id': tenant.pk, 'pms_tenant_id': pms_tenant_id,
            })
        else:
            tenant = Tenant(pms_tenant_id=pms_tenant_id)
            result.tenants_created += 1
    tenant.name = name
    tenant.unit = tenant_data.get('unit')
    tenant.save()
    return tenant


def _sync_ledger(tenant, ledger, result, synced_at):
    """Make the tenant's local transactions match the PMS ledger exactly."""
    parsed = [parse_ledger_entry(entry) for entry in ledger]
    pms_ids = [values['pms_id'] for values in parsed]
    if len(set(pms_ids)) != len(pms_ids):
        raise InvalidLedgerEntry('duplicate transaction id in ledger')

    existing = {t.pms_id: t for t in tenant.transactions.all()}
    live = [t for t in existing.values() if t.removed_from_pms_at is None]
    if live and not parsed:
        # Every real tenant has a ledger. One that had entries and now has
        # none looks like a bad response, and acting on it would zero the
        # balance. Refuse, and let a person decide.
        raise InvalidLedgerEntry(
            f'the PMS returned an empty ledger but {len(live)} entries are on file'
        )
    to_create, to_update = [], []
    for values in parsed:
        current = existing.pop(values['pms_id'], None)
        if current is None:
            to_create.append(Transaction(tenant=tenant, **values))
            continue
        changed = any(getattr(current, name) != values[name] for name in TRANSACTION_FIELDS)
        restored = current.removed_from_pms_at is not None
        if changed or restored:
            for name in TRANSACTION_FIELDS:
                setattr(current, name, values[name])
            current.removed_from_pms_at = None
            to_update.append(current)
            if restored:
                result.transactions_restored += 1
            else:
                result.transactions_updated += 1

    Transaction.objects.bulk_create(to_create)
    Transaction.objects.bulk_update(to_update, TRANSACTION_FIELDS + ['removed_from_pms_at'])
    # Whatever is left locally is no longer in the PMS ledger. It stops
    # counting toward the balance, so the balance still reconciles with the
    # PMS, but the row is kept to explain why the balance changed.
    newly_removed = [t.pk for t in existing.values() if t.removed_from_pms_at is None]
    Transaction.objects.filter(pk__in=newly_removed).update(removed_from_pms_at=synced_at)

    tenant.ledger_synced_at = synced_at
    tenant.save(update_fields=['ledger_synced_at'])

    result.transactions_created += len(to_create)
    result.transactions_removed += len(newly_removed)


def import_tenants(tenants_data, dry_run=False):
    """Apply a PMS tenants payload to the local database.

    With `dry_run`, everything runs and is counted, then rolled back.
    """
    started = time.monotonic()
    if dry_run:
        # One outer transaction that is always rolled back. Each tenant's own
        # atomic block becomes a savepoint inside it.
        with db_transaction.atomic():
            result = _import_tenants(tenants_data)
            db_transaction.set_rollback(True)
    else:
        # No outer transaction: each tenant commits on its own, so a failure
        # partway through leaves the tenants already done in place.
        result = _import_tenants(tenants_data)
    logger.info('pms.import.finished', extra={
        'dry_run': dry_run,
        'tenants_in_payload': len(tenants_data),
        'tenants_created': result.tenants_created,
        'tenants_linked': result.tenants_linked,
        'transactions_created': result.transactions_created,
        'transactions_updated': result.transactions_updated,
        'transactions_removed': result.transactions_removed,
        'transactions_restored': result.transactions_restored,
        'ledgers_skipped': len(result.errors),
        'duration_ms': round((time.monotonic() - started) * 1000),
    })
    return result


def _import_tenants(tenants_data):
    """Apply the payload tenant by tenant.

    Each tenant is applied in its own database transaction. If any entry in a
    tenant's ledger is invalid, that tenant is left exactly as it was and
    reported in `ImportResult.errors`: a partly imported ledger shows a
    plausible but wrong balance, which is worse than a stale one.
    """
    result = ImportResult()
    synced_at = timezone.now()
    seen = set()
    for tenant_data in tenants_data:
        pms_tenant_id = tenant_data.get('tenant_id') if isinstance(tenant_data, dict) else None
        if not isinstance(pms_tenant_id, int) or isinstance(pms_tenant_id, bool) or pms_tenant_id < 0:
            result.errors.append(f'Skipped a tenant with no usable tenant_id: {pms_tenant_id!r}')
            continue
        if pms_tenant_id in seen:
            # Syncing the second copy would mark the first copy's entries as
            # removed. Keep the first and say so.
            result.errors.append(f'PMS tenant {pms_tenant_id}: appears more than once. Only the first was used.')
            continue
        seen.add(pms_tenant_id)
        ledger = tenant_data.get('ledger')
        if not isinstance(ledger, list):
            result.errors.append(f'PMS tenant {pms_tenant_id}: response has no ledger. Skipped.')
            continue
        tenant_result = ImportResult()
        try:
            with db_transaction.atomic():
                tenant = _resolve_tenant(tenant_data, tenant_result)
                _sync_ledger(tenant, ledger, tenant_result, synced_at)
        except (InvalidLedgerEntry, DatabaseError) as exc:
            # The atomic block has already rolled this tenant back. A database
            # error (a value the schema rejects) is held to one tenant too.
            logger.warning('pms.import.ledger_skipped', extra={
                'pms_tenant_id': pms_tenant_id, 'reason': str(exc),
            })
            result.errors.append(f'PMS tenant {pms_tenant_id}: {exc}. Ledger left unchanged.')
            continue
        # Only counted once this tenant's block has completed.
        result.tenants_created += tenant_result.tenants_created
        result.tenants_linked += tenant_result.tenants_linked
        result.transactions_created += tenant_result.transactions_created
        result.transactions_updated += tenant_result.transactions_updated
        result.transactions_removed += tenant_result.transactions_removed
        result.transactions_restored += tenant_result.transactions_restored
    return result
