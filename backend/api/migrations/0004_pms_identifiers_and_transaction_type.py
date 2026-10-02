from django.db import migrations, models


def backfill_pms_id(apps, schema_editor):
    # The previous import command wrote the PMS transaction id into the
    # primary key, so that is the only place an existing row's PMS id lives.
    Transaction = apps.get_model('api', 'Transaction')
    for transaction in Transaction.objects.all().iterator():
        transaction.pms_id = str(transaction.pk)
        transaction.save(update_fields=['pms_id'])


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_transaction'),
    ]

    operations = [
        migrations.AddField(
            model_name='tenant',
            name='pms_tenant_id',
            field=models.PositiveIntegerField(blank=True, null=True, unique=True),
        ),
        migrations.AddField(
            model_name='transaction',
            name='pms_id',
            field=models.CharField(default='', max_length=64),
            preserve_default=False,
        ),
        # Existing rows never recorded a type. They get a placeholder here and
        # the next `import_transactions` run sets the real value from the PMS.
        migrations.AddField(
            model_name='transaction',
            name='type',
            field=models.CharField(
                choices=[('charge', 'Charge'), ('payment', 'Payment')],
                default='charge',
                max_length=16,
            ),
            preserve_default=False,
        ),
        migrations.RunPython(backfill_pms_id, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='transaction',
            constraint=models.UniqueConstraint(
                fields=('tenant', 'pms_id'), name='unique_pms_transaction_per_tenant'
            ),
        ),
    ]
