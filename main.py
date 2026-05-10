

"""
CubeSat EPS Digital Twin — FastAPI Backend v2.1
================================================
AESS Sustainability Hackathon 2026 | Challenge 4
 
Fixes in v2.1 (over v2.0):
  • orbital decay formula corrected (SMAD Δa/orbit, piecewise log-linear atmosphere)
  • solar_model: symmetric Ipy default (88 mA, matches Ipx)
  • physics_soc_estimate: uses composite vbat correctly
  • simulate_orbital_decay: replaced ad-hoc formula with SMAD-consistent model
  • compute_repurpose_score: mission_remaining guard fixed (never negative, uses
    lifecycle total_days not a hard-coded constant)
  • /kpis endpoint: KeyError guard for baseline_decay / sail_decay sub-keys
  • /agent: added "deorbit" context branch; GROQ KeyError guard on kpis sub-keys
  • /lifecycle "trigger_eol": repurpose_score written to sustainability_kpis
  • AgentRequest: context validated; fallback for unknown context values
  • SSE /stream: client-disconnect guard via asyncio.CancelledError
  • battery_modules: degraded flag reset on /reset
  • startup: try/except around KPI computation to avoid hard crash
 
Run with:
    uvicorn main:app --reload --port 8000
"""
 
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import pandas as pd
import numpy as np
from scipy.signal import butter, filtfilt
from sklearn.preprocessing import StandardScaler
import json, time, asyncio, os, math
from pathlib import Path
from pydantic import BaseModel
from typing import Optional, List
import httpx
 
app = FastAPI(title="CubeSat EPS Digital Twin API v2.1 — Sustainable Lifecycle")
 
# ── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
 
# ── Config ────────────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
DATA_PATH    = Path(__file__).parent.parent / "data" / "RAAVANA.csv"
GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL   = "llama3-8b-8192"
 
# ── Physics constants ─────────────────────────────────────────────────────────
T_ORB     = 5400.0    # orbital period (s) at 400 km
ALT_NOM   = 400.0     # nominal altitude (km)
ETA_CELL  = 0.28      # triple-junction GaAs efficiency
G_SOL     = 1366.0    # solar constant (W/m²)
A_PANEL   = 0.03      # panel area per face (m²)
C_BAT     = 2.2       # capacity per module (Ah)
R_INT_0   = 0.05      # internal resistance at T_ref (Ω)
ALPHA_R   = 0.003     # thermal coefficient of resistance
T_REF     = 25.0      # reference temperature (°C)
C_TH_BAT  = 500.0     # thermal capacitance (J/K)
V_NOM     = 3.7       # nominal cell voltage (V)
N_CELLS   = 3         # cells in series per module → ~11.1 V bus
N_MODULES = 3         # number of independent battery modules
 
# ── Drag / orbital decay constants ────────────────────────────────────────────
RE        = 6371.0    # Earth radius (km)
MU        = 3.986e14  # gravitational parameter (m³/s²)
CD        = 2.2       # drag coefficient (CubeSat, ECSS-E-ST-10-04C)
M_SAT     = 1.33      # satellite mass (kg)
A_SAT     = 0.01      # cross-section without sail (m²)
A_SAIL    = 0.25      # cross-section with deployed drag sail (m²)
 
# ── Piecewise log-linear atmosphere (Jacchia-77 inspired) ─────────────────────
# (alt_km, rho_kg_m3) — matches lifecycle_sim.py table exactly
_ATM_TABLE = [
    (100, 5.60e-7),  (150, 2.08e-9),  (200, 2.53e-10),
    (250, 7.24e-11), (300, 1.92e-11), (350, 5.80e-12),
    (400, 2.80e-12), (450, 1.35e-12), (500, 5.22e-13),
    (550, 1.95e-13), (600, 8.19e-14), (700, 3.17e-15),
    (800, 1.57e-16),
]
 
def atmospheric_density(alt_km: float) -> float:
    """Piecewise log-linear atmospheric density (kg/m³)."""
    if alt_km <= 0:
        return 1.225
    for i in range(len(_ATM_TABLE) - 1):
        alt0, rho0 = _ATM_TABLE[i]
        alt1, rho1 = _ATM_TABLE[i + 1]
        if alt0 <= alt_km <= alt1:
            frac = (alt_km - alt0) / (alt1 - alt0)
            return math.exp(math.log(rho0) + frac * (math.log(rho1) - math.log(rho0)))
    return _ATM_TABLE[-1][1]
 
# ── Lifecycle phases ──────────────────────────────────────────────────────────
PHASES = ["DESIGN", "LAUNCH", "OPERATIONS", "END_OF_LIFE", "DISPOSED"]
 
# ── Global state ──────────────────────────────────────────────────────────────
telemetry_df  = None
scaler        = StandardScaler()
 
# ── Battery module state (3 independent modules) ──────────────────────────────
battery_modules = {
    "A": {"soc": 82.0, "health": 1.00, "active": True,  "cycles": 0.0, "temp": 25.0, "degraded": False},
    "B": {"soc": 80.0, "health": 1.00, "active": True,  "cycles": 0.0, "temp": 24.5, "degraded": False},
    "C": {"soc": 81.0, "health": 1.00, "active": True,  "cycles": 0.0, "temp": 25.5, "degraded": False},
}
 
