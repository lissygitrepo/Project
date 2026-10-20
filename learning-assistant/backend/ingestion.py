import os
import uuid

import chromadb
import pdfplumber
from vision import describe_image
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from sentence_transformers import SentenceTransformer

from dotenv import load_dotenv

load_dotenv()


def _env_flag(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


# Global default; can be overridden per upload via the /ingest endpoint
IMAGE_PROCESSING_DEFAULT = _env_flag("ENABLE_IMAGE_PROCESSING", default=False)

# Embedding model: free, local, CPU-friendly
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")

# Persistent vector store. Cosine space makes distance = 1 - cosine similarity,
# which is what retrieval.py assumes when it computes similarity_score.
chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection(
    name="course_materials",
    metadata={"hnsw:space": "cosine"},
)

SUPPORTED_EXTENSIONS = {".pdf", ".pptx", ".txt", ".md"}
MAX_IMAGE_CALLS_PER_FILE = 15  # protects free-tier rate limits


# ---------- Table helper ----------

def _clean_cell(cell) -> str:
    if cell is None:
        return ""
    return " ".join(str(cell).split())  # collapse newlines/extra spaces


def table_to_markdown(rows: list[list]) -> str:
    """Convert a table (list of rows) into a markdown table, so row/column
    relationships survive embedding and are readable by the LLM."""
    rows = [[_clean_cell(c) for c in row] for row in rows if row]
    rows = [r for r in rows if any(r)]  # drop fully empty rows
    if not rows:
        return ""

    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]  # pad ragged rows

    header, body = rows[0], rows[1:]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    for r in body:
        lines.append("| " + " | ".join(r) + " |")
    return "\n".join(lines)


# ---------- PDF ----------

def extract_from_pdf(file_path: str) -> tuple[str, dict]:
    parts = []
    table_count = 0
    image_count = 0

    with pdfplumber.open(file_path) as pdf:
        page_total = len(pdf.pages)

        for page_num, page in enumerate(pdf.pages, start=1):
            found_tables = page.find_tables()
            bboxes = [t.bbox for t in found_tables]
            image_count += len(page.images)

            # Extract body text *excluding* table areas, so table content
            # isn't duplicated as jumbled text AND as a markdown table.
            def outside_tables(obj, bboxes=bboxes):
                x0, top = obj.get("x0"), obj.get("top")
                x1, bottom = obj.get("x1"), obj.get("bottom")
                if None in (x0, top, x1, bottom):
                    return True
                for bx0, btop, bx1, bbottom in bboxes:
                    if x0 >= bx0 - 1 and x1 <= bx1 + 1 and top >= btop - 1 and bottom <= bbottom + 1:
                        return False
                return True

            page_text = page.filter(outside_tables).extract_text() or ""

            page_parts = []
            if page_text.strip():
                page_parts.append(page_text.strip())

            for t in found_tables:
                md = table_to_markdown(t.extract())
                if md:
                    page_parts.append("Table:\n" + md)
                    table_count += 1

            if page_parts:
                parts.append(f"[Page {page_num}]\n" + "\n\n".join(page_parts))

    stats = {"pages": page_total, "tables_extracted": table_count, "images_skipped": image_count}
    return "\n\n".join(parts), stats


# ---------- PPTX ----------

def _shape_to_text(shape, state: dict) -> tuple[list[str], int]:
    """Returns (text_blocks, tables_found) for one shape, recursing into groups.
    Pictures are captioned by a vision model; counts are tracked in `state`."""
    texts, tables = [], 0

    if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
        for child in shape.shapes:
            t, tb = _shape_to_text(child, state)
            texts += t
            tables += tb
        return texts, tables

    if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
        desc = None
        if state["enabled"] and state["attempts"] < MAX_IMAGE_CALLS_PER_FILE:
            state["attempts"] += 1
            try:
                desc = describe_image(shape.image.blob, shape.image.content_type)
            except Exception:
                desc = None
        if desc:
            state["described"] += 1
            texts.append("Image description: " + desc)
        else:
            state["skipped"] += 1
        return texts, tables

    if getattr(shape, "has_table", False) and shape.has_table:
        rows = [[cell.text for cell in row.cells] for row in shape.table.rows]
        md = table_to_markdown(rows)
        if md:
            texts.append("Table:\n" + md)
            tables += 1
        return texts, tables

    if getattr(shape, "has_text_frame", False) and shape.has_text_frame:
        t = shape.text_frame.text.strip()
        if t:
            texts.append(t)

    return texts, tables


