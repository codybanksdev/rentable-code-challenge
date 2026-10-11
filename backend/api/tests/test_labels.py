from rest_framework.test import APIClient

from api.models import Label, Tenant
from api.services.pms_import import import_tenants


def label_names(tenant_id):
    tenants = APIClient().get('/api/tenants/').json()
    return [label['name'] for label in next(t for t in tenants if t['id'] == tenant_id)['labels']]


def test_default_labels_exist_with_their_colours():
    body = APIClient().get('/api/labels/').json()

    assert [(label['name'], label['color']) for label in body] == [
        ('At risk', '#c62828'), ('Defaulting', '#000000'), ('Requires follow up', '#e65100'),
    ]


def test_setting_a_tenants_labels_replaces_the_previous_set():
    tenant = Tenant.objects.create(name='Alice')
    at_risk = Label.objects.get(name='At risk')
    follow_up = Label.objects.get(name='Requires follow up')
    client = APIClient()
    url = f'/api/tenants/{tenant.id}/labels/'

    assert client.put(url, {'label_ids': [at_risk.id, follow_up.id]}, format='json').status_code == 200
    assert label_names(tenant.id) == ['At risk', 'Requires follow up']

    response = client.put(url, {'label_ids': [follow_up.id]}, format='json')
    assert [label['name'] for label in response.json()] == ['Requires follow up']
    assert label_names(tenant.id) == ['Requires follow up']

    assert client.put(url, {'label_ids': []}, format='json').status_code == 200
    assert label_names(tenant.id) == []


def test_unknown_label_or_tenant_is_rejected_and_changes_nothing():
    tenant = Tenant.objects.create(name='Alice')
    at_risk = Label.objects.get(name='At risk')
    tenant.labels.set([at_risk])
    client = APIClient()

    assert client.put(f'/api/tenants/{tenant.id}/labels/', {'label_ids': [at_risk.id, 9999]}, format='json').status_code == 400
    assert client.put('/api/tenants/9999/labels/', {'label_ids': []}, format='json').status_code == 404
    assert label_names(tenant.id) == ['At risk']


def test_creating_a_custom_label():
    client = APIClient()

    response = client.post('/api/labels/', {'name': '  Payment plan ', 'color': '#2a78d6'}, format='json')

    assert response.status_code == 201
    assert response.json()['name'] == 'Payment plan'
    assert Label.objects.filter(name='Payment plan', color='#2a78d6').exists()


def test_invalid_labels_are_rejected():
    client = APIClient()

    assert client.post('/api/labels/', {'name': 'at RISK', 'color': '#111111'}, format='json').status_code == 400
    assert client.post('/api/labels/', {'name': 'Late', 'color': 'red'}, format='json').status_code == 400
    assert client.post('/api/labels/', {'name': '', 'color': '#111111'}, format='json').status_code == 400
    assert Label.objects.count() == 3


def test_an_import_keeps_a_tenants_labels():
    entry = {'id': '1', 'date': '2023-01-01', 'description': 'Rent', 'type': 'charge', 'amount': 100.0}
    payload = [{'tenant_id': 1, 'name': 'Alice', 'unit': 'A1', 'ledger': [entry]}]
    import_tenants(payload)
    tenant = Tenant.objects.get(pms_tenant_id=1)
    tenant.labels.set([Label.objects.get(name='Defaulting')])

    import_tenants(payload)

    assert label_names(tenant.id) == ['Defaulting']


def test_tenant_list_loads_labels_without_a_query_per_tenant(django_assert_num_queries):
    at_risk = Label.objects.get(name='At risk')
    for index in range(5):
        Tenant.objects.create(name=f'Tenant {index}').labels.set([at_risk])

    # One query for tenants with balances, one for all of their labels.
    with django_assert_num_queries(2):
        APIClient().get('/api/tenants/')
