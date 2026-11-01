"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";

export default function LoginPage() {
  const { user, loading, login, register } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isInstructor, setIsInstructor] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Already logged in? Go straight to the dashboard
  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (mode === "register" && isInstructor && !code.trim()) {
      setError("Enter the instructor code, or untick the instructor option.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register({
          name: name.trim(),
          email: email.trim(),
          password,
          instructor_code: isInstructor ? code.trim() : undefined,
        });
      }
      router.replace("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const tab = (value, label) => (
    <button
      type="button"
      onClick={() => {
        setMode(value);
        setError("");
      }}
      className={`flex-1 rounded-md py-2 text-sm font-medium ${
        mode === value ? "bg-white text-gray-900 shadow" : "text-gray-500 hover:text-gray-700"
      }`}
    >
      {label}
    </button>
  );

  const inputClass =
    "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 text-gray-900">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">AI Learning Assistant</h1>
        <p className="mt-1 text-sm text-gray-500">Personalized learning from your own course material</p>

        <div className="mt-6 flex gap-1 rounded-lg bg-gray-100 p-1">
          {tab("login", "Log in")}
          {tab("register", "Register")}
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {mode === "register" && (
            <label className="block text-sm font-medium">
              Name
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
          )}

          <label className="block text-sm font-medium">
            Email
            <input
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="block text-sm font-medium">
            Password
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={mode === "register" ? 8 : undefined}
              required
            />
            {mode === "register" && <span className="mt-1 block text-xs text-gray-500">At least 8 characters</span>}
          </label>

          {mode === "register" && (
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isInstructor} onChange={(e) => setIsInstructor(e.target.checked)} />
                I am an instructor
              </label>
              {isInstructor && (
                <input
                  type="password"
                  placeholder="Instructor code"
                  className={inputClass}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </div>
          )}

          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? "Please wait..." : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}