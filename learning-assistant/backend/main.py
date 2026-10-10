from fastapi import FastAPI, UploadFile, File
from dotenv import load_dotenv
import os
import shutil

from pydantic import BaseModel
from retrieval import retrieve_relevant_chunks
from guardrails import validate_query, check_context_relevance
from tutor import generate_answer

from ingestion import ingest_pdf, collection

load_dotenv()

app = FastAPI(title="AI Learning Assistant API")

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.get("/")
def health_check():
    return {"status": "ok", "message": "Backend is running"}


@app.get("/config-check")
def config_check():
    return {"groq_key_loaded": bool(os.getenv("GROQ_API_KEY"))}


@app.post("/ingest")
async def ingest_document(file: UploadFile = File(...)):
    """Upload a PDF, extract its content, chunk it, embed it, and store in ChromaDB."""
    file_path = os.path.join(UPLOAD_DIR, file.filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    result = ingest_pdf(file_path, source_name=file.filename)
    return result


@app.get("/collection-stats")
def collection_stats():
    """Quick sanity check — how many chunks are currently stored."""
    return {"total_chunks": collection.count()}

class QueryRequest(BaseModel):
    query: str


@app.post("/query")
async def handle_query(request: QueryRequest):
    # Step 1: Guardrail check on raw input
    validation = validate_query(request.query)
    if not validation["passed"]:
        return {
            "status": "blocked",
            "stage": "guardrail",
            "message": validation["reason"],
        }

    # Step 2: Retrieve relevant chunks
    chunks = retrieve_relevant_chunks(request.query, top_k=4)

    # Step 3: Context relevance check (FR-2 — out-of-domain detection)
    if not check_context_relevance(chunks):
        return {
            "status": "out_of_domain",
            "message": "This question doesn't appear to relate to the uploaded course material.",
        }

    # Step 4: Generate the answer via Groq
    answer = generate_answer(request.query, chunks)

    return {
        "status": "success",
        "answer": answer,
        "sources": [{"source": c["source"], "chunk_index": c["chunk_index"]} for c in chunks],
    }