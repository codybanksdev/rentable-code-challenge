from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.response import Response
from api.models import Tenant, Transaction
from api.serializers import (
    LedgerSerializer, MonthlyActivitySerializer, TenantSerializer, TransactionSerializer,
)
from api.services.ledger import build_ledger
from api.services.reports import monthly_activity

# Create your views here.

@api_view(['GET'])
def welcome_message(request):
    """
    A simple view to test the API.
    """
    return Response({'message': 'Welcome to the Rentable Code Challenge!'})

@api_view(['GET'])
def tenant_list(request):
    """
    Returns a list of all tenants with their current balance.
    """
    tenants = Tenant.objects.with_balance().order_by('name', 'id')
    serializer = TenantSerializer(tenants, many=True)
    return Response(serializer.data)

@api_view(['GET'])
def tenant_ledger(request, tenant_id):
    """
    Returns one tenant's transactions, oldest first, with a running balance
    and totals.
    """
    tenant = get_object_or_404(Tenant, pk=tenant_id)
    serializer = LedgerSerializer(build_ledger(tenant))
    return Response(serializer.data)

@api_view(['GET'])
def transaction_list(request):
    """
    Returns a list of transactions, optionally filtered by tenant.
    """
    transactions = Transaction.objects.order_by('date', 'id')
    tenant_id = request.query_params.get('tenant')
    if tenant_id is not None:
        if not tenant_id.isdigit():
            return Response({'detail': 'tenant must be a tenant id.'}, status=400)
        transactions = transactions.filter(tenant_id=tenant_id)
    serializer = TransactionSerializer(transactions, many=True)
    return Response(serializer.data)

@api_view(['GET'])
def monthly_activity_report(request):
    """
    Returns total charges and payments per month across all tenants.
    """
    serializer = MonthlyActivitySerializer(monthly_activity(), many=True)
    return Response(serializer.data)
