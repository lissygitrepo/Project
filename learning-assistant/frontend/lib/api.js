export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TOKEN_KEY = "la_token";

export const getToken = () =>
  typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => window.localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => window.localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// FastAPI returns `detail` as a string (our errors) or a list (validation errors)
function formatDetail(detail) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => `${(d.loc || []).slice(1).join(".") || "input"}: ${d.msg}`)
      .join("; ");
  }
  return "Something went wrong.";
}

/**
 * apiFetch("/topics")
 * apiFetch("/quiz/generate", { method: "POST", json: {...} })
 * apiFetch("/auth/login", { method: "POST", form: {...}, auth: false })
 * apiFetch("/ingest", { method: "POST", body: formData })   // file uploads
 */
export async function apiFetch(path, { method = "GET", json, form, body, auth = true } = {}) {
  const headers = {};
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let payload = body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(json);
  } else if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(form).toString();
  }
  // For FormData bodies the browser sets the multipart header itself

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(`Cannot reach the server at ${API_URL}. Is the backend running?`, 0);
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && auth && token) {
      // Token expired or invalid: clear it and tell the app to send the user to login
      clearToken();
      if (typeof window !== "undefined") window.dispatchEvent(new Event("la:unauthorized"));
    }
    throw new ApiError(formatDetail(data && data.detail), res.status);
  }
  return data;
}

export const loginRequest = (email, password) =>
  apiFetch("/auth/login", { method: "POST", form: { username: email, password }, auth: false });

export const registerRequest = (payload) =>
  apiFetch("/auth/register", { method: "POST", json: payload, auth: false });