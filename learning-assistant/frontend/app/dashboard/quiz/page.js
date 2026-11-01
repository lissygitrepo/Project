"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import Markdown from "../../../components/Markdown";

const LETTERS = ["A", "B", "C", "D"];
const COUNTS = [3, 5, 7, 10];

const STATUS_LABEL = {
  needs_review: "needs review",
  in_progress: "in progress",
  not_started: "not started",
  locked: "locked",
  mastered: "mastered",
};

function groupSources(sources = []) {
  const map = new Map();
  for (const s of sources) {
    if (!map.has(s.source)) map.set(s.source, []);
    if (s.chunk_index !== null && s.chunk_index !== undefined) map.get(s.source).push(s.chunk_index);
  }
  return [...map.entries()].map(([file, chunks]) => ({ file, chunks: chunks.sort((a, b) => a - b) }));
}

function scoreTone(score) {
  if (score >= 75) return "border-green-200 bg-green-50 text-green-900";
  if (score >= 50) return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-red-200 bg-red-50 text-red-900";
}

export default function QuizPage() {
  const { user } = useAuth();
  const isStudent = user?.role === "student";

  const [phase, setPhase] = useState("setup"); // setup | taking | results
  const [items, setItems] = useState([]); // learning-path items (topic + status)
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);

  const [quiz, setQuiz] = useState(null); // { quiz_id, topic, questions }
  const [answers, setAnswers] = useState([]); // null = unanswered, 0-3 = chosen option
  const [result, setResult] = useState(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [review, setReview] = useState(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState("");

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function loadTopics() {
    try {
      const p = await apiFetch("/path");
      if (!mounted.current) return;
      setItems(p.path);
      // Keep the current choice if it's still selectable, otherwise pick the first open topic
      setTopic((cur) => {
        if (p.path.find((t) => t.topic === cur && t.status !== "locked")) return cur;
        const first = p.path.find((t) => t.status !== "locked");
        return first ? first.topic : "";
      });
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) setItemsLoaded(true);
    }
  }

  useEffect(() => {
    if (isStudent) loadTopics();
  }, [isStudent]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startQuiz() {
    if (!topic || busy) return;
    setError("");
    setBusy(true);
    try {
      const q = await apiFetch("/quiz/generate", {
        method: "POST",
        json: { topic, num_questions: count },
      });
      setQuiz(q);
      setAnswers(Array(q.questions.length).fill(null));
      setResult(null);
      setReview(null);
      setReviewError("");
      setPhase("taking");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitQuiz() {
    if (busy) return;
    const unanswered = answers.filter((a) => a === null).length;
    if (
      unanswered > 0 &&
      !window.confirm(`${unanswered} question(s) are unanswered and will count as wrong. Submit anyway?`)
    ) {
      return;
    }
    setError("");
    setBusy(true);
    try {
      const r = await apiFetch(`/quiz/${quiz.quiz_id}/submit`, {
        method: "POST",
        json: { answers: answers.map((a) => (a === null ? -1 : a)) },
      });
      setResult(r);
      setPhase("results");
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function getReview() {
    setReviewBusy(true);
    setReviewError("");
    try {
      setReview(await apiFetch("/remediation", { method: "POST", json: { topic: result.topic } }));
    } catch (e) {
      setReviewError(e.message);
    } finally {
      setReviewBusy(false);
    }
  }

  function backToSetup() {
    setPhase("setup");
    setQuiz(null);
    setResult(null);
    setReview(null);
    setReviewError("");
    setError("");
    loadTopics(); // refresh statuses (a low score may have locked other topics)
  }

  function cancelQuiz() {
    if (window.confirm("Leave this quiz? Your answers will be lost.")) backToSetup();
  }

  if (!isStudent) {
    return (
      <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
        The Quiz page is for student accounts. Log in as a student to try it.
      </p>
    );
  }

  const errorBox = error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;

  // ---------- Setup ----------
  if (phase === "setup") {
    const selectable = items.filter((t) => t.status !== "locked");
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Take a quiz</h1>
          <p className="text-sm text-gray-500">Questions are written from your course material.</p>
        </div>

        {errorBox}

        {!itemsLoaded ? (
          <p className="text-sm text-gray-500">Loading topics...</p>
        ) : items.length === 0 ? (
          <p className="rounded-md bg-gray-100 px-4 py-3 text-sm text-gray-600">
            No topics yet. Your instructor needs to upload material first.
          </p>
        ) : (
          <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-5">
            {items.some((t) => t.status === "locked") && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Some topics are locked until you recover your review topics.
              </p>
            )}

            <label className="block text-sm font-medium">
              Topic
              <select
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900"
              >
                {selectable.length === 0 && <option value="">No topics available</option>}
                {items.map((t) => (
                  <option key={t.topic} value={t.topic} disabled={t.status === "locked"}>
                    {t.topic} ({STATUS_LABEL[t.status]}
                    {t.mastery_value !== null ? `, ${t.mastery_value}%` : ""})
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium">
              Number of questions
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="mt-1 w-40 rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900"
              >
                {COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <button
              onClick={startQuiz}
              disabled={busy || !topic}
              className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {busy ? "Writing your quiz from the course material..." : "Start quiz"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---------- Taking ----------
  if (phase === "taking" && quiz) {
    const answered = answers.filter((a) => a !== null).length;
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">{quiz.topic}</h1>
            <p className="text-sm text-gray-500">
              Answered {answered} of {quiz.questions.length}
            </p>
          </div>
          <button
            onClick={cancelQuiz}
            disabled={busy}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel quiz
          </button>
        </div>

        {errorBox}

        {quiz.questions.map((q, qi) => (
          <fieldset key={qi} className="space-y-2 rounded-xl border border-gray-200 bg-white p-5">
            <legend className="px-1 text-sm font-semibold text-gray-500">Question {qi + 1}</legend>
            <p className="font-medium">{q.question}</p>
            <div className="space-y-2">
              {q.options.map((opt, oi) => {
                const chosen = answers[qi] === oi;
                return (
                  <label
                    key={oi}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
                      chosen ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`q${qi}`}
                      checked={chosen}
                      onChange={() => setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)))}
                      className="mt-1"
                    />
                    <span>
                      <span className="mr-1 font-medium">{LETTERS[oi]}.</span>
                      {opt}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}

        <button
          onClick={submitQuiz}
          disabled={busy}
          className="rounded-md bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? "Scoring..." : "Submit answers"}
        </button>
      </div>
    );
  }

  // ---------- Results ----------
  if (phase === "results" && result && quiz) {
    const grouped = review ? groupSources(review.sources) : [];
    return (
      <div className="space-y-6">
        <div className={`rounded-xl border p-5 ${scoreTone(result.score)}`}>
          <p className="text-sm font-medium">{result.topic}</p>
          <p className="mt-1 text-4xl font-semibold">{result.score}%</p>
          <p className="mt-1 text-sm">
            {result.correct} of {result.total} correct &middot; Topic mastery is now {result.mastery_value}%
          </p>
        </div>

        {result.remediation_recommended && (
          <div className="space-y-3 rounded-xl border border-red-200 bg-white p-5">
            <p className="text-sm">
              Your score is below 50%, so new topics are paused until you recover this one. Get a short review
              based on the questions you missed, then retake the quiz.
            </p>

            {!review && (
              <button
                onClick={getReview}
                disabled={reviewBusy}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {reviewBusy ? "Preparing your review..." : "Get review help"}
              </button>
            )}

            {reviewError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{reviewError}</p>}

            {review && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <Markdown>{review.review}</Markdown>
                {grouped.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span>Sources:</span>
                    {grouped.map((g) => (
                      <span key={g.file} className="rounded-full bg-gray-100 px-2 py-0.5">
                        {g.file}
                        {g.chunks.length > 0 && ` · chunk ${g.chunks.join(", ")}`}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Review your answers</h2>
          {result.results.map((r, i) => {
            const q = quiz.questions[i];
            const mine = r.your_answer >= 0 ? q.options[r.your_answer] : null;
            return (
              <div key={i} className="space-y-2 rounded-xl border border-gray-200 bg-white p-5 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">
                    {i + 1}. {q.question}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.correct ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                    }`}
                  >
                    {r.correct ? "Correct" : mine === null ? "Skipped" : "Incorrect"}
                  </span>
                </div>
                {!r.correct && (
                  <p className="text-gray-600">
                    Your answer: <span className="font-medium">{mine === null ? "(none)" : mine}</span>
                  </p>
                )}
                <p className="text-gray-600">
                  Correct answer:{" "}
                  <span className="font-medium text-green-700">
                    {LETTERS[r.correct_index]}. {q.options[r.correct_index]}
                  </span>
                </p>
                {r.explanation && <p className="rounded-md bg-gray-50 px-3 py-2 text-gray-700">{r.explanation}</p>}
              </div>
            );
          })}
        </div>

        <button
          onClick={backToSetup}
          className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Take another quiz
        </button>
      </div>
    );
  }

  return null;
}