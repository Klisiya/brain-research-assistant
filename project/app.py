from datetime import datetime
from functools import wraps
from math import ceil
import os
import re
import unicodedata
from urllib.parse import urlparse

import click
from dotenv import load_dotenv
from flask import Flask, abort, jsonify, redirect, request, send_file
from flask_login import (
    LoginManager,
    UserMixin,
    current_user,
    login_required,
    login_user,
    logout_user,
)
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy
from openai import OpenAI
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from werkzeug.security import check_password_hash, generate_password_hash

from attachment_api import register_attachment_api

load_dotenv()

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY") or os.urandom(32)
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 31536000


def get_database_url():
    database_url = os.getenv("DATABASE_URL", "sqlite:///users.db")

    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)

    return database_url


app.config["SQLALCHEMY_DATABASE_URI"] = get_database_url()
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)

# SQLite otherwise declares foreign keys without enforcing them on connections.
with app.app_context():
    if db.engine.dialect.name == "sqlite":
        @event.listens_for(db.engine, "connect")
        def enable_sqlite_foreign_keys(connection, _record):
            cursor = connection.cursor()
            try:
                cursor.execute("PRAGMA foreign_keys=ON")
            finally:
                cursor.close()

migrate = Migrate(app, db)

login_manager = LoginManager(app)
login_manager.login_view = "login"
login_manager.login_message = "Please sign in to access the AI Tutor."
login_manager.login_message_category = "error"

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_CHAT_MESSAGE_LENGTH = 4000
MAX_CHAT_HISTORY_ITEMS = 10
ALLOWED_CHAT_HISTORY_ROLES = {"user", "assistant"}
DEFAULT_FRONTEND_URL = "http://127.0.0.1:5173"
USER_ROLE = "user"
TEACHER_ROLE = "teacher"
ADMIN_ROLE = "admin"
USER_ROLES = {USER_ROLE, TEACHER_ROLE, ADMIN_ROLE}
PAPER_EDITOR_ROLES = {TEACHER_ROLE, ADMIN_ROLE}
PAPER_PUBLICATION_TYPES = {"Research Article", "Review", "Book Chapter", "Learning Resource"}
PAPER_DIFFICULTIES = {"Beginner", "Intermediate", "Advanced"}
PAPER_RESOURCE_CATEGORIES = {"Foundational", "Recommended", "Course Resource", "Emerging Research"}
PAPER_STATUSES = {"draft", "published", "archived"}
PAPER_PUBLIC_SORTS = {"recommended", "newest", "oldest", "readingTime", "title"}
PAPER_MANAGEMENT_SORTS = PAPER_PUBLIC_SORTS
PAPER_PUBLIC_VIEWS = {"all", "recommended", "resources"}
PAPER_RESOURCE_PUBLICATION_TYPES = {"Review", "Book Chapter", "Learning Resource"}

instructions = """
You are a Brain Research Learning Assistant
You help students understand:
- neuroscience
- cognition
- memory
- neuroplasticity
- attention
- psychology
- brain structures
- research methods
- scientific papers

Explain clearly and step by step.
Use beginner-friendly language first.
Give example and analogies when useful.
"""

BRAIN_REGIONS = {
    "frontal-lobe": {
        "name": "Frontal Lobe",
        "overview": (
            "The frontal lobe supports planning, decision-making, voluntary movement, "
            "language production, and flexible control of behavior."
        ),
        "main_functions": [
            "Executive control and goal-directed planning",
            "Voluntary motor control",
            "Speech production and expressive language",
            "Impulse regulation and social behavior",
        ],
        "related_cognitive_processes": [
            "Working memory",
            "Attention control",
            "Reasoning",
            "Cognitive flexibility",
        ],
        "clinical_relevance": (
            "Frontal lobe injury can affect personality, inhibition, planning, speech, "
            "and motor function. It is also important in research on ADHD, depression, "
            "addiction, and traumatic brain injury."
        ),
        "key_research_topics": [
            "Prefrontal cortex networks",
            "Executive function and self-control",
            "Motor planning",
            "Neuromodulation and frontal circuits",
        ],
    },
    "parietal-lobe": {
        "name": "Parietal Lobe",
        "overview": (
            "The parietal lobe integrates sensory information and helps the brain build "
            "spatial maps of the body and the surrounding world."
        ),
        "main_functions": [
            "Touch, pressure, pain, and temperature processing",
            "Spatial attention",
            "Body awareness",
            "Sensorimotor integration",
        ],
        "related_cognitive_processes": [
            "Mental rotation",
            "Numerical reasoning",
            "Visual attention",
            "Hand-eye coordination",
        ],
        "clinical_relevance": (
            "Damage can lead to neglect, impaired spatial awareness, difficulty with "
            "calculation, or problems coordinating sensory input with action."
        ),
        "key_research_topics": [
            "Multisensory integration",
            "Attention networks",
            "Body schema",
            "Spatial cognition and navigation",
        ],
    },
    "temporal-lobe": {
        "name": "Temporal Lobe",
        "overview": (
            "The temporal lobe is central to auditory processing, language comprehension, "
            "object recognition, memory, and emotion-linked learning."
        ),
        "main_functions": [
            "Auditory perception",
            "Language comprehension",
            "Memory encoding and retrieval",
            "Recognition of objects and faces",
        ],
        "related_cognitive_processes": [
            "Semantic memory",
            "Episodic memory",
            "Speech perception",
            "Emotion and memory interactions",
        ],
        "clinical_relevance": (
            "Temporal lobe dysfunction is associated with memory disorders, language "
            "comprehension problems, epilepsy, and some forms of dementia."
        ),
        "key_research_topics": [
            "Hippocampal memory systems",
            "Auditory cortex organization",
            "Language networks",
            "Temporal lobe epilepsy",
        ],
    },
    "occipital-lobe": {
        "name": "Occipital Lobe",
        "overview": (
            "The occipital lobe is the brain's primary visual processing hub, converting "
            "signals from the eyes into patterns, motion, color, and form."
        ),
        "main_functions": [
            "Primary visual processing",
            "Color and motion analysis",
            "Shape and pattern detection",
            "Visual field mapping",
        ],
        "related_cognitive_processes": [
            "Visual perception",
            "Object recognition",
            "Reading support",
            "Visual attention",
        ],
        "clinical_relevance": (
            "Occipital damage can cause visual field loss, visual agnosia, hallucinations, "
            "or cortical blindness depending on the affected pathway."
        ),
        "key_research_topics": [
            "Visual cortex plasticity",
            "Retinotopic mapping",
            "Visual attention pathways",
            "Computer vision and neural coding",
        ],
    },
    "cerebellum": {
        "name": "Cerebellum",
        "overview": (
            "The cerebellum fine-tunes movement, timing, balance, and motor learning, "
            "and it is increasingly studied for roles in cognition and emotion."
        ),
        "main_functions": [
            "Balance and posture",
            "Movement coordination",
            "Motor learning",
            "Timing and prediction",
        ],
        "related_cognitive_processes": [
            "Procedural learning",
            "Prediction error processing",
            "Sequence learning",
            "Attention timing",
        ],
        "clinical_relevance": (
            "Cerebellar dysfunction may cause ataxia, tremor, poor coordination, speech "
            "difficulties, and cognitive-affective changes."
        ),
        "key_research_topics": [
            "Motor adaptation",
            "Cerebellar prediction models",
            "Cerebellar contributions to cognition",
            "Rehabilitation after movement disorders",
        ],
    },
    "brainstem": {
        "name": "Brainstem",
        "overview": (
            "The brainstem connects the brain with the spinal cord and regulates vital "
            "functions such as breathing, heart rate, arousal, and basic reflexes."
        ),
        "main_functions": [
            "Breathing and cardiovascular regulation",
            "Sleep-wake arousal systems",
            "Cranial nerve functions",
            "Basic reflex control",
        ],
        "related_cognitive_processes": [
            "Arousal",
            "Attention readiness",
            "Pain modulation",
            "Autonomic regulation",
        ],
        "clinical_relevance": (
            "Brainstem injury is medically serious because it can disrupt consciousness, "
            "breathing, swallowing, eye movements, and core autonomic functions."
        ),
        "key_research_topics": [
            "Arousal and consciousness",
            "Autonomic nervous system control",
            "Neuromodulatory nuclei",
            "Brainstem reflex circuits",
        ],
    },
}


