import re

# Basic patterns that should never reach the LLM
BLOCKED_PATTERNS = [
    r"ignore (all )?(previous|prior) instructions",
    r"system prompt",
    r"</?script>",
    r"(drop|delete)\s+table",
    r"--\s*$",  # trailing SQL comment, common injection marker
]

MIN_QUERY_LENGTH = 3
MAX_QUERY_LENGTH = 1000
OUT_OF_DOMAIN_MESSAGE = "This question doesn't appear to relate to the uploaded course material."


def validate_query(query: str) -> dict:
    """
    Validates a student query before it reaches retrieval/LLM.
    Returns {"passed": bool, "reason": str | None}
    """
    if not query or len(query.strip()) < MIN_QUERY_LENGTH:
        return {"passed": False, "reason": "Query is too short or empty."}

    if len(query) > MAX_QUERY_LENGTH:
        return {"passed": False, "reason": "Query exceeds maximum allowed length."}

    lowered = query.lower()
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, lowered):
            return {"passed": False, "reason": "Query failed security validation."}

    return {"passed": True, "reason": None}


def check_context_relevance(retrieved_chunks: list[dict], min_score: float = 0.25) -> bool:
    """
    FR-2: if nothing retrieved is even loosely relevant, treat the query
    as out-of-domain rather than letting the LLM improvise an answer.
    """
    if not retrieved_chunks:
        return False
    return any(c["similarity_score"] >= min_score for c in retrieved_chunks)