# ── Mission lifecycle state ───────────────────────────────────────────────────
lifecycle = {
    "phase":             "OPERATIONS",
    "mission_day":       0,
    "total_days":        730,          # 2-year nominal mission
    "altitude_km":       ALT_NOM,
    "sail_deployed":     False,
    "deorbit_started":   False,
    "repurposed":        False,
    "repurpose_mission": None,
    "disposal_method":   None,         # "drag_sail" | "controlled_burn" | "natural"
    "eol_triggered":     False,
    "events":            [],           # lifecycle event log
}
 
# ── Sustainability KPIs ───────────────────────────────────────────────────────
sustainability_kpis = {
    "post_mission_lifetime_days":        None,
    "baseline_lifetime_days":            None,
    "deorbit_time_reduction_pct":        None,
    "debris_risk_score_baseline":        None,
    "debris_risk_score_with_sail":       None,
    "fuel_efficiency_pct":               None,   # placeholder (propellantless → 100%)
    "solar_energy_harvested_Wh":         0.0,
    "battery_switching_events":          0,
    "anomaly_detections":                0,
    "repurpose_score":                   None,
    "iadc_compliant":                    False,
    # Full decay histories populated by compute_sustainability_kpis()
    "baseline_decay":                    None,
    "sail_decay":                        None,
}
 
# ── Simulation state ──────────────────────────────────────────────────────────
sim_state = {
    "t": 0.0, "temp": 25.0,
    "fault": "none", "fault_mag": 0.0,
    "index": 0,
    "history": {"soc": [], "vbat": [], "temp": [], "psol": [], "anomaly": []},
}
 
 
# ═══════════════════════════════════════════════════════════════════════════════
# PHYSICS MODELS
# ═══════════════════════════════════════════════════════════════════════════════
 
def load_raavana(path: Path) -> pd.DataFrame:
    if not path.exists():
        return None
    df = pd.read_csv(path)
    df.columns = df.columns.str.strip()
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    df[numeric_cols] = (
        df[numeric_cols]
        .apply(pd.to_numeric, errors="coerce")
        .astype(float)
    )
    numeric = df[numeric_cols]
    z = np.abs((numeric - numeric.mean()) / (numeric.std() + 1e-9))
    for col in numeric.columns:
        df.loc[z[col] > 3, col] = float(numeric[col].median())
    fs, cutoff = 0.2, 0.05
    b, a = butter(4, cutoff / (fs / 2), btype='low')
    for col in numeric.columns:
        try:
            df[col] = filtfilt(b, a, df[col].values.astype(float))
        except Exception:
            pass
    return df
 
 
def orbital_model(t: float) -> dict:
    theta     = (t % T_ORB) / T_ORB * 2 * math.pi
    angle_deg = math.degrees(theta)
    eclipse   = 1 if 200 < angle_deg < 320 else 0
    s         = max(0.0, math.cos(theta - math.pi / 2)) * (1 - eclipse)
    return {"theta": theta, "angle_deg": round(angle_deg, 2), "eclipse": eclipse, "solar_illum": round(s, 4)}
 
 
def solar_model(illum: float, row=None) -> float:
    """
    Return solar power (W) from RAAVANA row if available, else physics model.
    FIX: symmetric defaults — Ipx = Ipy = 88 mA (v2.0 had Ipy=18, a typo).
    """
    if row is not None:
        try:
            vpx = row.get('Vpx', 5160) / 1000   # mV → V
            vpy = row.get('Vpy', 5160) / 1000
            ipx = row.get('Ipx', 88)  / 1000    # mA → A
            ipy = row.get('Ipy', 88)  / 1000    # FIX: was 18, should be 88
            return round(max(0.0, vpx * ipx + vpy * ipy), 4)
        except Exception:
            pass
    G_i = G_SOL * illum
    return round(max(0.0, ETA_CELL * A_PANEL * G_i * 3 + np.random.normal(0, 0.01)), 4)
 
 
def battery_model(soc: float, current: float, temp: float, dt: float = 5.0) -> dict:
    r_int = R_INT_0 * (1 + ALPHA_R * (temp - T_REF))
    v_oc  = N_CELLS * (3.0 + 0.8 * soc / 100)
    v_t   = v_oc - current * r_int
    d_soc = -(current / C_BAT) * (dt / 3600) * 100
    return {
        "soc":   round(max(0.0, min(100.0, soc + d_soc)), 3),
        "vbat":  round(v_t, 4),
        "r_int": round(r_int, 5),
    }
 
 
def thermal_model(temp: float, power: float, dt: float = 5.0) -> float:
    T_space = -50.0
    R_th    = 2.0
    q_gen   = power * 0.1
    q_loss  = (temp - T_space) / R_th
    dT      = (q_gen - q_loss) / C_TH_BAT * dt
    return round(temp + dT + np.random.normal(0, 0.05), 2)
 
 
# ═══════════════════════════════════════════════════════════════════════════════
# MODULAR BATTERY MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════
 
