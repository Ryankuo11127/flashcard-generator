from dotenv import load_dotenv
from openai import OpenAI
import json
import os
import uuid
from typing import List

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from pypdf import PdfReader
from docx import Document

from pydantic import BaseModel, Field


# -----------------------------
# App + OpenAI setup
# -----------------------------
load_dotenv()

# Fail fast if key is missing (prevents confusing 500s)
if not os.getenv("OPENAI_API_KEY"):
    raise RuntimeError("OPENAI_API_KEY is missing. Put it in your .env file.")

client = OpenAI()
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "data/uploads"
RESULT_DIR = "data/results"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(RESULT_DIR, exist_ok=True)


# -----------------------------
# Models for structured output
# -----------------------------
class Flashcard(BaseModel):
    type: str = Field(default="basic")
    front: str
    back: str
    tags: List[str] = Field(default_factory=list)


class FlashcardDeck(BaseModel):
    deck_name: str
    cards: List[Flashcard]


# -----------------------------
# Routes
# -----------------------------
@app.get("/")
def root():
    return {"status": "ok"}


def extract_text(path: str) -> str:
    lower = path.lower()

    if lower.endswith(".pdf"):
        reader = PdfReader(path)
        parts = []
        for page in reader.pages:
            parts.append(page.extract_text() or "")
        return "\n".join(parts).strip()

    if lower.endswith(".docx"):
        doc = Document(path)
        return "\n".join(p.text for p in doc.paragraphs).strip()

    if lower.endswith(".txt"):
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read().strip()

    raise HTTPException(status_code=400, detail="Unsupported file type. Use PDF, DOCX, or TXT.")


@app.post("/api/jobs")
async def create_job(file: UploadFile = File(...)):
    job_id = str(uuid.uuid4())

    filename = file.filename or "upload"
    safe_name = filename.replace("\\", "_").replace("/", "_")
    upload_path = os.path.join(UPLOAD_DIR, f"{job_id}__{safe_name}")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file upload.")

    with open(upload_path, "wb") as f:
        f.write(data)

    text = extract_text(upload_path)

    text_path = os.path.join(RESULT_DIR, f"{job_id}.txt")
    with open(text_path, "w", encoding="utf-8") as f:
        f.write(text)

    return {"job_id": job_id, "filename": filename, "chars_extracted": len(text)}


@app.get("/api/jobs/{job_id}/text")
def get_extracted_text(job_id: str):
    text_path = os.path.join(RESULT_DIR, f"{job_id}.txt")
    if not os.path.exists(text_path):
        raise HTTPException(status_code=404, detail="Job not found")

    with open(text_path, "r", encoding="utf-8") as f:
        text = f.read()

    return {"job_id": job_id, "text": text}


@app.post("/api/jobs/{job_id}/flashcards")
def generate_flashcards(job_id: str, n: int = 20):
    # Guardrails to prevent runaway cost
    if n < 1:
        raise HTTPException(status_code=400, detail="n must be >= 1")
    if n > 60:
        raise HTTPException(status_code=400, detail="n must be <= 60 (cost protection)")

    text_path = os.path.join(RESULT_DIR, f"{job_id}.txt")
    if not os.path.exists(text_path):
        raise HTTPException(status_code=404, detail="Job not found")

    with open(text_path, "r", encoding="utf-8") as f:
        text = f.read()

    if not text.strip():
        raise HTTPException(status_code=400, detail="No text extracted from file.")

    # Cost protection: truncate input
    text = text[:12000]

    instructions = (
        "You generate study flashcards. "
        "Return ONLY the requested structured output."
    )

    user_input = (
        f"Generate {n} study flashcards from the content below.\n\n"
        "Rules:\n"
        "- Keep fronts short (question/term).\n"
        "- Keep backs clear and correct.\n"
        "- Add 0-3 tags per card (optional).\n"
        "- deck_name should reflect the topic.\n\n"
        f"Content:\n{text}"
    )

    try:
        # Structured Outputs via Responses API parse() :contentReference[oaicite:1]{index=1}
        response = client.responses.parse(
            model="gpt-4o-mini",
            instructions=instructions,
            input=user_input,
            text_format=FlashcardDeck,
            max_output_tokens=1200,
        )
        deck: FlashcardDeck = response.output_parsed

    except Exception as e:
        # Return a useful error message instead of a generic 500
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI generation failed: {str(e)[:300]}"
        )

    out_path = os.path.join(RESULT_DIR, f"{job_id}.flashcards.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(deck.model_dump(), f, ensure_ascii=False, indent=2)

    return {"job_id": job_id, "flashcards": deck.model_dump()}
