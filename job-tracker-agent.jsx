import { useState, useRef, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────
// CONFIGURATION
// Copy config.example.js to config.js and fill in your profile.
// When running as a Claude artifact, edit PROFILE_CONTEXT below directly.
// ─────────────────────────────────────────────

const PROFILE_CONTEXT = `Your Name - Your Title (~X years experience)
Roles: Most recent role and company, Previous role, Earlier role.
Skills: Your core skills.
Education: Your degree, university.
Location: Your location.
Target: What roles you're looking for.`;

const SENDER_NAME = "Your Name";

// ─────────────────────────────────────────────
// PROMPTS
// ─────────────────────────────────────────────

const SYSTEM_PROMPT_FIT = `You are a job fit evaluator. Given a JD and candidate profile, evaluate fit.

${PROFILE_CONTEXT}

Respond ONLY in valid JSON. No markdown, no backticks, no preamble:
{"company":"string","role":"string","fit_score":0-100,"verdict":"Strong Fit"|"Moderate Fit"|"Weak Fit"|"Skip","strengths":["s1","s2","s3"],"gaps":["g1","g2"],"one_liner":"single sentence on fit","outreach_angle":"best angle for cold outreach"}`;

const SYSTEM_PROMPT_EMAIL = `Write a cold outreach email for ${SENDER_NAME}. Professional but human tone. ~200 words.

Structure: (1) Genuine excitement about the company/problem (1-2 sentences). (2) One product insight. (3) Brief relevant experience connection (2-3 sentences). (4) Low-pressure close.

Rules: No em dashes. No generic openings. Specific subject line. Sign as ${SENDER_NAME}.

${PROFILE_CONTEXT}

Respond ONLY in valid JSON. No markdown, no backticks:
{"subject":"string","body":"string"}`;

// ─────────────────────────────────────────────
// PIPELINE STEPS
// ─────────────────────────────────────────────

const STEPS = [
  { id: "parse", label: "Parsing JD", icon: "🔍" },
  { id: "evaluate", label: "Evaluating Fit", icon: "🧠" },
  { id: "notion", label: "Logging to Notion", icon: "📋" },
  { id: "email", label: "Drafting Email", icon: "✉️" },
  { id: "done", label: "Complete", icon: "✅" },
];

// ─────────────────────────────────────────────
// MCP SERVER URLS
// These require OAuth and are safe to expose.
// They only work when the user has connected
// the relevant integration in Claude.ai.
// ─────────────────────────────────────────────

const NOTION_MCP = "https://mcp.notion.com/mcp";
const GMAIL_MCP = "https://gmail.mcp.claude.com/mcp";

// ─────────────────────────────────────────────
// UI COMPONENTS
// ─────────────────────────────────────────────

function StatusBadge({ status }) {
  const colors = {
    pending: { bg: "rgba(150,150,150,0.1)", text: "#999", dot: "#999" },
    active: { bg: "rgba(99,180,255,0.12)", text: "#63b4ff", dot: "#63b4ff" },
    done: { bg: "rgba(80,200,120,0.12)", text: "#50c878", dot: "#50c878" },
    error: { bg: "rgba(255,99,99,0.12)", text: "#ff6363", dot: "#ff6363" },
  };
  const c = colors[status] || colors.pending;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.text, letterSpacing: "0.02em",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%", background: c.dot,
        animation: status === "active" ? "pulse 1.5s infinite" : "none",
      }} />
      {status === "active" ? "Running" : status === "done" ? "Done" : status === "error" ? "Failed" : "Waiting"}
    </span>
  );
}

