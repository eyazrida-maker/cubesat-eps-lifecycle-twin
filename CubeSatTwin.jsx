import { useState, useEffect, useRef, useCallback } from "react";
 
// ── Config ────────────────────────────────────────────────────────────────────
const API = "http://localhost:8000";
 
// Design tokens — deep space mission control: near-black bg, teal + amber accents, white text
const C = {
  teal:        "#0F6E56",
  tealLight:   "rgba(15,110,86,0.18)",
  tealBright:  "#13C296",
  tealDim:     "#0a4f3e",
  amber:       "#BA7517",
  amberLight:  "rgba(186,117,23,0.18)",
  amberBright: "#F5A623",
  danger:      "#E24B4A",
  dangerLight: "rgba(226,75,74,0.15)",
  blue:        "#3B82F6",
  blueLight:   "rgba(59,130,246,0.15)",
  purple:      "#8B5CF6",
  purpleLight: "rgba(139,92,246,0.15)",
  green:       "#22C55E",
  // Dark backgrounds
  bg:          "#080D0B",
  bgCard:      "#0E1612",
  bgPanel:     "#121A16",
  bgElevated:  "#172019",
  // Borders
  border:      "rgba(15,110,86,0.22)",
  borderDim:   "rgba(255,255,255,0.07)",
  // Text
  text:        "#F0FAF6",
  textDim:     "rgba(240,250,246,0.5)",
  textMuted:   "rgba(240,250,246,0.3)",
};
 
const FONT = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace";
const SANS = "'DM Sans', 'Inter', system-ui, sans-serif";
 
// ── Global styles ─────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: ${C.bg}; font-family: ${SANS}; color: ${C.text}; min-height: 100vh; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${C.teal}55; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: ${C.teal}99; }
 
  @keyframes pulse    { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(1.5)} }
  @keyframes blink    { 0%,100%{opacity:1} 50%{opacity:0.2} }
  @keyframes spin     { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes dots     { 0%,80%,100%{transform:scale(0.4);opacity:.2} 40%{transform:scale(1);opacity:1} }
  @keyframes fadeIn   { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
  @keyframes slideIn  { from{opacity:0;transform:translateX(-10px)} to{opacity:1;transform:translateX(0)} }
  @keyframes scanline { 0%{transform:translateY(-100%)} 100%{transform:translateY(100vh)} }
  @keyframes glow     { 0%,100%{box-shadow:0 0 0 0 rgba(15,110,86,0)} 50%{box-shadow:0 0 14px 2px rgba(15,110,86,0.35)} }
  @keyframes alertPulse { 0%,100%{box-shadow:0 0 0 0 rgba(226,75,74,0)} 50%{box-shadow:0 0 18px 4px rgba(226,75,74,0.3)} }
  @keyframes shimmer  { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
 
  input[type=range] {
    -webkit-appearance: none; appearance: none;
    height: 4px; border-radius: 2px;
    background: ${C.border}; outline: none;
  }
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 14px; height: 14px; border-radius: 50%;
    background: ${C.teal}; cursor: pointer;
    box-shadow: 0 0 6px ${C.teal}88;
  }
  input::placeholder { color: ${C.textMuted}; }
  input:focus { outline: none; }
 
  .tab-btn:hover { background: rgba(15,110,86,0.12) !important; color: ${C.tealBright} !important; }
  .metric-card:hover { border-color: rgba(15,110,86,0.45) !important; transform: translateY(-1px); }
  .action-btn:hover { filter: brightness(1.15); transform: translateY(-1px); }
  .quick-prompt:hover { background: ${C.bgElevated} !important; border-color: ${C.teal}66 !important; color: ${C.tealBright} !important; }
`;
 
// ── Utilities ─────────────────────────────────────────────────────────────────
const fmt2   = v => (typeof v === "number" ? v.toFixed(2) : "—");
const fmt1   = v => (typeof v === "number" ? v.toFixed(1) : "—");
const fmtInt = v => (typeof v === "number" ? Math.round(v).toLocaleString() : "—");
const clamp  = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
 
// ── Offline fallback agent response ──────────────────────────────────────────
function fallbackResponse(telemetry, message) {
  const d = telemetry || {};
  const soc = d.soc_real ?? 0;
  const vbat = d.vbat ?? 0;
  const temp = d.tbat ?? 0;
  const anomaly = d.anomaly_score ?? 0;
  const isAlert = anomaly > 0.5;
 
  let level = "nominal";
  let action = "Continue monitoring all EPS subsystems.";
  let content = "";
 
  if (isAlert || message?.toLowerCase().includes("anomaly")) {
    level = anomaly > 0.75 ? "critical" : "warning";
    action = vbat < 9.5
      ? "Immediate battery check — voltage below safe threshold."
      : temp > 45
      ? "Thermal management mode — reduce payload duty cycle."
      : "Increase telemetry sampling rate. Prepare fault isolation procedure.";
    content = `⚠️ ANOMALY DETECTED (score: ${fmt2(anomaly)})\n\n`
      + `Current EPS status:\n• SoC: ${fmt1(soc)}% ${soc < 20 ? "— CRITICAL LOW" : soc < 40 ? "— WARNING" : "— nominal"}\n`
      + `• Voltage: ${fmt2(vbat)}V ${vbat < 9.5 ? "— BELOW MINIMUM" : "— nominal"}\n`
      + `• Temperature: ${fmt1(temp)}°C ${temp > 50 ? "— OVERTEMP" : temp < -10 ? "— COLD" : "— nominal"}\n\n`
      + `Backend agent offline — physics-based analysis active. ${action}`;
  } else if (message?.toLowerCase().includes("repurpose") || message?.toLowerCase().includes("deorbit") || message?.toLowerCase().includes("eol")) {
    level = "warning";
    action = "Fetch live EOL decision from /lifecycle/decision endpoint.";
    content = `End-of-life analysis (offline mode):\n\n`
      + `Current battery SoC average: ${fmt1(soc)}%\n`
      + `Subsystem voltage: ${fmt2(vbat)}V\n\n`
      + `A repurpose score ≥ 60/100 recommends relay-node or beacon mission.\n`
      + `Connect the Groq backend for full AI-driven scoring. The drag sail provides IADC-compliant deorbit regardless of the decision.`;
  } else {
    content = `EPS Status (offline mode — backend not connected):\n\n`
      + `• State of Charge: ${fmt1(soc)}%\n`
      + `• Battery Voltage: ${fmt2(vbat)} V\n`
      + `• Temperature: ${fmt1(temp)} °C\n`
      + `• Solar Power: ${fmt2(d.psol ?? 0)} W\n`
      + `• Anomaly Score: ${fmt2(anomaly)} — ${anomaly > 0.5 ? "ALERT" : "nominal"}\n\n`
      + `Start the FastAPI backend (uvicorn main:app --reload --port 8000) and set GROQ_API_KEY for full AI reasoning.`;
  }
 
  return { content, decision: { level, action } };
}
 
// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, color, min, max, height = 48 }) {
  if (!data || data.length < 2) return <div style={{ height }} />;
  const w = 300, h = height, range = (max - min) || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((clamp(v, min, max) - min) / range) * (h - 8) - 4;
    return `${x},${y}`;
  }).join(" ");
  const last = data[data.length - 1];
  const lx = w;
  const ly = h - ((clamp(last, min, max) - min) / range) * (h - 8) - 4;
  const gId = `sg${color.replace(/[^a-zA-Z0-9]/g, "")}${Math.abs(min)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height, display: "block" }}>
      <defs>
        <linearGradient id={gId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${lx},${h}`} fill={`url(#${gId})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="4" fill={color}
        style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
    </svg>
  );
}
 
// ── Decay chart ───────────────────────────────────────────────────────────────
function DecayChart({ baseline, sail }) {
  if (!baseline?.alt_history_km || !sail?.alt_history_km) {
    return (
      <div style={{ height: 200, display: "flex", alignItems: "center",
        justifyContent: "center", color: C.textMuted, fontSize: 13 }}>
        Load KPI data to view decay simulation
      </div>
    );
  }
  const allDays = [...(baseline.day_history || []), ...(sail.day_history || [])];
  const maxDay = Math.max(...allDays, 1);
  const W = 560, H = 200;
  const px = d => (d / maxDay) * (W - 48) + 28;
  const py = a => H - 24 - ((clamp(a, 80, 450) - 80) / (450 - 80)) * (H - 36);
 
  const blPts = (baseline.day_history || [])
    .map((d, i) => `${px(d)},${py(baseline.alt_history_km[i] ?? 80)}`).join(" ");
  const slPts = (sail.day_history || [])
    .map((d, i) => `${px(d)},${py(sail.alt_history_km[i] ?? 80)}`).join(" ");
 
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }}>
      {[100, 200, 300, 400].map(alt => (
        <g key={alt}>
          <line x1={28} y1={py(alt)} x2={W - 20} y2={py(alt)}
            stroke={C.borderDim} strokeWidth="1" strokeDasharray="4,4" />
          <text x={22} y={py(alt) + 4} fontSize={9} fill={C.textMuted} textAnchor="end">{alt}km</text>
        </g>
      ))}
      <line x1={28} y1={py(80)} x2={W - 20} y2={py(80)}
        stroke={C.danger} strokeWidth="1" strokeDasharray="3,3" opacity="0.6" />
      <text x={32} y={py(80) - 5} fontSize={9} fill={C.danger}>Reentry 80km</text>
 
      {blPts && (
        <polyline points={blPts} fill="none" stroke={C.amber}
          strokeWidth="2" strokeDasharray="7,3" opacity="0.85" />
      )}
      {slPts && (
        <polyline points={slPts} fill="none" stroke={C.tealBright} strokeWidth="2.5" />
      )}
 
      <rect x={W - 180} y={10} width={160} height={44} rx={5}
        fill={C.bgCard} stroke={C.border} />
      <line x1={W - 168} y1={24} x2={W - 148} y2={24}
        stroke={C.amber} strokeWidth="2" strokeDasharray="5,2" />
      <text x={W - 143} y={28} fontSize={10} fill={C.text}>No sail (baseline)</text>
      <line x1={W - 168} y1={40} x2={W - 148} y2={40}
        stroke={C.tealBright} strokeWidth="2.5" />
      <text x={W - 143} y={44} fontSize={10} fill={C.text}>With drag sail</text>
    </svg>
  );
}
 