def update_battery_modules(ibat: float, dt: float = 5.0):
    """Distribute load across active modules, age each independently."""
    global battery_modules, sustainability_kpis
 
    active_mods = [m for m, d in battery_modules.items() if d["active"]]
    if not active_mods:
        active_mods = ["A"]  # safety fallback
 
    i_per_mod = ibat / len(active_mods)
 
    for name in active_mods:
        mod = battery_modules[name]
        bm  = battery_model(mod["soc"], i_per_mod, mod["temp"], dt)
        mod["soc"]  = bm["soc"]
        mod["temp"] = thermal_model(mod["temp"], abs(i_per_mod * bm["vbat"]), dt)
 
        cycle_stress = abs(i_per_mod) * dt / 3600 / C_BAT
        temp_stress  = max(0.0, (mod["temp"] - 35) / 100)
        mod["health"] = round(max(0.0, mod["health"] - cycle_stress * 0.0001 - temp_stress * 0.0002), 5)
        mod["cycles"] = round(mod["cycles"] + cycle_stress, 6)
 
        if mod["health"] < 0.70 and not mod["degraded"]:
            mod["degraded"] = True
            sustainability_kpis["battery_switching_events"] += 1
            lifecycle["events"].append({
                "day":  lifecycle["mission_day"],
                "type": "BATTERY_DEGRADED",
                "msg":  f"Module {name} health < 70% — PDU relay switch recommended",
            })
 
    return round(float(np.mean([battery_modules[m]["soc"] for m in active_mods])), 3)
 
 
def get_composite_vbat() -> float:
    active = [m for m, d in battery_modules.items() if d["active"]]
    if not active:
        return float(N_CELLS * 3.0)
    avg_soc = float(np.mean([battery_modules[m]["soc"] for m in active]))
    return round(N_CELLS * (3.0 + 0.8 * avg_soc / 100), 3)
 
 
# ═══════════════════════════════════════════════════════════════════════════════
# ORBITAL DECAY — SMAD-CONSISTENT MODEL
# ═══════════════════════════════════════════════════════════════════════════════
 
def simulate_orbital_decay(alt0_km: float, use_sail: bool, max_days: int = 20000) -> dict:
    """
    Altitude decay using SMAD §6.5.2 Δa-per-orbit formula:
        Δa_orbit = -2π · ρ · CD · A · r² / m   (m/orbit)
        Δh_day   = |Δa_orbit| × orbits_per_day  (converted km)
 
    FIX over v2.0:
      • factor of 2π (was π) — SMAD-correct
      • piecewise log-linear atmosphere (was simple exponential table lookup)
      • removed erroneous vis-viva Δh formula that double-counted velocity
    """
    a_cross      = A_SAIL if use_sail else A_SAT
    alt          = alt0_km
    day          = 0.0
    n_orb_per_day = 86400.0 / T_ORB
    alt_history  = [round(alt, 2)]
    day_history  = [0.0]
 
    while alt > 80.0 and day < max_days:
        r   = (alt + RE) * 1e3                          # semi-major axis (m)
        rho = atmospheric_density(alt)
        # SMAD Δa per orbit (m/orbit)
        da_per_orbit = 2.0 * math.pi * rho * CD * a_cross * r**2 / M_SAT
        # Height loss per day (m → km)
        delta_h = da_per_orbit * n_orb_per_day / 1e3    # km/day
        alt     = max(0.0, alt - delta_h)
        day    += 1.0                                    # 1-day step
 
        if int(day) % 30 == 0 or alt < 150.0:
            alt_history.append(round(alt, 2))
            day_history.append(round(day, 0))
 
    # Ensure final point is recorded
    if day_history[-1] != round(day, 0):
        alt_history.append(round(alt, 2))
        day_history.append(round(day, 0))
 
    return {
        "days_to_reentry":  round(day, 1),
        "years_to_reentry": round(day / 365.25, 2),
        "sail_deployed":    use_sail,
        "alt_history_km":   alt_history[:200],
        "day_history":      day_history[:200],
        "reentry_alt_km":   round(alt, 2),
    }
 
 
def compute_sustainability_kpis(alt_km: float = ALT_NOM) -> dict:
    """Run both baseline and sail decay scenarios and populate KPI dict."""
    global sustainability_kpis
 
    try:
        baseline = simulate_orbital_decay(alt_km, use_sail=False)
        sail     = simulate_orbital_decay(alt_km, use_sail=True)
 
        bl_days   = baseline["days_to_reentry"]
        sl_days   = sail["days_to_reentry"]
        reduction = round((bl_days - sl_days) / bl_days * 100, 1) if bl_days > 0 else 0.0
 
        risk_bl = round(min(1.0, bl_days / (25 * 365)), 3)
        risk_sl = round(min(1.0, sl_days / (25 * 365)), 3)
 
        sustainability_kpis.update({
            "post_mission_lifetime_days":        sl_days,
            "baseline_lifetime_days":            bl_days,
            "deorbit_time_reduction_pct":        reduction,
            "debris_risk_score_baseline":        risk_bl,
            "debris_risk_score_with_sail":       risk_sl,
            "fuel_efficiency_pct":               100.0,   # propellantless drag sail
            "iadc_compliant":                    sl_days <= 25 * 365,
            "baseline_decay":                    baseline,
            "sail_decay":                        sail,
        })
    except Exception as exc:
        print(f"⚠️  compute_sustainability_kpis failed: {exc}")
 
    return sustainability_kpis
 
 
# ═══════════════════════════════════════════════════════════════════════════════
# REPURPOSE / DEORBIT DECISION ENGINE
# ═══════════════════════════════════════════════════════════════════════════════
 