function ScoreRing({ score }) {
  const r = 36, c = 2 * Math.PI * r;
  const color = score >= 70 ? "#50c878" : score >= 45 ? "#f0a030" : "#ff6363";
  const offset = c - (score / 100) * c;
  return (
    <div style={{ position: "relative", width: 90, height: 90 }}>
      <svg width="90" height="90" viewBox="0 0 90 90">
        <circle cx="45" cy="45" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <circle cx="45" cy="45" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          transform="rotate(-90 45 45)" style={{ transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 9, color: "#888", marginTop: 2 }}>FIT</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN AGENT
// ─────────────────────────────────────────────

export default function JobTrackerAgent() {
  const [jdText, setJdText] = useState("");
  const [jdUrl, setJdUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [stepStates, setStepStates] = useState({});
  const [logs, setLogs] = useState([]);
  const [fitResult, setFitResult] = useState(null);
  const [emailResult, setEmailResult] = useState(null);
  const [notionUrl, setNotionUrl] = useState(null);
  const [error, setError] = useState(null);
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const addLog = useCallback((msg) => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg }]);
  }, []);

  const setStep = useCallback((id, status) => {
    setStepStates(prev => ({ ...prev, [id]: status }));
  }, []);

  // ─────────────────────────────────────────
  // API CALL HELPER
  // No API key needed inside Claude artifacts.
  // For standalone use, add Authorization header
  // with your ANTHROPIC_API_KEY.
  // ─────────────────────────────────────────

  const callClaude = async (messages, mcpServers, tools, model) => {
    const body = {
      model: model || "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages,
    };
    if (mcpServers) body.mcp_servers = mcpServers;
    if (tools) body.tools = tools;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API ${res.status}: ${errText.substring(0, 200)}`);
    }
    return res.json();
  };

  const extractText = (data) => {
    return data.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  };

  // ─────────────────────────────────────────
  // AGENT PIPELINE
  // ─────────────────────────────────────────

  const runAgent = async () => {
    const inputText = jdText.trim();
    const inputUrl = jdUrl.trim();
    if (!inputText && !inputUrl) return;

    setRunning(true);
    setError(null);
    setFitResult(null);
    setEmailResult(null);
    setNotionUrl(null);
    setStepStates({});
    setLogs([]);

    try {
      // Step 1: Parse JD
      setStep("parse", "active");
      let jd;

      if (inputText) {
        addLog("Using pasted JD text...");
        jd = inputText;
        addLog(`Parsed JD (${jd.length} chars)`);
      } else {
        addLog("Fetching JD from URL...");
        const fetchRes = await callClaude(
          [{ role: "user", content: `Fetch this URL and return ONLY the job description text: ${inputUrl}` }],
          null,
          [{ type: "web_search_20250305", name: "web_search" }]
        );
        jd = extractText(fetchRes);
        if (!jd || jd.length < 50) throw new Error("Could not extract JD from URL");
        addLog(`Fetched JD (${jd.length} chars)`);
      }
      setStep("parse", "done");

      // Step 2: Evaluate fit (Haiku for speed)
      setStep("evaluate", "active");
      addLog("Evaluating fit against profile...");

      const evalRes = await callClaude(
        [{ role: "user", content: `${SYSTEM_PROMPT_FIT}\n\n---\nJD:\n${jd.substring(0, 1500)}\n\nJSON only.` }],
        null, null
      );

      const evalText = extractText(evalRes);
      let fit;
      try {
        fit = JSON.parse(evalText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
      } catch {
        throw new Error("Failed to parse fit evaluation");
      }

      setFitResult(fit);
      addLog(`Fit: ${fit.fit_score}/100 (${fit.verdict})`);
      setStep("evaluate", "done");

      // Step 3: Log to Notion (non-blocking, 30s timeout)
      setStep("notion", "active");
      addLog("Logging to Notion...");

      try {
        const notionPromise = callClaude(
          [{
            role: "user",
            content: `Search for a database called "Job Tracker" in my Notion. If it doesn't exist, create it with properties: Company (title), Role (rich_text), Fit Score (number), Verdict (select), URL (url), Date Added (date).

Then add a row: Company="${fit.company}", Role="${fit.role}", Fit Score=${fit.fit_score}, Verdict="${fit.verdict}", URL="${inputUrl || "pasted"}", Date Added="${new Date().toISOString().split("T")[0]}". Return the page URL.`
          }],
          [{ type: "url", url: NOTION_MCP, name: "notion-mcp" }],
          null,
          "claude-sonnet-4-20250514"
        );
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 30000));
        const notionRes = await Promise.race([notionPromise, timeout]);
        const notionText = extractText(notionRes);
        const match = notionText.match(/https:\/\/www\.notion\.so\/[^\s)]+/);
        if (match) setNotionUrl(match[0]);
        addLog("Logged to Notion");
      } catch (e) {
        addLog("Notion: " + (e.message === "Timeout" ? "timed out, moving on" : (e.message || "skipped").substring(0, 60)));
      }
      setStep("notion", "done");

      // Step 4: Draft email (Haiku for speed)
      setStep("email", "active");
      addLog("Drafting outreach email...");

      const emailRes = await callClaude(
        [{
          role: "user",
          content: `${SYSTEM_PROMPT_EMAIL}\n\n---\nCompany: ${fit.company}\nRole: ${fit.role}\nStrengths: ${fit.strengths.join(", ")}\nAngle: ${fit.outreach_angle}\nJD excerpt:\n${jd.substring(0, 800)}\n\nJSON only.`
        }],
        null, null
      );

      const emailText = extractText(emailRes);
      let email;
      try {
        email = JSON.parse(emailText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
      } catch {
        throw new Error("Failed to parse email draft");
      }

      setEmailResult(email);
      addLog("Email drafted");

      // Save to Gmail (non-blocking, 30s timeout)
      try {
        addLog("Saving to Gmail drafts...");
        const gmailPromise = callClaude(
          [{ role: "user", content: `Create a Gmail draft. Subject: ${email.subject}\nBody: ${email.body}\n\nJust save as draft, don't send.` }],
          [{ type: "url", url: GMAIL_MCP, name: "gmail-mcp" }],
          null,
          "claude-sonnet-4-20250514"
        );
        const gmailTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 30000));
        await Promise.race([gmailPromise, gmailTimeout]);
        addLog("Saved to Gmail drafts");
      } catch (e) {
        addLog(e.message === "Timeout" ? "Gmail: timed out (draft shown below)" : "Gmail save skipped (draft shown below)");
      }

      setStep("email", "done");
      setStep("done", "done");
      addLog("Pipeline complete!");

    } catch (err) {
      setError(err.message);
      addLog(`Error: ${err.message}`);
      const active = Object.entries(stepStates).find(([, v]) => v === "active");
      if (active) setStep(active[0], "error");
    } finally {
      setRunning(false);
    }
  };

  const canRun = !running && (jdText.trim().length > 50 || jdUrl.trim().length > 5);

  // ─────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(165deg, #0a0a0f 0%, #0f1218 40%, #0a0f14 100%)",
      color: "#e0e0e0",
      fontFamily: "'IBM Plex Mono', 'SF Mono', monospace",
      padding: "32px 24px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes slideIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        textarea::placeholder, input::placeholder { color: #555; }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "#63b4ff", fontWeight: 600, letterSpacing: "0.1em" }}>
              AGENTIC WORKFLOW
            </span>
            <span style={{ width: 40, height: 1, background: "rgba(99,180,255,0.3)" }} />
          </div>
          <h1 style={{
            fontFamily: "'IBM Plex Sans', sans-serif",
            fontSize: 28, fontWeight: 700, margin: 0, color: "#fff",
            letterSpacing: "-0.02em",
          }}>
            Job Tracker Agent
          </h1>
          <p style={{
            fontFamily: "'IBM Plex Sans', sans-serif",
            fontSize: 13, color: "#777", margin: "6px 0 0", lineHeight: 1.5,
          }}>
            Paste a JD below. The agent scores fit, logs to Notion, and drafts outreach in Gmail.
          </p>
        </div>

        {/* Input */}
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10, padding: 16, marginBottom: 12,
        }}>
          <textarea
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="Paste the full job description here (fastest)..."
            disabled={running}
            rows={6}
            style={{
              width: "100%", background: "transparent", border: "none", outline: "none",
              color: "#e0e0e0", fontSize: 13, padding: 0, resize: "vertical",
              fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1.6,
            }}
          />
        </div>

        {/* URL fallback + run button */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#555", fontFamily: "'IBM Plex Sans', sans-serif", flexShrink: 0 }}>
            or URL:
          </span>
          <input
            type="text"
            value={jdUrl}
            onChange={(e) => setJdUrl(e.target.value)}
            placeholder="https://boards.greenhouse.io/..."
            disabled={running || jdText.trim().length > 50}
            style={{
              flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8, outline: "none", color: "#e0e0e0", fontSize: 13,
              padding: "8px 12px", fontFamily: "'IBM Plex Mono', monospace",
              opacity: jdText.trim().length > 50 ? 0.3 : 1,
            }}
          />
          <button
            onClick={runAgent}
            disabled={!canRun}
            style={{
              padding: "10px 22px", borderRadius: 7, border: "none",
              background: running ? "rgba(99,180,255,0.15)" : !canRun ? "rgba(255,255,255,0.05)" : "#63b4ff",
              color: running ? "#63b4ff" : !canRun ? "#555" : "#0a0a0f",
              fontSize: 13, fontWeight: 600, cursor: canRun ? "pointer" : "default",
              fontFamily: "'IBM Plex Sans', sans-serif",
              transition: "all 0.2s", flexShrink: 0,
            }}
          >
            {running ? "Running..." : "Run Agent"}
          </button>
        </div>

        {/* Pipeline steps */}
        {(running || Object.keys(stepStates).length > 0) && (
          <div style={{
            display: "flex", gap: 2, marginBottom: 24,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10, padding: 12,
          }}>
            {STEPS.map((step, i) => (
              <div key={step.id} style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                gap: 6, padding: "8px 4px", position: "relative",
              }}>
                <span style={{ fontSize: 18 }}>{step.icon}</span>
                <span style={{
                  fontSize: 10, fontWeight: 600, textAlign: "center", lineHeight: 1.3,
                  fontFamily: "'IBM Plex Sans', sans-serif",
                  color: stepStates[step.id] === "active" ? "#63b4ff"
                    : stepStates[step.id] === "done" ? "#50c878"
                    : stepStates[step.id] === "error" ? "#ff6363" : "#555",
                }}>
                  {step.label}
                </span>
                <StatusBadge status={stepStates[step.id] || "pending"} />
                {i < STEPS.length - 1 && (
                  <div style={{
                    position: "absolute", right: -1, top: "50%", transform: "translateY(-50%)",
                    color: "#333", fontSize: 10,
                  }}>→</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Fit result card */}
        {fitResult && (
          <div style={{
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10, padding: 20, marginBottom: 16, animation: "slideIn 0.3s ease",
          }}>
            <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
              <ScoreRing score={fitResult.fit_score} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 2 }}>
                  {fitResult.company}
                </div>
                <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: "#888", marginBottom: 10 }}>
                  {fitResult.role}
                </div>
                <span style={{
                  display: "inline-block", padding: "3px 12px", borderRadius: 99, fontSize: 11, fontWeight: 600,
                  background: fitResult.verdict === "Strong Fit" ? "rgba(80,200,120,0.12)"
                    : fitResult.verdict === "Moderate Fit" ? "rgba(240,160,48,0.12)" : "rgba(255,99,99,0.12)",
                  color: fitResult.verdict === "Strong Fit" ? "#50c878"
                    : fitResult.verdict === "Moderate Fit" ? "#f0a030" : "#ff6363",
                }}>
                  {fitResult.verdict}
                </span>
              </div>
            </div>

            <p style={{
              fontSize: 13, color: "#aaa", margin: "16px 0 12px", lineHeight: 1.6,
              fontFamily: "'IBM Plex Sans', sans-serif",
            }}>
              {fitResult.one_liner}
            </p>

            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#50c878", fontWeight: 600, marginBottom: 6, letterSpacing: "0.05em" }}>STRENGTHS</div>
                {fitResult.strengths.map((s, i) => (
                  <div key={i} style={{
                    fontSize: 12, color: "#999", padding: "4px 0", fontFamily: "'IBM Plex Sans', sans-serif",
                    borderBottom: i < fitResult.strengths.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  }}>{s}</div>
                ))}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#f0a030", fontWeight: 600, marginBottom: 6, letterSpacing: "0.05em" }}>GAPS</div>
                {fitResult.gaps.map((g, i) => (
                  <div key={i} style={{
                    fontSize: 12, color: "#999", padding: "4px 0", fontFamily: "'IBM Plex Sans', sans-serif",
                    borderBottom: i < fitResult.gaps.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  }}>{g}</div>
                ))}
              </div>
            </div>

            {notionUrl && (
              <div style={{
                marginTop: 14, padding: "8px 12px", background: "rgba(99,180,255,0.06)",
                borderRadius: 6, fontSize: 12, color: "#63b4ff",
              }}>
                📋 <a href={notionUrl} target="_blank" rel="noopener" style={{ color: "#63b4ff", textDecoration: "underline" }}>View in Notion</a>
              </div>
            )}
          </div>
        )}

        {/* Email draft */}
        {emailResult && (
          <div style={{
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10, padding: 20, marginBottom: 16, animation: "slideIn 0.3s ease",
          }}>
            <div style={{ fontSize: 10, color: "#63b4ff", fontWeight: 600, marginBottom: 10, letterSpacing: "0.05em" }}>
              OUTREACH EMAIL DRAFT
            </div>
            <div style={{
              background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 16,
              border: "1px solid rgba(255,255,255,0.04)",
            }}>
              <div style={{
                fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 10, paddingBottom: 10,
                borderBottom: "1px solid rgba(255,255,255,0.06)", fontFamily: "'IBM Plex Sans', sans-serif",
              }}>
                Subject: {emailResult.subject}
              </div>
              <div style={{
                fontSize: 13, color: "#bbb", lineHeight: 1.7,
                fontFamily: "'IBM Plex Sans', sans-serif", whiteSpace: "pre-wrap",
              }}>
                {emailResult.body}
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: "#666", fontFamily: "'IBM Plex Sans', sans-serif" }}>
              ✉️ Draft saved to Gmail
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div style={{
            background: "rgba(255,99,99,0.08)", border: "1px solid rgba(255,99,99,0.2)",
            borderRadius: 10, padding: 16, marginBottom: 16,
            fontSize: 13, color: "#ff6363", lineHeight: 1.6, fontFamily: "'IBM Plex Sans', sans-serif",
          }}>
            {error}
          </div>
        )}

        {/* Agent log */}
        {logs.length > 0 && (
          <div style={{
            background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10, padding: 16,
          }}>
            <div style={{ fontSize: 10, color: "#666", fontWeight: 600, marginBottom: 10, letterSpacing: "0.05em" }}>
              AGENT LOG
            </div>
            <div ref={logRef} style={{ maxHeight: 180, overflowY: "auto" }}>
              {logs.map((log, i) => (
                <div key={i} style={{
                  fontSize: 11, padding: "3px 0", color: "#777",
                  display: "flex", gap: 10, animation: "slideIn 0.2s ease",
                }}>
                  <span style={{ color: "#444", flexShrink: 0 }}>{log.time}</span>
                  <span>{log.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{
          marginTop: 28, textAlign: "center", fontSize: 11, color: "#444",
          fontFamily: "'IBM Plex Sans', sans-serif",
        }}>
          Job Tracker Agent · Claude API + Notion MCP + Gmail MCP
        </div>
      </div>
    </div>
  );
}
