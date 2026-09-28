"""Bounded background delivery keeps account lookups out of public response timing."""
from concurrent.futures import ThreadPoolExecutor
from threading import BoundedSemaphore
from account_service import AccountError
from sqlalchemy.exc import SQLAlchemyError


class RecoveryDelivery:
    def __init__(self, app, service):
        self.app, self.service = app, service
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="account-recovery")
        self.slots = BoundedSemaphore(20)

    def submit(self, email):
        # An explicit test hook permits deterministic credential assertions.
        if self.app.testing and self.app.config.get("ACCOUNT_RECOVERY_SYNCHRONOUS", False):
            self.deliver(email)
            return
        if not self.slots.acquire(blocking=False):
            raise AccountError("Please try again later.", "RECOVERY_BUSY", 503)
        try:
            future = self.executor.submit(self.deliver, email)
            future.add_done_callback(lambda _future: self.slots.release())
        except RuntimeError:
            self.slots.release()
            raise AccountError("Please try again later.", "RECOVERY_BUSY", 503) from None

    def deliver(self, email):
        with self.app.app_context():
            try:
                self.service.request_reset(email=email)
            except (AccountError, SQLAlchemyError):
                self.app.logger.warning("Password recovery delivery failed; a new request may be submitted.")