// ── Badge ─────────────────────────────────────────────────────────────────────
function Badge({ label, color = C.teal, bg, pulse: doPulse = false, dot = true }) {
  const bgColor = bg ?? `${color}22`;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600,
      background: bgColor, color, border: `1px solid ${color}44`,
      letterSpacing: "0.04em",
    }}>
      {dot && (
        <span style={{
          width: 6, height: 6, borderRadius: "50%", background: color,
          animation: doPulse ? "pulse 1.2s ease-in-out infinite" : "none",
          flexShrink: 0,
        }} />
      )}
      {label}
    </span>
  );
}
 
// ── Metric card ───────────────────────────────────────────────────────────────
function MetricCard({ label, value, twin, unit, history, color, min, max, ok, icon }) {
  const accentColor = ok === false ? C.danger : ok === true ? C.teal : color;
  return (
    <div className="metric-card" style={{
      background: C.bgCard, borderRadius: 12, padding: "16px",
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${accentColor}`,
      boxShadow: `0 2px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.03)`,
      display: "flex", flexDirection: "column", gap: 8,
      animation: "fadeIn 0.3s ease", transition: "all 0.2s ease",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{
          fontSize: 10, color: C.textMuted, textTransform: "uppercase",
          letterSpacing: "0.1em", display: "flex", alignItems: "center", gap: 5,
        }}>
          {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
          {label}
        </span>
        {ok !== undefined && (
          <Badge
            label={ok ? "OK" : "ALERT"}
            color={ok ? C.green : C.danger}
            pulse={!ok}
          />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{
          fontSize: 28, fontWeight: 700, color,
          fontFamily: FONT, fontVariantNumeric: "tabular-nums",
          textShadow: `0 0 20px ${color}44`,
        }}>
          {typeof value === "number" ? value.toFixed(2) : (value ?? "—")}
        </span>
        <span style={{ fontSize: 12, color: C.textMuted }}>{unit}</span>
        {twin !== undefined && (
          <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 4 }}>
            twin: <span style={{ color: C.blue, fontWeight: 600 }}>{fmt2(twin)}</span>
          </span>
        )}
      </div>
      {history && (
        <Sparkline data={history} color={color} min={min} max={max} />
      )}
    </div>
  );
}
 
// ── KPI stat tile ─────────────────────────────────────────────────────────────
function KpiStat({ label, value, unit, color = C.teal, good, icon, subtitle }) {
  const borderColor = good === true ? C.teal : good === false ? C.danger : color;
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`,
      borderTop: `3px solid ${borderColor}`,
      borderRadius: 10, padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: 5,
      boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
    }}>
      <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.09em" }}>
        {icon} {label}
      </div>
      <div style={{
        fontSize: 24, fontWeight: 700, color, fontFamily: FONT,
        letterSpacing: "-0.02em", textShadow: `0 0 16px ${color}44`,
      }}>
        {value ?? "—"}
        <span style={{ fontSize: 12, fontWeight: 400, color: C.textMuted, marginLeft: 5 }}>{unit}</span>
      </div>
      {subtitle && <div style={{ fontSize: 11, color: C.textMuted }}>{subtitle}</div>}
      {good !== undefined && (
        <div style={{ fontSize: 11, color: good ? C.green : C.danger, fontWeight: 600 }}>
          {good ? "✓ Compliant" : "✗ Non-compliant"}
        </div>
      )}
    </div>
  );
}
 