def extract_from_pptx(file_path: str, process_images: bool = False) -> tuple[str, dict]:
    prs = Presentation(file_path)
    parts = []
    table_count = 0
    state = {"enabled": process_images, "attempts": 0, "described": 0, "skipped": 0}

    for slide_num, slide in enumerate(prs.slides, start=1):
        slide_parts = []

        for shape in slide.shapes:
            texts, tb = _shape_to_text(shape, state)
            slide_parts += texts
            table_count += tb

        if slide.has_notes_slide and slide.notes_slide.notes_text_frame is not None:
            notes = slide.notes_slide.notes_text_frame.text.strip()
            if notes:
                slide_parts.append("Speaker notes: " + notes)

        if slide_parts:
            parts.append(f"[Slide {slide_num}]\n" + "\n\n".join(slide_parts))

    stats = {
        "slides": len(prs.slides),
        "tables_extracted": table_count,
        "images_described": state["described"],
        "images_skipped": state["skipped"],
        "image_processing": "on" if process_images else "off",
    }
    return "\n\n".join(parts), stats

# ---------- TXT / MD ----------

def extract_from_text_file(file_path: str) -> tuple[str, dict]:
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
    return text, {}


# ---------- Dispatcher ----------

def extract_text(file_path: str, process_images: bool = False) -> tuple[str, dict]:
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".pdf":
        return extract_from_pdf(file_path)
    if ext == ".pptx":
        return extract_from_pptx(file_path, process_images)
    if ext in (".txt", ".md"):
        return extract_from_text_file(file_path)
    raise ValueError(f"Unsupported file type: {ext}")


# ---------- Chunking, embedding, storage (unchanged logic) ----------

def chunk_text(text: str, chunk_size: int = 500, overlap: int = 100) -> list[str]:
    chunks = []
    start = 0
    while start < len(text):
        chunk = text[start:start + chunk_size].strip()
        if chunk:
            chunks.append(chunk)
        start += chunk_size - overlap
    return chunks

def embed_and_store(chunks: list[str], source_name: str, topic: str) -> list[str]:
    """Embed chunks and store them in ChromaDB with source + topic metadata.
    Returns the list of vector IDs (used to fill document_chunks_meta)."""
    if not chunks:
        return []

    embeddings = embedding_model.encode(chunks).tolist()
    ids = [str(uuid.uuid4()) for _ in chunks]
    metadatas = [
        {"source": source_name, "chunk_index": i, "topic": topic}
        for i in range(len(chunks))
    ]

    collection.add(ids=ids, embeddings=embeddings, documents=chunks, metadatas=metadatas)
    return ids


# def embed_and_store(chunks: list[str], source_name: str) -> int:
#     if not chunks:
#         return 0

#     embeddings = embedding_model.encode(chunks).tolist()
#     ids = [str(uuid.uuid4()) for _ in chunks]
#     metadatas = [{"source": source_name, "chunk_index": i} for i in range(len(chunks))]

#     collection.add(ids=ids, embeddings=embeddings, documents=chunks, metadatas=metadatas)
#     return len(chunks)


def ingest_document(file_path: str, source_name: str, topic: str,
                    process_images: bool | None = None) -> dict:
    """Full pipeline: extract -> chunk -> embed -> store.
    process_images=None means 'use the ENABLE_IMAGE_PROCESSING default'."""
    if process_images is None:
        process_images = IMAGE_PROCESSING_DEFAULT

    text, stats = extract_text(file_path, process_images)
    if not text.strip():
        return {"status": "error", "message": "No extractable text found in this file."}

    chunks = chunk_text(text)
    chunk_ids = embed_and_store(chunks, source_name, topic)

    return {
        "status": "success",
        "source": source_name,
        "topic": topic,
        "characters_extracted": len(text),
        "chunks_created": len(chunk_ids),
        "_chunk_ids": chunk_ids,  # internal: main.py removes this before responding
        **stats,
    }