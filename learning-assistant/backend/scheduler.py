import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Document, MasteryScore, RemediationLog, utcnow

REMEDIATION_THRESHOLD = 50.0   # quiz score below this opens remediation (UML: "Is Score < 50%?")
MASTERED_THRESHOLD = 75.0      # mastery at or above this counts as mastered


def get_open_remediation(db: Session, student_id: uuid.UUID, topic: str) -> RemediationLog | None:
    return db.scalar(
        select(RemediationLog).where(
            RemediationLog.student_id == student_id,
            RemediationLog.topic == topic,
            RemediationLog.resolved_at.is_(None),
        )
    )


def trigger_remediation(db: Session, student_id: uuid.UUID, topic: str) -> bool:
    """Open remediation for a topic. Returns False if one is already open (no duplicates)."""
    if get_open_remediation(db, student_id, topic) is not None:
        return False
    db.add(RemediationLog(student_id=student_id, topic=topic))
    return True


def resolve_remediation(db: Session, student_id: uuid.UUID, topic: str) -> bool:
    """Close any open remediation for this topic. Returns True if one was closed."""
    row = get_open_remediation(db, student_id, topic)
    if row is None:
        return False
    row.resolved_at = utcnow()
    return True


def build_learning_path(db: Session, student_id: uuid.UUID) -> dict:
    """Rule-based adaptive path:
    1. Topics under remediation come first.
    2. While any remediation is open, topics not yet started are locked (new modules paused).
    3. Then topics in progress, then new topics, then mastered topics."""
    doc_topics = set(db.scalars(
        select(Document.topic).where(Document.topic.is_not(None)).distinct()
    ).all())
    open_topics = set(db.scalars(
        select(RemediationLog.topic).where(
            RemediationLog.student_id == student_id,
            RemediationLog.resolved_at.is_(None),
        )
    ).all())
    mastery = {
        m.topic: m.mastery_value
        for m in db.scalars(select(MasteryScore).where(MasteryScore.student_id == student_id)).all()
    }

    locked = bool(open_topics)
    groups = {"needs_review": [], "in_progress": [], "not_started": [], "locked": [], "mastered": []}

    for topic in sorted(doc_topics | open_topics):
        value = mastery.get(topic)
        if topic in open_topics:
            status, action = "needs_review", "Study the remediation material, then retake the quiz."
        elif value is None:
            if locked:
                status, action = "locked", "Locked until your review topics are cleared."
            else:
                status, action = "not_started", "Ready to start: take the first quiz."
        elif value >= MASTERED_THRESHOLD:
            status, action = "mastered", "Mastered. Revisit occasionally to retain it."
        else:
            status, action = "in_progress", "Practice again to strengthen mastery."
        groups[status].append({"topic": topic, "status": status, "mastery_value": value, "action": action})

    ordered = (groups["needs_review"] + groups["in_progress"] + groups["not_started"]
               + groups["locked"] + groups["mastered"])
    next_item = next(
        (t for t in ordered if t["status"] in ("needs_review", "in_progress", "not_started")), None
    )
    return {"new_topics_locked": locked, "next_recommended": next_item, "path": ordered}