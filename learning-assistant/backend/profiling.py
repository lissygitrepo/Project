import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models import Assessment, QueryLog, Quiz, RemediationLog, StudentProfile

FEATURES = ["avg_score", "trend", "quiz_count", "questions_asked", "remediation_count", "avg_minutes"]
# Performance signals count more than engagement signals, so a low scorer who simply
# asks few questions is not mistaken for a steady learner
WEIGHTS = np.array([3.0, 2.0, 0.5, 0.5, 1.5, 0.5])

MIN_QUIZZES = 2          # fewer quizzes than this: "not enough data yet"
MODEL_VERSION = 2
MODEL_PATH = Path(__file__).parent / "model_store" / "profiler.joblib"

PROFILES = {
    "fast_paced_advanced": {
        "label": "Fast-paced advanced",
        "track": "advanced",
        "tip": "You are moving quickly and scoring well. Try the harder topics and quiz yourself with more questions.",
    },
    "steady_learner": {
        "label": "Steady learner",
        "track": "standard",
        "tip": "You are making steady progress. Keep a regular rhythm and revisit topics that are still below 75%.",
    },
    "needs_fundamentals_support": {
        "label": "Needs fundamentals support",
        "track": "foundational",
        "tip": "Let us rebuild the basics first. Use the review help after each quiz and retake topics until you pass 50%.",
    },
    "insufficient_data": {
        "label": "Not enough data yet",
        "track": "standard",
        "tip": "Take at least 2 quizzes and your learning profile will appear here.",
    },
}

REVIEW_STYLE = {
    "needs_fundamentals_support": (
        "Style: the student is struggling with the basics. Use very simple words and short sentences, "
        "define every technical term the first time it appears, and explain one idea at a time."
    ),
    "fast_paced_advanced": (
        "Style: the student is advanced. Keep the review brief and focus on the subtle points they missed."
    ),
}


def review_style_hint(profile_key: str) -> str:
    return ("\n\n" + REVIEW_STYLE[profile_key]) if profile_key in REVIEW_STYLE else ""


# ---------------------------------------------------------------- training data

def make_synthetic_students(n_per_group: int = 50, seed: int = 42) -> np.ndarray:
    """Simulated cohort built from three behaviour patterns (advanced, steady, struggling).
    Real data is too sparse to train on, so the model is fitted on this and applied to real students."""
    rng = np.random.default_rng(seed)

    def group(n, score, trend, quizzes, questions, remed, minutes):
        return np.column_stack([
            np.clip(rng.normal(score[0], score[1], n), 0, 100),
            np.clip(rng.normal(trend[0], trend[1], n), -15, 15),
            rng.poisson(quizzes, n) + MIN_QUIZZES,
            rng.poisson(questions, n),
            rng.poisson(remed, n),
            np.clip(rng.normal(minutes[0], minutes[1], n), 1, 30),
        ])

    n = n_per_group
    return np.vstack([
        group(n, (84, 6), (2.0, 1.5), 8, 4, 0.1, (4, 1.2)),    # advanced
        group(n, (64, 7), (0.5, 2.0), 5, 8, 1.0, (6, 1.5)),    # steady
        group(n, (38, 8), (-1.5, 2.0), 3, 16, 3.0, (8, 2.0)),  # struggling
    ])


def train_model() -> dict:
    X = make_synthetic_students()
    scaler = StandardScaler().fit(X)
    Xs = scaler.transform(X) * WEIGHTS
    km = KMeans(n_clusters=3, n_init=10, random_state=42).fit(Xs)
    silhouette = float(silhouette_score(Xs, km.labels_))

    centres = scaler.inverse_transform(km.cluster_centers_ / WEIGHTS)   # back to real units
    order = np.argsort(centres[:, FEATURES.index("avg_score")])         # lowest -> highest score
    label_map = {
        int(order[0]): "needs_fundamentals_support",
        int(order[1]): "steady_learner",
        int(order[2]): "fast_paced_advanced",
    }

    artifact = {
        "version": MODEL_VERSION,
        "scaler": scaler,
        "kmeans": km,
        "label_map": label_map,
        "features": FEATURES,
        "n_samples": int(len(X)),
        "silhouette": silhouette,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "centroids": {
            label_map[c]: {f: round(float(v), 1) for f, v in zip(FEATURES, centres[c])}
            for c in label_map
        },
    }
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, MODEL_PATH)
    return artifact


