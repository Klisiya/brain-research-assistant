"""Regression clients exercise the real CSRF exchange on every write."""
from flask.testing import FlaskClient


class CsrfClient(FlaskClient):
    def open(self, *args, **kwargs):
        if kwargs.get("method", "GET").upper() not in {"GET", "HEAD", "OPTIONS"}:
            headers = dict(kwargs.get("headers") or {})
            if "X-CSRF-Token" not in headers:
                headers["X-CSRF-Token"] = super().open("/api/auth/csrf").json["csrfToken"]
            kwargs["headers"] = headers
        return super().open(*args, **kwargs)


def csrf_client(app):
    app.config.update(ACCOUNT_RATE_LIMIT_ENABLED=False, ACCOUNT_RECOVERY_SYNCHRONOUS=True)
    return CsrfClient(app, app.response_class, use_cookies=True)
