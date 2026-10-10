import os
import uuid
from pypdf import PdfReader
import chromadb
from sentence_transformers import SentenceTransformer

# Load the embedding model once (free, runs locally on CPU)
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")

# Persistent ChromaDB client — stores data in a local folder, survives restarts
chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection(name="course_materials")


def extract_text_from_pdf(file_path: str) -> str:
    """Extract raw text from a PDF file."""
    reader = PdfReader(file_path)
    text = ""
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            text += page_text + "\n"
    return text


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 100) -> list[str]:
    """
    Split text into overlapping chunks using a sliding window.
    chunk_size and overlap are measured in characters (simple and
    dependency-free — good enough for project scale).
    """
    chunks = []
    start = 0
    text_length = len(text)

    while start < text_length:
        end = start + chunk_size
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start += chunk_size - overlap  # move forward, keeping overlap

    return chunks


def embed_and_store(chunks: list[str], source_name: str) -> int:
    """
    Generate embeddings for each chunk and store them in ChromaDB,
    along with metadata (which source file each chunk came from).
    """
    if not chunks:
        return 0

    embeddings = embedding_model.encode(chunks).tolist()
    ids = [str(uuid.uuid4()) for _ in chunks]
    metadatas = [{"source": source_name, "chunk_index": i} for i in range(len(chunks))]

    collection.add(
        ids=ids,
        embeddings=embeddings,
        documents=chunks,
        metadatas=metadatas,
    )
    return len(chunks)


def ingest_pdf(file_path: str, source_name: str) -> dict:
    """Full pipeline: extract -> chunk -> embed -> store."""
    text = extract_text_from_pdf(file_path)
    if not text.strip():
        return {"status": "error", "message": "No extractable text found in PDF."}

    chunks = chunk_text(text)
    stored_count = embed_and_store(chunks, source_name)

    return {
        "status": "success",
        "source": source_name,
        "characters_extracted": len(text),
        "chunks_created": stored_count,
    }