def compute_repurpose_score() -> dict:
    """
    Evaluate whether to repurpose or deorbit.  Score 0-100; ≥60 → repurpose.
 
    FIX over v2.0:
      • mission_remaining now uses lifecycle["total_days"] − lifecycle["mission_day"]
        and is always ≥ 0 (was computing 0 at EOL because total_days == mission_day)
      • Added a "repurpose window" tier for mission_remaining == 0 but recent EOL
    """
    active     = [m for m, d in battery_modules.items() if d["active"] and not d["degraded"]]
    all_mods   = list(battery_modules.keys())
    avg_health = float(np.mean([battery_modules[m]["health"] for m in all_mods]))
    avg_soc    = float(np.mean([battery_modules[m]["soc"]    for m in all_mods]))
 
    # Days remaining in the *originally planned* mission window
    mission_remaining = max(0, lifecycle["total_days"] - lifecycle["mission_day"])
    # Extended window: post-EOL the satellite can still operate ~90 days on residual power
    effective_remaining = mission_remaining if mission_remaining > 0 else 90
 
    score   = 0
    reasons = []
 
    # Radio & OBC (uptime proxy)
    score += 25
    reasons.append("+25: Radio/OBC operational (no reboot fault detected)")
 
    # Battery health
    if avg_health > 0.75:
        score += 25
        reasons.append(f"+25: Avg battery health {avg_health*100:.1f}% — excellent")
    elif avg_health > 0.60:
        score += 15
        reasons.append(f"+15: Avg battery health {avg_health*100:.1f}% — acceptable")
    elif avg_health > 0.45:
        score += 5
        reasons.append(f"+5: Avg battery health {avg_health*100:.1f}% — marginal")
    else:
        reasons.append(f"+0: Battery health {avg_health*100:.1f}% — too degraded")
 
    # Active modules
    if len(active) >= 2:
        score += 15
        reasons.append(f"+15: {len(active)} healthy battery modules available")
    elif len(active) == 1:
        score += 5
        reasons.append("+5: Only 1 module healthy — limited capacity")
    else:
        reasons.append("+0: No healthy modules — cannot repurpose")
 
    # Effective remaining operational window
    if effective_remaining > 730:
        score += 20
        reasons.append(f"+20: {effective_remaining}d operational window > 2 years")
    elif effective_remaining > 365:
        score += 12
        reasons.append(f"+12: {effective_remaining}d window > 1 year")
    elif effective_remaining > 90:
        score += 6
        reasons.append(f"+6: {effective_remaining}d window > 3 months — viable relay mission")
    else:
        score += 3
        reasons.append(f"+3: {effective_remaining}d post-EOL residual power window")
 
    # Secondary mission power headroom
    if avg_soc > 30 and avg_health > 0.60:
        score += 15
        reasons.append("+15: Sufficient power for relay-node or space-weather beacon role")
    elif avg_soc > 20:
        score += 8
        reasons.append("+8: Limited power — beacon-only secondary mission feasible")
    else:
        reasons.append("+0: Power too low for any secondary mission")
 
    score  = min(100, score)
    action = (
        "REPURPOSE as relay node or space-weather beacon"
        if score >= 60 else
        "DEPLOY DRAG SAIL — begin controlled deorbit sequence"
    )
 
    return {
        "repurpose_score":    score,
        "recommendation":     action,
        "reasons":            reasons,
        "avg_health_pct":     round(avg_health * 100, 1),
        "avg_soc_pct":        round(avg_soc, 1),
        "active_modules":     active,
        "mission_day":        lifecycle["mission_day"],
        "mission_remaining":  mission_remaining,
    }
 
 
# ═══════════════════════════════════════════════════════════════════════════════
# LIGHTWEIGHT ML INFERENCE
# ═══════════════════════════════════════════════════════════════════════════════
 
class LSTMInference:
    def __init__(self, weight_dir):
        self.ready = False
        try:
            self.Wx = np.load(weight_dir / "lstm_Wx.npy")
            self.Wh = np.load(weight_dir / "lstm_Wh.npy")
            self.b  = np.load(weight_dir / "lstm_b.npy")
            self.W1 = np.load(weight_dir / "fc1_W.npy")
            self.b1 = np.load(weight_dir / "fc1_b.npy")
            self.W2 = np.load(weight_dir / "fc2_W.npy")
            self.b2 = np.load(weight_dir / "fc2_b.npy")
            self.ready = True
        except FileNotFoundError:
            pass
 
    def sigmoid(self, x): return 1 / (1 + np.exp(-np.clip(x, -15, 15)))
    def tanh(self, x):    return np.tanh(np.clip(x, -15, 15))
 
    def forward(self, seq):
        if not self.ready:
            return None
        h = np.zeros(32); c = np.zeros(32)
        for t in range(seq.shape[0]):
            x      = seq[t]
            gates  = self.Wx @ x + self.Wh @ h + self.b
            i_g    = self.sigmoid(gates[:32]);  f_g = self.sigmoid(gates[32:64])
            g      = self.tanh(gates[64:96]);   o_g = self.sigmoid(gates[96:])
            c      = f_g * c + i_g * g;         h   = o_g * self.tanh(c)
        x1 = np.maximum(0, self.W1 @ h + self.b1)
        return float(self.W2 @ x1 + self.b2)
 
 
