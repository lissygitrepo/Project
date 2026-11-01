from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth import require_instructor
from database import get_db
from models import User
from profiling import FEATURES, MIN_QUIZZES, WEIGHTS, get_model, refresh_profile
from quiz_routes import require_student

router = APIRouter(tags=["profiling"])


@router.get("/profile")
def my_profile(db: Session = Depends(get_db), user: User = Depends(require_student)):
    """The student's current learning profile (recomputed and saved on each call)."""
    return refresh_profile(db, user.id)


@router.get("/profiling/model")
def model_info(instructor: User = Depends(require_instructor)):
    """Instructor-only: how the profiling model was built (useful for the project report)."""
    m = get_model()
    return {
        "algorithm": "KMeans (k=3) on standardised, weighted features",
        "features": FEATURES,
        "weights": dict(zip(FEATURES, [float(w) for w in WEIGHTS])),
        "trained_on": f"{m['n_samples']} synthetic students",
        "trained_at": m["trained_at"],
        "silhouette_score": round(m["silhouette"], 3),
        "min_quizzes_for_profile": MIN_QUIZZES,
        "cluster_centres": m["centroids"],
    }