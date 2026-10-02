from django.urls import path
from .views import (
    monthly_activity_report, tenant_ledger, tenant_ledger_csv, tenant_list,
    tenant_transactions, transaction_list,
)

urlpatterns = [
    path('tenants/', tenant_list, name='tenant_list'),
    path('tenants/<int:tenant_id>/ledger/', tenant_ledger, name='tenant_ledger'),
    path('tenants/<int:tenant_id>/ledger.csv', tenant_ledger_csv, name='tenant_ledger_csv'),
    path('tenants/<int:tenant_id>/transactions/', tenant_transactions, name='tenant_transactions'),
    path('transactions/', transaction_list, name='transaction_list'),
    path('reports/monthly-activity/', monthly_activity_report, name='monthly_activity_report'),
]
