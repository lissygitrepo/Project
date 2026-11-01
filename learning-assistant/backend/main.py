import os
import shutil

from dotenv import load_dotenv
from pydantic import BaseModel
from sqlalchemy.orm import Session

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
# from sqlalchemy import inspect, select, text
from sqlalchemy import func, inspect, select, text
from models import Document, DocumentChunkMeta, QueryLog, User
from profile_routes import router as profile_router
from analytics_routes import router as analytics_router

load_dotenv()  # keep this before importing modules that read env vars

from auth import get_current_user, require_instructor, router as auth_router
from database import Base, engine, get_db
from guardrails import OUT_OF_DOMAIN_MESSAGE, check_context_relevance, validate_query
from ingestion import SUPPORTED_EXTENSIONS, collection, ingest_document
from models import Document, QueryLog, User
from retrieval import retrieve_relevant_chunks
from tutor import generate_answer
from quiz_routes import router as quiz_router
from adaptive_routes import router as adaptive_router
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="AI Learning Assistant API")
app.include_router(profile_router)
app.include_router(analytics_router)


allowed_origins = os.getenv("FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed_origins],
    allow_credentials=False,   # we authenticate with the Authorization header, not cookies
    allow_methods=["*"],
    allow_headers=["*"],
)


Base.metadata.create_all(bind=engine)  # creates any missing tables on startup
app.include_router(auth_router)
app.include_router(quiz_router)
app.include_router(adaptive_router)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


class QueryRequest(BaseModel):
    query: str
    topic: str | None = None  # optional: restrict the search to one topic


@app.get("/")
def health_check():
    return {"status": "ok", "message": "Backend is running"}


@app.get("/config-check")
def config_check():
    return {"groq_key_loaded": bool(os.getenv("GROQ_API_KEY"))}


@app.get("/db-check")
def db_check():
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok", "tables": sorted(inspect(engine).get_table_names())}


@app.get("/collection-stats")
def collection_stats():
    """Quick sanity check: how many chunks are currently stored."""
    return {"total_chunks": collection.count()}


def normalize_topic(raw: str) -> str:
    topic = " ".join(raw.split())  # trim and collapse repeated spaces
    if not 2 <= len(topic) <= 200:
        raise HTTPException(status_code=400, detail="Topic must be between 2 and 200 characters.")
    return topic

@app.post("/ingest")
def ingest_endpoint(
    file: UploadFile = File(...),
    topic: str = Form(...),
    process_images: bool | None = None,
    db: Session = Depends(get_db),
    instructor: User = Depends(require_instructor),
):
    """Instructor-only: upload a PDF, PPTX, TXT or MD file tagged with a topic.
    process_images: true/false overrides the ENABLE_IMAGE_PROCESSING default (PPTX only)."""
    topic = normalize_topic(topic)
    filename = os.path.basename(file.filename)
    ext = os.path.splitext(filename)[1].lower()

    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    file_path = os.path.join(UPLOAD_DIR, filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    result = ingest_document(file_path, source_name=filename, topic=topic,
                             process_images=process_images)

    chunk_ids = result.pop("_chunk_ids", [])
    if result.get("status") == "success":
        doc = Document(filename=filename, topic=topic, uploaded_by=instructor.id)
        db.add(doc)
        db.flush()  # assigns doc.id
        db.add_all([
            DocumentChunkMeta(document_id=doc.id, chunk_index=i, chroma_vector_id=vid)
            for i, vid in enumerate(chunk_ids)
        ])
        db.commit()

    return result

@app.get("/topics")
def list_topics(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """All topics that currently have uploaded material."""
    rows = db.scalars(
        select(Document.topic).where(Document.topic.is_not(None)).distinct().order_by(Document.topic)
    ).all()
    return {"topics": rows}

@app.get("/documents")
def list_documents(db: Session = Depends(get_db), instructor: User = Depends(require_instructor)):
    """Instructor-only: everything uploaded so far, with chunk counts."""
    rows = db.execute(
        select(Document, func.count(DocumentChunkMeta.id))
        .outerjoin(DocumentChunkMeta, DocumentChunkMeta.document_id == Document.id)
        .group_by(Document.id)
        .order_by(Document.uploaded_at.desc())
    ).all()
    return {
        "documents": [
            {
                "id": d.id,
                "filename": d.filename,
                "topic": d.topic,
                "chunks": n,
                "uploaded_at": d.uploaded_at,
            }
            for d, n in rows
        ]
    }


@app.post("/query")
def handle_query(
    request: QueryRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    def log(passed: bool, response: str):
        db.add(QueryLog(
            student_id=user.id,
            query_text=request.query[:2000],
            guardrail_passed=passed,
            response_text=response,
        ))
        db.commit()

    # Step 1: guardrail check on raw input
    validation = validate_query(request.query)
    if not validation["passed"]:
        log(False, validation["reason"])
        return {"status": "blocked", "stage": "guardrail", "message": validation["reason"]}

    # Step 2: retrieve relevant chunks
    chunks = retrieve_relevant_chunks(request.query, top_k=4, topic=request.topic)

    # Step 3: context relevance check (FR-2, out-of-domain detection)
    if not check_context_relevance(chunks):
        message = OUT_OF_DOMAIN_MESSAGE
        log(True, message)
        return {"status": "out_of_domain", "message": message}

    # Step 4: generate the answer via Groq
    answer = generate_answer(request.query, chunks)
    log(True, answer)

    return {
        "status": "success",
        "answer": answer,
        "sources": [{"source": c["source"], "chunk_index": c["chunk_index"]} for c in chunks],
    }