_model = None
_lock = threading.Lock()


def get_model() -> dict:
    """Load the saved model, or train and save one on first use."""
    global _model
    with _lock:
        if _model is None:
            if MODEL_PATH.exists():
                try:
                    loaded = joblib.load(MODEL_PATH)
                    if loaded.get("version") == MODEL_VERSION and loaded.get("features") == FEATURES:
                        _model = loaded
                except Exception:
                    _model = None
            if _model is None:
                _model = train_model()
        return _model


def classify(features: dict) -> str:
    m = get_model()
    x = np.array([[features[f] for f in FEATURES]], dtype=float)
    cluster = int(m["kmeans"].predict(m["scaler"].transform(x) * WEIGHTS)[0])
    return m["label_map"][cluster]


# ---------------------------------------------------------------- real students

def student_features(db: Session, student_id: uuid.UUID) -> dict:
    scores = [
        r[0] for r in db.execute(
            select(Assessment.score).where(Assessment.student_id == student_id).order_by(Assessment.taken_at)
        ).all()
    ]
    n = len(scores)

    trend = 0.0
    if n >= 2:
        trend = float(np.polyfit(np.arange(n), scores, 1)[0])   # score points gained per quiz
    trend = max(-15.0, min(15.0, trend))

    # Median minutes per submitted quiz, each capped at 30 so an abandoned tab does not skew it
    durations = db.execute(
        select(Quiz.created_at, Quiz.submitted_at).where(
            Quiz.student_id == student_id, Quiz.submitted_at.is_not(None)
        )
    ).all()
    minutes = [min(30.0, max(0.0, (s - c).total_seconds() / 60)) for c, s in durations]

    questions = db.scalar(
        select(func.count()).select_from(QueryLog).where(
            QueryLog.student_id == student_id, QueryLog.guardrail_passed.is_(True)
        )
    ) or 0
    remediations = db.scalar(
        select(func.count()).select_from(RemediationLog).where(RemediationLog.student_id == student_id)
    ) or 0

    return {
        "avg_score": round(float(np.mean(scores)), 1) if scores else 0.0,
        "trend": round(trend, 2),
        "quiz_count": n,
        "questions_asked": int(questions),
        "remediation_count": int(remediations),
        "avg_minutes": round(float(np.median(minutes)), 1) if minutes else 0.0,
    }


def compute_profile(db: Session, student_id: uuid.UUID) -> dict:
    feats = student_features(db, student_id)
    key = classify(feats) if feats["quiz_count"] >= MIN_QUIZZES else "insufficient_data"
    meta = PROFILES[key]
    return {
        "key": key,
        "label": meta["label"],
        "learning_track": meta["track"],
        "tip": meta["tip"],
        "quizzes_needed": max(0, MIN_QUIZZES - feats["quiz_count"]),
        "based_on": feats,
    }


def refresh_profile(db: Session, student_id: uuid.UUID) -> dict:
    """Recompute the profile and save it to student_profiles."""
    profile = compute_profile(db, student_id)
    row = db.scalar(select(StudentProfile).where(StudentProfile.user_id == student_id))
    if row is None:
        row = StudentProfile(user_id=student_id)
        db.add(row)
    row.cognitive_profile = {
        "key": profile["key"],
        "label": profile["label"],
        "based_on": profile["based_on"],
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }
    row.learning_track = profile["learning_track"]
    db.commit()
    return profile