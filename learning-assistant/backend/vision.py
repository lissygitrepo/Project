import base64
import os
import re

import groq
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

VISION_MODEL = "qwen/qwen3.8-27b"
SUPPORTED_MIME = {"image/jpeg", "image/png", "image/gif", "image/webp"}
MIN_IMAGE_BYTES = 8_000  # skip tiny icons/logos

PROMPT = (
    "This image is from a university lecture slide. Describe it for a student who "
    "cannot see it: transcribe any visible text and labels, and explain what the "
    "diagram, chart or figure shows. Be factual and concise (max 120 words). "
    "If the image is purely decorative (logo, icon, background), reply with exactly: DECORATIVE"
)


def _strip_thinking(text: str) -> str:
    # Thinking-mode models may include <think>...</think> blocks; drop them
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def describe_image(image_bytes: bytes, mime_type: str) -> str | None:
    """Return a text description of the image, or None if it was skipped/failed."""
    if len(image_bytes) < MIN_IMAGE_BYTES or mime_type not in SUPPORTED_MIME:
        return None

    b64 = base64.b64encode(image_bytes).decode("utf-8")
    kwargs = dict(
        model=VISION_MODEL,
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}},
            ],
        }],
        temperature=0.2,
        max_completion_tokens=800,
    )

    try:
        try:
            # Ask for no extended reasoning so captioning stays fast
            resp = client.chat.completions.create(**kwargs, reasoning_effort="none")
        except groq.BadRequestError:
            # If this value isn't accepted, retry with the model's defaults
            resp = client.chat.completions.create(**kwargs)
        text = _strip_thinking(resp.choices[0].message.content or "")
    except Exception as e:
        print(f"[vision] captioning failed: {e}")
        return None

    if not text or text.upper().startswith("DECORATIVE"):
        return None
    return text