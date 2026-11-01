"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

const STATUS_STYLE = {
  needs_review: "bg-red-50 text-red-700",
  in_progress: "bg-amber-50 text-amber-700",
  not_started: "bg-blue-50 text-blue-700",
  locked: "bg-gray-100 text-gray-600",
  mastered: "bg-green-50 text-green-700",
};

const barColor = (v) => (v >= 75 ? "bg-green-500" : v >= 50 ? "bg-amber-500" : "bg-red-500");

function formatWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs shadow">
      <p className="font-semibold">{d.topic}</p>
      <p>Score: {d.score}%</p>
      <p className="text-gray-500">{d.when}</p>
    </div>
  );
}

export default function ProgressPage() {
  const { user } = useAuth();
  const isStudent = user?.role === "student";

  const [path, setPath] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isStudent) return;
    let cancelled = false;
    (async () => {
      try {
        const [p, pr] = await Promise.all([apiFetch("/path"), apiFetch("/progress")]);
        if (!cancelled) {
          setPath(p);
          setProgress(pr);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isStudent]);

  if (!isStudent) {
    return (
      <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
        The Progress page is for student accounts. Log in as a student to see it.
      </p>
    );
  }

  if (!loaded) return <p className="text-sm text-gray-500">Loading your progress...</p>;

  if (error) {
    return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  }

  const items = path?.path ?? [];
  const recent = progress?.recent_assessments ?? []; // newest first
  const attempted = items.filter((t) => t.mastery_value !== null);
  const avgMastery = attempted.length
    ? Math.round(attempted.reduce((sum, t) => sum + t.mastery_value, 0) / attempted.length)
    : null;
  const needsReview = items.filter((t) => t.status === "needs_review").length;
  const masteredCount = items.filter((t) => t.status === "mastered").length;

  // Chart needs oldest -> newest
  const history = [...recent].reverse().map((a, i) => ({
    n: i + 1,
    score: a.score,
    topic: a.topic,
    when: formatWhen(a.taken_at),
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">My progress</h1>
        <p className="text-sm text-gray-500">How you are doing in each topic, and what to do next.</p>
      </div>

      {items.length === 0 ? (
        <p className="rounded-md bg-gray-100 px-4 py-3 text-sm text-gray-600">
          No topics yet. Your instructor needs to upload material first.
        </p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Topics" value={items.length} />
            <Stat label="Average mastery" value={avgMastery === null ? "n/a" : `${avgMastery}%`} hint="Topics you have attempted" />
            <Stat label="Mastered" value={masteredCount} hint="75% or more" />
            <Stat label="Needs review" value={needsReview} hint="Below 50% on last result" />
          </div>

          {/* Mastery bars */}
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="font-semibold">Mastery by topic</h2>
            <p className="mb-4 text-xs text-gray-500">
              Mastery blends your quiz scores, giving more weight to recent ones. The markers show the 50% review
              line and the 75% mastered line.
            </p>
            <ul className="space-y-4">
              {items.map((t) => (
                <li key={t.topic}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium">{t.topic}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-gray-500">
                        {t.mastery_value === null ? "No quiz yet" : `${t.mastery_value}%`}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status]}`}>
                        {t.status.replace("_", " ")}
                      </span>
                    </span>
                  </div>
                  <div className="relative h-2.5 w-full overflow-hidden rounded bg-gray-100">
                    {t.mastery_value !== null && (
                      <div
                        className={`h-full rounded ${barColor(t.mastery_value)}`}
                        style={{ width: `${Math.min(100, Math.max(0, t.mastery_value))}%` }}
                      />
                    )}
                    <div className="absolute top-0 h-full w-px bg-gray-500/50" style={{ left: "50%" }} />
                    <div className="absolute top-0 h-full w-px bg-gray-500/50" style={{ left: "75%" }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Score history chart */}
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="font-semibold">Recent quiz scores</h2>
            {history.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">
                You have not taken a quiz yet.{" "}
                <Link href="/dashboard/quiz" className="text-indigo-600 underline">
                  Take your first quiz
                </Link>
                .
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-gray-500">Your last {history.length} quizzes, oldest to newest.</p>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={history} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="n" tick={{ fontSize: 12 }} label={{ value: "Quiz #", position: "insideBottom", offset: -2, fontSize: 12 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" width={45} />
                      <Tooltip content={<ChartTooltip />} />
                      <ReferenceLine
                        y={50}
                        stroke="#ef4444"
                        strokeDasharray="4 4"
                        label={{ value: "Review line (50%)", position: "insideBottomRight", fontSize: 11, fill: "#ef4444" }}
                      />
                      <Line type="monotone" dataKey="score" stroke="#4f46e5" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </section>

          {/* Learning path */}
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="font-semibold">Your learning path</h2>
            {path.new_topics_locked && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                New topics are paused until you clear your review topics.
              </p>
            )}
            <ol className="mt-3 divide-y divide-gray-100">
              {items.map((t, i) => (
                <li key={t.topic} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {i + 1}. {t.topic}
                    </p>
                    <p className="text-gray-500">{t.action}</p>
                  </div>
                  {t.status === "locked" ? (
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">Locked</span>
                  ) : (
                    <Link
                      href="/dashboard/quiz"
                      className="rounded-md border border-indigo-200 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                    >
                      {t.status === "needs_review" ? "Review and retake" : "Take quiz"}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </section>

          {/* Recent assessments table */}
          {recent.length > 0 && (
            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="font-semibold">Recent assessments</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="py-2 pr-4">Topic</th>
                      <th className="py-2 pr-4">Score</th>
                      <th className="py-2">Taken</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {recent.map((a, i) => (
                      <tr key={i}>
                        <td className="py-2 pr-4">{a.topic}</td>
                        <td className={`py-2 pr-4 font-medium ${a.score >= 50 ? "text-green-700" : "text-red-700"}`}>
                          {a.score}%
                        </td>
                        <td className="py-2 text-gray-500">{formatWhen(a.taken_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}