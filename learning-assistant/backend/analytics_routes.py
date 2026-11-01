from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from auth import require_instructor
from database import get_db
from guardrails import OUT_OF_DOMAIN_MESSAGE
from models import Assessment, Document, MasteryScore, QueryLog, RemediationLog, User
from profiling import PROFILES, compute_profile

router = APIRouter(prefix="/analytics", tags=["analytics"])

MAX_STUDENTS = 200       # prototype cap: profiles are computed live for each student
INACTIVE_DAYS = 7        # no activity for this long = inactive
OUT_OF_DOMAIN_LIST = 10  # how many recent unanswerable questions to show


def _local_day(dt: datetime):
    return dt.astimezone().date()


@router.get("/overview")
def overview(
    days: int = Query(30, ge=7, le=90),
    db: Session = Depends(get_db),
    instructor: User = Depends(require_instructor),
):
    """Instructor-only cohort analytics. `days` sets the window for activity figures;
    mastery, remediation, and profile figures always reflect the current state."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)

    students = db.scalars(
        select(User).where(User.role == "student").order_by(User.name).limit(MAX_STUDENTS)
    ).all()

    # ---- per-student aggregates (one query each, then looked up by student id)
    quiz_stats = {
        sid: (int(cnt), float(avg), last)
        for sid, cnt, avg, last in db.execute(
            select(Assessment.student_id, func.count(), func.avg(Assessment.score), func.max(Assessment.taken_at))
            .group_by(Assessment.student_id)
        ).all()
    }
    query_last = dict(db.execute(
        select(QueryLog.student_id, func.max(QueryLog.created_at)).group_by(QueryLog.student_id)
    ).all())
    mastery_avg = {
        sid: float(avg) for sid, avg in db.execute(
            select(MasteryScore.student_id, func.avg(MasteryScore.mastery_value)).group_by(MasteryScore.student_id)
        ).all()
    }

    open_rem = defaultdict(list)
    for sid, topic in db.execute(
        select(RemediationLog.student_id, RemediationLog.topic).where(RemediationLog.resolved_at.is_(None))
    ).all():
        open_rem[sid].append(topic)
    rem_by_topic = Counter(t for topics in open_rem.values() for t in topics)

    # ---- topic table
    doc_topics = dict(db.execute(
        select(Document.topic, func.count(Document.id)).where(Document.topic.is_not(None)).group_by(Document.topic)
    ).all())
    mastery_by_topic = {
        t: (int(n), float(avg)) for t, n, avg in db.execute(
            select(MasteryScore.topic, func.count(), func.avg(MasteryScore.mastery_value)).group_by(MasteryScore.topic)
        ).all()
    }
    attempts_by_topic = dict(db.execute(select(Assessment.topic, func.count()).group_by(Assessment.topic)).all())

    topics = []
    for t in sorted(set(doc_topics) | set(mastery_by_topic)):
        n_students, avg_m = mastery_by_topic.get(t, (0, None))
        topics.append({
            "topic": t,
            "files": int(doc_topics.get(t, 0)),
            "students_attempted": n_students,
            "attempts": int(attempts_by_topic.get(t, 0)),
            "avg_mastery": round(avg_m, 1) if avg_m is not None else None,
            "in_remediation": rem_by_topic.get(t, 0),
        })
    # weakest topics first; topics nobody has attempted go last
    topics.sort(key=lambda r: (r["avg_mastery"] is None, r["avg_mastery"] or 0, r["topic"]))

    # ---- activity inside the window
    quiz_events = db.execute(
        select(Assessment.student_id, Assessment.taken_at).where(Assessment.taken_at >= since)
    ).all()
    question_events = db.execute(
        select(QueryLog.student_id, QueryLog.created_at)
        .join(User, User.id == QueryLog.student_id)
        .where(User.role == "student", QueryLog.created_at >= since, QueryLog.guardrail_passed.is_(True))
    ).all()

    today = datetime.now().astimezone().date()
    buckets = {today - timedelta(days=i): {"quizzes": 0, "questions": 0} for i in range(days)}
    for _, ts in quiz_events:
        d = _local_day(ts)
        if d in buckets:
            buckets[d]["quizzes"] += 1
    for _, ts in question_events:
        d = _local_day(ts)
        if d in buckets:
            buckets[d]["questions"] += 1
    activity = [{"date": d.isoformat(), **buckets[d]} for d in sorted(buckets)]
    active_ids = {sid for sid, _ in quiz_events} | {sid for sid, _ in question_events}

    # ---- what students are asking
    blocked, out_of_domain, answered = db.execute(
        select(
            func.count().filter(QueryLog.guardrail_passed.is_(False)),
            func.count().filter(QueryLog.guardrail_passed.is_(True), QueryLog.response_text == OUT_OF_DOMAIN_MESSAGE),
            func.count().filter(QueryLog.guardrail_passed.is_(True), QueryLog.response_text != OUT_OF_DOMAIN_MESSAGE),
        )
        .select_from(QueryLog)
        .join(User, User.id == QueryLog.student_id)
        .where(User.role == "student", QueryLog.created_at >= since)
    ).one()
    recent_ood = db.execute(
        select(QueryLog.query_text, QueryLog.created_at)
        .join(User, User.id == QueryLog.student_id)
        .where(
            User.role == "student",
            QueryLog.created_at >= since,
            QueryLog.guardrail_passed.is_(True),
            QueryLog.response_text == OUT_OF_DOMAIN_MESSAGE,
        )
        .order_by(QueryLog.created_at.desc())
        .limit(OUT_OF_DOMAIN_LIST)
    ).all()
    asked_total = answered + out_of_domain

    # ---- student rows and profile distribution
    profile_counts = Counter()
    rows = []
    for s in students:
        n_quizzes, avg_score, last_quiz = quiz_stats.get(s.id, (0, None, None))
        last_active = max([d for d in (last_quiz, query_last.get(s.id)) if d], default=None)
        days_inactive = (now - last_active).days if last_active else None
        inactive = days_inactive is not None and days_inactive >= INACTIVE_DAYS
        review_topics = sorted(open_rem.get(s.id, []))

        try:
            profile_key = compute_profile(db, s.id)["key"]
        except Exception:
            profile_key = "insufficient_data"
        profile_counts[profile_key] += 1

        rows.append({
            "id": str(s.id),
            "name": s.name,
            "email": s.email,
            "profile_key": profile_key,
            "profile_label": PROFILES[profile_key]["label"],
            "quizzes": n_quizzes,
            "avg_score": round(avg_score, 1) if avg_score is not None else None,
            "avg_mastery": round(mastery_avg[s.id], 1) if s.id in mastery_avg else None,
            "review_topics": review_topics,
            "last_active": last_active,
            "days_inactive": days_inactive,
            "inactive": inactive,
            "needs_attention": bool(review_topics) or inactive,
        })
    rows.sort(key=lambda r: (not r["needs_attention"], r["name"].lower()))

    all_mastery = list(mastery_avg.values())
    return {
        "window_days": days,
        "generated_at": now,
        "summary": {
            "students": len(students),
            "active_students": len(active_ids),
            "quizzes_taken": len(quiz_events),
            "questions_asked": len(question_events),
            "avg_mastery": round(sum(all_mastery) / len(all_mastery), 1) if all_mastery else None,
            "students_in_remediation": len(open_rem),
            "inactive_students": sum(1 for r in rows if r["inactive"]),
            "out_of_domain_rate": round(100 * out_of_domain / asked_total, 1) if asked_total else None,
        },
        "topics": topics,
        "profiles": [
            {"key": k, "label": PROFILES[k]["label"], "count": profile_counts.get(k, 0)}
            for k in ("fast_paced_advanced", "steady_learner", "needs_fundamentals_support", "insufficient_data")
        ],
        "questions": {
            "answered": int(answered),
            "out_of_domain": int(out_of_domain),
            "blocked": int(blocked),
            "recent_out_of_domain": [{"text": t[:300], "asked_at": ts} for t, ts in recent_ood],
        },
        "activity": activity,
        "students": rows,
    }