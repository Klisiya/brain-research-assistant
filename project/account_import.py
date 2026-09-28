"""Bounded, in-memory CSV parsing; every data row produces an explicit result."""
import csv
import io
from flask import request
from account_service import AccountError

MAX_BYTES = 128 * 1024
MAX_ROWS = 100


def read_import():
    upload = request.files.get("file")
    if upload is None or len(request.files) != 1 or len(request.files.getlist("file")) != 1 or request.form:
        raise AccountError("Upload one CSV file.", "IMPORT_INVALID", 400)
    if not (upload.filename or "").lower().endswith(".csv") or upload.mimetype not in {
        "text/csv", "text/plain", "application/csv", "application/vnd.ms-excel"
    }:
        raise AccountError("Use a CSV file.", "IMPORT_INVALID", 400)
    raw = upload.stream.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise AccountError("CSV must be at most 128 KiB.", "REQUEST_TOO_LARGE", 413)
    try:
        content = raw.decode("utf-8-sig")
        if any(ord(char) < 32 and char not in "\n\r\t" for char in content):
            raise ValueError()
        rows = list(csv.reader(io.StringIO(content, newline=""), strict=True))
    except (UnicodeError, ValueError, csv.Error):
        raise AccountError("Use a valid UTF-8 CSV file.", "IMPORT_INVALID", 400) from None
    if not rows or rows[0] not in (["email", "username", "role"], ["email", "display_name", "role"]):
        raise AccountError("Columns must be email, username (or display_name), role. Passwords are not accepted.", "IMPORT_INVALID", 400)
    if not 1 <= len(rows) - 1 <= MAX_ROWS:
        raise AccountError("Import between 1 and 100 rows.", "IMPORT_INVALID", 400)
    return rows[1:]
