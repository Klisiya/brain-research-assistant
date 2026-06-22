from flask import Flask, render_template, request 
from openai import OpenAI
from dotenv import load_dotenv
import os

load_dotenv()

app = Flask(__name__)
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

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

@app.route("/", methods=["GET", "POST"])
def home():
    answer = ""
    question = ""

    if request.method == "POST":
        question = request.form["question"]

        response = client.responses.create(
            model="gpt-5.5",
            instructions=instructions,
            input=question
        )

        answer = response.output_text

    return render_template("index.html", answer=answer, question=question)    

@app.route("/contact")
def contact():
    return render_template("contact.html")

@app.route("/about")
def about():
    return render_template("about.html")

@app.route("/login", methods=["GET", "POST"])
def login():
    status_message = ""

    if request.method == "POST":
        status_message = "Login interface is ready for authentication integration."

    return render_template("login.html", status_message=status_message)

if __name__ == "__main__":
    app.run(debug=True)
