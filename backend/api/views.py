from datetime import date

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from api.models import Tenant, Transaction
from api.serializers import (
    LedgerSerializer, MonthlyActivitySerializer, TenantSerializer,
    TransactionCreateSerializer, TransactionSerializer,
)
from api.services.ledger import build_ledger
from api.services.ledger_csv import write_ledger_csv
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

def _date_param(request, name):
    value = request.query_params.get(name)
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValidationError({name: 'Use the format YYYY-MM-DD.'})

def _ledger_for_request(request, tenant_id):
    tenant = get_object_or_404(Tenant, pk=tenant_id)
    start = _date_param(request, 'start')
    end = _date_param(request, 'end')
    if start and end and start > end:
        raise ValidationError({'start': 'start must not be after end.'})
    return build_ledger(tenant, start=start, end=end)

@api_view(['GET'])
def tenant_ledger(request, tenant_id):
    """
    Returns one tenant's transactions, oldest first, with a running balance
    and totals. Optional `start` and `end` (YYYY-MM-DD) limit it to a period:
    earlier entries become the opening balance, and the balance returned is
    the balance as of `end`.
    """
    serializer = LedgerSerializer(_ledger_for_request(request, tenant_id))
    return Response(serializer.data)

@api_view(['GET'])
def tenant_ledger_csv(request, tenant_id):
    """
    The same ledger as `tenant_ledger`, as a CSV download.
    """
    ledger = _ledger_for_request(request, tenant_id)
    response = HttpResponse(content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="ledger-tenant-{ledger.tenant.pk}.csv"'
    write_ledger_csv(ledger, response)
    return response

@api_view(['POST'])
def tenant_transactions(request, tenant_id):
    """
    Records a transaction on a tenant's ledger. It has no PMS id, so imports
    leave it alone.
    """
    tenant = get_object_or_404(Tenant, pk=tenant_id)
    serializer = TransactionCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    transaction = serializer.save(tenant=tenant)
    return Response(TransactionSerializer(transaction).data, status=201)

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
