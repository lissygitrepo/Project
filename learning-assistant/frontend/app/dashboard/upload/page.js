"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

const ALLOWED = [".pdf", ".pptx", ".txt", ".md"];
const MAX_MB = 25;

const extOf = (name) => {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
};
const normTopic = (t) => t.split(/\s+/).filter(Boolean).join(" ");

function formatWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

export default function UploadPage() {
  const { user } = useAuth();
  const isInstructor = user?.role === "instructor";

  const [file, setFile] = useState(null);
  const [inputKey, setInputKey] = useState(0); // changing this clears the file input
  const [topic, setTopic] = useState("");
  const [imageMode, setImageMode] = useState("default"); // default | on | off

  const [docs, setDocs] = useState([]);
  const [topics, setTopics] = useState([]);
  const [listError, setListError] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const loadLists = useCallback(async () => {
    try {
      const [d, t] = await Promise.all([apiFetch("/documents"), apiFetch("/topics")]);
      setDocs(d.documents);
      setTopics(t.topics);
      setListError("");
    } catch (e) {
      setListError(e.message);
    }
  }, []);

  useEffect(() => {
    if (isInstructor) loadLists();
  }, [isInstructor, loadLists]);

  const cleanTopic = normTopic(topic);
  const isPptx = file ? extOf(file.name) === ".pptx" : false;
  const nearMatch = topics.find((x) => x.toLowerCase() === cleanTopic.toLowerCase() && x !== cleanTopic);

  async function upload(e) {
    e.preventDefault();
    setError("");
    setResult(null);

    if (!file) return setError("Choose a file first.");
    if (!ALLOWED.includes(extOf(file.name))) {
      return setError(`Unsupported file type. Supported: ${ALLOWED.join(", ")}`);
    }
    if (file.size > MAX_MB * 1024 * 1024) return setError(`File is larger than ${MAX_MB} MB.`);
    if (cleanTopic.length < 2) return setError("Enter a topic (at least 2 characters).");
    if (cleanTopic.length > 200) return setError("Topic is too long (max 200 characters).");

    if (
      docs.some((d) => d.filename === file.name) &&
      !window.confirm(
        `"${file.name}" was already uploaded. Uploading it again adds a second copy of its content to the search index. Continue?`
      )
    ) {
      return;
    }

    const form = new FormData();
    form.append("file", file);
    form.append("topic", cleanTopic);
    // process_images is a query parameter on the backend; only send it when overriding the default
    const qs = isPptx && imageMode !== "default" ? `?process_images=${imageMode === "on"}` : "";

    setBusy(true);
    try {
      const r = await apiFetch(`/ingest${qs}`, { method: "POST", body: form });
      if (r.status !== "success") {
        setError(r.message || "The file could not be processed.");
      } else {
        setResult(r);
        setFile(null);
        setInputKey((k) => k + 1);
        loadLists();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!isInstructor) {
    return (
      <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
        The upload page is for instructor accounts. Log in as an instructor to add course material.
      </p>
    );
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Course material</h1>
        <p className="text-sm text-gray-500">
          Upload slides and documents. Students can only ask about and be quizzed on what you add here.
        </p>
      </div>

      <form onSubmit={upload} className="space-y-5 rounded-xl border border-gray-200 bg-white p-5">
        <label className="block text-sm font-medium">
          File ({ALLOWED.join(", ")}; up to {MAX_MB} MB)
          <input
            key={inputKey}
            type="file"
            accept={ALLOWED.join(",")}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
          />
        </label>

        <div>
          <label className="block text-sm font-medium">
            Topic
            <input
              list="topic-suggestions"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={200}
              placeholder="e.g. Normalization"
              className={inputClass}
            />
          </label>
          <datalist id="topic-suggestions">
            {topics.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <p className="mt-1 text-xs text-gray-500">
            Quizzes, mastery, and filters use this exact label, so reuse an existing topic when the material belongs
            to it.
          </p>
          {nearMatch && (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              A topic named &ldquo;{nearMatch}&rdquo; already exists, and topic names are case-sensitive.{" "}
              <button type="button" onClick={() => setTopic(nearMatch)} className="font-medium underline">
                Use &ldquo;{nearMatch}&rdquo;
              </button>
            </p>
          )}
        </div>

        {isPptx && (
          <label className="block text-sm font-medium">
            Image processing (PowerPoint only)
            <select value={imageMode} onChange={(e) => setImageMode(e.target.value)} className={inputClass}>
              <option value="default">Use the server default</option>
              <option value="on">On: describe images so they become searchable</option>
              <option value="off">Off: text and tables only (faster)</option>
            </select>
            <span className="mt-1 block text-xs font-normal text-gray-500">
              Turning it on sends slide images to a vision model. It is slower and uses API quota.
            </span>
          </label>
        )}

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? "Processing... this can take a minute for large decks" : "Upload and index"}
        </button>
      </form>

      {result && (
        <section className="space-y-3 rounded-xl border border-green-200 bg-green-50 p-5">
          <p className="font-medium text-green-900">
            Added &ldquo;{result.source}&rdquo; to the topic &ldquo;{result.topic}&rdquo;
          </p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Chunks created" value={result.chunks_created} />
            <Stat label="Characters read" value={result.characters_extracted?.toLocaleString()} />
            {result.slides !== undefined && <Stat label="Slides" value={result.slides} />}
            {result.pages !== undefined && <Stat label="Pages" value={result.pages} />}
            {result.tables_extracted !== undefined && <Stat label="Tables found" value={result.tables_extracted} />}
            {result.images_described !== undefined && <Stat label="Images described" value={result.images_described} />}
            {result.images_skipped !== undefined && <Stat label="Images skipped" value={result.images_skipped} />}
          </div>
          {result.image_processing && (
            <p className="text-sm text-green-900">Image processing was {result.image_processing} for this file.</p>
          )}
          {result.images_skipped > 0 && result.image_processing === "off" && (
            <p className="text-xs text-green-800">
              Skipped images are not searchable. Re-upload with image processing on if they carry important content.
            </p>
          )}
        </section>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold">Uploaded material</h2>
        {listError && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{listError}</p>}
        {docs.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Nothing uploaded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-2 pr-4">File</th>
                  <th className="py-2 pr-4">Topic</th>
                  <th className="py-2 pr-4">Chunks</th>
                  <th className="py-2">Uploaded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2 pr-4 font-medium">{d.filename}</td>
                    <td className="py-2 pr-4">
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">{d.topic}</span>
                    </td>
                    <td className="py-2 pr-4">{d.chunks}</td>
                    <td className="py-2 text-gray-500">{formatWhen(d.uploaded_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}