class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False)
    email = db.Column(db.String(255), nullable=False, unique=True, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(50), nullable=False, default=USER_ROLE)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Paper(db.Model):
    __tablename__ = "papers"

    id = db.Column(db.Integer, primary_key=True)
    slug = db.Column(db.String(220), nullable=False, unique=True, index=True)
    title = db.Column(db.String(500), nullable=False)
    authors = db.Column(db.JSON, nullable=False, default=list)
    year = db.Column(db.Integer, nullable=True)
    journal = db.Column(db.String(300), nullable=True)
    publication_type = db.Column(db.String(50), nullable=False)
    topics = db.Column(db.JSON, nullable=False, default=list)
    difficulty = db.Column(db.String(30), nullable=False)
    estimated_reading_minutes = db.Column(db.Integer, nullable=False)
    abstract = db.Column(db.Text, nullable=False)
    learning_objectives = db.Column(db.JSON, nullable=False, default=list)
    keywords = db.Column(db.JSON, nullable=False, default=list)
    featured = db.Column(db.Boolean, nullable=False, default=False)
    open_access = db.Column(db.Boolean, nullable=False, default=False)
    external_url = db.Column(db.String(1000), nullable=True)
    resource_category = db.Column(db.String(60), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="draft", index=True)
    created_by_id = db.Column(
        db.Integer,
        db.ForeignKey("user.id"),
        nullable=False,
        index=True,
    )
    updated_by_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )
    published_at = db.Column(db.DateTime, nullable=True)

    created_by = db.relationship(
        "User",
        foreign_keys=[created_by_id],
        backref=db.backref("created_papers", lazy="dynamic"),
    )
    updated_by = db.relationship(
        "User",
        foreign_keys=[updated_by_id],
        backref=db.backref("updated_papers", lazy="dynamic"),
    )

    attachments = db.relationship(
        "PaperAttachment", back_populates="paper", cascade="all, delete-orphan",
        order_by="(PaperAttachment.sort_order, PaperAttachment.created_at, PaperAttachment.id)",
    )


class PaperAttachment(db.Model):
    __tablename__ = "paper_attachments"
    __table_args__ = (
        db.CheckConstraint("attachment_type IN ('pdf', 'cover', 'slides', 'document', 'external_link')", name="ck_attachment_type"),
        db.CheckConstraint("access_level IN ('public', 'authenticated', 'staff')", name="ck_attachment_access"),
        db.CheckConstraint("version >= 1", name="ck_attachment_version"),
        db.CheckConstraint(
            "(attachment_type = 'external_link' AND external_url IS NOT NULL AND storage_key IS NULL "
            "AND sha256 IS NULL AND file_size IS NULL AND mime_type IS NULL AND original_filename IS NULL) OR "
            "(attachment_type != 'external_link' AND external_url IS NULL AND storage_key IS NOT NULL "
            "AND sha256 IS NOT NULL AND file_size > 0 AND mime_type IS NOT NULL AND original_filename IS NOT NULL)",
            name="ck_attachment_resource",
        ),
        db.UniqueConstraint("paper_id", "attachment_type", "sha256", name="uq_attachment_sha"),
        db.Index("uq_attachment_primary", "paper_id", "attachment_type", unique=True,
                 sqlite_where=db.text("attachment_type IN ('pdf', 'cover')"),
                 postgresql_where=db.text("attachment_type IN ('pdf', 'cover')")),
        {"sqlite_autoincrement": True},
    )

    id = db.Column(db.Integer, primary_key=True)
    paper_id = db.Column(db.Integer, db.ForeignKey("papers.id"), nullable=False, index=True)
    attachment_type = db.Column(db.String(30), nullable=False, index=True)
    display_name = db.Column(db.String(300), nullable=False)
    description = db.Column(db.String(1000), nullable=True)
    original_filename = db.Column(db.String(500), nullable=True)
    storage_key = db.Column(db.String(1000), nullable=True, unique=True)
    mime_type = db.Column(db.String(150), nullable=True)
    file_size = db.Column(db.Integer, nullable=True)
    sha256 = db.Column(db.String(64), nullable=True, index=True)
    external_url = db.Column(db.String(1500), nullable=True)
    access_level = db.Column(db.String(30), nullable=False, default="public", server_default="public")
    version = db.Column(db.Integer, nullable=False, default=1, server_default="1")
    sort_order = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    uploaded_by_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    paper = db.relationship("Paper", back_populates="attachments")
    uploaded_by = db.relationship("User", foreign_keys=[uploaded_by_id])
    __mapper_args__ = {"version_id_col": version, "version_id_generator": False}


