from django.contrib import admin

from api.models import Label, Tenant, Transaction


@admin.register(Label)
class LabelAdmin(admin.ModelAdmin):
    list_display = ['name', 'color']


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ['name', 'unit', 'pms_tenant_id', 'ledger_synced_at']
    search_fields = ['name', 'unit']
    list_filter = ['labels']


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ['date', 'tenant', 'description', 'type', 'amount', 'pms_id', 'removed_from_pms_at']
    list_filter = ['type', 'removed_from_pms_at']
    search_fields = ['description', 'tenant__name', 'pms_id']
    date_hierarchy = 'date'
