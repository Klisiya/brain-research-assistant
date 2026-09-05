"""Bounded attachment validation without trusting browser MIME or filenames."""
import hashlib
from pathlib import PurePosixPath
import re
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET
import zipfile
import zlib


MIB = 1024 * 1024
FILE_LIMITS = {"pdf": 50 * MIB, "cover": 8 * MIB, "slides": 50 * MIB, "document": 30 * MIB}
FORMATS = {
    "pdf": {"pdf": "application/pdf"},
    "cover": {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"},
    "slides": {"pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
    "document": {"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
}
ACCESS_LEVELS = {"public", "authenticated", "staff"}


class AttachmentError(ValueError):
    def __init__(self, message, code="VALIDATION_ERROR", status=400):
        super().__init__(message)
        self.code = code
        self.status = status


def too_large():
    return AttachmentError("The uploaded file is too large.", "FILE_TOO_LARGE", 413)


def safe_filename(filename):
    if not isinstance(filename, str):
        return ""
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    return re.sub(r"[\x00-\x1f\x7f]", "", name).strip()[:500]


def validate_external_url(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 1500:
        raise AttachmentError("externalUrl must be a valid HTTP or HTTPS URL.")
    value = value.strip()
    if re.search(r"[\x00-\x20\x7f\\]", value):
        raise AttachmentError("externalUrl must be a valid HTTP or HTTPS URL.")
    try:
        parsed = urlsplit(value)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                or parsed.username is not None or parsed.password is not None):
            raise ValueError
        parsed.port
    except ValueError as error:
        raise AttachmentError("externalUrl must be a valid HTTP or HTTPS URL.") from error
    return value


def validate_metadata(payload, *, existing=None, link=False):
    if not isinstance(payload, dict):
        raise AttachmentError("Request body must be an object.")
    allowed = {"attachmentType", "displayName", "description", "accessLevel", "sortOrder"}
    if link:
        allowed.add("externalUrl")
    if set(payload) - allowed:
        raise AttachmentError("Unknown attachment fields.")
    kind = payload.get("attachmentType", existing.attachment_type if existing else None)
    if not isinstance(kind, str) or kind not in ({"external_link"} if link else set(FORMATS)):
        raise AttachmentError("Invalid attachmentType.")
    if existing and kind != existing.attachment_type:
        raise AttachmentError("attachmentType cannot be changed during replacement.")
    values = {"attachment_type": kind}
    for field, column, limit, optional in [
        ("displayName", "display_name", 300, False),
        ("description", "description", 1000, True),
    ]:
        value = payload.get(field, getattr(existing, column) if existing else None)
        if optional and value is None:
            values[column] = None
            continue
        if not isinstance(value, str) or len(value.strip()) > limit or (not optional and not value.strip()):
            raise AttachmentError(f"{field} must be a string of at most {limit} characters.")
        values[column] = value.strip() or None
    access = payload.get("accessLevel", existing.access_level if existing else "public")
    if not isinstance(access, str) or access not in ACCESS_LEVELS:
        raise AttachmentError("Invalid accessLevel.")
    values["access_level"] = access
    order = payload.get("sortOrder", existing.sort_order if existing else 0)
    if isinstance(order, str) and re.fullmatch(r"-?[0-9]{1,10}", order):
        order = int(order)
    if type(order) is not int or not -(2**31) <= order < 2**31:
        raise AttachmentError("sortOrder must be a 32-bit integer.")
    values["sort_order"] = order
    if link:
        values["external_url"] = validate_external_url(
            payload.get("externalUrl", existing.external_url if existing else None)
        )
    return values


def _validate_office(stream, kind):
    folder, main, namespace, tag, content_type = (
        ("word", "word/document.xml", "http://schemas.openxmlformats.org/wordprocessingml/2006/main", "document",
         "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")
        if kind == "document" else
        ("ppt", "ppt/presentation.xml", "http://schemas.openxmlformats.org/presentationml/2006/main", "presentation",
         "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml")
    )
    with zipfile.ZipFile(stream) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(entries) > 4096 or len(set(names)) != len(names):
            raise ValueError
        if not {"[Content_Types].xml", "_rels/.rels", main}.issubset(names):
            raise ValueError
        if sum(entry.file_size for entry in entries) > 200 * MIB:
            raise ValueError
        for entry in entries:
            path = PurePosixPath(entry.filename)
            if (path.is_absolute() or ".." in path.parts or "\\" in entry.filename
                    or ":" in entry.filename or entry.flag_bits & 1
                    or entry.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
                    or entry.file_size > 100 * MIB
                    or entry.file_size > max(entry.compress_size, 1) * 200
                    or "vbaproject" in entry.filename.lower()
                    or entry.filename.lower().endswith((".exe", ".dll", ".js", ".html"))):
                raise ValueError
        def read_xml(name):
            if archive.getinfo(name).file_size > 4 * MIB:
                raise ValueError
            data = archive.read(name)
            if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
                raise ValueError
            return ET.fromstring(data)
        types = read_xml("[Content_Types].xml")
        ct_ns = "{http://schemas.openxmlformats.org/package/2006/content-types}"
        if types.tag != ct_ns + "Types" or not any(
            item.tag == ct_ns + "Override" and item.get("PartName") == "/" + main
            and item.get("ContentType") == content_type for item in types
        ):
            raise ValueError
        relationships = read_xml("_rels/.rels")
        rel_ns = "{http://schemas.openxmlformats.org/package/2006/relationships}"
        if relationships.tag != rel_ns + "Relationships" or not any(
            item.tag == rel_ns + "Relationship"
            and item.get("Type") == "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
            and item.get("Target", "").lstrip("/") == main
            and item.get("TargetMode", "Internal") == "Internal" for item in relationships
        ):
            raise ValueError
        if read_xml(main).tag != "{" + namespace + "}" + tag:
            raise ValueError
        # Bound decompression above before checking all CRCs; never extract entries.
        if archive.testzip() is not None:
            raise ValueError


def validate_file(upload, kind, limits=None):
    if upload is None or not upload.filename:
        raise AttachmentError("A file is required.")
    filename = safe_filename(upload.filename)
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    expected = FORMATS[kind].get(extension)
    if expected is None or upload.mimetype != expected:
        raise AttachmentError("This file type is not allowed.", "FILE_TYPE_NOT_ALLOWED")
    limit = (limits or FILE_LIMITS)[kind]
    stream = upload.stream
    stream.seek(0)
    digest = hashlib.sha256()
    size = 0
    while chunk := stream.read(1024 * 1024):
        size += len(chunk)
        if size > limit:
            raise too_large()
        digest.update(chunk)
    stream.seek(0)
    header = stream.read(16)
    stream.seek(0)
    valid = False
    if kind == "pdf":
        valid = header.startswith(b"%PDF-")
    elif extension == "png":
        valid = header.startswith(b"\x89PNG\r\n\x1a\n")
    elif extension in {"jpg", "jpeg"}:
        valid = header.startswith(b"\xff\xd8\xff")
    elif extension == "webp":
        valid = header.startswith(b"RIFF") and header[8:12] == b"WEBP"
    elif kind in {"slides", "document"}:
        try:
            _validate_office(stream, kind)
            valid = True
        except (zipfile.BadZipFile, ValueError, ET.ParseError, KeyError, RuntimeError, NotImplementedError, EOFError, zlib.error):
            valid = False
    stream.seek(0)
    if not valid:
        raise AttachmentError("The file content does not match its format.", "INVALID_FILE_CONTENT")
    return {"original_filename": filename, "mime_type": expected, "file_size": size,
            "sha256": digest.hexdigest()}, extension
