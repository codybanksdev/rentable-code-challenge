from decimal import Decimal

from rest_framework import serializers
from api.models import Tenant, Transaction

CENT = Decimal('0.01')

class TenantSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Tenant
        fields = ['id', 'pms_tenant_id', 'name', 'unit', 'ledger_synced_at']

class TenantSerializer(TenantSummarySerializer):
    balance = serializers.SerializerMethodField()

    class Meta(TenantSummarySerializer.Meta):
        fields = TenantSummarySerializer.Meta.fields + ['balance']

    def get_balance(self, tenant):
        """The tenant's balance, or null when there is nothing to base one on.

        Requires a queryset built with `Tenant.objects.with_balance()`. A
        tenant with no PMS record and no transactions has no balance: showing
        $0.00 would claim their account is settled.
        """
        if tenant.balance is None:
            return '0.00' if tenant.pms_tenant_id is not None else None
        return str(tenant.balance.quantize(CENT))

class TransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transaction
        fields = ['id', 'pms_id', 'tenant', 'date', 'description', 'type', 'amount', 'removed_from_pms_at']

class TransactionCreateSerializer(serializers.ModelSerializer):
    """A transaction recorded here rather than imported from the PMS."""

    class Meta:
        model = Transaction
        fields = ['date', 'description', 'type', 'amount']

    def validate_amount(self, amount):
        if amount == 0:
            raise serializers.ValidationError('Amount cannot be zero.')
        return amount

class LedgerEntrySerializer(serializers.Serializer):
    id = serializers.IntegerField(source='transaction.id')
    pms_id = serializers.CharField(source='transaction.pms_id', allow_null=True)
    date = serializers.DateField(source='transaction.date')
    description = serializers.CharField(source='transaction.description')
    type = serializers.CharField(source='transaction.type')
    amount = serializers.DecimalField(source='transaction.amount', max_digits=10, decimal_places=2)
    running_balance = serializers.DecimalField(max_digits=12, decimal_places=2)

class LedgerSerializer(serializers.Serializer):
    tenant = TenantSummarySerializer()
    start = serializers.DateField(allow_null=True)
    end = serializers.DateField(allow_null=True)
    opening_balance = serializers.DecimalField(max_digits=12, decimal_places=2)
    total_charges = serializers.DecimalField(max_digits=12, decimal_places=2)
    total_payments = serializers.DecimalField(max_digits=12, decimal_places=2)
    balance = serializers.DecimalField(max_digits=12, decimal_places=2)
    entries = LedgerEntrySerializer(many=True)
    removed_entries = TransactionSerializer(many=True)

class MonthlyActivitySerializer(serializers.Serializer):
    month = serializers.DateField(format='%Y-%m')
    charges = serializers.DecimalField(max_digits=14, decimal_places=2)
    payments = serializers.DecimalField(max_digits=14, decimal_places=2)
