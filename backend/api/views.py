import logging
from datetime import datetime

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from api.models import Label, Tenant, Transaction
from api.serializers import (
    LabelSerializer, LedgerSerializer, MonthlyActivitySerializer, RollForwardSerializer,
    TenantLabelsSerializer,
    TenantSerializer, TransactionSerializer,
)
from api.services.ledger import build_ledger
from api.services.ledger_csv import ledger_csv_filename, write_ledger_csv
from api.services.reports import monthly_activity, roll_forward, write_roll_forward_csv

# Create your views here.

logger = logging.getLogger(__name__)

@api_view(['GET'])
def welcome_message(request):
    """
    A simple view to test the API.
    """
    return Response({'message': 'Welcome to the Rentable Code Challenge!'})

@api_view(['GET'])
def tenant_list(request):
    """
    Returns a list of all tenants with their current balance. With `as_of`
    (YYYY-MM-DD), balances are as of the close of that day.
    """
    as_of = _date_param(request, 'as_of')
    tenants = Tenant.objects.with_balance(as_of=as_of).prefetch_related('labels').order_by('name', 'id')
    serializer = TenantSerializer(tenants, many=True)
    return Response(serializer.data)

def _date_param(request, name):
    value = request.query_params.get(name)
    if not value:
        return None
    try:
        # strptime, not date.fromisoformat, which also accepts 20230105.
        return datetime.strptime(value, '%Y-%m-%d').date()
    except ValueError:
        raise ValidationError({name: 'Use the format YYYY-MM-DD.'})

def _date_range(request):
    start = _date_param(request, 'start')
    end = _date_param(request, 'end')
    if start and end and start > end:
        raise ValidationError({'start': 'start must not be after end.'})
    return start, end

def _ledger_for_request(request, tenant_id):
    tenant = get_object_or_404(Tenant, pk=tenant_id)
    start, end = _date_range(request)
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
    response['Content-Disposition'] = f'attachment; filename="{ledger_csv_filename(ledger)}"'
    write_ledger_csv(ledger, response)
    # Financial data left the application: record whose, and which period.
    logger.info('ledger.exported', extra={
        'tenant_id': ledger.tenant.pk, 'pms_tenant_id': ledger.tenant.pms_tenant_id,
        'start': ledger.start, 'end': ledger.end, 'entries': len(ledger.entries),
    })
    return response

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
    Returns, per month across all tenants: net charges, net payments,
    returned payments, the collection rate, and the total receivable at month
    end. Optional `start` and `end` (YYYY-MM-DD) limit the months returned.
    """
    start, end = _date_range(request)
    serializer = MonthlyActivitySerializer(monthly_activity(start, end), many=True)
    return Response(serializer.data)

@api_view(['GET'])
def roll_forward_report(request):
    """
    Returns the receivable roll-forward for a period: per tenant, opening
    balance, net charges, net payments and closing balance, with control
    totals. Optional `start` and `end` (YYYY-MM-DD); without them it covers
    the whole history.
    """
    start, end = _date_range(request)
    return Response(RollForwardSerializer(roll_forward(start, end)).data)

@api_view(['GET'])
def roll_forward_csv(request):
    """
    The same roll-forward statement as a CSV download, ending in a totals row.
    """
    start, end = _date_range(request)
    response = HttpResponse(content_type='text/csv; charset=utf-8')
    period = f"{start or 'start'}-to-{end or 'latest'}"
    response['Content-Disposition'] = f'attachment; filename="roll-forward-{period}.csv"'
    statement = roll_forward(start, end)
    write_roll_forward_csv(statement, response)
    logger.info('roll_forward.exported', extra={
        'start': start, 'end': end, 'tenants': len(statement['rows']),
    })
    return response

@api_view(['GET', 'POST'])
def label_list(request):
    """
    Lists the labels that can be put on tenants, or creates a new one.
    """
    if request.method == 'POST':
        serializer = LabelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        label = serializer.save()
        logger.info('label.created', extra={'label_id': label.pk, 'label': label.name})
        return Response(serializer.data, status=201)
    return Response(LabelSerializer(Label.objects.all(), many=True).data)

@api_view(['PUT'])
def tenant_labels(request, tenant_id):
    """
    Replaces a tenant's labels with the given set and returns the new set.
    """
    tenant = get_object_or_404(Tenant, pk=tenant_id)
    serializer = TenantLabelsSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    labels = serializer.validated_data['label_ids']
    tenant.labels.set(labels)
    # The one write the API allows on a tenant, so it leaves a trace.
    logger.info('tenant.labels_changed', extra={
        'tenant_id': tenant.pk, 'labels': sorted(label.name for label in labels),
    })
    return Response(LabelSerializer(tenant.labels.all(), many=True).data)
