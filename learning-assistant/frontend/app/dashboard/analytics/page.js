"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

const PROFILE_STYLE = {
  fast_paced_advanced: "bg-green-50 text-green-700",
  steady_learner: "bg-blue-50 text-blue-700",
  needs_fundamentals_support: "bg-amber-50 text-amber-800",
  insufficient_data: "bg-gray-100 text-gray-600",
};
const PROFILE_BAR = {
  fast_paced_advanced: "bg-green-500",
  steady_learner: "bg-blue-500",
  needs_fundamentals_support: "bg-amber-500",
  insufficient_data: "bg-gray-300",
};

const masteryColor = (v) => (v >= 75 ? "#22c55e" : v >= 50 ? "#f59e0b" : "#ef4444");
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function ago(days) {
  if (days === null || days === undefined) return "never";
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function shortDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function formatWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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

function Card({ title, note, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold">{title}</h2>
      {note && <p className="mb-3 text-xs text-gray-500">{note}</p>}
      {children}
    </section>
  );
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  const isInstructor = user?.role === "instructor";

  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [onlyAttention, setOnlyAttention] = useState(false);

  useEffect(() => {
    if (!isInstructor) return;
    let cancelled = false;
    setLoading(true);
    apiFetch(`/analytics/overview?days=${days}`)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isInstructor, days]);

  if (!isInstructor) {
    return (
      <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Analytics is for instructor accounts. Log in as an instructor to see your cohort.
      </p>
    );
  }

  if (!data) {
    return error ? (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
    ) : (
      <p className="text-sm text-gray-500">Loading analytics...</p>
    );
  }

  const s = data.summary;
  const chartTopics = data.topics.filter((t) => t.avg_mastery !== null).map((t) => ({ name: t.topic, mastery: t.avg_mastery }));
  const profileTotal = data.profiles.reduce((sum, p) => sum + p.count, 0);
  const shown = onlyAttention ? data.students.filter((r) => r.needs_attention) : data.students;
  const askedTotal = data.questions.answered + data.questions.out_of_domain;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Class analytics</h1>
          <p className="text-sm text-gray-500">How your students are doing, and what they need next.</p>
        </div>
        <label className="text-sm text-gray-600">
          Activity window{" "}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="ml-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-xs text-gray-400">Refreshing...</p>}

      {s.students === 0 ? (
        <p className="rounded-md bg-gray-100 px-4 py-3 text-sm text-gray-600">
          No student accounts yet. Once students register and take quizzes, their results appear here.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Students" value={s.students} />
            <Stat label="Active" value={s.active_students} hint={`last ${data.window_days} days`} />
            <Stat label="Quizzes taken" value={s.quizzes_taken} hint={`last ${data.window_days} days`} />
            <Stat label="Questions asked" value={s.questions_asked} hint={`last ${data.window_days} days`} />
            <Stat label="Average mastery" value={s.avg_mastery === null ? "n/a" : `${s.avg_mastery}%`} hint="across attempted topics" />
            <Stat label="In review" value={s.students_in_remediation} hint="open remediation" />
            <Stat label="Inactive" value={s.inactive_students} hint="7+ days quiet" />
            <Stat
              label="Not covered"
              value={s.out_of_domain_rate === null ? "n/a" : `${s.out_of_domain_rate}%`}
              hint="questions outside the material"
            />
          </div>

          <Card
            title="Mastery by topic"
            note="Average mastery across students who have attempted each topic. Topics below 50% may need re-teaching."
          >
            {chartTopics.length === 0 ? (
              <p className="text-sm text-gray-500">No quiz results yet.</p>
            ) : (
              <div style={{ height: Math.max(180, chartTopics.length * 46) }} className="w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartTopics} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} tickFormatter={(v) => truncate(v, 22)} />
                    <Tooltip formatter={(v) => [`${v}%`, "Average mastery"]} />
                    <Bar dataKey="mastery" radius={[0, 4, 4, 0]}>
                      {chartTopics.map((t, i) => (
                        <Cell key={i} fill={masteryColor(t.mastery)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="py-2 pr-4">Topic</th>
                    <th className="py-2 pr-4">Files</th>
                    <th className="py-2 pr-4">Students</th>
                    <th className="py-2 pr-4">Attempts</th>
                    <th className="py-2 pr-4">Avg mastery</th>
                    <th className="py-2">In review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.topics.map((t) => (
                    <tr key={t.topic}>
                      <td className="py-2 pr-4 font-medium">{t.topic}</td>
                      <td className="py-2 pr-4">{t.files}</td>
                      <td className="py-2 pr-4">{t.students_attempted}</td>
                      <td className="py-2 pr-4">{t.attempts}</td>
                      <td className="py-2 pr-4">{t.avg_mastery === null ? "No quiz data" : `${t.avg_mastery}%`}</td>
                      <td className={`py-2 ${t.in_remediation > 0 ? "font-medium text-red-700" : ""}`}>{t.in_remediation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Activity" note={`Quizzes and questions per day over the last ${data.window_days} days.`}>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.activity} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} minTickGap={28} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={35} />
                  <Tooltip labelFormatter={shortDate} />
                  <Legend />
                  <Line type="monotone" dataKey="quizzes" name="Quizzes" stroke="#4f46e5" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="questions" name="Questions" stroke="#16a34a" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card title="Learner profiles" note="Groups students by their quiz and activity patterns. A guide for support, not a grade.">
              <ul className="space-y-3">
                {data.profiles.map((p) => (
                  <li key={p.key}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{p.label}</span>
                      <span className="text-gray-500">{p.count}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded bg-gray-100">
                      <div
                        className={`h-full rounded ${PROFILE_BAR[p.key]}`}
                        style={{ width: `${profileTotal ? (p.count / profileTotal) * 100 : 0}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            <Card
              title="Questions students asked"
              note={`Last ${data.window_days} days. Questions outside the material show gaps you may want to cover.`}
            >
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-lg bg-green-50 p-2">
                  <p className="text-lg font-semibold text-green-700">{data.questions.answered}</p>
                  <p className="text-xs text-green-700">Answered</p>
                </div>
                <div className="rounded-lg bg-blue-50 p-2">
                  <p className="text-lg font-semibold text-blue-700">{data.questions.out_of_domain}</p>
                  <p className="text-xs text-blue-700">Not covered</p>
                </div>
                <div className="rounded-lg bg-amber-50 p-2">
                  <p className="text-lg font-semibold text-amber-700">{data.questions.blocked}</p>
                  <p className="text-xs text-amber-700">Blocked</p>
                </div>
              </div>

              <h3 className="mt-4 text-sm font-medium">Recent questions the material did not cover</h3>
              {data.questions.recent_out_of_domain.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">
                  {askedTotal === 0 ? "No questions asked yet." : "None. The material covered everything asked."}
                </p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {data.questions.recent_out_of_domain.map((q, i) => (
                    <li key={i} className="rounded-md bg-gray-50 px-3 py-2">
                      <p className="break-words">{q.text}</p>
                      <p className="text-xs text-gray-400">{formatWhen(q.asked_at)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Students" note="Students who are in review or have been quiet for 7+ days are listed first.">
            <label className="mb-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} />
              Show only students who need attention
            </label>
            {shown.length === 0 ? (
              <p className="text-sm text-gray-500">No students need attention right now.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="py-2 pr-4">Student</th>
                      <th className="py-2 pr-4">Profile</th>
                      <th className="py-2 pr-4">Quizzes</th>
                      <th className="py-2 pr-4">Avg score</th>
                      <th className="py-2 pr-4">Mastery</th>
                      <th className="py-2 pr-4">In review</th>
                      <th className="py-2">Last active</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {shown.map((r) => (
                      <tr key={r.id} className={r.needs_attention ? "bg-red-50/40" : ""}>
                        <td className="py-2 pr-4">
                          <p className="font-medium">{r.name}</p>
                          <p className="text-xs text-gray-400">{r.email}</p>
                        </td>
                        <td className="py-2 pr-4">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PROFILE_STYLE[r.profile_key]}`}>
                            {r.profile_label}
                          </span>
                        </td>
                        <td className="py-2 pr-4">{r.quizzes}</td>
                        <td className="py-2 pr-4">{r.avg_score === null ? "-" : `${r.avg_score}%`}</td>
                        <td className="py-2 pr-4">{r.avg_mastery === null ? "-" : `${r.avg_mastery}%`}</td>
                        <td className="py-2 pr-4">
                          {r.review_topics.length === 0 ? (
                            "-"
                          ) : (
                            <span className="text-red-700">{r.review_topics.join(", ")}</span>
                          )}
                        </td>
                        <td className="py-2">
                          <span className={r.inactive ? "font-medium text-amber-700" : "text-gray-500"}>
                            {ago(r.days_inactive)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}