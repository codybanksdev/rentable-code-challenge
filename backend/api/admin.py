from django.contrib import admin

from api.models import Tenant, Transaction


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ['name', 'unit', 'pms_tenant_id', 'ledger_synced_at']
    search_fields = ['name', 'unit']


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ['date', 'tenant', 'description', 'type', 'amount', 'pms_id', 'removed_from_pms_at']
    list_filter = ['type', 'removed_from_pms_at']
    search_fields = ['description', 'tenant__name', 'pms_id']
    date_hierarchy = 'date'
