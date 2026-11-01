from profiling import FEATURES, MODEL_PATH, PROFILES, classify, train_model

m = train_model()
print(f"Model saved to: {MODEL_PATH}")
print(f"Trained on {m['n_samples']} synthetic students; silhouette score = {m['silhouette']:.3f}\n")

print("Cluster centres (real units):")
print(f"{'profile':30s}" + "".join(f"{f:>18s}" for f in FEATURES))
for key, c in m["centroids"].items():
    print(f"{PROFILES[key]['label']:30s}" + "".join(f"{c[f]:>18}" for f in FEATURES))

examples = {
    "Asha": dict(avg_score=84, trend=2.5, quiz_count=12, questions_asked=3, remediation_count=0, avg_minutes=4),
    "Meena": dict(avg_score=63, trend=0.4, quiz_count=6, questions_asked=9, remediation_count=1, avg_minutes=6),
    "Ravi": dict(avg_score=36, trend=-1.8, quiz_count=4, questions_asked=20, remediation_count=3, avg_minutes=8),
}
print("\nExample students:")
for name, f in examples.items():
    print(f"  {name:6s} -> {PROFILES[classify(f)]['label']}")