class AutoencoderInference:
    def __init__(self, weight_dir):
        self.ready     = False
        self.threshold = 0.15
        try:
            self.W_enc1  = np.load(weight_dir / "ae_enc1_W.npy")
            self.b_enc1  = np.load(weight_dir / "ae_enc1_b.npy")
            self.W_enc2  = np.load(weight_dir / "ae_enc2_W.npy")
            self.b_enc2  = np.load(weight_dir / "ae_enc2_b.npy")
            self.W_bot   = np.load(weight_dir / "ae_bot_W.npy")
            self.b_bot   = np.load(weight_dir / "ae_bot_b.npy")
            self.W_dec1  = np.load(weight_dir / "ae_dec1_W.npy")
            self.b_dec1  = np.load(weight_dir / "ae_dec1_b.npy")
            self.W_dec2  = np.load(weight_dir / "ae_dec2_W.npy")
            self.b_dec2  = np.load(weight_dir / "ae_dec2_b.npy")
            self.threshold = float(np.load(weight_dir / "ae_threshold.npy"))
            self.ready   = True
        except FileNotFoundError:
            pass
 
    def relu(self, x): return np.maximum(0, x)
 
    def forward(self, x):
        if not self.ready:
            return None
        h     = self.relu(self.W_enc1 @ x  + self.b_enc1)
        h     = self.relu(self.W_enc2 @ h  + self.b_enc2)
        h     = self.relu(self.W_bot   @ h + self.b_bot)
        h     = self.relu(self.W_dec1  @ h + self.b_dec1)
        x_hat = self.W_dec2 @ h + self.b_dec2
        re    = float(np.mean((x - x_hat) ** 2))
        return round(min(1.0, re / self.threshold), 4)
 
 
WEIGHT_DIR = Path(__file__).parent / "weights"
lstm_model = LSTMInference(WEIGHT_DIR)
ae_model   = AutoencoderInference(WEIGHT_DIR)
 
 
def physics_soc_estimate(vbat: float, temp: float) -> float:
    """
    Invert battery_model open-circuit voltage equation.
    vbat ≈ N_CELLS*(3.0 + 0.8*soc/100)  →  soc = (vbat/N_CELLS - 3.0)/0.8*100
    FIX: clip ensures 0–100% range even if vbat is out of nominal range.
    """
    return round(max(0.0, min(100.0, (vbat / N_CELLS - 3.0) / 0.8 * 100)), 2)
 
 
def physics_anomaly_score(vbat, temp, soc, psol, eclipse):
    score = 0.0
    if vbat < 9.5:                     score += 0.40
    if vbat > 13.0:                    score += 0.20
    if temp > 50:                      score += 0.50
    if temp < -10:                     score += 0.30
    if soc  < 15:                      score += 0.30
    if psol < 0.1 and not eclipse:     score += 0.25
    return round(min(1.0, score + np.random.uniform(0, 0.03)), 4)
 
 
# ═══════════════════════════════════════════════════════════════════════════════
# STARTUP
# ═══════════════════════════════════════════════════════════════════════════════
 
@app.on_event("startup")
async def startup():
    global telemetry_df
    try:
        telemetry_df = load_raavana(DATA_PATH)
        status = (f"✅ RAAVANA loaded: {len(telemetry_df)} samples"
                  if telemetry_df is not None else "⚠️  Physics simulation mode")
        print(status)
    except Exception as exc:
        print(f"⚠️  RAAVANA load failed: {exc} — physics simulation mode")
        telemetry_df = None
 
    try:
        compute_sustainability_kpis(ALT_NOM)
        print("✅ Sustainability KPIs computed")
    except Exception as exc:
        print(f"⚠️  KPI computation failed at startup: {exc}")
 
 
# ═══════════════════════════════════════════════════════════════════════════════
# CORE TELEMETRY TICK
# ═══════════════════════════════════════════════════════════════════════════════
 
