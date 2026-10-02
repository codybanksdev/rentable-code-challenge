import logging
import time

from django.conf import settings
from django.contrib.auth import get_user_model, login

logger = logging.getLogger(__name__)

DEV_ADMIN_USERNAME = 'dev-admin'


class ApiRequestLogMiddleware:
    """Log one `api.request` event for every call to the API.

    Records what was asked for and how it went: method, path, query string,
    status and duration. Query strings here hold only ids and dates. Request
    and response bodies are never logged.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.path.startswith('/api/'):
            return self.get_response(request)
        started = time.monotonic()
        response = self.get_response(request)
        # A 5xx is the server's fault and a 4xx the caller's; neither is lost
        # among routine requests when filtering by level.
        level = (
            logging.ERROR if response.status_code >= 500
            else logging.WARNING if response.status_code >= 400
            else logging.INFO
        )
        logger.log(level, 'api.request', extra={
            'method': request.method,
            'path': request.path,
            'query': request.META.get('QUERY_STRING', ''),
            'status': response.status_code,
            'duration_ms': round((time.monotonic() - started) * 1000),
        })
        return response


class DevAdminAutoLoginMiddleware:
    """Open the Django admin without a login, for local development only.

    When `settings.ADMIN_AUTO_LOGIN` is on, a visit to /admin/ is signed in as
    a superuser called "dev-admin", created on first use. The setting can only
    be on while DEBUG is on; see settings.py.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if (
            settings.ADMIN_AUTO_LOGIN
            and request.path.startswith('/admin/')
            and not request.user.is_authenticated
        ):
            user, created = get_user_model().objects.get_or_create(
                username=DEV_ADMIN_USERNAME,
                defaults={'is_staff': True, 'is_superuser': True},
            )
            if created:
                # No password: this account can only be entered through here.
                user.set_unusable_password()
                user.save()
            login(request, user, backend='django.contrib.auth.backends.ModelBackend')
            logger.warning('admin.auto_login', extra={'path': request.path})
        return self.get_response(request)