class AttachmentFileCleanup(db.Model):
    """Durable outbox: deleting metadata cannot lose the file cleanup work."""
    __tablename__ = "attachment_file_cleanup"
    storage_key = db.Column(db.String(1000), primary_key=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


@login_manager.user_loader
def load_user(user_id):
    try:
        return db.session.get(User, int(user_id))
    except (TypeError, ValueError):
        return None


def roles_required(*allowed_roles):
    allowed_role_set = set(allowed_roles)

    def decorator(view_function):
        @wraps(view_function)
        def wrapped_view(*args, **kwargs):
            if not current_user.is_authenticated:
                return (
                    jsonify(
                        {
                            "error": "Authentication required.",
                            "code": "AUTH_REQUIRED",
                        }
                    ),
                    401,
                )

            if current_user.role not in allowed_role_set:
                return (
                    jsonify(
                        {
                            "error": "You do not have permission to perform this action.",
                            "code": "FORBIDDEN",
                        }
                    ),
                    403,
                )

            return view_function(*args, **kwargs)

        return wrapped_view

    return decorator


def get_frontend_url():
    return os.getenv("FRONTEND_URL", DEFAULT_FRONTEND_URL).rstrip("/")


def get_frontend_home_url():
    return f"{get_frontend_url()}/"


def get_frontend_login_url():
    return f"{get_frontend_url()}/login"


def get_api_login_url():
    return get_frontend_login_url()


def normalize_email(email):
    return email.strip().lower()


def is_valid_email(email):
    return bool(EMAIL_PATTERN.match(email))


def get_openai_client():
    api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        return None

    return OpenAI(api_key=api_key)


class AITutorConfigurationError(RuntimeError):
    pass


class AITutorServiceError(RuntimeError):
    pass


def build_ai_tutor_input(message, history=None):
    if not history:
        return message

    return [*history, {"role": "user", "content": message}]


def generate_tutor_reply(message, history=None):
    client = get_openai_client()

    if not client:
        raise AITutorConfigurationError("OpenAI API key is not configured.")

    try:
        response = client.responses.create(
            model="gpt-5.4-mini",
            instructions=instructions,
            input=build_ai_tutor_input(message, history),
        )
    except Exception as error:
        app.logger.warning("AI Tutor request failed: %s", error.__class__.__name__)
        raise AITutorServiceError("AI Tutor request failed.") from error

    return response.output_text


def validate_chat_history(raw_history):
    if raw_history is None:
        return []

    if not isinstance(raw_history, list):
        raise ValueError("History must be an array.")

    validated_history = []

    for item in raw_history:
        if not isinstance(item, dict):
            raise ValueError("History items must be objects.")

        if "role" not in item or "content" not in item:
            raise ValueError("History items must include role and content.")

        role = item["role"]
        content = item["content"]

        if not isinstance(role, str) or not isinstance(content, str):
            raise ValueError("History role and content must be strings.")

        if role not in ALLOWED_CHAT_HISTORY_ROLES:
            raise ValueError("History role must be user or assistant.")

        content = content.strip()

        if not content:
            raise ValueError("History content cannot be empty.")

        if len(content) > MAX_CHAT_MESSAGE_LENGTH:
            raise ValueError("History content is too long.")

        validated_history.append({"role": role, "content": content})

    return validated_history[-MAX_CHAT_HISTORY_ITEMS:]


def validate_chat_payload():
    if request.mimetype != "application/json":
        raise ValueError("Request must be application/json.")

    payload = request.get_json(silent=True)

    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object.")

    if "message" not in payload:
        raise ValueError("Message is required.")

    message = payload["message"]

    if not isinstance(message, str):
        raise ValueError("Message must be a string.")

    message = message.strip()

    if not message:
        raise ValueError("Message cannot be empty.")

    if len(message) > MAX_CHAT_MESSAGE_LENGTH:
        raise ValueError("Message is too long.")

    history = validate_chat_history(payload.get("history"))

    return message, history


def serialize_user(user):
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
    }


class PaperValidationError(ValueError):
    def __init__(self, message, field):
        super().__init__(message)
        self.field = field


def paper_validation_error_response(error):
    return (
        jsonify(
            {
                "error": str(error),
                "code": "VALIDATION_ERROR",
                "field": error.field,
            }
        ),
        400,
    )


def serialize_paper(paper, include_management_fields=False):
    serialized = {
        "id": paper.id,
        "slug": paper.slug,
        "title": paper.title,
        "authors": paper.authors,
        "year": paper.year,
        "journal": paper.journal,
        "publicationType": paper.publication_type,
        "topics": paper.topics,
        "difficulty": paper.difficulty,
        "estimatedReadingMinutes": paper.estimated_reading_minutes,
        "abstract": paper.abstract,
        "learningObjectives": paper.learning_objectives,
        "keywords": paper.keywords,
        "featured": paper.featured,
        "openAccess": paper.open_access,
        "externalUrl": paper.external_url,
        "resourceCategory": paper.resource_category,
        "createdAt": paper.created_at.isoformat() if paper.created_at else None,
        "updatedAt": paper.updated_at.isoformat() if paper.updated_at else None,
        "publishedAt": paper.published_at.isoformat() if paper.published_at else None,
    }

    if include_management_fields:
        creator = paper.created_by
        serialized.update(
            {
                "status": paper.status,
                "createdBy": (
                    {
                        "id": creator.id,
                        "username": creator.username,
                        "role": creator.role,
                    }
                    if creator
                    else None
                ),
                "updatedById": paper.updated_by_id,
            }
        )

    return serialized


def normalize_paper_slug(value, *, fallback_to_paper=False):
    if not isinstance(value, str):
        raise PaperValidationError("Slug must be a string.", "slug")

    normalized = unicodedata.normalize("NFKD", value.strip().lower())
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value).strip("-")

    if not slug and fallback_to_paper:
        slug = "paper"

    if not slug:
        raise PaperValidationError("Slug must contain URL-safe letters or numbers.", "slug")

    return slug[:220].rstrip("-")


def generate_unique_paper_slug(value, *, exclude_paper_id=None, fallback_to_paper=False):
    base_slug = normalize_paper_slug(value, fallback_to_paper=fallback_to_paper)
    candidate = base_slug
    suffix_number = 2

    while True:
        query = Paper.query.filter_by(slug=candidate)

        if exclude_paper_id is not None:
            query = query.filter(Paper.id != exclude_paper_id)

        if query.first() is None:
            return candidate

        suffix = f"-{suffix_number}"
        candidate = f"{base_slug[: 220 - len(suffix)].rstrip('-')}{suffix}"
        suffix_number += 1


PAPER_WRITABLE_FIELDS = {
    "slug",
    "title",
    "authors",
    "year",
    "journal",
    "publicationType",
    "topics",
    "difficulty",
    "estimatedReadingMinutes",
    "abstract",
    "learningObjectives",
    "keywords",
    "featured",
    "openAccess",
    "externalUrl",
    "resourceCategory",
    "status",
}
PAPER_REQUIRED_CREATE_FIELDS = {
    "title",
    "authors",
    "publicationType",
    "topics",
    "difficulty",
    "estimatedReadingMinutes",
    "abstract",
    "learningObjectives",
    "keywords",
    "resourceCategory",
}


def validate_paper_string(value, field, *, maximum_length, allow_empty=False):
    if not isinstance(value, str):
        raise PaperValidationError(f"{field} must be a string.", field)

    normalized = value.strip()

    if not normalized and not allow_empty:
        raise PaperValidationError(f"{field} cannot be empty.", field)

    if len(normalized) > maximum_length:
        raise PaperValidationError(
            f"{field} must be at most {maximum_length} characters.",
            field,
        )

    return normalized


