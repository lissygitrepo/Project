import json
import random
import re

import groq

from ingestion import collection
from tutor import MODEL_NAME, client  # reuse the same Groq client and model

MAX_CONTEXT_CHUNKS = 8   # how many chunks of the topic go into one quiz
MAX_ATTEMPTS = 2         # retry once if the model returns malformed JSON


class NoMaterialError(Exception):
    pass


class QuizGenerationError(Exception):
    pass


SYSTEM_PROMPT = (
    "You write multiple-choice quiz questions for university students. "
    "Use ONLY the course material provided; never use outside knowledge. "
    "Each question must have exactly 4 options with exactly one correct answer, "
    "plausible wrong options, and no 'all of the above' or 'none of the above'. "
    "Vary which position holds the correct answer. "
    "Each explanation must be 1-2 sentences and cite what the material says. "
    "Respond with JSON only."
)

JSON_SHAPE = (
    'Return ONLY a JSON object in exactly this shape:\n'
    '{"questions": [{"question": "...", "options": ["...", "...", "...", "..."], '
    '"correct_index": 0, "explanation": "..."}]}'
)


def _fetch_context(topic: str) -> str:
    data = collection.get(where={"topic": topic}, include=["documents"])
    docs = data.get("documents") or []
    if not docs:
        raise NoMaterialError(f"No material found for topic '{topic}'.")
    sample = random.sample(docs, min(len(docs), MAX_CONTEXT_CHUNKS))
    return "\n\n---\n\n".join(sample)


def _parse_questions(raw: str, n: int) -> list[dict]:
    text = re.sub(r"<think>.*?</think>", "", raw or "", flags=re.DOTALL).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object found")

    data = json.loads(text[start:end + 1])
    questions = data.get("questions")
    if not isinstance(questions, list):
        raise ValueError("'questions' is not a list")

    cleaned = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        options = q.get("options")
        correct = q.get("correct_index")
        valid = (
            isinstance(q.get("question"), str) and q["question"].strip()
            and isinstance(options, list) and len(options) == 4
            and all(isinstance(o, str) and o.strip() for o in options)
            and isinstance(correct, int) and not isinstance(correct, bool)
            and 0 <= correct <= 3
        )
        if valid:
            cleaned.append({
                "question": q["question"].strip(),
                "options": [o.strip() for o in options],
                "correct_index": correct,
                "explanation": str(q.get("explanation", "")).strip(),
            })

    if not cleaned:
        raise ValueError("no valid questions in the response")
    return cleaned[:n]


def _call_llm(user_prompt: str):
    kwargs = dict(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.5,
        max_completion_tokens=3000,  # reasoning tokens count toward this limit
        reasoning_effort="low",
    )
    try:
        return client.chat.completions.create(**kwargs, response_format={"type": "json_object"})
    except groq.BadRequestError:
        # If JSON mode isn't accepted for this model, retry and parse manually
        return client.chat.completions.create(**kwargs)


def generate_quiz_questions(topic: str, n: int) -> list[dict]:
    context = _fetch_context(topic)
    user_prompt = (
        f"Course material (topic: {topic}):\n{context}\n\n"
        f"Write exactly {n} multiple-choice questions based only on this material.\n"
        + JSON_SHAPE
    )

    last_error = None
    for _ in range(MAX_ATTEMPTS):
        try:
            response = _call_llm(user_prompt)
            return _parse_questions(response.choices[0].message.content, n)
        except (ValueError, json.JSONDecodeError) as e:
            last_error = e
        except groq.APIError as e:
            raise QuizGenerationError(f"The language model request failed: {e}") from e

    raise QuizGenerationError(f"Could not produce a valid quiz ({last_error}). Please try again.")