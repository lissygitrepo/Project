import re

from ingestion import collection
from retrieval import retrieve_relevant_chunks
from tutor import MODEL_NAME, client

MAX_MISSED = 5

SYSTEM_PROMPT = (
    "You are a patient tutor helping a student recover after a low quiz score. "
    "Use ONLY the course material provided; never add outside facts. "
    "Write in simple, encouraging language. Format the answer in markdown with exactly "
    "these sections:\n"
    "## Key ideas to revisit (3-5 short bullets)\n"
    "## Where you slipped (one short paragraph per missed question: explain the correct "
    "answer and why the student's choice was wrong; skip this section if no missed "
    "questions are listed)\n"
    "## Try this next (2-3 self-check questions the student can answer on their own; "
    "do not give the answers)"
)


def _gather_material(topic: str, missed: list[dict]) -> list[dict]:
    """Use each missed question as a search query so the review targets the student's gaps."""
    seen, chunks = set(), []
    for m in missed[:MAX_MISSED]:
        for c in retrieve_relevant_chunks(m["question"], top_k=2, topic=topic):
            key = (c["source"], c["chunk_index"])
            if key not in seen:
                seen.add(key)
                chunks.append(c)

    if not chunks:  # no missed-question info available: fall back to general topic material
        data = collection.get(where={"topic": topic}, include=["documents", "metadatas"], limit=6)
        for doc, meta in zip(data.get("documents") or [], data.get("metadatas") or []):
            chunks.append({"text": doc, "source": meta.get("source"), "chunk_index": meta.get("chunk_index")})
    return chunks


def generate_review(topic: str, missed: list[dict], style_hint: str = "") -> dict:
    chunks = _gather_material(topic, missed)
    if not chunks:
        raise ValueError(f"No material found for topic '{topic}'.")

    material = "\n\n".join(
        f"[Source: {c['source']}, chunk {c['chunk_index']}]\n{c['text']}" for c in chunks
    )
    if missed:
        missed_text = "\n".join(
            f"{i}. Question: {m['question']}\n"
            f"   Correct answer: {m['correct_option']}\n"
            f"   Student answered: {m['your_answer'] or 'skipped'}\n"
            f"   Note: {m['explanation']}"
            for i, m in enumerate(missed[:MAX_MISSED], start=1)
        )
    else:
        missed_text = "(no missed-question details available)"

    user_prompt = (
        f"Topic: {topic}\n\nCourse material:\n{material}\n\n"
        f"Questions the student missed:\n{missed_text}\n\n"
        "Write the review now."
    )

    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT + style_hint},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.3,
        max_completion_tokens=2000,  # reasoning tokens count toward this limit
        reasoning_effort="low",
    )
    text = re.sub(r"<think>.*?</think>", "", response.choices[0].message.content or "", flags=re.DOTALL).strip()
    if not text:
        raise RuntimeError("The model returned an empty review. Please try again.")

    return {
        "review": text,
        "sources": [{"source": c["source"], "chunk_index": c["chunk_index"]} for c in chunks],
    }