def validate_optional_paper_string(value, field, *, maximum_length):
    if value is None:
        return None

    normalized = validate_paper_string(
        value,
        field,
        maximum_length=maximum_length,
        allow_empty=True,
    )
    return normalized or None


def validate_paper_string_list(value, field, *, minimum_items, item_maximum_length):
    if not isinstance(value, list):
        raise PaperValidationError(f"{field} must be an array of strings.", field)

    normalized_items = []
    seen_items = set()

    for item in value:
        if not isinstance(item, str):
            raise PaperValidationError(f"Every {field} item must be a string.", field)

        normalized_item = item.strip()

        if not normalized_item:
            continue

        if len(normalized_item) > item_maximum_length:
            raise PaperValidationError(
                f"Every {field} item must be at most {item_maximum_length} characters.",
                field,
            )

        deduplication_key = normalized_item.casefold()

        if deduplication_key in seen_items:
            continue

        seen_items.add(deduplication_key)
        normalized_items.append(normalized_item)

    if len(normalized_items) < minimum_items:
        raise PaperValidationError(
            f"{field} must contain at least {minimum_items} non-empty item.",
            field,
        )

    return normalized_items


def validate_paper_enum(value, field, allowed_values):
    if not isinstance(value, str) or value not in allowed_values:
        allowed = ", ".join(sorted(allowed_values))
        raise PaperValidationError(f"{field} must be one of: {allowed}.", field)

    return value


def validate_paper_boolean(value, field):
    if not isinstance(value, bool):
        raise PaperValidationError(f"{field} must be a boolean.", field)

    return value


def validate_paper_integer(value, field, *, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, int):
        raise PaperValidationError(f"{field} must be an integer.", field)

    if value < minimum or value > maximum:
        raise PaperValidationError(
            f"{field} must be between {minimum} and {maximum}.",
            field,
        )

    return value


def validate_paper_year(value):
    if value is None:
        return None

    return validate_paper_integer(
        value,
        "year",
        minimum=1800,
        maximum=datetime.utcnow().year + 1,
    )


def validate_paper_external_url(value):
    normalized = validate_optional_paper_string(value, "externalUrl", maximum_length=1000)

    if normalized is None:
        return None

    parsed_url = urlparse(normalized)

    if parsed_url.scheme.lower() not in {"http", "https"} or not parsed_url.netloc:
        raise PaperValidationError(
            "externalUrl must be an http or https URL.",
            "externalUrl",
        )

    return normalized


def read_paper_request_payload():
    if request.mimetype != "application/json":
        raise PaperValidationError(
            "Request Content-Type must be application/json.",
            "contentType",
        )

    payload = request.get_json(silent=True)

    if not isinstance(payload, dict):
        raise PaperValidationError("Request body must be a JSON object.", "body")

    return payload


def validate_paper_payload(payload, *, partial=False):
    unknown_fields = sorted(set(payload) - PAPER_WRITABLE_FIELDS)

    if unknown_fields:
        field = unknown_fields[0]
        raise PaperValidationError(f"Unsupported field: {field}.", field)

    if partial and not payload:
        raise PaperValidationError("At least one field must be provided.", "body")

    if not partial:
        missing_fields = sorted(PAPER_REQUIRED_CREATE_FIELDS - set(payload))

        if missing_fields:
            field = missing_fields[0]
            raise PaperValidationError(f"{field} is required.", field)

    validated = {}

    if "slug" in payload:
        validated["slug"] = normalize_paper_slug(payload["slug"])

    if "title" in payload:
        validated["title"] = validate_paper_string(
            payload["title"],
            "title",
            maximum_length=500,
        )

    if "authors" in payload:
        validated["authors"] = validate_paper_string_list(
            payload["authors"],
            "authors",
            minimum_items=1,
            item_maximum_length=300,
        )

    if "year" in payload:
        validated["year"] = validate_paper_year(payload["year"])

    if "journal" in payload:
        validated["journal"] = validate_optional_paper_string(
            payload["journal"],
            "journal",
            maximum_length=300,
        )

    if "publicationType" in payload:
        validated["publication_type"] = validate_paper_enum(
            payload["publicationType"],
            "publicationType",
            PAPER_PUBLICATION_TYPES,
        )

    if "topics" in payload:
        validated["topics"] = validate_paper_string_list(
            payload["topics"],
            "topics",
            minimum_items=1,
            item_maximum_length=100,
        )

    if "difficulty" in payload:
        validated["difficulty"] = validate_paper_enum(
            payload["difficulty"],
            "difficulty",
            PAPER_DIFFICULTIES,
        )

    if "estimatedReadingMinutes" in payload:
        validated["estimated_reading_minutes"] = validate_paper_integer(
            payload["estimatedReadingMinutes"],
            "estimatedReadingMinutes",
            minimum=1,
            maximum=600,
        )

    if "abstract" in payload:
        validated["abstract"] = validate_paper_string(
            payload["abstract"],
            "abstract",
            maximum_length=20000,
        )

    if "learningObjectives" in payload:
        validated["learning_objectives"] = validate_paper_string_list(
            payload["learningObjectives"],
            "learningObjectives",
            minimum_items=1,
            item_maximum_length=1000,
        )

    if "keywords" in payload:
        validated["keywords"] = validate_paper_string_list(
            payload["keywords"],
            "keywords",
            minimum_items=0,
            item_maximum_length=100,
        )

    if "featured" in payload:
        validated["featured"] = validate_paper_boolean(payload["featured"], "featured")

    if "openAccess" in payload:
        validated["open_access"] = validate_paper_boolean(
            payload["openAccess"],
            "openAccess",
        )

    if "externalUrl" in payload:
        validated["external_url"] = validate_paper_external_url(payload["externalUrl"])

    if "resourceCategory" in payload:
        validated["resource_category"] = validate_paper_enum(
            payload["resourceCategory"],
            "resourceCategory",
            PAPER_RESOURCE_CATEGORIES,
        )

    if "status" in payload:
        validated["status"] = validate_paper_enum(
            payload["status"],
            "status",
            PAPER_STATUSES,
        )

    if not partial:
        validated.setdefault("status", "draft")
        validated.setdefault("featured", False)
        validated.setdefault("open_access", False)
        validated.setdefault("external_url", None)
        validated.setdefault("year", None)
        validated.setdefault("journal", None)

    return validated


def parse_paper_integer_query(field, default, *, maximum=None):
    raw_value = request.args.get(field)

    if raw_value is None or raw_value == "":
        return default

    try:
        value = int(raw_value)
    except ValueError as error:
        raise PaperValidationError(f"{field} must be an integer.", field) from error

    if value < 1:
        raise PaperValidationError(f"{field} must be at least 1.", field)

    if maximum is not None and value > maximum:
        raise PaperValidationError(f"{field} must be at most {maximum}.", field)

    return value


