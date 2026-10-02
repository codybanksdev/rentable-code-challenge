from django.core.management.base import BaseCommand
from api.models import Tenant

class Command(BaseCommand):
    help = 'Seeds the database with initial data (e.g., tenants).'

    def handle(self, *args, **options):
        self.stdout.write('Starting to seed tenant data.')
        # pms_tenant_id is the tenant's id in the PMS. It is stated here,
        # because the import only ever matches tenants on that id: it does
        # not guess from a name. Charlie Chaplin is not in the PMS.
        tenants_data = [
            {'name': 'Alice Wonderland', 'unit': 'A101', 'pms_tenant_id': 1},
            {'name': 'Bob The Builder', 'unit': 'B202', 'pms_tenant_id': 2},
            {'name': 'Charlie Chaplin', 'unit': 'C303', 'pms_tenant_id': None},
        ]

        for tenant_data in tenants_data:
            tenant, created = Tenant.objects.get_or_create(
                name=tenant_data['name'],
                defaults={'unit': tenant_data['unit'], 'pms_tenant_id': tenant_data['pms_tenant_id']}
            )
            if created:
                continue
            # A database seeded before PMS ids existed gets its link here. An
            # existing link is never changed, and the unit is left to the
            # import once the tenant is linked, since the PMS owns it.
            if tenant.pms_tenant_id is None:
                tenant.pms_tenant_id = tenant_data['pms_tenant_id']
                tenant.unit = tenant_data['unit']
                tenant.save()

        self.stdout.write('Successfully seeded tenant data.')
