"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import Markdown from "../../../components/Markdown";

const MAX_LEN = 1000; // matches the backend guardrail limit
const MIN_LEN = 3;

// Group sources by file: [{ file, chunks: [1, 3] }]
function groupSources(sources = []) {
  const map = new Map();
  for (const s of sources) {
    if (!map.has(s.source)) map.set(s.source, []);
    if (s.chunk_index !== null && s.chunk_index !== undefined) map.get(s.source).push(s.chunk_index);
  }
  return [...map.entries()].map(([file, chunks]) => ({ file, chunks: chunks.sort((a, b) => a - b) }));
}

function Bubble({ msg }) {
  if (msg.role === "user") {
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm text-white">
          {msg.text}
        </div>
        <span className="mt-1 text-xs text-gray-400">{msg.topic ? `Topic: ${msg.topic}` : "All topics"}</span>
      </div>
    );
  }

  const tone = {
    answer: "border-gray-200 bg-white text-gray-900",
    blocked: "border-amber-200 bg-amber-50 text-amber-900",
    out_of_domain: "border-blue-200 bg-blue-50 text-blue-900",
    error: "border-red-200 bg-red-50 text-red-800",
  }[msg.kind];

  const grouped = groupSources(msg.sources);

  return (
    <div className="flex flex-col items-start">
      <div className={`max-w-[90%] rounded-2xl rounded-bl-sm border px-4 py-3 ${tone}`}>
        {msg.kind === "blocked" && <p className="mb-1 text-xs font-semibold uppercase tracking-wide">Blocked</p>}
        {msg.kind === "out_of_domain" && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide">Outside the course material</p>
        )}
        {msg.kind === "answer" ? <Markdown>{msg.text}</Markdown> : <p className="text-sm">{msg.text}</p>}
        {msg.kind === "out_of_domain" && msg.topic && (
          <p className="mt-2 text-xs">
            You searched only in &ldquo;{msg.topic}&rdquo;. Try &ldquo;All topics&rdquo; or rephrase the question.
          </p>
        )}
      </div>

      {grouped.length > 0 && (
        <div className="mt-2 flex max-w-[90%] flex-wrap items-center gap-2 text-xs text-gray-500">
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
  );
}

export default function AskPage() {
  const { user } = useAuth();
  const isStudent = user?.role === "student";

  const [topics, setTopics] = useState([]);
  const [topic, setTopic] = useState(""); // "" means all topics
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const idRef = useRef(0);
  const scrollRef = useRef(null);
  const nextId = () => ++idRef.current;

  // Load the topic list for the dropdown
  useEffect(() => {
    if (!isStudent) return;
    let cancelled = false;
    apiFetch("/topics")
      .then((d) => !cancelled && setTopics(d.topics))
      .catch(() => {}); // the dropdown simply stays at "All topics"
    return () => {
      cancelled = true;
    };
  }, [isStudent]);

  // Keep the chat scrolled to the newest message
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function send() {
    if (busy) return;
    const question = input.trim();
    if (question.length < MIN_LEN) {
      setFormError(`Please type at least ${MIN_LEN} characters.`);
      return;
    }

    const askedTopic = topic; // capture now, in case the dropdown changes while waiting
    setFormError("");
    setInput("");
    setMessages((m) => [...m, { id: nextId(), role: "user", text: question, topic: askedTopic }]);
    setBusy(true);

    try {
      const data = await apiFetch("/query", {
        method: "POST",
        json: { query: question, topic: askedTopic || null },
      });

      let reply;
      if (data.status === "success") {
        reply = { kind: "answer", text: data.answer, sources: data.sources };
      } else if (data.status === "blocked") {
        reply = { kind: "blocked", text: data.message };
      } else if (data.status === "out_of_domain") {
        reply = { kind: "out_of_domain", text: data.message };
      } else {
        reply = { kind: "error", text: "Unexpected response from the server." };
      }
      setMessages((m) => [...m, { id: nextId(), role: "assistant", topic: askedTopic, ...reply }]);
    } catch (e) {
      setMessages((m) => [...m, { id: nextId(), role: "assistant", kind: "error", text: e.message }]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    // Enter sends, Shift+Enter adds a new line
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  if (!isStudent) {
    return (
      <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
        The Ask page is for student accounts. Log in as a student to try it.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Ask a question</h1>
          <p className="text-sm text-gray-500">Answers come only from your course material.</p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">
            Search in{" "}
            <select
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="ml-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
            >
              <option value="">All topics</option>
              {topics.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => setMessages([])}
            disabled={messages.length === 0 || busy}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50"
          >
            Clear chat
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="h-[55vh] space-y-4 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-4"
      >
        {messages.length === 0 && !busy && (
          <div className="flex h-full items-center justify-center text-center text-sm text-gray-400">
            <p>
              Ask something from your course material, for example &ldquo;What is the difference between 2NF and
              3NF?&rdquo;.
              <br />
              Pick a topic above to narrow the search.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <Bubble key={m.id} msg={m} />
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
              Searching your material and writing an answer...
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={MAX_LEN}
            rows={2}
            placeholder="Type your question (Enter to send, Shift+Enter for a new line)"
            className="flex-1 resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={send}
            disabled={busy || input.trim().length === 0}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
        <div className="mt-1 flex justify-between text-xs">
          <span className="text-red-600">{formError}</span>
          <span className="text-gray-400">
            {input.length}/{MAX_LEN}
          </span>
        </div>
      </div>
    </div>
  );
}