def parse_paper_list_filters(*, management=False):
    query_text = request.args.get("q", "").strip()

    if len(query_text) > 500:
        raise PaperValidationError("q must be at most 500 characters.", "q")

    page = parse_paper_integer_query("page", 1)
    per_page = parse_paper_integer_query("perPage", 12, maximum=50)
    sort = request.args.get("sort", "recommended")
    allowed_sorts = PAPER_MANAGEMENT_SORTS if management else PAPER_PUBLIC_SORTS

    if sort not in allowed_sorts:
        raise PaperValidationError(
            f"sort must be one of: {', '.join(sorted(allowed_sorts))}.",
            "sort",
        )

    filters = {
        "q": query_text,
        "page": page,
        "perPage": per_page,
        "sort": sort,
    }

    if management:
        status = request.args.get("status") or None

        if status is not None:
            status = validate_paper_enum(status, "status", PAPER_STATUSES)

        filters["status"] = status
        return filters

    topic = request.args.get("topic") or None
    author = request.args.get("author") or None
    year_raw = request.args.get("year")
    view = request.args.get("view", "all")

    if topic is not None:
        topic = validate_paper_string(topic, "topic", maximum_length=100)

    if author is not None:
        author = validate_paper_string(author, "author", maximum_length=300)

    if year_raw in {None, ""}:
        year = None
    else:
        try:
            year = validate_paper_year(int(year_raw))
        except (TypeError, ValueError) as error:
            raise PaperValidationError("year must be a valid integer.", "year") from error

    if view not in PAPER_PUBLIC_VIEWS:
        raise PaperValidationError(
            f"view must be one of: {', '.join(sorted(PAPER_PUBLIC_VIEWS))}.",
            "view",
        )

    difficulty = request.args.get("difficulty") or None
    publication_type = request.args.get("publicationType") or None
    resource_category = request.args.get("resourceCategory") or None
    featured_raw = request.args.get("featured")
    featured = None

    if difficulty is not None:
        difficulty = validate_paper_enum(difficulty, "difficulty", PAPER_DIFFICULTIES)

    if publication_type is not None:
        publication_type = validate_paper_enum(
            publication_type,
            "publicationType",
            PAPER_PUBLICATION_TYPES,
        )

    if resource_category is not None:
        resource_category = validate_paper_enum(
            resource_category,
            "resourceCategory",
            PAPER_RESOURCE_CATEGORIES,
        )

    if featured_raw is not None:
        if featured_raw.lower() not in {"true", "false"}:
            raise PaperValidationError("featured must be true or false.", "featured")

        featured = featured_raw.lower() == "true"

    filters.update(
        {
            "topic": topic,
            "author": author,
            "year": year,
            "view": view,
            "difficulty": difficulty,
            "publicationType": publication_type,
            "resourceCategory": resource_category,
            "featured": featured,
        }
    )
    return filters


def paper_matches_search(paper, query_text):
    if not query_text:
        return True

    searchable_values = [
        paper.title,
        paper.journal or "",
        paper.abstract,
        *(paper.authors or []),
        *(paper.topics or []),
        *(paper.keywords or []),
    ]
    normalized_query = query_text.casefold()
    return any(normalized_query in str(value).casefold() for value in searchable_values)


def apply_paper_python_filters(papers, filters, *, management=False):
    # JSON-array search and topic matching stay in Python so this small content
    # library behaves consistently on both SQLite and PostgreSQL.
    filtered = [paper for paper in papers if paper_matches_search(paper, filters["q"])]

    if not management and filters["topic"] is not None:
        normalized_topic = filters["topic"].casefold()
        filtered = [
            paper
            for paper in filtered
            if any(topic.casefold() == normalized_topic for topic in (paper.topics or []))
        ]

    if not management and filters["author"] is not None:
        normalized_author = filters["author"].casefold()
        filtered = [
            paper
            for paper in filtered
            if any(author.casefold() == normalized_author for author in (paper.authors or []))
        ]

    if not management and filters["view"] == "recommended":
        filtered = [
            paper
            for paper in filtered
            if paper.featured or paper.resource_category == "Recommended"
        ]
    elif not management and filters["view"] == "resources":
        filtered = [
            paper
            for paper in filtered
            if paper.publication_type in PAPER_RESOURCE_PUBLICATION_TYPES
            or paper.resource_category == "Course Resource"
        ]

    return filtered


def get_paper_sort_timestamp(paper):
    timestamp = paper.published_at or paper.created_at
    return timestamp.timestamp() if timestamp else 0


def sort_papers(papers, sort, *, include_resource_recommendation=False):
    if sort == "newest":
        return sorted(
            papers,
            key=lambda paper: (
                paper.year is None,
                -(paper.year or 0),
                -get_paper_sort_timestamp(paper),
            ),
        )

    if sort == "oldest":
        return sorted(
            papers,
            key=lambda paper: (
                paper.year is None,
                paper.year or 0,
                paper.title.casefold(),
            ),
        )

    if sort == "readingTime":
        return sorted(
            papers,
            key=lambda paper: (paper.estimated_reading_minutes, paper.title.casefold()),
        )

    if sort == "title":
        return sorted(papers, key=lambda paper: paper.title.casefold())

    if include_resource_recommendation:
        return sorted(
            papers,
            key=lambda paper: (
                -(int(paper.featured) * 2 + int(paper.resource_category == "Recommended")),
                -get_paper_sort_timestamp(paper),
                paper.title.casefold(),
            ),
        )

    return sorted(
        papers,
        key=lambda paper: (not paper.featured, -get_paper_sort_timestamp(paper)),
    )


def paginate_papers(papers, page, per_page):
    total = len(papers)
    total_pages = ceil(total / per_page) if total else 0
    normalized_page = min(page, total_pages) if total_pages else 1
    start = (normalized_page - 1) * per_page
    return papers[start : start + per_page], {
        "page": normalized_page,
        "perPage": per_page,
        "total": total,
        "totalPages": total_pages,
    }


def paper_not_found_response():
    return jsonify({"error": "Paper not found.", "code": "PAPER_NOT_FOUND"}), 404


def paper_edit_forbidden_response():
    return (
        jsonify(
            {
                "error": "You do not have permission to edit this paper.",
                "code": "PAPER_EDIT_FORBIDDEN",
            }
        ),
        403,
    )


def can_manage_paper(paper):
    return current_user.role == ADMIN_ROLE or paper.created_by_id == current_user.id


def commit_paper_database_changes():
    try:
        db.session.commit()
    except IntegrityError as error:
        db.session.rollback()
        app.logger.warning("Paper database integrity error: %s", error.__class__.__name__)
        return (
            jsonify(
                {
                    "error": "The paper conflicts with an existing record.",
                    "code": "PAPER_CONFLICT",
                }
            ),
            409,
        )
    except SQLAlchemyError as error:
        db.session.rollback()
        app.logger.exception("Paper database operation failed: %s", error.__class__.__name__)
        return (
            jsonify(
                {
                    "error": "The paper operation could not be completed.",
                    "code": "PAPER_DATABASE_ERROR",
                }
            ),
            500,
        )

    return None


