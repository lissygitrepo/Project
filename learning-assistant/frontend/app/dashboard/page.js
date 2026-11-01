"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../lib/auth";

const STATUS_STYLE = {
  needs_review: "bg-red-50 text-red-700",
  in_progress: "bg-amber-50 text-amber-700",
  not_started: "bg-blue-50 text-blue-700",
  locked: "bg-gray-100 text-gray-600",
  mastered: "bg-green-50 text-green-700",
};

const PROFILE_STYLE = {
  fast_paced_advanced: "bg-green-50 text-green-700",
  steady_learner: "bg-blue-50 text-blue-700",
  needs_fundamentals_support: "bg-amber-50 text-amber-800",
  insufficient_data: "bg-gray-100 text-gray-600",
};

const trendWord = (t) => (t > 0.5 ? "improving" : t < -0.5 ? "declining" : "steady");

function ProfileCard({ profile }) {
  const b = profile.based_on;
  const notEnough = profile.key === "insufficient_data";
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Your learning profile</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${PROFILE_STYLE[profile.key]}`}>
          {profile.label}
        </span>
      </div>

      <p className="mt-2 text-sm text-gray-700">{profile.tip}</p>

      {notEnough ? (
        <p className="mt-3 text-sm text-gray-500">
          {profile.quizzes_needed} more quiz{profile.quizzes_needed === 1 ? "" : "zes"} needed.{" "}
          <Link href="/dashboard/quiz" className="text-indigo-600 underline">
            Take a quiz
          </Link>
        </p>
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
          <div>
            <dt className="text-xs text-gray-500">Average score</dt>
            <dd className="font-semibold">{b.avg_score}%</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Trend</dt>
            <dd className="font-semibold capitalize">{trendWord(b.trend)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Quizzes taken</dt>
            <dd className="font-semibold">{b.quiz_count}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Questions asked</dt>
            <dd className="font-semibold">{b.questions_asked}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Times in review</dt>
            <dd className="font-semibold">{b.remediation_count}</dd>
          </div>
        </dl>
      )}

      <p className="mt-3 text-xs text-gray-400">
        A guide based on your recent activity. It updates after every quiz and is not a grade.
      </p>
    </section>
  );
}

function QuickLink({ href, title, text }) {
  return (
    <Link href={href} className="rounded-xl border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:bg-indigo-50/40">
      <p className="font-medium">{title}</p>
      <p className="text-sm text-gray-500">{text}</p>
    </Link>
  );
}

export default function DashboardHome() {
  const { user } = useAuth();
  const isStudent = user.role === "student";

  const [topics, setTopics] = useState([]);
  const [path, setPath] = useState(null);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const calls = [apiFetch("/topics")];
      if (isStudent) calls.push(apiFetch("/path"), apiFetch("/profile"));
      // allSettled: one failing call must not blank the whole page
      const [t, p, pr] = await Promise.allSettled(calls);
      if (cancelled) return;
      if (t.status === "fulfilled") setTopics(t.value.topics);
      else setError(t.reason.message);
      if (p && p.status === "fulfilled") setPath(p.value);
      if (pr && pr.status === "fulfilled") setProfile(pr.value);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [isStudent]);

  const next = path && path.next_recommended;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
        <p className="text-gray-500">
          {isStudent
            ? "Ask questions, take quizzes and track your progress."
            : "Upload course material and see how your students are doing."}
        </p>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {isStudent ? (
        <div className="grid gap-3 md:grid-cols-3">
          <QuickLink href="/dashboard/ask" title="Ask a question" text="Answers from your course material" />
          <QuickLink href="/dashboard/quiz" title="Take a quiz" text="Test what you know" />
          <QuickLink href="/dashboard/progress" title="My progress" text="Mastery and learning path" />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <QuickLink href="/dashboard/upload" title="Upload material" text="Add slides and documents by topic" />
          <QuickLink href="/dashboard/analytics" title="Class analytics" text="Mastery, activity and who needs help" />
        </div>
      )}

      {isStudent && profile && <ProfileCard profile={profile} />}

      {isStudent && path && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="font-semibold">Your next step</h2>
          {next ? (
            <div className="mt-2">
              <p className="text-lg">{next.topic}</p>
              <p className="text-sm text-gray-500">{next.action}</p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-500">
              Nothing to do yet. Your instructor needs to upload material first.
            </p>
          )}
          {path.new_topics_locked && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              New topics are paused until you clear your review topics.
            </p>
          )}

          {path.path.length > 0 && (
            <ul className="mt-4 divide-y divide-gray-100">
              {path.path.map((item) => (
                <li key={item.topic} className="flex items-center justify-between py-2 text-sm">
                  <span>{item.topic}</span>
                  <span className="flex items-center gap-3">
                    {item.mastery_value !== null && <span className="text-gray-500">{item.mastery_value}%</span>}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[item.status]}`}>
                      {item.status.replace("_", " ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold">Topics with uploaded material</h2>
        {!loaded ? (
          <p className="mt-2 text-sm text-gray-500">Loading...</p>
        ) : topics.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No material uploaded yet.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {topics.map((t) => (
              <span key={t} className="rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-700">
                {t}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
