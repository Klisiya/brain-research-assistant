"""Small replaceable mail adapter with explicit local-only delivery."""
from email.message import EmailMessage
import smtplib
import ssl
from pathlib import Path
from urllib.parse import urlparse
from account_service import AccountError


class AccountMail:
    def __init__(self, app):
        self.app = app

    def send(self, email, kind, link):
        config = self.app.config
        sink = config.get("ACCOUNT_MAIL_TEST_SINK")
        if self.app.testing and callable(sink):
            sink(email, kind, link)
            return
        mode = config.get("ACCOUNT_MAIL_MODE", "disabled")
        if mode == "development" and self.app.debug:
            # A local spool, separate from application/access logs and HTTP responses.
            try:
                directory = Path(self.app.instance_path) / "account-mail"
                directory.mkdir(parents=True, exist_ok=True)
                import secrets
                path = directory / (secrets.token_hex(16) + ".txt")
                with path.open("x", encoding="utf-8") as message:
                    message.write(f"To: {email}\n{kind}\n{link}\n")
            except OSError:
                raise AccountError("Email delivery is unavailable.", "MAIL_UNAVAILABLE", 503) from None
            return
        if mode != "smtp":
            raise AccountError("Email delivery is unavailable.", "MAIL_UNAVAILABLE", 503)
        if urlparse(link).scheme != "https" and not self.app.debug:
            raise AccountError("Email delivery is unavailable.", "MAIL_UNAVAILABLE", 503)
        if not isinstance(config.get("ACCOUNT_SMTP_HOST"), str) or not config["ACCOUNT_SMTP_HOST"].strip() or not isinstance(config.get("ACCOUNT_MAIL_FROM"), str) or "@" not in config["ACCOUNT_MAIL_FROM"]:
            raise AccountError("Email delivery is unavailable.", "MAIL_UNAVAILABLE", 503)
        try:
            message = EmailMessage()
            message["From"] = config["ACCOUNT_MAIL_FROM"]
            message["To"] = email
            message["Subject"] = "Brain Research: " + kind
            message.set_content("Use this single-use link before it expires:\n" + link)
            with smtplib.SMTP(config["ACCOUNT_SMTP_HOST"], config.get("ACCOUNT_SMTP_PORT", 587), timeout=10) as client:
                client.starttls(context=ssl.create_default_context())
                if config.get("ACCOUNT_SMTP_USER"):
                    client.login(config["ACCOUNT_SMTP_USER"], config["ACCOUNT_SMTP_PASSWORD"])
                client.send_message(message)
        except (OSError, smtplib.SMTPException, KeyError, ValueError):
            raise AccountError("Email delivery is unavailable.", "MAIL_UNAVAILABLE", 503) from None