def public_paper_filter_response(filters):
    return {
        "q": filters["q"],
        "topic": filters["topic"],
        "author": filters["author"],
        "year": filters["year"],
        "view": filters["view"],
        "difficulty": filters["difficulty"],
        "publicationType": filters["publicationType"],
        "resourceCategory": filters["resourceCategory"],
        "featured": filters["featured"],
        "sort": filters["sort"],
    }


def management_paper_filter_response(filters):
    return {
        "q": filters["q"],
        "status": filters["status"],
        "sort": filters["sort"],
    }


def validate_auth_login_payload():
    if request.mimetype != "application/json":
        raise ValueError("Request must be application/json.")

    payload = request.get_json(silent=True)

    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object.")

    email = payload.get("email")
    password = payload.get("password")
    remember = payload.get("remember", False)

    if not isinstance(email, str) or not email.strip():
        raise ValueError("Email is required.")

    if not isinstance(password, str) or not password:
        raise ValueError("Password is required.")

    if not isinstance(remember, bool):
        remember = False

    return normalize_email(email), password, remember


def authenticate_user(email, password):
    user = User.query.filter_by(email=email).first()

    if user and user.check_password(password):
        return user

    return None


def build_brain_region_summary(region):
    overview = region.get("overview", "")
    key_functions = region.get("main_functions", [])

    if not key_functions:
        return overview

    highlighted_functions = ", ".join(key_functions[:2])

    return f"Key functions include {highlighted_functions}."


def serialize_brain_region(slug, region, include_detail=False):
    overview = region.get("overview", "")
    main_functions = region.get("main_functions", [])
    related_processes = region.get("related_cognitive_processes", [])
    clinical_relevance = region.get("clinical_relevance", "")
    research_topics = region.get("key_research_topics", [])

    if not include_detail:
        return {
            "slug": slug,
            "name": region.get("name", ""),
            "shortDescription": overview,
            "summary": build_brain_region_summary(region),
        }

    return {
        "slug": slug,
        "name": region.get("name", ""),
        "subtitle": "Brain Region",
        "overview": overview,
        "keyFunctions": main_functions,
        "relatedCognitiveProcesses": related_processes,
        "clinicalRelevance": clinical_relevance,
        "researchHighlights": research_topics,
        "sections": [
            {
                "id": "main-functions",
                "title": "Main functions",
                "items": main_functions,
            },
            {
                "id": "related-cognitive-processes",
                "title": "Related cognitive processes",
                "items": related_processes,
            },
            {
                "id": "clinical-relevance",
                "title": "Clinical relevance",
                "content": clinical_relevance,
            },
            {
                "id": "research-highlights",
                "title": "Research highlights",
                "items": research_topics,
            },
        ],
    }


def cache_static_response(response):
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


DEMO_PAPERS = [
    {
        "slug": "demo-foundations-of-neural-communication",
        "title": "Demo Resource: Foundations of Neural Communication",
        "authors": ["Brain Research Tutor Education Team"],
        "year": 2024,
        "journal": "Demo Brain Science Learning Series",
        "publicationType": "Learning Resource",
        "topics": ["Neuroscience", "Neural Communication"],
        "difficulty": "Beginner",
        "estimatedReadingMinutes": 18,
        "abstract": "A demonstration learning summary about neural signaling, prepared for local development and interface testing.",
        "learningObjectives": [
            "Describe the basic roles of electrical and chemical signaling.",
            "Identify key terms used when discussing synaptic communication.",
        ],
        "keywords": ["demo", "neurons", "synapses"],
        "featured": True,
        "openAccess": True,
        "externalUrl": None,
        "resourceCategory": "Foundational",
        "status": "published",
    },
    {
        "slug": "demo-memory-systems-review",
        "title": "Demo Resource: Memory Systems Review",
        "authors": ["Brain Research Tutor Education Team"],
        "year": 2023,
        "journal": "Demo Cognitive Science Reviews",
        "publicationType": "Review",
        "topics": ["Memory", "Cognition"],
        "difficulty": "Intermediate",
        "estimatedReadingMinutes": 27,
        "abstract": "A demonstration review outline for testing structured paper metadata without reproducing a paid or copyrighted article.",
        "learningObjectives": [
            "Compare working, episodic, and semantic memory at a high level.",
            "Recognize common evidence limits in memory research.",
        ],
        "keywords": ["demo", "memory", "cognition"],
        "featured": False,
        "openAccess": True,
        "externalUrl": None,
        "resourceCategory": "Recommended",
        "status": "published",
    },
    {
        "slug": "demo-brain-computer-interface-draft",
        "title": "Demo Draft: Brain-Computer Interface Concepts",
        "authors": ["Brain Research Tutor Education Team"],
        "year": 2026,
        "journal": "Demo Emerging Research Notes",
        "publicationType": "Research Article",
        "topics": ["Brain-Computer Interfaces", "Neuroscience"],
        "difficulty": "Advanced",
        "estimatedReadingMinutes": 32,
        "abstract": "A draft demonstration record used to verify that unpublished content remains unavailable through public endpoints.",
        "learningObjectives": [
            "Outline a basic signal acquisition and decoding workflow.",
            "Distinguish educational examples from validated clinical systems.",
        ],
        "keywords": ["demo", "BCI", "neural signals"],
        "featured": False,
        "openAccess": False,
        "externalUrl": None,
        "resourceCategory": "Emerging Research",
        "status": "draft",
    },
    {
        "slug": "demo-archived-neuroplasticity-guide",
        "title": "Demo Archived Resource: Neuroplasticity Guide",
        "authors": ["Brain Research Tutor Education Team"],
        "year": 2022,
        "journal": "Demo Course Resource Archive",
        "publicationType": "Book Chapter",
        "topics": ["Neuroplasticity", "Learning"],
        "difficulty": "Intermediate",
        "estimatedReadingMinutes": 24,
        "abstract": "An archived demonstration record used to test management filters and public visibility boundaries.",
        "learningObjectives": [
            "Define experience-dependent plasticity in a learning context.",
            "Explain why archived resources should not appear publicly.",
        ],
        "keywords": ["demo", "neuroplasticity", "learning"],
        "featured": False,
        "openAccess": True,
        "externalUrl": None,
        "resourceCategory": "Course Resource",
        "status": "archived",
    },
]


