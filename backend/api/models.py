from django.core.validators import RegexValidator
from django.db import models
from django.db.models import Case, DecimalField, F, Q, Sum, When


class TenantQuerySet(models.QuerySet):
    def with_balance(self, as_of=None):
        """Annotate each tenant with `balance`, the amount they currently owe,
        and `deposit_held`, the security deposit being held for them.

        Charges add to the balance and payments reduce it. Amounts keep the
        sign the PMS sent, so a credit (negative charge) reduces the balance
        and a returned payment (negative payment) adds back to it.

        The balance is None for a tenant with no transactions at all, so
        callers can tell "nothing on file" from "settled at zero". Entries the
        PMS has removed are left out.

        With `as_of`, only transactions dated on or before it count, which
        gives each tenant's balance at the close of that day.
        """
        money = DecimalField(max_digits=12, decimal_places=2)
        counted = Q(transactions__removed_from_pms_at__isnull=True)
        if as_of is not None:
            counted &= Q(transactions__date__lte=as_of)
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
                filter=counted,
            ),
            # Deposit money actually received, net of refunds. It is the
            # tenant's money that the landlord is holding.
            deposit_held=Sum(
                'transactions__amount',
                filter=counted & Q(
                    transactions__category=Transaction.Category.DEPOSIT,
                    transactions__type=Transaction.Type.PAYMENT,
                ),
            ),
        )


class Label(models.Model):
    """A tag the accounting team puts on tenants, such as "At risk".

    Labels belong to this application. The PMS knows nothing about them and
    an import never changes them.
    """
    name = models.CharField(max_length=40, unique=True)
    # Background colour of the label's chip, as #rrggbb.
    color = models.CharField(
        max_length=7,
        validators=[RegexValidator(r'^#[0-9a-fA-F]{6}$', 'Use a colour in the form #rrggbb.')],
    )

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


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
    labels = models.ManyToManyField(Label, related_name='tenants', blank=True)

    objects = TenantQuerySet.as_manager()

    def __str__(self):
        return self.name


class Transaction(models.Model):
    class Type(models.TextChoices):
        CHARGE = 'charge', 'Charge'
        PAYMENT = 'payment', 'Payment'

    class Category(models.TextChoices):
        # Rent, fees, utilities and their payments: money owed to the landlord.
        RENT_AND_FEES = 'rent_and_fees', 'Rent and fees'
        # Security deposit: the tenant's money, held by the landlord. A
        # liability, kept apart from what the tenant owes.
        DEPOSIT = 'deposit', 'Security deposit'

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='transactions')
    # The transaction's identifier in the PMS (a string in the API).
    pms_id = models.CharField(max_length=64)
    date = models.DateField()
    description = models.CharField(max_length=255)
    type = models.CharField(max_length=16, choices=Type.choices)
    # Stored exactly as the PMS sends it. The sign is not the direction of the
    # entry -- `type` is. Use `balance_effect` when adding entries up.
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    # Which account the entry belongs to. Set by the import; see
    # api/services/categories.py.
    category = models.CharField(
        max_length=16, choices=Category.choices, default=Category.RENT_AND_FEES,
    )
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