// ── Battery module card ───────────────────────────────────────────────────────
function BatteryModuleCard({ name, data, onSwitch }) {
  const health = data?.health ?? 100;
  const soc    = data?.soc    ?? 0;
  const active = data?.active ?? true;
  const deg    = data?.degraded ?? false;
 
  const healthColor = health > 80 ? C.teal : health > 60 ? C.amber : C.danger;
  const socColor    = soc > 40 ? C.tealBright : soc > 20 ? C.amberBright : C.danger;
 
  return (
    <div style={{
      background: C.bgCard, borderRadius: 14, padding: "18px",
      border: `2px solid ${deg ? C.danger : active ? C.teal : C.borderDim}`,
      opacity: active ? 1 : 0.55, transition: "all 0.3s ease",
      boxShadow: deg
        ? `0 0 0 3px ${C.danger}22, 0 4px 20px rgba(0,0,0,0.5), inset 0 0 30px ${C.danger}08`
        : active
        ? `0 0 0 1px ${C.teal}22, 0 4px 20px rgba(0,0,0,0.5), inset 0 0 30px ${C.teal}05`
        : "0 4px 12px rgba(0,0,0,0.4)",
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{
          fontFamily: FONT, fontWeight: 700, fontSize: 18,
          color: active ? C.tealBright : C.textMuted,
          letterSpacing: "0.05em",
          textShadow: active ? `0 0 12px ${C.teal}66` : "none",
        }}>
          MOD-{name}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {deg && <Badge label="DEGRADED" color={C.danger} pulse />}
          <Badge
            label={active ? "ACTIVE" : "ISOLATED"}
            color={active ? C.green : C.textMuted}
          />
        </div>
      </div>
 
      {/* SoC bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textDim, marginBottom: 5 }}>
          <span>State of Charge</span>
          <span style={{ fontFamily: FONT, color: socColor, fontWeight: 700 }}>{fmt1(soc)}%</span>
        </div>
        <div style={{ height: 5, background: C.borderDim, borderRadius: 3, overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${clamp(soc, 0, 100)}%`,
            background: `linear-gradient(90deg, ${socColor}, ${socColor}bb)`,
            borderRadius: 3, transition: "width 0.6s ease",
            boxShadow: `0 0 8px ${socColor}66`,
          }} />
        </div>
      </div>
 
      {/* Health bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textDim, marginBottom: 5 }}>
          <span>Cell Health</span>
          <span style={{ fontFamily: FONT, color: healthColor, fontWeight: 700 }}>{fmt1(health)}%</span>
        </div>
        <div style={{ height: 5, background: C.borderDim, borderRadius: 3, overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${clamp(health, 0, 100)}%`,
            background: `linear-gradient(90deg, ${healthColor}, ${healthColor}bb)`,
            borderRadius: 3, transition: "width 0.6s ease",
            boxShadow: `0 0 8px ${healthColor}66`,
          }} />
        </div>
      </div>
 
      <div style={{ display: "flex", gap: 16, fontSize: 11, color: C.textDim, fontFamily: FONT }}>
        <span>Temp: <span style={{ color: C.text }}>{fmt1(data?.temp)}°C</span></span>
        <span>Cycles: <span style={{ color: C.text }}>{fmt2(data?.cycles)}</span></span>
      </div>
 
      <button
        className="action-btn"
        onClick={() => onSwitch(name, !active)}
        style={{
          padding: "9px 0", borderRadius: 8, cursor: "pointer",
          border: `1px solid ${active ? C.danger : C.teal}`,
          background: active ? `${C.danger}18` : `${C.teal}18`,
          color: active ? C.danger : C.tealBright,
          fontFamily: SANS, fontWeight: 600, fontSize: 12,
          transition: "all 0.2s ease",
        }}
      >
        {active ? "⬛ Isolate — PDU Relay OFF" : "▶ Connect — PDU Relay ON"}
      </button>
    </div>
  );
}
 
// ── Lifecycle timeline ────────────────────────────────────────────────────────
const LC_PHASES = [
  { id: "DESIGN",      label: "Design",       icon: "📐", desc: "Hardware selection & sustainability KPIs" },
  { id: "LAUNCH",      label: "Launch",        icon: "🚀", desc: "Orbital insertion at 400 km LEO" },
  { id: "OPERATIONS",  label: "Operations",    icon: "🛰",  desc: "Active mission — RAAVANA telemetry live" },
  { id: "END_OF_LIFE", label: "End of Life",   icon: "⚠️",  desc: "AI evaluates: repurpose vs. deorbit" },
  { id: "DISPOSED",    label: "Disposed",      icon: "🌍",  desc: "Drag sail deployed — controlled deorbit" },
];
 
function LifecycleTimeline({ phase, events = [] }) {
  const currentIdx = LC_PHASES.findIndex(p => p.id === phase);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {LC_PHASES.map((p, i) => {
        const done    = i < currentIdx;
        const current = i === currentIdx;
        return (
          <div key={p.id} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              <div style={{
                width: 34, height: 34, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 15, fontWeight: 700,
                background: current ? C.teal : done ? `${C.teal}33` : C.bgElevated,
                color: current ? "#fff" : done ? C.tealBright : C.textMuted,
                border: current ? `2px solid ${C.tealBright}` : done ? `1px solid ${C.teal}55` : `1px solid ${C.borderDim}`,
                animation: current ? "glow 2.5s ease-in-out infinite" : "none",
                transition: "all 0.4s ease",
                boxShadow: current ? `0 0 16px ${C.teal}66` : "none",
              }}>
                {done ? "✓" : p.icon}
              </div>
              {i < LC_PHASES.length - 1 && (
                <div style={{
                  width: 2, height: 36,
                  background: done ? `linear-gradient(${C.teal}, ${C.teal}55)` : C.borderDim,
                  transition: "background 0.5s",
                }} />
              )}
            </div>
            <div style={{ paddingBottom: 20, paddingTop: 6 }}>
              <div style={{
                fontSize: 13, fontWeight: 600,
                color: current ? C.tealBright : done ? C.teal : C.textMuted,
              }}>
                {p.label}
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{p.desc}</div>
              {current && events.slice(-2).map((e, ei) => (
                <div key={ei} style={{
                  fontSize: 10, color: C.tealBright, marginTop: 6, fontFamily: FONT,
                  background: C.tealLight, padding: "4px 10px", borderRadius: 4,
                  border: `1px solid ${C.teal}44`, display: "inline-block",
                  maxWidth: "100%", wordBreak: "break-word",
                }}>
                  {e.msg}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
 
// ── Repurpose panel ───────────────────────────────────────────────────────────
function RepurposePanel({ decision, onDeploy, onRepurpose }) {
  if (!decision) return null;
  const score = decision.repurpose_score ?? 0;
  const color = score >= 60 ? C.teal : score >= 40 ? C.amber : C.danger;
 
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: 22, animation: "fadeIn 0.4s ease",
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, display: "flex",
        alignItems: "center", gap: 8, color: C.text }}>
        🤖 AI End-of-Life Decision Engine
        <Badge label="GROQ LLAMA3" color={C.purple} />
      </div>
 
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11,
          color: C.textDim, marginBottom: 7 }}>
          <span>Repurpose Viability Score</span>
          <span style={{ fontFamily: FONT, fontWeight: 700, color, fontSize: 16,
            textShadow: `0 0 12px ${color}66` }}>
            {score}/100
          </span>
        </div>
        <div style={{ height: 10, background: C.borderDim, borderRadius: 5, overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${score}%`,
            background: `linear-gradient(90deg, ${color}, ${color}99)`,
            borderRadius: 5, transition: "width 0.9s cubic-bezier(.4,0,.2,1)",
            boxShadow: `0 0 10px ${color}88`,
          }} />
        </div>
        <div style={{ fontSize: 12, color, fontWeight: 600, marginTop: 8 }}>
          → {decision.recommendation}
        </div>
      </div>
 
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 8,
          textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Scoring Breakdown
        </div>
        {(decision.reasons || []).map((r, i) => (
          <div key={i} style={{
            fontSize: 11, fontFamily: FONT, color: C.textDim,
            padding: "5px 0", borderBottom: `1px solid ${C.borderDim}`,
          }}>
            {r}
          </div>
        ))}
      </div>
 
      <div style={{ display: "flex", gap: 10 }}>
        <button className="action-btn" onClick={onRepurpose} style={{
          flex: 1, padding: "11px 0", borderRadius: 9,
          border: `1px solid ${C.teal}`,
          background: C.tealLight, color: C.tealBright,
          fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: SANS,
          transition: "all 0.2s ease",
        }}>
          ♻️ Repurpose as Relay Node
        </button>
        <button className="action-btn" onClick={onDeploy} style={{
          flex: 1, padding: "11px 0", borderRadius: 9,
          border: `1px solid ${C.amber}`,
          background: C.amberLight, color: C.amberBright,
          fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: SANS,
          transition: "all 0.2s ease",
        }}>
          🪂 Deploy Drag Sail
        </button>
      </div>
    </div>
  );
}
 
// ── Typing dots ───────────────────────────────────────────────────────────────
function Dots() {
  return (
    <span style={{ display: "inline-flex", gap: 5 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 7, height: 7, borderRadius: "50%", background: C.teal,
          display: "inline-block",
          animation: `dots 1.2s ease-in-out ${i * 0.22}s infinite`,
        }} />
      ))}
    </span>
  );
}
 
// ── Chat bubble ───────────────────────────────────────────────────────────────
function Bubble({ msg }) {
  const isAgent = msg.role === "agent";
  return (
    <div style={{
      display: "flex", flexDirection: isAgent ? "row" : "row-reverse",
      gap: 10, alignItems: "flex-start", marginBottom: 14,
      animation: "slideIn 0.25s ease",
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 15,
        background: isAgent ? C.teal : C.bgElevated,
        border: `1px solid ${isAgent ? C.teal : C.border}`,
        boxShadow: isAgent ? `0 0 10px ${C.teal}44` : "none",
      }}>
        {isAgent ? "🛰" : "👤"}
      </div>
      <div style={{
        maxWidth: "85%", padding: "11px 15px",
        background: isAgent ? C.bgElevated : C.tealLight,
        borderRadius: isAgent ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
        border: `1px solid ${isAgent ? C.border : C.teal + "55"}`,
        fontSize: 13, lineHeight: 1.75,
        color: isAgent ? C.text : C.tealBright,
        whiteSpace: "pre-wrap",
      }}>
        {msg.thinking ? <Dots /> : msg.content}
        {msg.decision && (
          <div style={{
            marginTop: 10, padding: "8px 12px", borderRadius: 8,
            fontSize: 12, fontWeight: 600,
            background: msg.decision.level === "critical"
              ? C.dangerLight
              : msg.decision.level === "warning"
              ? C.amberLight
              : C.tealLight,
            border: `1px solid ${msg.decision.level === "critical" ? C.danger
              : msg.decision.level === "warning" ? C.amber : C.teal}55`,
            color: msg.decision.level === "critical" ? C.danger
              : msg.decision.level === "warning" ? C.amberBright : C.tealBright,
          }}>
            ⚡ {msg.decision.action}
          </div>
        )}
      </div>
    </div>
  );
}
 
// ── Tab button ────────────────────────────────────────────────────────────────
function Tab({ id, label, icon, active, onClick, alert: hasAlert }) {
  return (
    <button
      className="tab-btn"
      onClick={() => onClick(id)}
      style={{
        padding: "12px 18px", borderRadius: 0, border: "none", cursor: "pointer",
        fontFamily: SANS, fontWeight: 600, fontSize: 13,
        background: "transparent",
        color: active ? C.tealBright : C.textDim,
        borderBottom: active ? `2px solid ${C.teal}` : "2px solid transparent",
        position: "relative", transition: "all 0.2s ease",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ marginRight: 5 }}>{icon}</span>{label}
      {hasAlert && (
        <span style={{
          position: "absolute", top: 8, right: 6,
          width: 7, height: 7, borderRadius: "50%",
          background: C.danger, animation: "pulse 1.2s infinite",
        }} />
      )}
    </button>
  );
}
 
// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function CubeSatTwin() {
  // Core state
  const [running, setRunning]           = useState(false);
  const [fault, setFault]               = useState("none");
  const [faultMag, setFaultMag]         = useState(0.7);
  const [current, setCurrent]           = useState(null);
  const [history, setHistory]           = useState({ soc: [], vbat: [], temp: [], psol: [], anomaly: [] });
  const [activeTab, setActiveTab]       = useState("dashboard");
  const [backendOk, setBackendOk]       = useState(false);
 
  // Battery state
  const [batteryModules, setBatteryModules] = useState({});
 
  // Lifecycle state
  const [phase, setPhase]               = useState("OPERATIONS");
  const [lcEvents, setLcEvents]         = useState([]);
  const [eolDecision, setEolDecision]   = useState(null);
 
  // KPI state
  const [kpis, setKpis]                 = useState(null);
  const [decayData, setDecayData]       = useState(null);
 
  // Chat state
  const [messages, setMessages]         = useState([{
    role: "agent",
    content: "EPS Digital Twin v2 online. Monitoring CubeSat with 3-module battery architecture and full lifecycle management.\n\nPress ▶ Start to begin the RAAVANA telemetry stream.",
  }]);
  const [userInput, setUserInput]       = useState("");
  const [agentBusy, setAgentBusy]       = useState(false);
  const [convHistory, setConvHistory]   = useState([]);
  const [agentContext, setAgentContext] = useState("ops");
 
  const intervalRef  = useRef(null);
  const chatRef      = useRef(null);
  // Track last anomaly state to avoid repeated triggers
  const lastAnomalyRef = useRef(false);
  const currentRef     = useRef(null);
  useEffect(() => { currentRef.current = current; }, [current]);
 
  // ── Inject global CSS ─────────────────────────────────────────────────────
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = GLOBAL_CSS;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);
 
  // ── Backend health check ──────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/`)
      .then(r => { if (r.ok) setBackendOk(true); })
      .catch(() => setBackendOk(false));
  }, []);
 
  // ── Load KPIs ─────────────────────────────────────────────────────────────
  const loadKpis = useCallback(async () => {
    try {
      const [kr, dr] = await Promise.all([
        fetch(`${API}/kpis`).then(r => r.json()),
        fetch(`${API}/kpis/decay`).then(r => r.json()),
      ]);
      setKpis(kr);
      setDecayData(dr);
    } catch { /* backend offline */ }
  }, []);
 
  useEffect(() => { loadKpis(); }, [loadKpis]);
 
  // ── AI Agent ──────────────────────────────────────────────────────────────
  const triggerAgent = useCallback(async (d, isAuto, msg, ctx = "ops") => {
    const tid = Date.now();
    setMessages(prev => [...prev, { role: "agent", content: "", thinking: true, id: tid }]);
    setAgentBusy(true);
 
    // If backend not available — use fallback immediately
    if (!backendOk) {
      const fb = fallbackResponse(d, msg);
      setMessages(prev => prev.map(m =>
        m.id === tid ? { role: "agent", content: fb.content, decision: fb.decision } : m
      ));
      setAgentBusy(false);
      return;
    }
 
    try {
      const r = await fetch(`${API}/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telemetry:            d ?? {},
          user_message:         msg,
          is_automatic:         isAuto,
          conversation_history: convHistory,
          context:              ctx,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setConvHistory(prev => [...prev,
        { role: "user",      content: msg },
        { role: "assistant", content: data.content },
      ]);
      setMessages(prev => prev.map(m =>
        m.id === tid
          ? { role: "agent", content: data.content, decision: data.decision }
          : m
      ));
    } catch (err) {
      // Backend reachable but request failed — use fallback
      const fb = fallbackResponse(d, msg);
      setMessages(prev => prev.map(m =>
        m.id === tid ? { role: "agent", content: fb.content, decision: fb.decision } : m
      ));
    }
    setAgentBusy(false);
  }, [backendOk, convHistory]);
 
  // ── Fetch telemetry tick ──────────────────────────────────────────────────
  const MAX_HIST = 60;
  const fetchTick = useCallback(async () => {
    try {
      const r = await fetch(`${API}/telemetry?fault=${fault}&fault_mag=${faultMag}`);
      if (!r.ok) return;
      const d = await r.json();
      setCurrent(d);
      setBatteryModules(d.battery_modules || {});
      setPhase(d.lifecycle?.phase || "OPERATIONS");
      setHistory(prev => ({
        soc:     [...prev.soc.slice(-MAX_HIST + 1),     d.soc_real],
        vbat:    [...prev.vbat.slice(-MAX_HIST + 1),    d.vbat],
        temp:    [...prev.temp.slice(-MAX_HIST + 1),    d.tbat],
        psol:    [...prev.psol.slice(-MAX_HIST + 1),    d.psol],
        anomaly: [...prev.anomaly.slice(-MAX_HIST + 1), d.anomaly_score],
      }));
 
      // ── Anomaly auto-trigger (ops context only, NOT eol) ─────────────────
      // Only fire once per anomaly event, never during EOL/DISPOSED phases
      const isOpsPhase = !["END_OF_LIFE", "DISPOSED"].includes(d.lifecycle?.phase);
      if (d.anomaly_flag && !lastAnomalyRef.current && !agentBusy && isOpsPhase) {
        lastAnomalyRef.current = true;
        triggerAgent(d, true,
          `Anomaly detected (score: ${d.anomaly_score?.toFixed(2)}). Diagnose EPS fault and recommend corrective action.`,
          "ops"  // always "ops" for anomaly — never triggers EOL messaging
        );
        setActiveTab("agent");
      }
      if (!d.anomaly_flag) lastAnomalyRef.current = false;
 
    } catch { /* backend offline */ }
  }, [fault, faultMag, agentBusy, triggerAgent]);
 
  // ── Fetch lifecycle events ────────────────────────────────────────────────
  const fetchEvents = useCallback(async () => {
    try {
      const r = await fetch(`${API}/lifecycle/events`);
      const d = await r.json();
      setLcEvents(d.events || []);
    } catch { }
  }, []);
 
  useEffect(() => {
    if (running) fetchEvents();
  }, [current, running, fetchEvents]);
 
  // ── Start / Stop ──────────────────────────────────────────────────────────
  const start = useCallback(() => {
    setRunning(true);
    intervalRef.current = setInterval(fetchTick, 1000);
  }, [fetchTick]);
 
  const stop = useCallback(() => {
    setRunning(false);
    clearInterval(intervalRef.current);
  }, []);
 
  useEffect(() => () => clearInterval(intervalRef.current), []);
 
  // Re-create interval when fetchTick changes (fault/faultMag)
  useEffect(() => {
    if (running) {
      clearInterval(intervalRef.current);
      intervalRef.current = setInterval(fetchTick, 1000);
    }
  }, [fetchTick, running]);
 
  // ── Reset ─────────────────────────────────────────────────────────────────
  const reset = async () => {
    stop();
    try { await fetch(`${API}/reset`, { method: "POST" }); } catch { }
    setCurrent(null);
    setHistory({ soc: [], vbat: [], temp: [], psol: [], anomaly: [] });
    setBatteryModules({});
    setPhase("OPERATIONS");
    setLcEvents([]);
    setEolDecision(null);
    setAgentContext("ops");
    lastAnomalyRef.current = false;
    setMessages([{ role: "agent", content: "Simulation reset to T+0. Press ▶ Start to begin." }]);
    setConvHistory([]);
    loadKpis();
  };
 
  // ── Send chat message ─────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const msg = userInput.trim();
    if (!msg || agentBusy) return;
    setMessages(prev => [...prev, { role: "user", content: msg }]);
    setUserInput("");
    await triggerAgent(currentRef.current || {}, false, msg, agentContext);
  }, [userInput, agentBusy, triggerAgent, agentContext]);
 
  // ── Battery switch ────────────────────────────────────────────────────────
  const switchModule = async (name, activate) => {
    try {
      const r = await fetch(`${API}/battery/switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: name, activate }),
      });
      if (!r.ok) {
        const e = await r.json();
        alert(e.detail);
        return;
      }
      const d = await r.json();
      setBatteryModules(d.battery_modules);
    } catch { alert("Backend offline — cannot switch module."); }
  };
 
  // ── Lifecycle actions ─────────────────────────────────────────────────────
  const triggerEOL = async () => {
    try {
      const r = await fetch(`${API}/lifecycle`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trigger_eol" }),
      });
      const d = await r.json();
      setPhase("END_OF_LIFE");
      setEolDecision(d.decision);
      setAgentContext("eol");
      setActiveTab("lifecycle");
      // Use "eol" context — correct messaging about mission end
      triggerAgent(
        currentRef.current || {},
        true,
        "End-of-life phase triggered by ground command. Evaluate current subsystem health and provide a clear recommendation: repurpose as relay node or initiate drag-sail deorbit? Justify with battery health and orbital data.",
        "eol"
      );
    } catch {
      alert("Backend offline — cannot trigger EOL.");
    }
  };
 
  const deploySail = async () => {
    try {
      await fetch(`${API}/lifecycle`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deploy_sail" }),
      });
      setPhase("DISPOSED");
      await loadKpis();
      triggerAgent(
        currentRef.current || {},
        true,
        "Drag sail successfully deployed. Confirm deorbit sequence is active and estimate time to atmospheric reentry at current altitude. Confirm IADC 25-year compliance.",
        "eol"
      );
    } catch {
      alert("Backend offline — cannot deploy sail.");
    }
  };
 
  const repurpose = async () => {
    try {
      await fetch(`${API}/lifecycle`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "repurpose", payload: { mission: "relay_node" } }),
      });
      setPhase("OPERATIONS");
      setEolDecision(null);
      setAgentContext("ops");
      triggerAgent(
        currentRef.current || {},
        true,
        "Satellite successfully repurposed as a relay node. What secondary mission parameters should we optimise for maximum lifespan?",
        "ops"
      );
    } catch {
      alert("Backend offline — cannot repurpose.");
    }
  };
 
  // ── Fault injection (inside component, correct scope) ─────────────────────
  const injectFault = (type) => {
    setFault(type);
    if (!running) start();
    if (type !== "none") {
      setMessages(prev => [...prev, {
        role: "agent",
        content: `Fault injected: ${type.replace(/_/g, " ")}. Telemetry stream active — watch anomaly score. Querying AI agent for diagnosis...`,
      }]);
      if (currentRef.current) {
        setTimeout(() => {
          triggerAgent(
            currentRef.current,
            true,
            `Fault injected: ${type.replace(/_/g, " ")} at magnitude ${faultMag}. Diagnose the EPS impact and recommend corrective actions.`,
            "ops"  // always ops context for faults
          );
          setActiveTab("agent");
        }, 2000);
      }
    }
  };
 
  // ── Chat scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);
 
  // ═════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════════
  const anomalyAlert = current?.anomaly_flag;
  const missionDay   = current?.mission_day ?? 0;
  const altKm        = current?.altitude_km ?? 400;
  const isOpsPhase   = !["END_OF_LIFE", "DISPOSED"].includes(phase);
 
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: SANS }}>
 
      {/* ── Scanline overlay (subtle) ──────────────────────────────────── */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 1000,
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)",
      }} />
 
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header style={{
        background: `${C.bgCard}ee`,
        borderBottom: `1px solid ${C.border}`,
        padding: "0 24px", height: 60,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100,
        backdropFilter: "blur(16px)",
        boxShadow: `0 1px 0 ${C.border}, 0 4px 24px rgba(0,0,0,0.6)`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: `linear-gradient(135deg, ${C.teal}, ${C.tealDim})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, boxShadow: `0 0 16px ${C.teal}55`,
          }}>
            🛰
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: C.text, letterSpacing: "-0.02em" }}>
              CubeSat EPS Digital Twin
            </div>
            <div style={{ fontSize: 9, color: C.textMuted, fontFamily: FONT, letterSpacing: "0.12em" }}>
              AESS SUSTAINABILITY HACKATHON 2026 · CHALLENGE 4
            </div>
          </div>
        </div>
 
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Badge
            label={phase.replace("_", " ")}
            color={
              phase === "DISPOSED"    ? C.blue  :
              phase === "END_OF_LIFE" ? C.amber :
              phase === "OPERATIONS"  ? C.teal  : C.textMuted
            }
            pulse={phase === "END_OF_LIFE"}
          />
          <Badge
            label={backendOk ? "Backend online" : "Backend offline"}
            color={backendOk ? C.green : C.danger}
          />
          {running && (
            <span style={{ fontFamily: FONT, fontSize: 11, color: C.textMuted }}>
              DAY <span style={{ color: C.tealBright }}>{missionDay}</span>
              {" "}· <span style={{ color: C.tealBright }}>{altKm.toFixed(0)}</span> km
            </span>
          )}
 
          <div style={{ display: "flex", gap: 6, marginLeft: 4 }}>
            <button
              className="action-btn"
              onClick={running ? stop : start}
              style={{
                padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer",
                background: running
                  ? `linear-gradient(135deg, ${C.danger}, #c23939)`
                  : `linear-gradient(135deg, ${C.teal}, ${C.tealDim})`,
                color: "#fff", fontWeight: 700, fontSize: 13, fontFamily: SANS,
                boxShadow: running ? `0 0 12px ${C.danger}44` : `0 0 12px ${C.teal}44`,
                transition: "all 0.2s ease",
              }}
            >
              {running ? "⏹ Stop" : "▶ Start"}
            </button>
            <button
              className="action-btn"
              onClick={reset}
              style={{
                padding: "8px 14px", borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: C.bgElevated, color: C.textDim,
                cursor: "pointer", fontSize: 15, transition: "all 0.2s",
              }}
            >
              ↺
            </button>
            {running && isOpsPhase && (
              <button
                className="action-btn"
                onClick={triggerEOL}
                style={{
                  padding: "8px 14px", borderRadius: 8,
                  border: `1px solid ${C.amber}`,
                  background: C.amberLight, color: C.amberBright,
                  fontWeight: 700, fontSize: 12, cursor: "pointer",
                  fontFamily: SANS, transition: "all 0.2s",
                }}
              >
                ⚠️ Trigger EOL
              </button>
            )}
          </div>
        </div>
      </header>
 
      {/* ── Tab bar ───────────────────────────────────────────────────── */}
      <div style={{
        background: `${C.bgCard}cc`,
        borderBottom: `1px solid ${C.border}`,
        padding: "0 24px", display: "flex", gap: 0,
        overflowX: "auto",
      }}>
        {[
          { id: "dashboard",  label: "Dashboard",          icon: "📊" },
          { id: "battery",    label: "Battery Modules",     icon: "🔋" },
          { id: "lifecycle",  label: "Lifecycle",           icon: "🔄", alert: phase === "END_OF_LIFE" },
          { id: "kpis",       label: "Sustainability KPIs", icon: "📈" },
          { id: "agent",      label: "AI Agent",            icon: "🤖", alert: anomalyAlert },
        ].map(t => (
          <Tab key={t.id} {...t} active={activeTab === t.id} onClick={setActiveTab} />
        ))}
      </div>
 
      {/* ── Main content ──────────────────────────────────────────────── */}
      <main style={{ maxWidth: 1300, margin: "0 auto", padding: "24px 24px 56px" }}>
 
        {/* ════ DASHBOARD ════ */}
        {activeTab === "dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
 
            {/* Source chips */}
            {current && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Badge
                  label={current.data_source === "RAAVANA" ? "🛰 Real RAAVANA telemetry" : "⚙ Physics simulation"}
                  color={current.data_source === "RAAVANA" ? C.teal : C.textMuted}
                />
                <Badge
                  label={current.lstm_active ? "🧠 LSTM SoC active" : "📐 Physics SoC fallback"}
                  color={current.lstm_active ? C.blue : C.textMuted}
                />
                <Badge
                  label={current.ae_active ? "🔍 Autoencoder active" : "📏 Rule-based AE fallback"}
                  color={current.ae_active ? C.blue : C.textMuted}
                />
                {anomalyAlert && <Badge label="⚠ ANOMALY DETECTED" color={C.danger} pulse />}
              </div>
            )}
 
            {/* Anomaly banner */}
            {anomalyAlert && (
              <div style={{
                background: C.dangerLight, border: `1px solid ${C.danger}55`,
                borderRadius: 10, padding: "14px 18px",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                animation: "alertPulse 2s ease-in-out infinite",
              }}>
                <span style={{ color: C.danger, fontWeight: 700, fontSize: 13 }}>
                  🚨 Anomaly score {fmt2(current?.anomaly_score)} — AI agent auto-triggered for ops diagnosis
                </span>
                <button
                  className="action-btn"
                  onClick={() => triggerAgent(current, true,
                    `High anomaly score ${current?.anomaly_score?.toFixed(2)} detected. Full EPS diagnostic and corrective action required.`,
                    "ops"
                  )}
                  style={{
                    padding: "7px 14px", borderRadius: 7,
                    border: `1px solid ${C.danger}`,
                    background: `${C.danger}22`, color: C.danger,
                    fontWeight: 700, fontSize: 12, cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  Query Agent →
                </button>
              </div>
            )}
 
            {/* Metrics grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 14 }}>
              <MetricCard
                label="State of Charge" value={current?.soc_real} twin={current?.soc_twin}
                unit="%" history={history.soc} color={C.tealBright} min={0} max={100} icon="⚡"
                ok={current ? current.soc_real > 20 : undefined}
              />
              <MetricCard
                label="Battery Voltage" value={current?.vbat}
                unit="V" history={history.vbat} color={C.blue} min={9} max={13.5} icon="🔌"
                ok={current ? (current.vbat > 9.5 && current.vbat < 13) : undefined}
              />
              <MetricCard
                label="Battery Temp" value={current?.tbat}
                unit="°C" history={history.temp} color={C.amberBright} min={-20} max={60} icon="🌡"
                ok={current ? (current.tbat > -10 && current.tbat < 50) : undefined}
              />
              <MetricCard
                label="Solar Power" value={current?.psol}
                unit="W" history={history.psol} color="#FBBF24" min={0} max={1.2} icon="☀️"
                ok={current ? (current.psol > 0.1 || current.eclipse === 1) : undefined}
              />
              <MetricCard
                label="Anomaly Score" value={current?.anomaly_score}
                unit="" history={history.anomaly} color={C.danger} min={0} max={1} icon="🔍"
                ok={current ? current.anomaly_score < 0.5 : undefined}
              />
              <MetricCard
                label="Orbit Angle" value={current?.angle}
                unit="°" color={C.purple} min={0} max={360} icon="🌍"
              />
            </div>
 
            {/* Orbit status bar */}
            {current && (
              <div style={{
                background: C.bgCard, border: `1px solid ${C.border}`,
                borderRadius: 10, padding: "12px 20px",
                display: "flex", gap: 28, flexWrap: "wrap", alignItems: "center",
              }}>
                <Badge
                  label={current.eclipse ? "🌑 ECLIPSE" : "☀ SUNLIT"}
                  color={current.eclipse ? C.textMuted : "#FBBF24"}
                />
                <span style={{ fontFamily: FONT, fontSize: 12, color: C.textDim }}>
                  T+ <b style={{ color: C.text }}>{fmtInt(current.t)}s</b>
                </span>
                <span style={{ fontFamily: FONT, fontSize: 12, color: C.textDim }}>
                  Orbit <b style={{ color: C.text }}>{fmtInt(current.t / 5400)}</b>
                </span>
                <span style={{ fontFamily: FONT, fontSize: 12, color: C.textDim }}>
                  Day <b style={{ color: C.text }}>{missionDay}</b>
                  <span style={{ color: C.textMuted }}>/{current.lifecycle?.total_days ?? 730}</span>
                </span>
                <span style={{ fontFamily: FONT, fontSize: 12, color: C.textDim }}>
                  Alt <b style={{ color: C.tealBright }}>{altKm.toFixed(1)} km</b>
                </span>
                <span style={{ fontFamily: FONT, fontSize: 12, color: C.textDim }}>
                  I_bat <b style={{ color: C.text }}>{fmt2(current.ibat)} A</b>
                </span>
                <span style={{ fontFamily: FONT, fontSize: 12, color: C.textDim }}>
                  Phase <b style={{ color: C.tealBright }}>{phase}</b>
                </span>
              </div>
            )}
 
            {/* Fault injection */}
            <div style={{
              background: C.bgCard, border: `1px solid ${C.border}`,
              borderRadius: 12, padding: 20,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: C.text }}>
                ⚡ Fault Injection — EPS Stress Testing
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                {[
                  { id: "none",               label: "✅ Nominal",           color: C.teal },
                  { id: "voltage_drop",        label: "⚡ Voltage Drop",      color: C.amber },
                  { id: "thermal",             label: "🔥 Thermal Runaway",   color: C.danger },
                  { id: "solar_degradation",   label: "☀️ Solar Degradation", color: C.purple },
                  { id: "overcurrent",         label: "⚠️ Overcurrent",       color: "#EF4444" },
                ].map(f => (
                  <button
                    key={f.id}
                    onClick={() => injectFault(f.id)}
                    style={{
                      padding: "9px 16px", borderRadius: 8,
                      border: `1px solid ${fault === f.id ? f.color : C.borderDim}`,
                      background: fault === f.id ? `${f.color}22` : C.bgElevated,
                      color: fault === f.id ? f.color : C.textDim,
                      fontWeight: fault === f.id ? 700 : 500,
                      fontSize: 12, cursor: "pointer", fontFamily: SANS,
                      transition: "all 0.2s",
                      boxShadow: fault === f.id ? `0 0 10px ${f.color}33` : "none",
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {fault !== "none" && (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 12, color: C.textDim, whiteSpace: "nowrap" }}>Magnitude</span>
                  <input
                    type="range" min="0.1" max="1" step="0.05" value={faultMag}
                    onChange={e => setFaultMag(parseFloat(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontFamily: FONT, fontSize: 12, color: C.tealBright, width: 36 }}>
                    {faultMag.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
 
            {/* No data hint */}
            {!current && (
              <div style={{
                textAlign: "center", padding: "60px 20px",
                color: C.textMuted, fontSize: 14, lineHeight: 2,
              }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🛰</div>
                Press <strong style={{ color: C.tealBright }}>▶ Start</strong> to begin the telemetry stream.
                <br />
                {backendOk
                  ? <span style={{ color: C.teal }}>Backend connected — real RAAVANA data available.</span>
                  : <span style={{ color: C.amber }}>Start <code style={{ fontFamily: FONT }}>uvicorn main:app --reload --port 8000</code> for full functionality.</span>
                }
              </div>
            )}
          </div>
        )}
 
        {/* ════ BATTERY MODULES ════ */}
        {activeTab === "battery" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{
              background: C.bgCard, border: `1px solid ${C.border}`,
              borderRadius: 10, padding: "14px 18px",
              fontSize: 13, color: C.textDim, lineHeight: 1.7,
            }}>
              <strong style={{ color: C.text }}>Modular Battery Architecture</strong> — Three independent
              Li-ion NMC modules (A/B/C) connected via PDU relay switches. Each module is monitored independently
              for SoC, health, temperature, and cycle count. Isolation of a degraded module prevents thermal
              cascade and preserves remaining capacity — a key sustainability design choice.
            </div>
 
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(290px,1fr))", gap: 16 }}>
              {Object.entries(batteryModules).map(([name, data]) => (
                <BatteryModuleCard key={name} name={name} data={data} onSwitch={switchModule} />
              ))}
              {Object.keys(batteryModules).length === 0 && (
                <div style={{ color: C.textMuted, fontSize: 13, gridColumn: "1/-1", textAlign: "center", padding: 48 }}>
                  Start the simulation to view battery module data.
                </div>
              )}
            </div>
 
            <div style={{
              background: C.bgCard, border: `1px solid ${C.border}`,
              borderRadius: 12, padding: 22,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: C.text }}>
                🔧 PDU Relay Architecture
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {[
                  { icon: "🔍", title: "Detection",   body: "Autoencoder anomaly score + physics rules flag per-module degradation when health < 70% or internal resistance rises above nominal." },
                  { icon: "🧠", title: "Decision",    body: "Groq Llama3 agent analyses the degradation trend and recommends isolating the module — load redistributed to healthy modules." },
                  { icon: "📡", title: "Execution",   body: "Ground operator approves → command uplinked on next pass → OBC sends relay signal to PDU → module isolated in milliseconds." },
                  { icon: "🌱", title: "Impact",      body: "Isolation prevents thermal runaway propagation. Extends operational life 30–60%. Reduces debris risk from in-orbit battery failure." },
                ].map((item, i) => (
                  <div key={i} style={{
                    padding: "12px 15px", borderRadius: 8,
                    background: C.bgElevated, border: `1px solid ${C.borderDim}`,
                  }}>
                    <div style={{ fontWeight: 700, marginBottom: 5, color: C.tealBright, fontSize: 13 }}>
                      {item.icon} {item.title}
                    </div>
                    <div style={{ color: C.textDim, fontSize: 12, lineHeight: 1.7 }}>{item.body}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
 
        {/* ════ LIFECYCLE ════ */}
        {activeTab === "lifecycle" && (
          <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20, alignItems: "start" }}>
 
            <div style={{
              background: C.bgCard, border: `1px solid ${C.border}`,
              borderRadius: 12, padding: 22,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 18, color: C.text }}>
                Mission Lifecycle
              </div>
              <LifecycleTimeline phase={phase} events={lcEvents} />
            </div>
 
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
 
              {(phase === "END_OF_LIFE" || eolDecision) && (
                <RepurposePanel
                  decision={eolDecision}
                  onDeploy={deploySail}
                  onRepurpose={repurpose}
                />
              )}
 
              {phase === "DISPOSED" && (
                <div style={{
                  background: C.tealLight, border: `1px solid ${C.teal}55`,
                  borderRadius: 12, padding: 20, animation: "fadeIn 0.4s ease",
                }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.tealBright, marginBottom: 8 }}>
                    🪂 Drag Sail Deployed — Controlled Deorbit Active
                  </div>
                  <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.7 }}>
                    Cross-sectional area increased from 0.010 m² → 0.250 m² (25× multiplier).
                    Atmospheric braking accelerated. See Sustainability KPIs for the full deorbit timeline and IADC compliance status.
                  </div>
                </div>
              )}
 
              {phase === "OPERATIONS" && !eolDecision && (
                <div style={{
                  background: C.bgCard, border: `1px solid ${C.border}`,
                  borderRadius: 12, padding: 22,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: C.text }}>
                    Lifecycle Controls
                  </div>
                  <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.7, marginBottom: 16 }}>
                    The satellite is in nominal operations. When mission objectives are complete or subsystem health degrades,
                    trigger End-of-Life evaluation. The AI engine computes a repurpose vs. deorbit score based on live subsystem health.
                  </div>
                  <button
                    className="action-btn"
                    onClick={triggerEOL}
                    disabled={!running}
                    style={{
                      padding: "12px 0", borderRadius: 9, width: "100%",
                      border: `1px solid ${C.amber}`,
                      background: C.amberLight, color: C.amberBright,
                      fontWeight: 700, fontSize: 13, cursor: running ? "pointer" : "not-allowed",
                      fontFamily: SANS, opacity: running ? 1 : 0.5, transition: "all 0.2s",
                    }}
                  >
                    ⚠️ Initiate End-of-Life Evaluation
                  </button>
                  {!running && (
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, textAlign: "center" }}>
                      Start the simulation first
                    </div>
                  )}
                </div>
              )}
 
              {/* Event log */}
              <div style={{
                background: C.bgCard, border: `1px solid ${C.border}`,
                borderRadius: 12, padding: 20,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: C.text }}>
                  📋 Lifecycle Event Log
                </div>
                {lcEvents.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.textMuted }}>
                    No events yet — events appear as the mission progresses.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
                    {lcEvents.slice().reverse().map((e, i) => (
                      <div key={i} style={{
                        padding: "7px 11px", borderRadius: 6,
                        background: C.bgElevated,
                        borderLeft: `3px solid ${
                          e.type.includes("SAIL")     ? C.teal  :
                          e.type.includes("DEGRADED") ? C.danger :
                          e.type.includes("EOL")      ? C.amber  : C.border
                        }`,
                        fontSize: 11, fontFamily: FONT,
                      }}>
                        <span style={{ color: C.textMuted }}>Day {e.day}</span>
                        {" "}<span style={{ color: C.tealBright }}>[{e.type}]</span>
                        {" "}<span style={{ color: C.textDim }}>{e.msg}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
 
        {/* ════ SUSTAINABILITY KPIs ════ */}
        {activeTab === "kpis" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
 
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 12 }}>
              <KpiStat
                label="Post-Mission Lifetime (Sail)"
                value={kpis?.post_mission_lifetime_days != null ? fmtInt(kpis.post_mission_lifetime_days) : "—"}
                unit="days" icon="🪂"
                good={kpis?.iadc_compliant}
                subtitle={kpis?.post_mission_lifetime_days ? `${(kpis.post_mission_lifetime_days / 365.25).toFixed(2)} years` : undefined}
              />
              <KpiStat
                label="Baseline Lifetime (No Sail)"
                value={kpis?.baseline_lifetime_days != null ? fmtInt(kpis.baseline_lifetime_days) : "—"}
                unit="days" icon="📡" color={C.amber}
                subtitle={kpis?.baseline_lifetime_days ? `${(kpis.baseline_lifetime_days / 365.25).toFixed(1)} years` : undefined}
              />
              <KpiStat
                label="Deorbit Time Reduction"
                value={kpis?.deorbit_time_reduction_pct ?? "—"}
                unit="%" icon="⬇️" color={C.tealBright}
                good={(kpis?.deorbit_time_reduction_pct ?? 0) > 50}
              />
              <KpiStat
                label="Debris Risk (Baseline)"
                value={kpis?.debris_risk_score_baseline ?? "—"}
                unit="/1.0" icon="⚠️" color={C.danger}
              />
              <KpiStat
                label="Debris Risk (With Sail)"
                value={kpis?.debris_risk_score_with_sail ?? "—"}
                unit="/1.0" icon="✅"
                good={(kpis?.debris_risk_score_with_sail ?? 1) < 0.5}
              />
              <KpiStat
                label="IADC 25-Year Rule"
                value={kpis?.iadc_compliant == null ? "—" : kpis.iadc_compliant ? "PASS" : "FAIL"}
                unit="" icon="📋"
                good={kpis?.iadc_compliant}
              />
              <KpiStat
                label="Solar Energy Harvested"
                value={kpis?.solar_energy_harvested_Wh != null
                  ? kpis.solar_energy_harvested_Wh.toFixed(1)
                  : "0.0"}
                unit="Wh" icon="☀️" color="#FBBF24"
              />
              <KpiStat
                label="Battery Switch Events"
                value={kpis?.battery_switching_events ?? 0}
                unit="events" icon="🔋" color={C.blue}
              />
              <KpiStat
                label="Anomaly Detections"
                value={kpis?.anomaly_detections ?? 0}
                unit="total" icon="🔍" color={C.purple}
              />
            </div>
 
            {/* Decay chart */}
            <div style={{
              background: C.bgCard, border: `1px solid ${C.border}`,
              borderRadius: 12, padding: 22,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                    Orbital Altitude Decay Simulation
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>
                    {decayData?.alt_nom_km ?? 400} km orbit
                    · {decayData?.sat_mass_kg ?? 1.33} kg
                    · Drag sail {decayData?.sail_area_m2 ?? 0.25} m²
                  </div>
                </div>
                <button
                  className="action-btn"
                  onClick={loadKpis}
                  style={{
                    padding: "7px 14px", borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: C.bgElevated, color: C.tealBright,
                    fontSize: 12, cursor: "pointer", fontWeight: 600,
                    transition: "all 0.2s",
                  }}
                >
                  ↻ Refresh
                </button>
              </div>
              <DecayChart baseline={decayData?.baseline} sail={decayData?.sail} />
              <div style={{ display: "flex", gap: 24, marginTop: 14, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: C.textDim }}>
                  <span style={{ color: C.amber }}>── ──</span> Without sail:{" "}
                  <strong style={{ color: C.text }}>
                    {kpis?.baseline_lifetime_days != null ? fmtInt(kpis.baseline_lifetime_days) : "—"} days
                  </strong>
                </span>
                <span style={{ fontSize: 11, color: C.textDim }}>
                  <span style={{ color: C.tealBright }}>────</span> With drag sail:{" "}
                  <strong style={{ color: C.text }}>
                    {kpis?.post_mission_lifetime_days != null ? fmtInt(kpis.post_mission_lifetime_days) : "—"} days
                  </strong>
                </span>
                <span style={{ fontSize: 11, color: C.textDim }}>
                  Reduction: <strong style={{ color: C.tealBright }}>{kpis?.deorbit_time_reduction_pct ?? "—"}%</strong>
                </span>
              </div>
            </div>
 
            {/* Design summary */}
            <div style={{
              background: C.bgCard, border: `1px solid ${C.border}`,
              borderRadius: 12, padding: 22,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, color: C.text }}>
                🌱 Sustainability Design Summary
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {[
                  { icon: "☀️", title: "Triple-Junction GaAs Panels",
                    body: "28.5% BOL efficiency vs 18.5% silicon — +54% power gain. Slower radiation degradation. MPPT converter at 97% efficiency captures near-eclipse illumination." },
                  { icon: "🔋", title: "Modular 3-Module Battery",
                    body: "Independent SoC/health per module with PDU relay isolation. Prevents thermal cascade. Extends mission life 30–60% vs single-module design." },
                  { icon: "🪂", title: "Deployable Drag Sail",
                    body: `25× cross-section increase (0.01→0.25 m²). Reduces post-mission lifetime from ${kpis?.baseline_lifetime_days != null ? fmtInt(kpis.baseline_lifetime_days) : "—"} to ${kpis?.post_mission_lifetime_days != null ? fmtInt(kpis.post_mission_lifetime_days) : "—"} days. IADC compliant by design.` },
                  { icon: "🤖", title: "AI Lifecycle Decision Engine",
                    body: "Scores repurpose viability 0–100 from subsystem health, mission life, and secondary mission potential. Prevents premature deorbit of functional satellites." },
                  { icon: "🔍", title: "Autoencoder Anomaly Detection",
                    body: "Real-time reconstruction error scoring. Physics fallback ensures zero downtime. Detects fault precursors before catastrophic EPS failure." },
                  { icon: "📋", title: "IADC Debris Mitigation",
                    body: "25-year post-mission deorbit rule enforced by design — drag sail guarantees compliance without propulsion. Kessler syndrome prevention by default." },
                ].map((item, i) => (
                  <div key={i} style={{
                    padding: "13px 15px", borderRadius: 9,
                    background: C.bgElevated, border: `1px solid ${C.borderDim}`,
                  }}>
                    <div style={{ fontWeight: 700, marginBottom: 5, color: C.tealBright, fontSize: 13 }}>
                      {item.icon} {item.title}
                    </div>
                    <div style={{ color: C.textDim, fontSize: 12, lineHeight: 1.7 }}>{item.body}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
 
        {/* ════ AI AGENT ════ */}
        {activeTab === "agent" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 310px", gap: 20, alignItems: "start" }}>
 
            {/* Chat window */}
            <div style={{
              background: C.bgCard, border: `1px solid ${C.border}`,
              borderRadius: 12, display: "flex", flexDirection: "column", height: 640,
            }}>
              <div style={{
                padding: "14px 20px", borderBottom: `1px solid ${C.border}`,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>
                    🤖 Groq Llama3 AI Agent
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>
                    Real-time satellite lifecycle reasoning
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {["ops", "eol"].map(ctx => (
                    <button
                      key={ctx}
                      onClick={() => setAgentContext(ctx)}
                      style={{
                        padding: "5px 12px", borderRadius: 7,
                        border: `1px solid ${agentContext === ctx ? C.teal : C.borderDim}`,
                        background: agentContext === ctx ? C.tealLight : C.bgElevated,
                        color: agentContext === ctx ? C.tealBright : C.textMuted,
                        fontSize: 11, fontWeight: 600, cursor: "pointer",
                        transition: "all 0.2s",
                      }}
                    >
                      {ctx === "ops" ? "Operations" : "End-of-Life"}
                    </button>
                  ))}
                </div>
              </div>
 
              <div
                ref={chatRef}
                style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}
              >
                {messages.map((m, i) => <Bubble key={i} msg={m} />)}
              </div>
 
              <div style={{
                padding: "14px 16px", borderTop: `1px solid ${C.border}`,
                display: "flex", gap: 8,
              }}>
                <input
                  value={userInput}
                  onChange={e => setUserInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                  placeholder={backendOk ? "Ask the AI agent... (Enter to send)" : "Start backend for full AI — offline fallback active"}
                  disabled={agentBusy}
                  style={{
                    flex: 1, padding: "10px 14px", borderRadius: 9,
                    border: `1px solid ${C.border}`,
                    background: C.bgElevated, color: C.text,
                    fontFamily: SANS, fontSize: 13,
                    transition: "border-color 0.2s",
                  }}
                />
                <button
                  onClick={sendMessage}
                  disabled={agentBusy || !userInput.trim()}
                  className="action-btn"
                  style={{
                    padding: "10px 18px", borderRadius: 9, border: "none",
                    background: agentBusy ? C.bgElevated : `linear-gradient(135deg, ${C.teal}, ${C.tealDim})`,
                    color: agentBusy ? C.textMuted : "#fff",
                    fontWeight: 700, fontSize: 13,
                    cursor: agentBusy ? "not-allowed" : "pointer",
                    boxShadow: agentBusy ? "none" : `0 0 12px ${C.teal}44`,
                    transition: "all 0.2s",
                  }}
                >
                  {agentBusy
                    ? <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>↻</span>
                    : "Send"}
                </button>
              </div>
            </div>
 
            {/* Quick prompts */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: C.textMuted,
                textTransform: "uppercase", letterSpacing: "0.1em", padding: "0 2px",
              }}>
                Quick Prompts
              </div>
              {[
                { label: "📊 Full EPS status report",       ctx: "ops", msg: "Give a full EPS status report covering battery health, solar performance, and anomaly risk." },
                { label: "🔋 Battery module analysis",      ctx: "ops", msg: "Analyse all three battery modules. Which shows earliest degradation signs and what action do you recommend?" },
                { label: "☀️ Solar efficiency check",       ctx: "ops", msg: "What is our solar panel efficiency and how does it compare to the GaAs BOL spec of 28.5%?" },
                { label: "⚠️ Explain current anomaly",      ctx: "ops", msg: "Explain the current anomaly score and which subsystem is most likely at risk." },
                { label: "🔄 Repurpose vs deorbit",         ctx: "eol", msg: "Should we repurpose this satellite or deploy the drag sail for deorbit? Give a full decision rationale." },
                { label: "🪂 Deorbit timeline estimate",    ctx: "eol", msg: "Estimate the deorbit timeline with the drag sail deployed from the current altitude." },
                { label: "📋 IADC compliance check",        ctx: "eol", msg: "Is this mission IADC 25-year compliant? What is the current debris risk score and how does the drag sail improve it?" },
              ].map((p, i) => (
                <button
                  key={i}
                  className="quick-prompt"
                  onClick={() => {
                    setAgentContext(p.ctx);
                    setMessages(prev => [...prev, { role: "user", content: p.msg }]);
                    triggerAgent(currentRef.current || {}, false, p.msg, p.ctx);
                  }}
                  style={{
                    padding: "10px 14px", borderRadius: 9,
                    border: `1px solid ${C.borderDim}`,
                    background: C.bgCard, color: C.textDim,
                    fontSize: 12, cursor: "pointer", textAlign: "left",
                    fontFamily: SANS, lineHeight: 1.4, transition: "all 0.2s",
                  }}
                >
                  {p.label}
                  {p.ctx === "eol" && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: C.amber }}>EOL</span>
                  )}
                </button>
              ))}
 
              {/* Context info */}
              <div style={{
                marginTop: 8, padding: "12px 14px", borderRadius: 9,
                background: C.bgElevated, border: `1px solid ${C.borderDim}`,
                fontSize: 11, color: C.textMuted, lineHeight: 1.6,
              }}>
                <div style={{ fontWeight: 700, color: C.tealBright, marginBottom: 4 }}>Agent Context</div>
                <div>
                  <strong style={{ color: C.text }}>Operations:</strong> EPS monitoring, fault diagnosis, battery management
                </div>
                <div style={{ marginTop: 4 }}>
                  <strong style={{ color: C.text }}>End-of-Life:</strong> Repurpose scoring, deorbit planning, IADC compliance
                </div>
                <div style={{ marginTop: 8, color: C.textMuted }}>
                  {backendOk
                    ? "🟢 Groq Llama3 backend connected"
                    : "🟡 Offline fallback mode — physics-based responses"}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
 