@app.cli.command("set-user-role")
@click.argument("email")
@click.argument("role")
def set_user_role_command(email, role):
    normalized_email = normalize_email(email)
    normalized_role = role.strip().lower()

    if normalized_role not in USER_ROLES:
        allowed_roles = ", ".join(sorted(USER_ROLES))
        raise click.ClickException(f"ROLE must be one of: {allowed_roles}.")

    user = User.query.filter_by(email=normalized_email).first()

    if user is None:
        raise click.ClickException("User not found for the supplied email address.")

    user.role = normalized_role

    try:
        db.session.commit()
    except SQLAlchemyError as error:
        db.session.rollback()
        app.logger.exception("Unable to update user role: %s", error.__class__.__name__)
        raise click.ClickException("Unable to update the user role.") from error

    click.echo(f"Updated {user.username} ({user.email}) to role {user.role}.")


@app.cli.command("seed-papers")
@click.option("--owner-email", help="Email of an existing teacher or admin owner.")
def seed_papers_command(owner_email):
    if owner_email:
        owner = User.query.filter_by(email=normalize_email(owner_email)).first()

        if owner is None:
            raise click.ClickException("No existing user matches the supplied owner email.")

        if owner.role not in PAPER_EDITOR_ROLES:
            raise click.ClickException("The seed owner must have the teacher or admin role.")
    else:
        owner = (
            User.query.filter(User.role.in_(PAPER_EDITOR_ROLES))
            .order_by(User.id.asc())
            .first()
        )

        if owner is None:
            raise click.ClickException(
                "No teacher or admin user exists. Use flask set-user-role first."
            )

    added_count = 0
    skipped_count = 0
    now = datetime.utcnow()

    for demo_payload in DEMO_PAPERS:
        if Paper.query.filter_by(slug=demo_payload["slug"]).first() is not None:
            skipped_count += 1
            continue

        try:
            validated = validate_paper_payload(demo_payload)
        except PaperValidationError as error:
            raise click.ClickException(
                f"Invalid demo paper field {error.field}: {error}"
            ) from error

        if validated["status"] == "published":
            validated["published_at"] = now

        db.session.add(
            Paper(
                **validated,
                created_by_id=owner.id,
                updated_by_id=owner.id,
            )
        )
        added_count += 1

    try:
        db.session.commit()
    except SQLAlchemyError as error:
        db.session.rollback()
        app.logger.exception("Unable to seed demo papers: %s", error.__class__.__name__)
        raise click.ClickException("Unable to seed demo papers.") from error

    click.echo(f"Demo papers added: {added_count}; skipped: {skipped_count}.")


@app.cli.command("init-db")
def init_db_command():
    db.create_all()
    click.echo("Database tables created.")


@app.route("/")
def home():
    return redirect(get_frontend_home_url())


@app.route("/brain-region/<slug>")
def brain_region(slug):
    if slug not in BRAIN_REGIONS:
        return jsonify({"error": "Brain region not found.", "code": "BRAIN_REGION_NOT_FOUND"}), 404

    return redirect(f"{get_frontend_url()}/brain-region/{slug}")


@app.route("/api/brain-regions")
def api_brain_regions():
    regions = [
        serialize_brain_region(slug, region)
        for slug, region in BRAIN_REGIONS.items()
    ]

    return jsonify({"regions": regions}), 200


@app.route("/api/brain-regions/<slug>")
def api_brain_region(slug):
    region = BRAIN_REGIONS.get(slug)

    if not region:
        return jsonify({"error": "Brain region not found.", "code": "BRAIN_REGION_NOT_FOUND"}), 404

    return jsonify({"region": serialize_brain_region(slug, region, include_detail=True)}), 200


@app.route("/api/papers", methods=["GET"])
def api_papers():
    try:
        filters = parse_paper_list_filters()
    except PaperValidationError as error:
        return paper_validation_error_response(error)

    query = Paper.query.filter_by(status="published")
    published_papers = query.all()

    if filters["difficulty"] is not None:
        query = query.filter_by(difficulty=filters["difficulty"])

    if filters["publicationType"] is not None:
        query = query.filter_by(publication_type=filters["publicationType"])

    if filters["resourceCategory"] is not None:
        query = query.filter_by(resource_category=filters["resourceCategory"])

    if filters["featured"] is not None:
        query = query.filter_by(featured=filters["featured"])

    if filters["year"] is not None:
        query = query.filter_by(year=filters["year"])

    papers = apply_paper_python_filters(query.all(), filters)
    papers = sort_papers(
        papers,
        filters["sort"],
        include_resource_recommendation=filters["sort"] == "recommended",
    )
    page_items, pagination = paginate_papers(
        papers,
        filters["page"],
        filters["perPage"],
    )

    return (
        jsonify(
            {
                "papers": [serialize_paper(paper) for paper in page_items],
                "libraryTotal": len(published_papers),
                "pagination": pagination,
                "filters": public_paper_filter_response(filters),
                "availableFilters": {
                    "topics": sorted(
                        {topic for paper in published_papers for topic in (paper.topics or [])},
                        key=str.casefold,
                    ),
                    "authors": sorted(
                        {author for paper in published_papers for author in (paper.authors or [])},
                        key=str.casefold,
                    ),
                    "years": sorted(
                        {paper.year for paper in published_papers if paper.year is not None},
                        reverse=True,
                    ),
                    "difficulties": sorted({paper.difficulty for paper in published_papers}),
                    "publicationTypes": sorted({paper.publication_type for paper in published_papers}),
                    "resourceCategories": sorted({paper.resource_category for paper in published_papers}),
                },
                "highlights": [
                    serialize_paper(paper)
                    for paper in sort_papers(
                        published_papers,
                        "recommended",
                        include_resource_recommendation=True,
                    )[:12]
                ],
            }
        ),
        200,
    )


@app.route("/api/papers/manage", methods=["GET"])
@roles_required(*PAPER_EDITOR_ROLES)
def api_manage_papers():
    try:
        filters = parse_paper_list_filters(management=True)
    except PaperValidationError as error:
        return paper_validation_error_response(error)

    query = Paper.query

    if current_user.role == TEACHER_ROLE:
        query = query.filter_by(created_by_id=current_user.id)

    if filters["status"] is not None:
        query = query.filter_by(status=filters["status"])

    papers = apply_paper_python_filters(query.all(), filters, management=True)
    papers = sort_papers(papers, filters["sort"])
    page_items, pagination = paginate_papers(
        papers,
        filters["page"],
        filters["perPage"],
    )

    return (
        jsonify(
            {
                "papers": [
                    serialize_paper(paper, include_management_fields=True)
                    for paper in page_items
                ],
                "pagination": pagination,
                "filters": management_paper_filter_response(filters),
            }
        ),
        200,
    )


@app.route("/api/papers/manage/<int:paper_id>", methods=["GET"])
@roles_required(*PAPER_EDITOR_ROLES)
def api_manage_paper(paper_id):
    paper = db.session.get(Paper, paper_id)

    if paper is None:
        return paper_not_found_response()

    if not can_manage_paper(paper):
        return paper_edit_forbidden_response()

    return jsonify({"paper": serialize_paper(paper, include_management_fields=True)}), 200


