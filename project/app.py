from datetime import datetime
import os
import re

import click
from dotenv import load_dotenv
from flask import Flask, abort, jsonify, redirect, render_template, request, send_file, url_for
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
from werkzeug.security import check_password_hash, generate_password_hash

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
    role = db.Column(db.String(50), nullable=False, default="user")
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


@login_manager.user_loader
def load_user(user_id):
    try:
        return db.session.get(User, int(user_id))
    except (TypeError, ValueError):
        return None


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


def ask_ai_tutor(question):
    try:
        return generate_tutor_reply(question)
    except AITutorConfigurationError:
        return "The AI tutor is unavailable because the OpenAI API key is not configured."
    except AITutorServiceError:
        return "The AI tutor could not generate a response right now. Please try again later."


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


def cache_static_response(response):
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


@app.cli.command("init-db")
def init_db_command():
    db.create_all()
    click.echo("Database tables created.")


@app.route("/")
def home():
    return render_template("index.html", answer="", question="")


@app.route("/brain-region/<slug>")
def brain_region(slug):
    region = BRAIN_REGIONS.get(slug)

    if not region:
        abort(404)

    return render_template("brain_region.html", region=region, slug=slug)


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
@login_required
def ai_tutor():
    answer = ""
    question = ""

    if request.method == "POST":
        question = request.form.get("question", "").strip()

        if question:
            answer = ask_ai_tutor(question)

    return render_template("index.html", answer=answer, question=question)


@app.route("/contact")
def contact():
    return render_template("contact.html")


@app.route("/about")
def about():
    return render_template("about.html")


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
    return redirect(url_for("login"))


if __name__ == "__main__":
    app.run(debug=True)
