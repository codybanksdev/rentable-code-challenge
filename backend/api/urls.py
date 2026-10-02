from django.urls import path
from .views import tenant_ledger, tenant_list, transaction_list

urlpatterns = [
    path('tenants/', tenant_list, name='tenant_list'),
    path('tenants/<int:tenant_id>/ledger/', tenant_ledger, name='tenant_ledger'),
    path('transactions/', transaction_list, name='transaction_list'),
]