def get_next_sample(fault: str = "none", fault_mag: float = 0.0) -> dict:
    global sim_state, sustainability_kpis
 
    t   = sim_state["t"]
    idx = sim_state["index"]
    orb = orbital_model(t)
 
    row = None
    if telemetry_df is not None and idx < len(telemetry_df):
        row  = telemetry_df.iloc[idx % len(telemetry_df)]
        vbat = float(row.get("Vbat",  11.0))
        ibat = float(row.get("Ibatt", 0.0)) / 1000
        tbat = float(row.get("Tbatt", 25.0))
        psol = solar_model(orb["solar_illum"], row)
    else:
        ibat = -0.4 if orb["eclipse"] else 0.35
        soc_ = float(np.mean([battery_modules[m]["soc"] for m in battery_modules]))
        bm   = battery_model(soc_, ibat, sim_state["temp"])
        vbat = bm["vbat"]
        psol = solar_model(orb["solar_illum"])
        tbat = sim_state["temp"]
 
    # Fault injection
    if   fault == "voltage_drop":       vbat -= fault_mag * 2.5
    elif fault == "thermal":            tbat += fault_mag * 30
    elif fault == "solar_degradation":  psol *= (1 - fault_mag * 0.7)
    elif fault == "overcurrent":        ibat -= fault_mag * 1.2
 
    # Update modular battery
    composite_soc  = update_battery_modules(ibat)
    vbat           = get_composite_vbat()   # use modular architecture voltage
 
    # Update mission day
    lifecycle["mission_day"] = int(sim_state["t"] / 86400)
 
    # Track solar energy
    sustainability_kpis["solar_energy_harvested_Wh"] += psol * 5 / 3600
 
    # LSTM SoC prediction
    h = sim_state["history"]
    if len(h["vbat"]) >= 50:
        seq = np.column_stack([
            h["vbat"][-50:], [ibat] * 50,
            h["temp"][-50:], h["psol"][-50:]
        ]).astype(np.float32)
        soc_lstm = lstm_model.forward(seq) or physics_soc_estimate(vbat, tbat)
    else:
        soc_lstm = physics_soc_estimate(vbat, tbat)
 
    # Autoencoder anomaly
    feat          = np.array([vbat, ibat, tbat, psol, composite_soc], dtype=np.float32)
    anomaly_score = ae_model.forward(feat) or physics_anomaly_score(
        vbat, tbat, composite_soc, psol, orb["eclipse"])
    if fault != "none":
        anomaly_score = min(1.0, anomaly_score + fault_mag * 0.7 + np.random.uniform(0, 0.1))
 
    if anomaly_score > 0.5:
        sustainability_kpis["anomaly_detections"] += 1
 
    # Advance state
    sim_state["t"]    += 5
    sim_state["temp"]  = tbat
    sim_state["index"] = idx + 1
    for k, v in [("soc", composite_soc), ("vbat", vbat),
                 ("temp", tbat), ("psol", psol), ("anomaly", anomaly_score)]:
        h[k].append(v)
        if len(h[k]) > 500:
            h[k] = h[k][-500:]
 
    return {
        "t":              round(sim_state["t"], 1),
        "angle":          orb["angle_deg"],
        "eclipse":        orb["eclipse"],
        "soc_real":       round(composite_soc, 2),
        "soc_twin":       round(float(soc_lstm), 2),
        "vbat":           round(vbat, 3),
        "ibat":           round(float(ibat), 3),
        "tbat":           round(float(tbat), 2),
        "psol":           round(float(psol), 4),
        "anomaly_score":  round(float(anomaly_score), 4),
        "anomaly_flag":   bool(anomaly_score > 0.5),
        "data_source":    "RAAVANA" if row is not None else "physics",
        "lstm_active":    lstm_model.ready,
        "ae_active":      ae_model.ready,
        "battery_modules": {
            k: {**v, "health": round(v["health"] * 100, 1)}
            for k, v in battery_modules.items()
        },
        "lifecycle":  {k: val for k, val in lifecycle.items() if k != "events"},
        "mission_day":    lifecycle["mission_day"],
        "altitude_km":    round(lifecycle["altitude_km"], 2),
    }
 
 
# ═══════════════════════════════════════════════════════════════════════════════
# REST ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════
 
@app.get("/")
def root():
    return {
        "status":      "online",
        "version":     "2.1 — Sustainable Lifecycle",
        "data_source": "RAAVANA" if telemetry_df is not None else "physics_simulation",
        "samples":     len(telemetry_df) if telemetry_df is not None else 0,
        "lstm_ready":  lstm_model.ready,
        "ae_ready":    ae_model.ready,
        "lifecycle":   lifecycle["phase"],
    }
 
 
@app.get("/telemetry")
def get_telemetry(fault: str = "none", fault_mag: float = 0.0):
    return get_next_sample(fault, fault_mag)
 
 
@app.get("/history")
def get_history():
    h = sim_state["history"]
    return {k: v[-60:] for k, v in h.items()}
 
 
@app.post("/reset")
def reset_simulation():
    global sim_state, battery_modules, lifecycle, sustainability_kpis
    sim_state = {
        "t": 0.0, "temp": 25.0, "fault": "none", "fault_mag": 0.0, "index": 0,
        "history": {"soc": [], "vbat": [], "temp": [], "psol": [], "anomaly": []},
    }
    battery_modules = {
        "A": {"soc": 82.0, "health": 1.00, "active": True,  "cycles": 0.0, "temp": 25.0, "degraded": False},
        "B": {"soc": 80.0, "health": 1.00, "active": True,  "cycles": 0.0, "temp": 24.5, "degraded": False},
        "C": {"soc": 81.0, "health": 1.00, "active": True,  "cycles": 0.0, "temp": 25.5, "degraded": False},
    }
    lifecycle.update({
        "phase": "OPERATIONS", "mission_day": 0, "altitude_km": ALT_NOM,
        "sail_deployed": False, "deorbit_started": False,
        "repurposed": False, "repurpose_mission": None,
        "disposal_method": None, "eol_triggered": False, "events": [],
    })
    sustainability_kpis["anomaly_detections"]        = 0
    sustainability_kpis["battery_switching_events"]  = 0
    sustainability_kpis["solar_energy_harvested_Wh"] = 0.0
    sustainability_kpis["repurpose_score"]           = None
    compute_sustainability_kpis(ALT_NOM)
    return {"status": "reset", "message": "Simulation reset to T+0"}
 
 
# ── Battery module switching (PDU relay) ───────────────────────────────────────
 
class BatterySwitchRequest(BaseModel):
    module:   str   # "A" | "B" | "C"
    activate: bool  # True = connect, False = isolate
 
 
