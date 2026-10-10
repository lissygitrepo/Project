import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# Free-tier, fast, good quality 
# MODEL_NAME = "llama-3.1-8b-instant"
MODEL_NAME = "openai/gpt-oss-20b"

SYSTEM_PROMPT = """You are an academic tutoring assistant. You must answer ONLY using the
provided context extracted from the course material below.
Keep answers concise, step-by-step where helpful, and never fabricate facts not present in the context."""


def generate_answer(query: str, context_chunks: list[dict]) -> str:
    context_text = "\n\n".join(
        f"[Source: {c['source']}, chunk {c['chunk_index']}]\n{c['text']}"
        for c in context_chunks
    )

    user_prompt = f"""Context from course material:
{context_text}

Student question: {query}

Answer using only the context above."""

    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.3,
        max_completion_tokens=600,
         reasoning_effort="low",
    )

    return response.choices[0].message.content