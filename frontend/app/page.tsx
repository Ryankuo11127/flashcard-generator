"use client";

import React, { useMemo, useRef, useState } from "react";

const API_BASE = "http://localhost:8000";

type Flashcard = { type?: string; front: string; back: string; tags?: string[] };
type Deck = { deck_name: string; cards: Flashcard[] };
type Job = { job_id: string; filename: string; chars_extracted: number };

function escapeCsv(value: unknown) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toAnkiCsv(deck: Deck) {
  const rows: string[][] = [["Front", "Back", "Tags"]];
  for (const card of deck?.cards ?? []) {
    const tags = Array.isArray(card.tags) ? card.tags.join(" ") : "";
    rows.push([card.front ?? "", card.back ?? "", tags]);
  }
  return rows.map((r) => r.map(escapeCsv).join(",")).join("\n");
}

function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function FlipCard({ card, index }: { card: Flashcard; index: number }) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div style={styles.flipOuter} onClick={() => setFlipped((v) => !v)}>
      <div
        style={{
          ...styles.flipInner,
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* FRONT */}
        <div style={styles.flipFaceFront}>
          <div style={styles.flashTop}>
            <div style={styles.badge}>#{index + 1}</div>
            <div style={styles.type}>{card.type || "basic"}</div>
          </div>

          <div>
            <div style={styles.faceLabel}>Front</div>
            <div style={styles.faceText}>{card.front}</div>
          </div>

          <div style={styles.hint}>Click to flip</div>
        </div>

        {/* BACK */}
        <div style={styles.flipFaceBack}>
          <div style={styles.flashTop}>
            <div style={styles.badge}>#{index + 1}</div>
            <div style={styles.type}>Back</div>
          </div>

          <div>
            <div style={styles.faceLabel}>Back</div>
            <div style={styles.faceText}>{card.back}</div>

            <div style={styles.tagsRow}>
              {(card.tags || []).slice(0, 6).map((t, i) => (
                <span key={i} style={styles.tag}>
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div style={styles.hint}>Click to flip</div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [n, setN] = useState<number>(20);

  const [busyUpload, setBusyUpload] = useState(false);
  const [busyGenerate, setBusyGenerate] = useState(false);
  const [error, setError] = useState("");

  const ankiCsv = useMemo(() => (deck ? toAnkiCsv(deck) : ""), [deck]);

  const chooseFile = () => inputRef.current?.click();

  async function uploadFile() {
    setError("");
    setDeck(null);
    setJob(null);

    if (!file) {
      setError("Pick a file first.");
      return;
    }

    const form = new FormData();
    form.append("file", file);

    setBusyUpload(true);
    try {
      const res = await fetch(`${API_BASE}/api/jobs`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
      const data = (await res.json()) as Job;
      setJob(data);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusyUpload(false);
    }
  }

  async function generateFlashcards() {
    setError("");

    if (!job?.job_id) {
      setError("Upload a file first.");
      return;
    }

    if (!Number.isFinite(n) || n < 1 || n > 60) {
      setError("n must be between 1 and 60.");
      return;
    }

    setBusyGenerate(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/jobs/${job.job_id}/flashcards?n=${encodeURIComponent(n)}`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error(`Generation failed (${res.status}): ${await res.text()}`);
      const data = await res.json();
      setDeck(data.flashcards as Deck);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusyGenerate(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.title}>Flashcard Generator</h1>

        <div style={styles.card}>
          <h2 style={styles.h2}>1) Select + Upload</h2>

          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            style={{ display: "none" }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />

          <div style={styles.row}>
            <button type="button" style={styles.button} onClick={chooseFile}>
              Choose File
            </button>

            <div style={styles.fileName}>{file ? file.name : "No file selected"}</div>

            <button
              type="button"
              style={{ ...styles.button, opacity: busyUpload ? 0.6 : 1 }}
              onClick={uploadFile}
              disabled={busyUpload}
            >
              {busyUpload ? "Uploading..." : "Upload"}
            </button>
          </div>

          {job && (
            <div style={styles.infoBox}>
              <div>
                <b>Job ID:</b> {job.job_id}
              </div>
              <div>
                <b>Extracted:</b> {job.chars_extracted} chars
              </div>
            </div>
          )}
        </div>

        <div style={styles.card}>
          <h2 style={styles.h2}>2) Generate</h2>

          <div style={styles.row}>
            <label style={styles.label}>
              Cards (1–60)
              <input
                style={styles.input}
                type="number"
                min={1}
                max={60}
                value={n}
                onChange={(e) => setN(Number(e.target.value))}
              />
            </label>

            <button
              type="button"
              style={{ ...styles.button, opacity: busyGenerate ? 0.6 : 1 }}
              onClick={generateFlashcards}
              disabled={busyGenerate || !job?.job_id}
            >
              {busyGenerate ? "Generating..." : "Generate Flashcards"}
            </button>
          </div>

          {error && <div style={styles.error}>{error}</div>}
        </div>

        {deck && (
          <div style={styles.card}>
            <div style={styles.deckHeader}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>
                  3) Results — {deck.deck_name} ({deck.cards.length} cards)
                </h2>
              </div>

              <div style={styles.actions}>
                <button
                  type="button"
                  style={styles.smallButton}
                  onClick={() =>
                    downloadText(
                      `${(deck.deck_name || "deck").replace(/[^\w\-]+/g, "_")}.json`,
                      JSON.stringify(deck, null, 2),
                      "application/json"
                    )
                  }
                >
                  Download JSON
                </button>

                <button
                  type="button"
                  style={styles.smallButton}
                  onClick={() =>
                    downloadText(
                      `${(deck.deck_name || "deck").replace(/[^\w\-]+/g, "_")}_anki.csv`,
                      ankiCsv,
                      "text/csv"
                    )
                  }
                >
                  Download Anki CSV
                </button>
              </div>
            </div>

            <div style={styles.grid}>
              {deck.cards.map((c, idx) => (
                <FlipCard key={idx} card={c} index={idx} />
              ))}
            </div>
          </div>
        )}

        <div style={styles.footer}>
          Backend: <code>{API_BASE}</code>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#0b0f19", color: "#e8eefc", padding: 24 },
  container: { maxWidth: 980, margin: "0 auto" },
  title: { margin: "0 0 16px 0", fontSize: 32 },

  card: {
    background: "#10182a",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  h2: { margin: "0 0 12px 0", fontSize: 18 },
  row: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" },

  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13 },
  input: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "#0c1220",
    color: "#e8eefc",
    width: 120,
  },

  button: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "#1a2b55",
    color: "#e8eefc",
    cursor: "pointer",
    fontWeight: 600,
  },

  smallButton: {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "#132247",
    color: "#e8eefc",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
  },

  fileName: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "#0c1220",
    border: "1px solid rgba(255,255,255,0.10)",
    minWidth: 240,
    opacity: 0.95,
  },

  infoBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    background: "#0c1220",
    border: "1px solid rgba(255,255,255,0.08)",
  },

  error: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    background: "rgba(255,80,80,0.12)",
    border: "1px solid rgba(255,80,80,0.35)",
    color: "#ffd5d5",
    whiteSpace: "pre-wrap",
  },

  deckHeader: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    marginBottom: 12,
  },
  actions: { display: "flex", gap: 10, flexWrap: "wrap" },

  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 },

  flashTop: { display: "flex", justifyContent: "space-between", gap: 10 },
  badge: {
    fontSize: 12,
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    opacity: 0.9,
  },
  type: { fontSize: 12, opacity: 0.8, alignSelf: "center" },

  faceLabel: { marginTop: 10, fontSize: 12, opacity: 0.7 },
  faceText: { marginTop: 6, fontSize: 15, lineHeight: 1.35 },

  tagsRow: { marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 },
  tag: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    opacity: 0.95,
  },

  hint: { marginTop: 10, fontSize: 11, opacity: 0.55 },

  footer: { marginTop: 10, opacity: 0.7, fontSize: 12 },

  flipOuter: { perspective: "1000px", cursor: "pointer" },
  flipInner: {
    position: "relative",
    width: "100%",
    minHeight: 190,
    transformStyle: "preserve-3d",
    transition: "transform 0.45s ease",
  },
  flipFaceFront: {
    position: "absolute",
    inset: 0,
    background: "#0c1220",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 16,
    padding: 14,
    backfaceVisibility: "hidden",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  },
  flipFaceBack: {
    position: "absolute",
    inset: 0,
    background: "#0c1220",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 16,
    padding: 14,
    backfaceVisibility: "hidden",
    transform: "rotateY(180deg)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  },
};