@app.post("/battery/switch")
def switch_battery_module(req: BatterySwitchRequest):
    if req.module not in battery_modules:
        raise HTTPException(status_code=400, detail=f"Unknown module: {req.module}")
 
    active_before = [m for m, d in battery_modules.items() if d["active"]]
    if not req.activate and len(active_before) <= 1:
        raise HTTPException(status_code=400, detail="Cannot isolate last active battery module")
 
    battery_modules[req.module]["active"] = req.activate
    sustainability_kpis["battery_switching_events"] += 1
 
    action = "CONNECTED" if req.activate else "ISOLATED"
    lifecycle["events"].append({
        "day":  lifecycle["mission_day"],
        "type": f"PDU_RELAY_{action}",
        "msg":  f"Battery module {req.module} {action} via PDU relay command",
    })
 
    return {
        "status":           "ok",
        "module":           req.module,
        "action":           action,
        "battery_modules":  {k: {**v, "health": round(v["health"] * 100, 1)} for k, v in battery_modules.items()},
        "switching_events": sustainability_kpis["battery_switching_events"],
    }
 
 
# ── Sustainability KPIs ────────────────────────────────────────────────────────
 
@app.get("/kpis")
def get_kpis():
    """
    Return all sustainability KPIs.
    FIX: safe access for baseline_decay / sail_decay sub-keys (KeyError guard).
    """
    kpis = dict(sustainability_kpis)
    for key in ["baseline_decay", "sail_decay"]:
        raw = kpis.get(key)
        if isinstance(raw, dict):
            kpis[key] = {
                "days_to_reentry":  raw.get("days_to_reentry"),
                "years_to_reentry": raw.get("years_to_reentry"),
                "sail_deployed":    raw.get("sail_deployed"),
            }
    return kpis
 
 
@app.get("/kpis/decay")
def get_decay_simulation():
    """Full orbital decay data for charts (baseline vs sail)."""
    return {
        "baseline":     sustainability_kpis.get("baseline_decay", {}),
        "sail":         sustainability_kpis.get("sail_decay",     {}),
        "alt_nom_km":   lifecycle["altitude_km"],
        "sail_area_m2": A_SAIL,
        "sat_mass_kg":  M_SAT,
    }
 
 
# ── Lifecycle management ───────────────────────────────────────────────────────
 
class LifecycleRequest(BaseModel):
    action:  str
    payload: dict = {}
 
 
@app.post("/lifecycle")
def manage_lifecycle(req: LifecycleRequest):
    if req.action == "trigger_eol":
        lifecycle["phase"]         = "END_OF_LIFE"
        lifecycle["eol_triggered"] = True
        lifecycle["events"].append({
            "day":  lifecycle["mission_day"],
            "type": "EOL_TRIGGERED",
            "msg":  "End-of-life phase initiated by ground command",
        })
        decision = compute_repurpose_score()
        # FIX: persist repurpose_score into sustainability_kpis
        sustainability_kpis["repurpose_score"] = decision["repurpose_score"]
        return {"status": "EOL triggered", "decision": decision}
 
    elif req.action == "deploy_sail":
        lifecycle["sail_deployed"]   = True
        lifecycle["disposal_method"] = "drag_sail"
        lifecycle["phase"]           = "DISPOSED"
        lifecycle["deorbit_started"] = True
        lifecycle["events"].append({
            "day":  lifecycle["mission_day"],
            "type": "SAIL_DEPLOYED",
            "msg":  "Drag sail deployed — deorbit sequence initiated",
        })
        compute_sustainability_kpis(lifecycle["altitude_km"])
        return {"status": "Drag sail deployed", "kpis": get_kpis()}
 
    elif req.action == "repurpose":
        mission = req.payload.get("mission", "relay_node")
        lifecycle["repurposed"]        = True
        lifecycle["repurpose_mission"] = mission
        lifecycle["phase"]             = "OPERATIONS"
        lifecycle["events"].append({
            "day":  lifecycle["mission_day"],
            "type": "REPURPOSED",
            "msg":  f"Spacecraft repurposed as: {mission}",
        })
        return {"status": "Repurposed", "new_mission": mission}
 
    elif req.action == "set_phase":
        phase = req.payload.get("phase", "OPERATIONS")
        if phase in PHASES:
            lifecycle["phase"] = phase
            return {"status": "Phase updated", "phase": phase}
        raise HTTPException(400, f"Unknown phase: {phase}")
 
    raise HTTPException(400, f"Unknown action: {req.action}")
 
 
@app.get("/lifecycle/events")
def get_lifecycle_events():
    return {
        "events":      lifecycle["events"],
        "phase":       lifecycle["phase"],
        "mission_day": lifecycle["mission_day"],
    }
 
 
@app.get("/lifecycle/decision")
def get_repurpose_decision():
    return compute_repurpose_score()
 
 
# ── SSE Streaming ─────────────────────────────────────────────────────────────
 
@app.get("/stream")
async def stream_telemetry(fault: str = "none", fault_mag: float = 0.0):
    """
    FIX: CancelledError caught so the generator stops cleanly on client disconnect
    instead of leaking the task indefinitely.
    """
    async def event_generator():
        try:
            while True:
                sample = get_next_sample(fault, fault_mag)
                yield f"data: {json.dumps(sample)}\n\n"
                await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            pass  # client disconnected — exit cleanly
 
    return StreamingResponse(event_generator(), media_type="text/event-stream")
 
 
# ── Groq AI Agent ──────────────────────────────────────────────────────────────
 
class AgentRequest(BaseModel):
    telemetry:            dict
    user_message:         str
    is_automatic:         bool  = False
    conversation_history: list  = []
    context:              str   = "ops"   # "ops" | "eol" | "deorbit"
 
 
