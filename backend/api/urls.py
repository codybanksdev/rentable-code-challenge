from django.urls import path
from .views import (
    label_list, monthly_activity_report, roll_forward_csv, roll_forward_report, tenant_labels, tenant_ledger, tenant_ledger_csv,
    tenant_list, transaction_list,
)

urlpatterns = [
    path('tenants/', tenant_list, name='tenant_list'),
    path('tenants/<int:tenant_id>/ledger/', tenant_ledger, name='tenant_ledger'),
    path('tenants/<int:tenant_id>/ledger.csv', tenant_ledger_csv, name='tenant_ledger_csv'),
    path('tenants/<int:tenant_id>/labels/', tenant_labels, name='tenant_labels'),
    path('labels/', label_list, name='label_list'),
    path('transactions/', transaction_list, name='transaction_list'),
    path('reports/monthly-activity/', monthly_activity_report, name='monthly_activity_report'),
    path('reports/roll-forward/', roll_forward_report, name='roll_forward_report'),
    path('reports/roll-forward.csv', roll_forward_csv, name='roll_forward_csv'),
]
