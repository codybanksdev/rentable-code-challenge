from django.db import migrations, models


def delete_untyped_transactions(apps, schema_editor):
    # Rows written before this migration never recorded whether they were a
    # charge or a payment, and nothing in them can recover it. Guessing would
    # publish a wrong balance, so they are dropped; the PMS is the system of
    # record and `import_transactions` restores them with their type.
    apps.get_model('api', 'Transaction').objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_transaction'),
    ]

    operations = [
        migrations.RunPython(delete_untyped_transactions, migrations.RunPython.noop),
        migrations.AddField(
            model_name='tenant',
            name='pms_tenant_id',
            field=models.PositiveIntegerField(blank=True, null=True, unique=True),
        ),
        # The table is empty at this point, so these defaults never reach a row.
        migrations.AddField(
            model_name='transaction',
            name='pms_id',
            field=models.CharField(default='', max_length=64),
            preserve_default=False,
        ),
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
        migrations.AddConstraint(
            model_name='transaction',
            constraint=models.UniqueConstraint(
                fields=('tenant', 'pms_id'), name='unique_pms_transaction_per_tenant'
            ),
        ),
    ]
