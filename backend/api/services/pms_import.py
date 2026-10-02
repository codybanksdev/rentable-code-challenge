"""Sync tenants and their ledgers from the PMS integration API.

See api/integration-data/PMS_API_SPEC.md for the upstream contract.
"""
import json
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation

import requests
from django.db import transaction as db_transaction

from api.models import Tenant, Transaction

PMS_TENANTS_URL = (
    'https://kpsaflrfjmhwomxiqrtiplvqem0hfmec.lambda-url.us-east-2.on.aws'
    '/api/simulated-pms-integration-api/tenants/'
)
REQUEST_TIMEOUT_SECONDS = 30
CENT = Decimal('0.01')
TRANSACTION_FIELDS = ['date', 'description', 'type', 'amount']


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
    transactions_deleted: int = 0
    # One message per tenant whose ledger was left untouched.
    errors: list = field(default_factory=list)


def fetch_tenants_with_ledgers():
    # Without includeLedgers the API returns tenants with no `ledger` key.
    try:
        response = requests.get(
            PMS_TENANTS_URL,
            params={'includeLedgers': 'true'},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.exceptions.RequestException, ValueError) as exc:
        raise PMSImportError(f'Error fetching data from integration API: {exc}') from exc
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
        return {
            'pms_id': str(pms_id),
            'date': date.fromisoformat(entry['date']),
            'description': entry.get('description') or '',
            'type': entry_type,
            'amount': amount.quantize(CENT),
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
        else:
            tenant = Tenant(pms_tenant_id=pms_tenant_id)
            result.tenants_created += 1
    tenant.name = name
    tenant.unit = tenant_data.get('unit')
    tenant.save()
    return tenant


def _sync_ledger(tenant, ledger, result):
    """Make the tenant's local transactions match the PMS ledger exactly."""
    parsed = [parse_ledger_entry(entry) for entry in ledger]
    pms_ids = [values['pms_id'] for values in parsed]
    if len(set(pms_ids)) != len(pms_ids):
        raise InvalidLedgerEntry('duplicate transaction id in ledger')

    existing = {t.pms_id: t for t in tenant.transactions.all()}
    to_create, to_update = [], []
    for values in parsed:
        current = existing.pop(values['pms_id'], None)
        if current is None:
            to_create.append(Transaction(tenant=tenant, **values))
        elif any(getattr(current, name) != values[name] for name in TRANSACTION_FIELDS):
            for name in TRANSACTION_FIELDS:
                setattr(current, name, values[name])
            to_update.append(current)

    Transaction.objects.bulk_create(to_create)
    Transaction.objects.bulk_update(to_update, TRANSACTION_FIELDS)
    # Whatever is left locally is no longer in the PMS ledger. Keeping it
    # would leave a balance that can never reconcile with the PMS.
    stale_ids = [t.pk for t in existing.values()]
    Transaction.objects.filter(pk__in=stale_ids).delete()

    result.transactions_created += len(to_create)
    result.transactions_updated += len(to_update)
    result.transactions_deleted += len(stale_ids)


def import_tenants(tenants_data):
    """Apply a PMS tenants payload to the local database.

    Each tenant is applied in its own database transaction. If any entry in a
    tenant's ledger is invalid, that tenant is left exactly as it was and
    reported in `ImportResult.errors`: a partly imported ledger shows a
    plausible but wrong balance, which is worse than a stale one.
    """
    result = ImportResult()
    for tenant_data in tenants_data:
        pms_tenant_id = tenant_data.get('tenant_id') if isinstance(tenant_data, dict) else None
        if not isinstance(pms_tenant_id, int) or isinstance(pms_tenant_id, bool):
            result.errors.append(f'Skipped a tenant with no usable tenant_id: {pms_tenant_id!r}')
            continue
        ledger = tenant_data.get('ledger')
        if not isinstance(ledger, list):
            result.errors.append(f'PMS tenant {pms_tenant_id}: response has no ledger. Skipped.')
            continue
        tenant_result = ImportResult()
        try:
            with db_transaction.atomic():
                tenant = _resolve_tenant(tenant_data, tenant_result)
                _sync_ledger(tenant, ledger, tenant_result)
        except InvalidLedgerEntry as exc:
            result.errors.append(f'PMS tenant {pms_tenant_id}: {exc}. Ledger left unchanged.')
            continue
        # Only counted once the tenant's transaction has committed.
        result.tenants_created += tenant_result.tenants_created
        result.tenants_linked += tenant_result.tenants_linked
        result.transactions_created += tenant_result.transactions_created
        result.transactions_updated += tenant_result.transactions_updated
        result.transactions_deleted += tenant_result.transactions_deleted
    return result
