"""One synchronizer-token boundary for cookie-authenticated writes."""
import hmac
import os
import secrets
from urllib.parse import urlsplit
from flask import jsonify, request, session
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from limits import parse_many
from limits.errors import StorageError
from redis.exceptions import RedisError

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
LIMITS = {
    "api_auth_login": ("LOGIN", "10/minute;100/hour"),
    "forgot": ("FORGOT", "5/minute;20/hour"),
    "reset": ("RESET", "10/minute;100/hour"),
    "change": ("CHANGE", "10/minute;100/hour"),
    "accept": ("ACCEPT", "10/minute;100/hour"),
    "invitation_details": ("INVITATION", "20/minute;100/hour"),
}


def install_security(app):
    production = os.getenv("APP_ENV", "development") == "production"
    app.config["APP_ENV"] = "production" if production else "development"
    storage = os.getenv("RATELIMIT_STORAGE_URI", "memory://")
    if production:
        if not os.getenv("SECRET_KEY") or len(os.environ["SECRET_KEY"]) < 32:
            raise RuntimeError("Production requires a stable SECRET_KEY of at least 32 characters.")
        if urlsplit(app.config["FRONTEND_URL"]).scheme != "https":
            raise RuntimeError("Production requires an HTTPS FRONTEND_URL.")
        if not storage.startswith(("redis://", "rediss://")):
            raise RuntimeError("Production requires shared Redis rate-limit storage.")
        if app.config.get("ACCOUNT_MAIL_MODE") == "development":
            raise RuntimeError("Development mail delivery is disabled in production.")
        app.config.update(SESSION_COOKIE_SECURE=True, REMEMBER_COOKIE_SECURE=True)
    app.config.setdefault("ACCOUNT_RATE_LIMIT_ENABLED", True)
    for name, default in LIMITS.values():
        value = os.getenv("ACCOUNT_LIMIT_" + name, default)
        if not parse_many(value):
            raise RuntimeError("Invalid account rate limit configuration.")
        app.config["ACCOUNT_LIMIT_" + name] = value

    @app.before_request
    def protect_writes():
        # Bound small credential bodies before either the limiter or JSON parser reads them.
        if request.path.startswith("/api/auth/"):
            request.max_content_length = 16 * 1024
        if request.path == "/api/admin/users/import":
            request.max_content_length = 144 * 1024
        if request.method in SAFE_METHODS:
            return None
        origin = request.headers.get("Origin")
        frontend = urlsplit(app.config["FRONTEND_URL"])
        allowed = {request.host_url.rstrip("/"), f"{frontend.scheme}://{frontend.netloc}"}
        if (origin is not None and origin not in allowed) or request.headers.get("Sec-Fetch-Site") == "cross-site":
            return jsonify(error="Request origin is not allowed.", code="CSRF_ORIGIN_DENIED"), 403
        expected, supplied = session.get("csrf_token"), request.headers.get("X-CSRF-Token")
        if not expected or not supplied:
            return jsonify(error="A CSRF token is required.", code="CSRF_MISSING"), 403
        if len(supplied) != 43 or not hmac.compare_digest(expected.encode(), supplied.encode()):
            return jsonify(error="Invalid CSRF token.", code="CSRF_INVALID"), 403
        return None

    @app.get("/api/auth/csrf")
    def csrf_token():
        if "csrf_token" not in session:
            session["csrf_token"] = secrets.token_urlsafe(32)
        return jsonify(csrfToken=session["csrf_token"])

    limiter = Limiter(key_func=get_remote_address, storage_uri=storage, default_limits=[],
                      key_prefix="brain-research-auth", headers_enabled=True,
                      swallow_errors=False, in_memory_fallback_enabled=False,
                      storage_options={"wrap_exceptions": True})
    limiter.init_app(app)
    for endpoint, (name, _) in LIMITS.items():
        app.view_functions[endpoint] = limiter.limit(
            lambda name=name: app.config["ACCOUNT_LIMIT_" + name],
            exempt_when=lambda: not app.config["ACCOUNT_RATE_LIMIT_ENABLED"],
        )(app.view_functions[endpoint])

    @app.errorhandler(429)
    def limited(_error):
        return jsonify(error="Too many requests. Please try again later.", code="RATE_LIMITED"), 429

    @app.errorhandler(StorageError)
    @app.errorhandler(RedisError)
    def storage_unavailable(_error):
        return jsonify(error="Authentication is temporarily unavailable.", code="AUTH_UNAVAILABLE"), 503

    @app.errorhandler(413)
    def oversized(_error):
        return jsonify(error="Request is too large.", code="REQUEST_TOO_LARGE"), 413

    return limiter
