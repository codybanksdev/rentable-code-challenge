from django.db import models
from django.db.models import Case, DecimalField, F, Q, Sum, When


class TenantQuerySet(models.QuerySet):
    def with_balance(self):
        """Annotate each tenant with `balance`: the amount they currently owe.

        Charges add to the balance and payments reduce it. Amounts keep the
        sign the PMS sent, so a credit (negative charge) reduces the balance
        and a returned payment (negative payment) adds back to it.

        The balance is None for a tenant with no transactions at all, so
        callers can tell "nothing on file" from "settled at zero". Entries the
        PMS has removed are left out.
        """
        money = DecimalField(max_digits=12, decimal_places=2)
        return self.annotate(
            balance=Sum(
                Case(
                    When(
                        transactions__type=Transaction.Type.PAYMENT,
                        then=-F('transactions__amount'),
                    ),
                    default=F('transactions__amount'),
                    output_field=money,
                ),
                filter=Q(transactions__removed_from_pms_at__isnull=True),
            )
        )


class Tenant(models.Model):
    # The tenant's identifier in the PMS. Local ids are assigned by this
    # database and are unrelated to it, so the two must never be compared.
    # Null for tenants that exist locally but have not been matched to the PMS.
    pms_tenant_id = models.PositiveIntegerField(unique=True, null=True, blank=True)
    name = models.CharField(max_length=255)
    unit = models.CharField(max_length=50, blank=True, null=True)
    # When this tenant's ledger was last brought in line with the PMS. Null if
    # it never has been.
    ledger_synced_at = models.DateTimeField(null=True, blank=True)

    objects = TenantQuerySet.as_manager()

    def __str__(self):
        return self.name


class Transaction(models.Model):
    class Type(models.TextChoices):
        CHARGE = 'charge', 'Charge'
        PAYMENT = 'payment', 'Payment'

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='transactions')
    # The transaction's identifier in the PMS (a string in the API). Null for
    # an entry recorded here rather than imported; the import never touches
    # those.
    pms_id = models.CharField(max_length=64, null=True, blank=True)
    date = models.DateField()
    description = models.CharField(max_length=255)
    type = models.CharField(max_length=16, choices=Type.choices)
    # Stored exactly as the PMS sends it. The sign is not the direction of the
    # entry -- `type` is. Use `balance_effect` when adding entries up.
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    # Set when an import finds the PMS no longer has this entry. The row is
    # kept so there is a record of why a balance changed, but it no longer
    # counts toward the balance.
    removed_from_pms_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['tenant', 'pms_id'], name='unique_pms_transaction_per_tenant'
            ),
        ]

    @property
    def balance_effect(self):
        """How much this entry changes what the tenant owes."""
        return -self.amount if self.type == self.Type.PAYMENT else self.amount

    def __str__(self):
        return f"{self.date} - {self.description} ({self.type} {self.amount})"