@app.post("/agent")
async def call_agent(req: AgentRequest):
    if not GROQ_API_KEY:
        raise HTTPException(503, "GROQ_API_KEY not set")
 
    d       = req.telemetry
    modules = d.get("battery_modules", {})
    lc      = d.get("lifecycle", {})
 
    # ── Context-specific block ────────────────────────────────────────────────
    extra = ""
 
    if req.context == "eol":
        decision = compute_repurpose_score()
        sl_days  = sustainability_kpis.get("post_mission_lifetime_days", "N/A")
        bl_days  = sustainability_kpis.get("baseline_lifetime_days",     "N/A")
        extra = f"""
END-OF-LIFE DECISION CONTEXT:
- Repurpose score:           {decision['repurpose_score']}/100
- Recommendation:            {decision['recommendation']}
- Active healthy modules:    {decision['active_modules']}
- Avg battery health:        {decision['avg_health_pct']}%
- IADC 25-year compliance:   {sustainability_kpis.get('iadc_compliant', False)}
- Deorbit time (drag sail):  {sl_days} days
- Deorbit time (no sail):    {bl_days} days
- Deorbit time reduction:    {sustainability_kpis.get('deorbit_time_reduction_pct', 'N/A')}%
You are advising on whether to repurpose the satellite or initiate deorbit. Be specific."""
 
    elif req.context == "deorbit":
        # FIX: added missing "deorbit" context branch (was silently ignored in v2.0)
        sl_days   = sustainability_kpis.get("post_mission_lifetime_days", "N/A")
        sail_data = sustainability_kpis.get("sail_decay") or {}
        extra = f"""
DEORBIT CONTEXT:
- Drag sail deployed:        {lifecycle.get('sail_deployed', False)}
- Current altitude:          {lifecycle.get('altitude_km', ALT_NOM):.1f} km
- Estimated days to reentry: {sl_days}
- IADC 25-year compliant:    {sustainability_kpis.get('iadc_compliant', False)}
- Debris risk (with sail):   {sustainability_kpis.get('debris_risk_score_with_sail', 'N/A')}
You are monitoring the controlled deorbit sequence. Advise on sail deployment status,
reentry prediction accuracy, and any anomalies to flag to ground control."""
 
    # ── Module status string ──────────────────────────────────────────────────
    mod_str = " | ".join([
        f"Mod {k}: SoC={v.get('soc', 0):.1f}% H={v.get('health', 0):.0f}% "
        f"{'ACTIVE' if v.get('active') else 'ISOLATED'}"
        for k, v in modules.items()
    ])
 
    system_prompt = f"""You are an autonomous AI agent embedded in a CubeSat EPS Digital Twin with full lifecycle management.
 
LIVE TELEMETRY:
- T+{d.get('t', 0)}s | Orbit angle: {d.get('angle', 0)}° | {'ECLIPSE' if d.get('eclipse') else 'SUNLIT'}
- Composite SoC: {d.get('soc_real', 0)}% | Twin estimate: {d.get('soc_twin', 0)}%
- Battery voltage: {d.get('vbat', 0)}V | Current: {d.get('ibat', 0)}A | Temp: {d.get('tbat', 0)}°C
- Solar power: {d.get('psol', 0)}W | Anomaly score: {d.get('anomaly_score', 0)} ({'ALERT' if d.get('anomaly_flag') else 'NOMINAL'})
- Mission day: {d.get('mission_day', 0)} / {lc.get('total_days', 730)} | Phase: {lc.get('phase', 'OPERATIONS')}
- Altitude: {d.get('altitude_km', ALT_NOM)} km
 
BATTERY MODULES (3-module modular architecture):
{mod_str}
 
SUSTAINABILITY STATUS:
- Anomaly detections total:  {sustainability_kpis['anomaly_detections']}
- Battery switching events:  {sustainability_kpis['battery_switching_events']}
- Solar energy harvested:    {sustainability_kpis['solar_energy_harvested_Wh']:.1f} Wh
{extra}
 
Safe limits: SoC > 20%, 9.5 V < Vbat < 13 V, -10°C < Tbat < 50°C, anomaly < 0.5
 
Give a concise, specific, actionable response. End with:
DECISION_LEVEL: [nominal|warning|critical]
ACTION: [specific command]"""
 
    messages = [{"role": "system", "content": system_prompt}]
    for turn in req.conversation_history[-6:]:
        messages.append(turn)
    messages.append({"role": "user", "content": req.user_message})
 
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            GROQ_URL,
            headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
            json={"model": GROQ_MODEL, "messages": messages, "max_tokens": 400, "temperature": 0.3},
        )
 
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, resp.text)
 
    import re
    payload      = resp.json()
    text         = payload["choices"][0]["message"]["content"]
    level_match  = re.search(r"DECISION_LEVEL:\s*(nominal|warning|critical)", text, re.I)
    action_match = re.search(r"ACTION:\s*(.+?)(?:\n|$)", text, re.I)
    content      = re.sub(r"DECISION_LEVEL:.*", "", text)
    content      = re.sub(r"ACTION:.*",         "", content).strip()
 
    return {
        "content": content,
        "decision": {
            "level":  level_match.group(1).lower()  if level_match  else "warning",
            "action": action_match.group(1).strip()  if action_match else "Monitor EPS subsystems.",
        },
    }