@app.route("/api/papers/<string:slug>", methods=["GET"])
def api_paper(slug):
    paper = Paper.query.filter_by(slug=slug, status="published").first()

    if paper is None:
        return paper_not_found_response()

    return jsonify({"paper": serialize_paper(paper)}), 200


@app.route("/api/papers", methods=["POST"])
@roles_required(*PAPER_EDITOR_ROLES)
def api_create_paper():
    try:
        payload = read_paper_request_payload()
        validated = validate_paper_payload(payload)
        requested_slug = validated.pop("slug", None)
        validated["slug"] = generate_unique_paper_slug(
            requested_slug or validated["title"],
            fallback_to_paper=requested_slug is None,
        )
    except PaperValidationError as error:
        return paper_validation_error_response(error)

    if validated["status"] == "published":
        validated["published_at"] = datetime.utcnow()

    paper = Paper(
        **validated,
        created_by_id=current_user.id,
        updated_by_id=current_user.id,
    )
    db.session.add(paper)
    database_error = commit_paper_database_changes()

    if database_error is not None:
        return database_error

    return (
        jsonify({"paper": serialize_paper(paper, include_management_fields=True)}),
        201,
    )


@app.route("/api/papers/<int:paper_id>", methods=["PATCH"])
@roles_required(*PAPER_EDITOR_ROLES)
def api_update_paper(paper_id):
    paper = db.session.get(Paper, paper_id)

    if paper is None:
        return paper_not_found_response()

    if not can_manage_paper(paper):
        return paper_edit_forbidden_response()

    try:
        payload = read_paper_request_payload()
        validated = validate_paper_payload(payload, partial=True)

        if "slug" in validated:
            validated["slug"] = generate_unique_paper_slug(
                validated["slug"],
                exclude_paper_id=paper.id,
            )
    except PaperValidationError as error:
        return paper_validation_error_response(error)

    previous_status = paper.status

    for field, value in validated.items():
        setattr(paper, field, value)

    if (
        validated.get("status") == "published"
        and previous_status != "published"
        and paper.published_at is None
    ):
        paper.published_at = datetime.utcnow()

    paper.updated_by_id = current_user.id
    database_error = commit_paper_database_changes()

    if database_error is not None:
        return database_error

    return jsonify({"paper": serialize_paper(paper, include_management_fields=True)}), 200


@app.route("/api/papers/<int:paper_id>/archive", methods=["POST"])
@roles_required(*PAPER_EDITOR_ROLES)
def api_archive_paper(paper_id):
    paper = db.session.get(Paper, paper_id)

    if paper is None:
        return paper_not_found_response()

    if not can_manage_paper(paper):
        return paper_edit_forbidden_response()

    if paper.status != "archived":
        paper.status = "archived"
        paper.updated_by_id = current_user.id
        database_error = commit_paper_database_changes()

        if database_error is not None:
            return database_error

    return jsonify({"paper": serialize_paper(paper, include_management_fields=True)}), 200


@app.route("/api/papers/<int:paper_id>", methods=["DELETE"])
@roles_required(ADMIN_ROLE)
def api_delete_paper(paper_id):
    return delete_paper_with_attachments(paper_id)


@app.route("/assets/models/brain.glb")
def brain_model_asset():
    model_dir = os.path.join(app.root_path, "static", "models")
    accepts_gzip = "gzip" in request.headers.get("Accept-Encoding", "").lower()
    gzip_path = os.path.join(model_dir, "brain.glb.gz")
    plain_path = os.path.join(model_dir, "brain.glb")

    if accepts_gzip and os.path.exists(gzip_path):
        response = send_file(
            gzip_path,
            mimetype="model/gltf-binary",
            conditional=True,
            etag=True,
            max_age=31536000,
        )
        response.headers["Content-Encoding"] = "gzip"
    else:
        response = send_file(
            plain_path,
            mimetype="model/gltf-binary",
            conditional=True,
            etag=True,
            max_age=31536000,
        )

    response.headers["Vary"] = "Accept-Encoding"
    return cache_static_response(response)


@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    try:
        email, password, remember = validate_auth_login_payload()
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    user = authenticate_user(email, password)

    if not user:
        return jsonify({"error": "Invalid email or password.", "code": "INVALID_CREDENTIALS"}), 401

    login_user(user, remember=remember)

    return jsonify({"authenticated": True, "user": serialize_user(user)}), 200


@app.route("/api/auth/me")
def api_auth_me():
    if not current_user.is_authenticated:
        return jsonify({"authenticated": False, "user": None}), 200

    return jsonify({"authenticated": True, "user": serialize_user(current_user)}), 200


@app.route("/api/auth/logout", methods=["POST"])
def api_auth_logout():
    logout_user()
    return jsonify({"authenticated": False}), 200


@app.route("/api/chat", methods=["POST"])
def api_chat():
    if not current_user.is_authenticated:
        return (
            jsonify(
                {
                    "error": "Authentication required.",
                    "code": "AUTH_REQUIRED",
                    "login_url": get_api_login_url(),
                }
            ),
            401,
        )

    try:
        message, history = validate_chat_payload()
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    try:
        reply = generate_tutor_reply(message, history)
    except AITutorConfigurationError:
        return jsonify({"error": "AI service is not configured."}), 503
    except AITutorServiceError:
        return jsonify({"error": "The AI Tutor is temporarily unavailable."}), 503
    except Exception:
        app.logger.exception("Unexpected AI Tutor API error.")
        return jsonify({"error": "The AI Tutor is temporarily unavailable."}), 500

    return jsonify({"reply": reply}), 200


@app.route("/ai-tutor", methods=["GET", "POST"])
def ai_tutor():
    return redirect(f"{get_frontend_url()}/#ai-section")


@app.route("/contact")
def contact():
    return redirect(f"{get_frontend_url()}/contact")


@app.route("/about")
def about():
    return redirect(f"{get_frontend_url()}/about")


@app.route("/register", methods=["GET", "POST"])
def register():
    abort(404)


@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(get_frontend_home_url())

    if request.method == "GET":
        return redirect(get_frontend_login_url())

    if request.method == "POST":
        email = normalize_email(request.form.get("email", ""))
        password = request.form.get("password", "")
        remember = request.form.get("remember") == "on"

        user = authenticate_user(email, password)

        if user:
            login_user(user, remember=remember)
            return redirect(get_frontend_home_url())

    return redirect(get_frontend_login_url())


@app.route("/forgot-password")
def forgot_password():
    if current_user.is_authenticated:
        return redirect(get_frontend_home_url())

    return redirect(get_frontend_login_url())


@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(get_frontend_home_url())


delete_paper_with_attachments = register_attachment_api(
    app, db, Paper, PaperAttachment, AttachmentFileCleanup, roles_required,
    can_manage_paper, paper_not_found_response,
)


if __name__ == "__main__":
    app.run(debug=True)
