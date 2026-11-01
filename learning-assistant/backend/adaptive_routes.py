import groq
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import Quiz, User
from quiz_routes import require_student
from remediation import generate_review
from scheduler import build_learning_path, get_open_remediation
from profiling import compute_profile, review_style_hint

router = APIRouter(tags=["adaptive"])


class RemediationRequest(BaseModel):
    topic: str


@router.get("/path")
def my_learning_path(db: Session = Depends(get_db), user: User = Depends(require_student)):
    return build_learning_path(db, user.id)


@router.post("/remediation")
def get_remediation(body: RemediationRequest, db: Session = Depends(get_db),
                    user: User = Depends(require_student)):
    topic = " ".join(body.topic.split())
    if get_open_remediation(db, user.id, topic) is None:
        raise HTTPException(
            status_code=404,
            detail="No active remediation for this topic. It opens after a quiz score below 50%.",
        )

    # Find what the student got wrong on their most recent submitted quiz for this topic
    quiz = db.scalar(
        select(Quiz)
        .where(Quiz.student_id == user.id, Quiz.topic == topic, Quiz.submitted_at.is_not(None))
        .order_by(Quiz.submitted_at.desc())
        .limit(1)
    )
    missed = []
    if quiz and quiz.answers:
        for q, chosen in zip(quiz.questions, quiz.answers):
            if chosen != q["correct_index"]:
                missed.append({
                    "question": q["question"],
                    "correct_option": q["options"][q["correct_index"]],
                    "your_answer": q["options"][chosen] if 0 <= chosen < len(q["options"]) else None,
                    "explanation": q["explanation"],
                })

    try:
        style_hint = review_style_hint(compute_profile(db, user.id)["key"])
        result = generate_review(topic, missed, style_hint)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except (RuntimeError, groq.APIError) as e:
        raise HTTPException(status_code=502, detail=f"Could not generate the review: {e}")

    return {"topic": topic, "based_on_missed_questions": len(missed), **result}