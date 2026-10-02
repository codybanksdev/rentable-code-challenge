from rest_framework import serializers
from api.models import Tenant, Transaction

class TenantSerializer(serializers.ModelSerializer):
    # Present only when the queryset was built with `Tenant.objects.with_balance()`.
    balance = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = Tenant
        fields = ['id', 'pms_tenant_id', 'name', 'unit', 'balance']

class TransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transaction
        fields = ['id', 'pms_id', 'tenant', 'date', 'description', 'type', 'amount']

class LedgerEntrySerializer(serializers.Serializer):
    id = serializers.IntegerField(source='transaction.id')
    pms_id = serializers.CharField(source='transaction.pms_id')
    date = serializers.DateField(source='transaction.date')
    description = serializers.CharField(source='transaction.description')
    type = serializers.CharField(source='transaction.type')
    amount = serializers.DecimalField(source='transaction.amount', max_digits=10, decimal_places=2)
    running_balance = serializers.DecimalField(max_digits=12, decimal_places=2)

class LedgerSerializer(serializers.Serializer):
    tenant = TenantSerializer()
    total_charges = serializers.DecimalField(max_digits=12, decimal_places=2)
    total_payments = serializers.DecimalField(max_digits=12, decimal_places=2)
    balance = serializers.DecimalField(max_digits=12, decimal_places=2)
    entries = LedgerEntrySerializer(many=True)
