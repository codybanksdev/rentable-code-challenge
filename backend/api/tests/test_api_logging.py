import logging

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from api.middleware import DEV_ADMIN_USERNAME
from api.models import Label, Tenant


@pytest.fixture
def events(caplog):
    """The `api` logger's records, by event name, for the duration of a test."""
    api_logger = logging.getLogger('api')
    caplog.set_level(logging.INFO, logger='api')
    api_logger.propagate = True
    yield lambda name: [record for record in caplog.records if record.getMessage() == name]
    api_logger.propagate = False


def test_every_api_request_is_logged_with_its_outcome(events):
    tenant = Tenant.objects.create(name='Alice', pms_tenant_id=1)

    APIClient().get(f'/api/tenants/{tenant.id}/ledger/?start=2023-01-01')

    [request] = events('api.request')
    assert (request.method, request.path, request.query, request.status) == (
        'GET', f'/api/tenants/{tenant.id}/ledger/', 'start=2023-01-01', 200,
    )
    assert request.levelname == 'INFO'
    assert request.duration_ms >= 0


def test_a_rejected_request_is_logged_as_a_warning(events):
    APIClient().get('/api/tenants/999/ledger/')
    APIClient().get('/api/tenants/?as_of=yesterday')

    assert [(r.status, r.levelname) for r in events('api.request')] == [(404, 'WARNING'), (400, 'WARNING')]


def test_requests_outside_the_api_are_not_logged(events):
    APIClient().get('/')

    assert events('api.request') == []


def test_exports_and_label_changes_leave_their_own_events(events):
    tenant = Tenant.objects.create(name='Alice', pms_tenant_id=7)
    at_risk = Label.objects.get(name='At risk')
    client = APIClient()

    client.get(f'/api/tenants/{tenant.id}/ledger.csv?end=2023-01-31')
    client.get('/api/reports/roll-forward.csv')
    client.put(f'/api/tenants/{tenant.id}/labels/', {'label_ids': [at_risk.id]}, format='json')
    client.post('/api/labels/', {'name': 'Payment plan', 'color': '#2a78d6'}, format='json')

    [exported] = events('ledger.exported')
    assert (exported.tenant_id, exported.pms_tenant_id, exported.start, str(exported.end)) == (
        tenant.id, 7, None, '2023-01-31',
    )
    assert len(events('roll_forward.exported')) == 1
    [changed] = events('tenant.labels_changed')
    assert (changed.tenant_id, changed.labels) == (tenant.id, ['At risk'])
    assert events('label.created')[0].label == 'Payment plan'


def test_admin_opens_without_a_login_when_the_dev_setting_is_on(settings, events):
    settings.ADMIN_AUTO_LOGIN = True

    response = APIClient().get('/admin/')

    assert response.status_code == 200
    user = get_user_model().objects.get(username=DEV_ADMIN_USERNAME)
    assert user.is_superuser and not user.has_usable_password()
    assert len(events('admin.auto_login')) == 1


def test_admin_requires_a_login_when_the_dev_setting_is_off(settings):
    settings.ADMIN_AUTO_LOGIN = False

    response = APIClient().get('/admin/')

    assert response.status_code == 302
    assert '/admin/login/' in response['Location']
    assert not get_user_model().objects.filter(username=DEV_ADMIN_USERNAME).exists()
