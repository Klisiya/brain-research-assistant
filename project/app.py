from datetime import datetime
import os
import re
from urllib.parse import urljoin, urlparse

import click
from dotenv import load_dotenv
from flask import Flask, flash, redirect, render_template, request, url_for
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


def is_safe_url(target):
    if not target:
        return False

    host_url = urlparse(request.host_url)
    redirect_url = urlparse(urljoin(request.host_url, target))

    return redirect_url.scheme in ("http", "https") and host_url.netloc == redirect_url.netloc


def get_safe_redirect(default_endpoint="ai_tutor"):
    target = request.form.get("next") or request.args.get("next")

    if is_safe_url(target):
        return target

    return url_for(default_endpoint, _anchor="ai-section")


def normalize_email(email):
    return email.strip().lower()


def is_valid_email(email):
    return bool(EMAIL_PATTERN.match(email))


def get_openai_client():
    api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        return None

    return OpenAI(api_key=api_key)


def ask_ai_tutor(question):
    client = get_openai_client()

    if not client:
        return "The AI tutor is unavailable because the OpenAI API key is not configured."

    try:
        response = client.responses.create(
            model="gpt-5.5",
            instructions=instructions,
            input=question,
        )
    except Exception:
        return "The AI tutor could not generate a response right now. Please try again later."

    return response.output_text


@app.cli.command("init-db")
def init_db_command():
    db.create_all()
    click.echo("Database tables created.")


@app.route("/")
def home():
    return render_template("index.html", answer="", question="")


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
    if current_user.is_authenticated:
        return redirect(url_for("ai_tutor", _anchor="ai-section"))

    status_message = ""
    status_type = "error"
    username = ""
    email = ""

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        email = normalize_email(request.form.get("email", ""))
        password = request.form.get("password", "")
        confirm_password = request.form.get("confirm_password", "")

        if not username or not email or not password or not confirm_password:
            status_message = "Please complete all required fields."
        elif not is_valid_email(email):
            status_message = "Please enter a valid email address."
        elif password != confirm_password:
            status_message = "Passwords do not match."
        elif User.query.filter_by(email=email).first():
            status_message = "An account with this email already exists."
        else:
            user = User(username=username, email=email, role="user")
            user.set_password(password)

            db.session.add(user)
            db.session.commit()

            flash("Account created. Please sign in.", "success")
            return redirect(url_for("login"))

    return render_template(
        "register.html",
        status_message=status_message,
        status_type=status_type,
        username=username,
        email=email,
    )


@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("ai_tutor", _anchor="ai-section"))

    status_message = ""
    status_type = "error"
    email = ""

    if request.method == "POST":
        email = normalize_email(request.form.get("email", ""))
        password = request.form.get("password", "")
        remember = request.form.get("remember") == "on"

        user = User.query.filter_by(email=email).first()

        if user and user.check_password(password):
            login_user(user, remember=remember)
            return redirect(get_safe_redirect())

        status_message = "Invalid email or password."

    return render_template(
        "login.html",
        status_message=status_message,
        status_type=status_type,
        email=email,
        next_url=request.args.get("next", ""),
    )


@app.route("/forgot-password")
def forgot_password():
    if current_user.is_authenticated:
        return redirect(url_for("ai_tutor", _anchor="ai-section"))

    return render_template(
        "login.html",
        status_message="Coming soon",
        status_type="info",
        email="",
        next_url=request.args.get("next", ""),
    )


@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("login"))


if __name__ == "__main__":
    app.run(debug=True)
