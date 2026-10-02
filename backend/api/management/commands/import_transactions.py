from django.core.management.base import BaseCommand, CommandError
from api.models import Tenant
from api.services.pms_import import PMSImportError, fetch_tenants_with_ledgers, import_tenants

class Command(BaseCommand):
    help = 'Imports tenants and their transaction ledgers from the integration API into the Django database.'

    def handle(self, *args, **options):
        self.stdout.write('Starting transaction import...')

        try:
            tenants_data = fetch_tenants_with_ledgers()
        except PMSImportError as e:
            raise CommandError(str(e))

        result = import_tenants(tenants_data)

        self.stdout.write(
            f'Tenants: {result.tenants_created} created, {result.tenants_linked} linked to an existing local tenant.'
        )
        self.stdout.write(
            f'Transactions: {result.transactions_created} created, {result.transactions_updated} updated, '
            f'{result.transactions_deleted} removed (no longer in the PMS).'
        )
        unlinked = Tenant.objects.filter(pms_tenant_id__isnull=True)
        for tenant in unlinked:
            self.stderr.write(f'Local tenant {tenant.id} ({tenant.name}) has no match in the PMS and has no ledger.')
        for error in result.errors:
            self.stderr.write(error)
        if result.errors:
            raise CommandError(f'Import finished with {len(result.errors)} error(s).')
        self.stdout.write('Successfully imported transaction data.')
