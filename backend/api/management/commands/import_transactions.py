from django.core.management.base import BaseCommand, CommandError
from api.models import Tenant
from api.services.pms_import import (
    PMSImportError, fetch_tenants_with_ledgers, import_tenants, load_tenants_from_file,
)

class Command(BaseCommand):
    help = 'Imports tenants and their transaction ledgers from the integration API into the Django database.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--source',
            help='Import from a saved PMS response (JSON file) instead of calling the API.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report what the import would change without writing anything.',
        )

    def handle(self, *args, **options):
        self.stdout.write('Starting transaction import...')

        try:
            if options['source']:
                tenants_data = load_tenants_from_file(options['source'])
            else:
                tenants_data = fetch_tenants_with_ledgers()
        except PMSImportError as e:
            raise CommandError(str(e))

        dry_run = options['dry_run']
        result = import_tenants(tenants_data, dry_run=dry_run)
        if dry_run:
            self.stdout.write('Dry run: nothing was written. This is what would change:')

        self.stdout.write(f'Tenants: {result.tenants_created} created.')
        self.stdout.write(
            f'Transactions: {result.transactions_created} created, {result.transactions_updated} updated, '
            f'{result.transactions_removed} marked removed (no longer in the PMS), '
            f'{result.transactions_restored} restored.'
        )
        # After a dry run the database is unchanged, so this list would be the
        # state before the import, not after it.
        unlinked = Tenant.objects.none() if dry_run else Tenant.objects.filter(pms_tenant_id__isnull=True)
        for tenant in unlinked:
            self.stderr.write(f'Local tenant {tenant.id} ({tenant.name}) has no match in the PMS and has no ledger.')
        for error in result.errors:
            self.stderr.write(error)
        if result.errors:
            raise CommandError(f'Import finished with {len(result.errors)} error(s).')
        if not dry_run:
            self.stdout.write('Successfully imported transaction data.')
