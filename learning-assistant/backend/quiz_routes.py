import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Assessment, Document, MasteryScore, Quiz, User, utcnow
from quiz import NoMaterialError, QuizGenerationError, generate_quiz_questions
from scheduler import (
    REMEDIATION_THRESHOLD,
    build_learning_path,
    resolve_remediation,
    trigger_remediation,
)

from profiling import refresh_profile


router = APIRouter(tags=["quiz"])

# REMEDIATION_THRESHOLD = 50.0   # "Is Score < 50%?" decision in the UML diagram
MASTERY_ALPHA = 0.6            # weight of the newest score in the mastery update


def require_student(user: User = Depends(get_current_user)) -> User:
    if user.role != "student":
        raise HTTPException(status_code=403, detail="Student access required.")
    return user


class GenerateRequest(BaseModel):
    topic: str
    num_questions: int = Field(default=5, ge=1, le=10)


class SubmitRequest(BaseModel):
    # One entry per question: 0-3 for the chosen option, -1 for unanswered
    answers: list[int] = Field(min_length=1, max_length=20)


def update_mastery(db: Session, student_id: uuid.UUID, topic: str, score: float) -> float:
    """First attempt sets mastery to the score; later attempts blend the new score
    with the old mastery, weighting recent performance (exponential moving average)."""
    row = db.scalar(
        select(MasteryScore).where(MasteryScore.student_id == student_id, MasteryScore.topic == topic)
    )
    if row is None:
        row = MasteryScore(student_id=student_id, topic=topic, mastery_value=round(score, 1))
        db.add(row)
    else:
        row.mastery_value = round(MASTERY_ALPHA * score + (1 - MASTERY_ALPHA) * row.mastery_value, 1)
    return row.mastery_value


@router.post("/quiz/generate")
def generate_quiz(body: GenerateRequest, db: Session = Depends(get_db), user: User = Depends(require_student)):
    topic = " ".join(body.topic.split())
    if not db.scalar(select(Document.id).where(Document.topic == topic).limit(1)):
        raise HTTPException(status_code=404, detail=f"No material uploaded for topic '{topic}'.")

    path = build_learning_path(db, user.id)
    topic_status = next((t["status"] for t in path["path"] if t["topic"] == topic), None)
    if topic_status == "locked":
        raise HTTPException(
            status_code=403,
            detail="This topic is locked until you clear your review topics.",
        )
    try:
        questions = generate_quiz_questions(topic, body.num_questions)
    except NoMaterialError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except QuizGenerationError as e:
        raise HTTPException(status_code=502, detail=str(e))

    quiz = Quiz(student_id=user.id, topic=topic, questions=questions)
    db.add(quiz)
    db.commit()

    # The answer key and explanations stay on the server until the quiz is submitted
    return {
        "quiz_id": str(quiz.id),
        "topic": topic,
        "questions": [{"question": q["question"], "options": q["options"]} for q in questions],
    }


@router.post("/quiz/{quiz_id}/submit")
def submit_quiz(quiz_id: uuid.UUID, body: SubmitRequest,
                db: Session = Depends(get_db), user: User = Depends(require_student)):
    # Row lock prevents a double-click or two parallel requests from scoring the quiz twice
    quiz = db.scalar(select(Quiz).where(Quiz.id == quiz_id).with_for_update())
    if quiz is None or quiz.student_id != user.id:
        raise HTTPException(status_code=404, detail="Quiz not found.")
    if quiz.submitted_at is not None:
        raise HTTPException(status_code=409, detail="This quiz has already been submitted.")

    total = len(quiz.questions)
    if len(body.answers) != total:
        raise HTTPException(status_code=400, detail=f"Expected {total} answers, got {len(body.answers)}.")
    if any(a < -1 or a > 3 for a in body.answers):
        raise HTTPException(status_code=400, detail="Each answer must be -1 (skipped) or 0-3.")

    results, correct_count = [], 0
    for q, chosen in zip(quiz.questions, body.answers):
        is_correct = chosen == q["correct_index"]
        correct_count += is_correct
        results.append({
            "question": q["question"],
            "your_answer": chosen,
            "correct_index": q["correct_index"],
            "correct": is_correct,
            "explanation": q["explanation"],
        })

    score = round(correct_count / total * 100, 1)
    db.add(Assessment(student_id=user.id, topic=quiz.topic, score=score))
    mastery = update_mastery(db, user.id, quiz.topic, score)
    quiz.answers = body.answers
    quiz.submitted_at = utcnow()

    # Module 4 rule: below the threshold opens remediation (pausing new topics);
    # at or above it closes any open remediation for this topic
    remediation_recommended = score < REMEDIATION_THRESHOLD
    if remediation_recommended:
        trigger_remediation(db, user.id, quiz.topic)
    else:
        resolve_remediation(db, user.id, quiz.topic)
    db.commit()
        # Keep the learning profile current; a profiling error must never break quiz scoring
    try:
        refresh_profile(db, user.id)
    except Exception as e:
        db.rollback()
        print(f"[profiling] profile refresh failed: {e}")

    return {
        "topic": quiz.topic,
        "score": score,
        "correct": correct_count,
        "total": total,
        "mastery_value": mastery,
        "remediation_recommended": remediation_recommended,
        "results": results,
    }


@router.get("/progress")
def my_progress(db: Session = Depends(get_db), user: User = Depends(require_student)):
    mastery = db.scalars(
        select(MasteryScore).where(MasteryScore.student_id == user.id).order_by(MasteryScore.topic)
    ).all()
    recent = db.scalars(
        select(Assessment).where(Assessment.student_id == user.id)
        .order_by(Assessment.taken_at.desc()).limit(10)
    ).all()
    return {
        "mastery": [{"topic": m.topic, "mastery_value": m.mastery_value, "updated_at": m.updated_at} for m in mastery],
        "recent_assessments": [{"topic": a.topic, "score": a.score, "taken_at": a.taken_at} for a in recent],
    }