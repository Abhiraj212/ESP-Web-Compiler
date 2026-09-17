/* ==========================================================================
   GRAIN GUARD — Hardware Data Layer Configuration
   Enter your NodeMCU's local IP address below once it is on the network.
   Example: NODEMCU_URL: "http://192.168.1.100"
   ========================================================================== */
const CONFIG = {
    NODEMCU_URL: "",
    UPDATE_INTERVAL: 3000
};

const SHOW_INTRO = true;

/* ==========================================================================
   Internal state
   ========================================================================== */
const sensorState = {
    sensor1: { temperature: null, humidity: null, status: "offline" },
    sensor2: { temperature: null, humidity: null, status: "offline" },
    sensor3: { temperature: null, humidity: null, status: "offline" }
};

let nodeMcuOnline = false;
let pollTimer = null;

const LS_KEYS = {
    LIMITS: "grainguard_limits_v1",
    READINGS: "grainguard_readings_v1"
};

/* ==========================================================================
   Boot sequence
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
    if (SHOW_INTRO) {
        runIntro();
    } else {
        document.getElementById("intro").classList.add("hidden");
        document.getElementById("app").classList.remove("hidden");
    }

    setupNav();
    setupRangeTabs();
    setupLimits();
    setupExport();
    startClock();
    renderAllMeters();
    renderSensorTiles();
    renderGraphs();
    updateWarningPanel();

    getSensorData();
    pollTimer = setInterval(getSensorData, CONFIG.UPDATE_INTERVAL);
});

/* ==========================================================================
   Intro animation — particles forming a leaf silhouette, then text reveal
   ========================================================================== */
function runIntro() {
    const introEl = document.getElementById("intro");
    const canvas = document.getElementById("introCanvas");
    const ctx = canvas.getContext("2d");
    let w, h;

    function resize() {
        w = canvas.width = canvas.offsetWidth * devicePixelRatio;
        h = canvas.height = canvas.offsetHeight * devicePixelRatio;
    }
    resize();
    window.addEventListener("resize", resize);

    // Build a rough leaf-shaped point cloud as particle targets
    function leafPoints(count) {
        const pts = [];
        const cx = w / 2, cy = h / 2;
        const scale = Math.min(w, h) * 0.011;
        for (let i = 0; i < count; i++) {
            const t = (i / count) * Math.PI * 2;
            // leaf outline via polar rose-like curve
            const r = (1 + Math.cos(t)) * 60 * scale * 0.6;
            const x = cx + Math.cos(t) * r;
            const y = cy - 40 * scale + Math.sin(t) * r * 1.3;
            pts.push({ x, y });
        }
        // add a stem/vein line
        for (let i = 0; i < count * 0.15; i++) {
            const f = i / (count * 0.15);
            pts.push({ x: cx, y: cy - 40 * scale + f * 90 * scale });
        }
        return pts;
    }

    const PARTICLE_COUNT = 140;
    const targets = leafPoints(PARTICLE_COUNT);
    const particles = targets.map(t => ({
        x: Math.random() * w,
        y: Math.random() * h,
        tx: t.x,
        ty: t.y,
        vx: 0,
        vy: 0,
        r: 1.4 + Math.random() * 1.8
    }));

    let frame = 0;
    const maxFrames = 130;
    let rafId;

    function tick() {
        frame++;
        ctx.clearRect(0, 0, w, h);
        const progress = Math.min(frame / maxFrames, 1);
        const ease = 1 - Math.pow(1 - progress, 3);

        particles.forEach(p => {
            const dx = p.tx - p.x;
            const dy = p.ty - p.y;
            p.vx += dx * 0.02 * ease;
            p.vy += dy * 0.02 * ease;
            p.vx *= 0.82;
            p.vy *= 0.82;
            p.x += p.vx;
            p.y += p.vy;

            ctx.beginPath();
            ctx.fillStyle = `rgba(47,145,83,${0.35 + ease * 0.55})`;
            ctx.arc(p.x, p.y, p.r * devicePixelRatio, 0, Math.PI * 2);
            ctx.fill();
        });

        if (frame < maxFrames + 20) {
            rafId = requestAnimationFrame(tick);
        }
    }
    tick();

    const seq = [
        { id: "introTitle", delay: 900 },
        { id: "introSubtitle", delay: 1250 },
        { id: "introMade", delay: 2100 },
        { id: "introAuthor", delay: 2350 }
    ];
    seq.forEach(s => {
        setTimeout(() => {
            const el = document.getElementById(s.id);
            if (el) el.classList.add("show");
        }, s.delay);
    });

    setTimeout(() => {
        cancelAnimationFrame(rafId);
        introEl.classList.add("fade-out");
        document.getElementById("app").classList.remove("hidden");
        setTimeout(() => introEl.classList.add("hidden"), 650);
    }, 3200);
}

/* ==========================================================================
   Navigation
   ========================================================================== */
function setupNav() {
    const items = document.querySelectorAll(".nav-item");
    items.forEach(btn => {
        btn.addEventListener("click", () => {
            items.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const view = btn.dataset.view;
            document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
            document.getElementById("view-" + view).classList.add("active");
            window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
        });
    });
}

/* ==========================================================================
   Live clock
   ========================================================================== */
function startClock() {
    function tick() {
        const now = new Date();
        const dateStr = now.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
        const timeStr = now.toLocaleTimeString(undefined, { hour12: false });
        const dateEl = document.getElementById("heroDate");
        const timeEl = document.getElementById("heroTime");
        if (dateEl) dateEl.textContent = dateStr;
        if (timeEl) timeEl.textContent = timeStr;
    }
    tick();
    setInterval(tick, 1000);
}

// ========================================
// NODEMCU HARDWARE CONNECTION
// ========================================
// Everything that talks to the physical NodeMCU lives in this section only.
// To connect your hardware, set CONFIG.NODEMCU_URL at the top of this file
// (e.g. "http://192.168.1.100") — nothing else in this file needs to change.
async function getSensorData() {
    if (!CONFIG.NODEMCU_URL) {
        setHardwareOffline();
        return;
    }
    try {
        const res = await fetch(CONFIG.NODEMCU_URL + "/api/sensors", { cache: "no-store" });
        if (!res.ok) throw new Error("Bad response");
        const data = await res.json();
        handleSensorPayload(data);
    } catch (err) {
        setHardwareOffline();
    }
}

function setHardwareOffline() {
    nodeMcuOnline = false;
    ["sensor1", "sensor2", "sensor3"].forEach(id => {
        sensorState[id].temperature = null;
        sensorState[id].humidity = null;
        sensorState[id].status = "offline";
    });
    renderAllMeters();
    renderSensorTiles();
    updateSystemStatus();
    updateWarningPanel();
}

function handleSensorPayload(data) {
    nodeMcuOnline = true;
    ["sensor1", "sensor2", "sensor3"].forEach(id => {
        if (data[id] && typeof data[id].temperature === "number" && typeof data[id].humidity === "number") {
            sensorState[id].temperature = data[id].temperature;
            sensorState[id].humidity = data[id].humidity;
            sensorState[id].status = "online";
        } else {
            sensorState[id].temperature = null;
            sensorState[id].humidity = null;
            sensorState[id].status = "offline";
        }
    });

    recordReadingIfComplete();
    renderAllMeters();
    renderSensorTiles();
    updateSystemStatus();
    updateWarningPanel();
    renderGraphs();
}
// ========================================
// END NODEMCU HARDWARE CONNECTION
// ========================================

/* ==========================================================================
   Averages
   ========================================================================== */
function getAverages() {
    const temps = ["sensor1", "sensor2", "sensor3"].map(id => sensorState[id].temperature).filter(v => typeof v === "number");
    const hums = ["sensor1", "sensor2", "sensor3"].map(id => sensorState[id].humidity).filter(v => typeof v === "number");
    const avgTemp = temps.length === 3 ? temps.reduce((a, b) => a + b, 0) / 3 : null;
    const avgHum = hums.length === 3 ? hums.reduce((a, b) => a + b, 0) / 3 : null;
    return { avgTemp, avgHum };
}

/* ==========================================================================
   Rendering: circular meters
   ========================================================================== */
const RING_CIRC = 2 * Math.PI * 52;

function setRing(fgId, pct, colorVar) {
    const fg = document.getElementById(fgId);
    if (!fg) return;
    const clamped = Math.max(0, Math.min(1, pct));
    fg.style.strokeDasharray = RING_CIRC;
    fg.style.strokeDashoffset = RING_CIRC * (1 - clamped);
    if (colorVar) fg.style.stroke = colorVar;
}

function renderAllMeters() {
    const { avgTemp, avgHum } = getAverages();
    const limits = getLimits();

    const tempEl = document.getElementById("tempValue");
    const humEl = document.getElementById("humValue");

    if (avgTemp !== null) {
        tempEl.textContent = avgTemp.toFixed(1) + " °C";
        document.querySelector("#ringTemp .meter-sub").textContent = "Live reading";
        const pct = limitPct(avgTemp, limits.temp);
        setRing("ringTempFg", pct.pct, pct.color);
    } else {
        tempEl.textContent = "-- °C";
        document.querySelector("#ringTemp .meter-sub").textContent = "No readings";
        setRing("ringTempFg", 0.12, "var(--green-600)");
    }

    if (avgHum !== null) {
        humEl.textContent = avgHum.toFixed(1) + " %RH";
        document.querySelector("#ringHum .meter-sub").textContent = "Live reading";
        const pct = limitPct(avgHum, limits.hum);
        setRing("ringHumFg", pct.pct, pct.color);
    } else {
        humEl.textContent = "-- %RH";
        document.querySelector("#ringHum .meter-sub").textContent = "No readings";
        setRing("ringHumFg", 0.12, "var(--green-600)");
    }

    // Air quality — no sensor present on this prototype; ring is decorative/categorical
    document.getElementById("airValue").textContent = "Not connected";
    setRing("ringAirFg", 0.92, "var(--green-600)");

    // Storage condition summary — categorical ring, always mostly filled
    const condEl = document.getElementById("condValue");
    const condSub = document.querySelector("#ringCond .meter-sub");
    if (avgTemp === null && avgHum === null) {
        condEl.textContent = "Waiting for data";
        condSub.textContent = "Limits not evaluated";
        setRing("ringCondFg", 0.92, "var(--green-600)");
    } else {
        const state = evaluateWarningState();
        condEl.textContent = state.label;
        condSub.textContent = state.sub;
        setRing("ringCondFg", 0.92, state.color);
    }

    // Compare cards
    document.getElementById("cmpInTemp").textContent = avgTemp !== null ? avgTemp.toFixed(1) + " °C" : "-- °C";
    document.getElementById("cmpInHum").textContent = avgHum !== null ? avgHum.toFixed(1) + " %RH" : "-- %RH";

    // Hero hardware status
    const hwStatus = document.getElementById("heroHwStatus");
    if (nodeMcuOnline) {
        hwStatus.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 20a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm-4.24-3.76-1.42-1.42a8 8 0 0 1 11.32 0l-1.42 1.42a6 6 0 0 0-8.48 0z"/></svg> HARDWARE ONLINE';
        hwStatus.classList.add("hw-online");
    } else {
        hwStatus.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 20a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm-4.24-3.76-1.42-1.42a8 8 0 0 1 11.32 0l-1.42 1.42a6 6 0 0 0-8.48 0zM4.93 13.93 3.51 12.5a13 13 0 0 1 18.36 0l-1.42 1.43a11 11 0 0 0-15.52 0z"/></svg> HARDWARE OFFLINE';
        hwStatus.classList.remove("hw-online");
    }
}

function limitPct(value, limitSet) {
    if (!limitSet || limitSet.normalMin === null || limitSet.normalMax === null) {
        return { pct: 0.5, color: "#2f9153" };
    }
    const span = (limitSet.criticalMax ?? limitSet.normalMax + 10) - (limitSet.criticalMin ?? limitSet.normalMin - 10);
    const from = limitSet.criticalMin ?? limitSet.normalMin - 10;
    let pct = span > 0 ? (value - from) / span : 0.5;
    pct = Math.max(0.05, Math.min(1, pct));
    const state = classifyValue(value, limitSet);
    const color = state === "critical" ? "#d94b3f" : state === "warning" ? "#d9a520" : "#2f9153";
    return { pct, color };
}

/* ==========================================================================
   Rendering: sensor tiles / table
   ========================================================================== */
function renderSensorTiles() {
    ["sensor1", "sensor2", "sensor3"].forEach(id => {
        const s = sensorState[id];
        const tempTxt = s.temperature !== null ? s.temperature.toFixed(1) + " °C" : "-- °C";
        const humTxt = s.humidity !== null ? s.humidity.toFixed(1) + " %RH" : "-- %RH";

        const tileTemp = document.getElementById("tile-temp-" + id);
        const tileHum = document.getElementById("tile-hum-" + id);
        const tableTemp = document.getElementById("table-temp-" + id);
        const tableHum = document.getElementById("table-hum-" + id);
        if (tileTemp) tileTemp.textContent = tempTxt;
        if (tileHum) tileHum.textContent = humTxt;
        if (tableTemp) tableTemp.textContent = tempTxt;
        if (tableHum) tableHum.textContent = humTxt;

        document.querySelectorAll(`[data-status-for="${id}"]`).forEach(el => {
            if (s.status === "online") {
                el.textContent = "CONNECTED";
                el.setAttribute("data-live", "online");
                el.classList.add("tile-status-online");
            } else {
                el.textContent = "NOT CONNECTED";
                el.removeAttribute("data-live");
                el.classList.remove("tile-status-online");
            }
        });
    });

    // Anomaly detection — simple spread check across the three sensors
    const temps = ["sensor1", "sensor2", "sensor3"].map(id => sensorState[id].temperature).filter(v => typeof v === "number");
    const anomalyEl = document.getElementById("anomalyStatus");
    if (anomalyEl) {
        if (temps.length < 3) {
            anomalyEl.textContent = "WAITING FOR DATA";
        } else {
            const spread = Math.max(...temps) - Math.min(...temps);
            anomalyEl.textContent = spread > 8 ? "UNUSUAL SPREAD DETECTED" : "READINGS CONSISTENT";
        }
    }
}

/* ==========================================================================
   System status list
   ========================================================================== */
function updateSystemStatus() {
    setStatusBadge("status-nodemcu", nodeMcuOnline, "NODEMCU");
    ["sensor1", "sensor2", "sensor3"].forEach(id => {
        setStatusBadge("status-" + id, sensorState[id].status === "online", id.toUpperCase());
    });
    document.querySelectorAll('[data-status-for="nodemcu"]').forEach(el => {
        el.textContent = nodeMcuOnline ? "CONNECTED" : "NOT CONNECTED";
        if (nodeMcuOnline) el.classList.add("tile-status-online"); else el.classList.remove("tile-status-online");
    });
}

function setStatusBadge(elId, isOnline, label) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (isOnline) {
        el.innerHTML = '<span class="dot dot-green"></span>CONNECTED';
        el.classList.add("status-badge-green");
    } else {
        el.innerHTML = '<span class="dot dot-gray"></span>NOT CONNECTED';
        el.classList.remove("status-badge-green");
    }
}

/* ==========================================================================
   Limits (localStorage persisted)
   ========================================================================== */
const LIMIT_FIELDS = [
    "temp-normal-min", "temp-normal-max",
    "temp-warning-min", "temp-warning-max",
    "temp-critical-min", "temp-critical-max",
    "hum-normal-min", "hum-normal-max",
    "hum-warning-min", "hum-warning-max",
    "hum-critical-min", "hum-critical-max"
];

function setupLimits() {
    const saved = loadLimitsRaw();
    LIMIT_FIELDS.forEach(id => {
        const el = document.getElementById(id);
        if (el && saved && saved[id] !== undefined && saved[id] !== null && saved[id] !== "") {
            el.value = saved[id];
        }
    });
    const sourceEl = document.getElementById("sourceBasis");
    if (sourceEl && saved && saved.sourceBasis) sourceEl.value = saved.sourceBasis;

    document.getElementById("saveLimitsBtn").addEventListener("click", () => {
        const payload = {};
        LIMIT_FIELDS.forEach(id => {
            const el = document.getElementById(id);
            payload[id] = el.value === "" ? null : parseFloat(el.value);
        });
        payload.sourceBasis = document.getElementById("sourceBasis").value;
        localStorage.setItem(LS_KEYS.LIMITS, JSON.stringify(payload));
        showToast("Configured limits saved.");
        renderAllMeters();
        updateWarningPanel();
    });
}

function loadLimitsRaw() {
    try {
        const raw = localStorage.getItem(LS_KEYS.LIMITS);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function getLimits() {
    const raw = loadLimitsRaw() || {};
    return {
        temp: {
            normalMin: numOrNull(raw["temp-normal-min"]),
            normalMax: numOrNull(raw["temp-normal-max"]),
            warningMin: numOrNull(raw["temp-warning-min"]),
            warningMax: numOrNull(raw["temp-warning-max"]),
            criticalMin: numOrNull(raw["temp-critical-min"]),
            criticalMax: numOrNull(raw["temp-critical-max"])
        },
        hum: {
            normalMin: numOrNull(raw["hum-normal-min"]),
            normalMax: numOrNull(raw["hum-normal-max"]),
            warningMin: numOrNull(raw["hum-warning-min"]),
            warningMax: numOrNull(raw["hum-warning-max"]),
            criticalMin: numOrNull(raw["hum-critical-min"]),
            criticalMax: numOrNull(raw["hum-critical-max"])
        }
    };
}

function numOrNull(v) {
    return typeof v === "number" && !isNaN(v) ? v : null;
}

function classifyValue(value, limitSet) {
    if (limitSet.criticalMin !== null && value <= limitSet.criticalMin) return "critical";
    if (limitSet.criticalMax !== null && value >= limitSet.criticalMax) return "critical";
    if (limitSet.warningMin !== null && value <= limitSet.warningMin) return "warning";
    if (limitSet.warningMax !== null && value >= limitSet.warningMax) return "warning";
    if (limitSet.normalMin !== null && value < limitSet.normalMin) return "warning";
    if (limitSet.normalMax !== null && value > limitSet.normalMax) return "warning";
    return "normal";
}

/* ==========================================================================
   Warning system
   ========================================================================== */
function evaluateWarningState() {
    const { avgTemp, avgHum } = getAverages();
    const limits = getLimits();
    const hasAnyLimits = Object.values(limits.temp).some(v => v !== null) || Object.values(limits.hum).some(v => v !== null);

    if (avgTemp === null && avgHum === null) {
        return { key: "waiting", label: "Waiting for data", sub: "Limits not evaluated", color: "#c9d4cb", pct: 0.15 };
    }
    if (!hasAnyLimits) {
        return { key: "monitoring", label: "Monitoring", sub: "No limits configured yet", color: "#2f9153", pct: 0.5 };
    }

    let worst = "normal";
    if (avgTemp !== null) {
        const c = classifyValue(avgTemp, limits.temp);
        if (rank(c) > rank(worst)) worst = c;
    }
    if (avgHum !== null) {
        const c = classifyValue(avgHum, limits.hum);
        if (rank(c) > rank(worst)) worst = c;
    }

    const map = {
        normal: { key: "normal", label: "Monitoring", sub: "Within configured range", color: "#2f9153", pct: 0.85 },
        warning: { key: "warning", label: "Attention required", sub: "Outside normal range", color: "#d9a520", pct: 0.6 },
        critical: { key: "critical", label: "Critical condition", sub: "Prompt inspection required", color: "#d94b3f", pct: 0.9 }
    };
    return map[worst];
}
function rank(state) { return { normal: 0, warning: 1, critical: 2 }[state] ?? 0; }

function updateWarningPanel() {
    const state = evaluateWarningState();
    const panel = document.getElementById("warningPanel");
    const tag = document.getElementById("warningTag");
    const title = document.getElementById("warningTitle");
    const copy = document.getElementById("warningCopy");
    const foot = document.getElementById("warningFoot");

    panel.classList.remove("state-attention", "state-critical");

    if (state.key === "waiting") {
        tag.textContent = "ENVIRONMENTAL WARNING CENTER";
        title.textContent = "Waiting for sensor data";
        copy.textContent = "Environmental warnings will appear when measured conditions cross configured limits.";
        foot.textContent = "No warning is active while readings are unavailable.";
    } else if (state.key === "monitoring") {
        tag.textContent = "ENVIRONMENTAL WARNING CENTER";
        title.textContent = "Monitoring";
        copy.textContent = "Readings are being collected, but no monitoring limits have been configured yet. Set limits on the Limits page to enable warnings.";
        foot.textContent = "No warning is active.";
    } else if (state.key === "normal") {
        tag.textContent = "ENVIRONMENTAL WARNING CENTER";
        title.textContent = "Conditions within range";
        copy.textContent = "Measured temperature and humidity are within the configured monitoring range.";
        foot.textContent = "No warning is active.";
    } else if (state.key === "warning") {
        panel.classList.add("state-attention");
        tag.textContent = "ENVIRONMENTAL WARNING CENTER";
        title.textContent = "Attention required";
        const { avgTemp, avgHum } = getAverages();
        const limits = getLimits();
        let msg = [];
        if (avgTemp !== null && classifyValue(avgTemp, limits.temp) !== "normal") {
            msg.push("Temperature is outside the configured monitoring range. Inspect storage conditions.");
        }
        if (avgHum !== null && classifyValue(avgHum, limits.hum) !== "normal") {
            msg.push("Relative humidity is outside the configured monitoring range. Inspect for moisture sources and ventilation.");
        }
        copy.textContent = msg.join(" ");
        foot.textContent = "Configured limits have been crossed.";
    } else if (state.key === "critical") {
        panel.classList.add("state-critical");
        tag.textContent = "ENVIRONMENTAL WARNING CENTER";
        title.textContent = "Critical condition";
        copy.textContent = "Measured conditions have reached the critical range. Prompt inspection of the storage area is recommended.";
        foot.textContent = "Critical threshold reached.";
    }
}

/* ==========================================================================
   Readings history (localStorage) + graphs
   ========================================================================== */
function loadReadings() {
    try {
        const raw = localStorage.getItem(LS_KEYS.READINGS);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function saveReadings(arr) {
    localStorage.setItem(LS_KEYS.READINGS, JSON.stringify(arr));
}

function recordReadingIfComplete() {
    const { avgTemp, avgHum } = getAverages();
    if (avgTemp === null || avgHum === null) return;
    const readings = loadReadings();
    readings.push({ t: Date.now(), temp: avgTemp, hum: avgHum });
    // Keep at most 30 days worth at a reasonable resolution (cap total entries)
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const trimmed = readings.filter(r => r.t >= cutoff);
    if (trimmed.length > 5000) trimmed.splice(0, trimmed.length - 5000);
    saveReadings(trimmed);
}

let currentRange = "today";

function setupRangeTabs() {
    document.querySelectorAll(".range-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".range-tab").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentRange = btn.dataset.range;
            renderGraphs();
        });
    });
}

function filteredReadings() {
    const all = loadReadings();
    const now = Date.now();
    let cutoff;
    if (currentRange === "today") cutoff = now - 24 * 60 * 60 * 1000;
    else if (currentRange === "7d") cutoff = now - 7 * 24 * 60 * 60 * 1000;
    else cutoff = now - 30 * 24 * 60 * 60 * 1000;
    return all.filter(r => r.t >= cutoff);
}

function renderGraphs() {
    const data = filteredReadings();
    const historyNote = document.getElementById("historyNote");
    historyNote.textContent = data.length === 0 ? "No recorded measurements yet." : `${data.length} recorded measurement${data.length === 1 ? "" : "s"}.`;

    drawSeries("tempGraph", "tempGraphEmpty", data.map(d => d.temp), "#2f9153",
        { current: "tempStatCurrent", min: "tempStatMin", max: "tempStatMax", avg: "tempStatAvg" }, "°C");
    drawSeries("humGraph", "humGraphEmpty", data.map(d => d.hum), "#3ea766",
        { current: "humStatCurrent", min: "humStatMin", max: "humStatMax", avg: "humStatAvg" }, "%RH");
}

function drawSeries(canvasId, emptyId, values, color, statIds, unit) {
    const canvas = document.getElementById(canvasId);
    const emptyEl = document.getElementById(emptyId);
    const ctx = canvas.getContext("2d");
    const wrap = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!values || values.length === 0) {
        emptyEl.style.display = "flex";
        document.getElementById(statIds.current).textContent = "-";
        document.getElementById(statIds.min).textContent = "-";
        document.getElementById(statIds.max).textContent = "-";
        document.getElementById(statIds.avg).textContent = "-";
        return;
    }
    emptyEl.style.display = "none";

    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const current = values[values.length - 1];

    document.getElementById(statIds.current).textContent = current.toFixed(1) + unit;
    document.getElementById(statIds.min).textContent = min.toFixed(1) + unit;
    document.getElementById(statIds.max).textContent = max.toFixed(1) + unit;
    document.getElementById(statIds.avg).textContent = avg.toFixed(1) + unit;

    const pad = 14 * dpr;
    const range = max - min || 1;
    const stepX = values.length > 1 ? (canvas.width - pad * 2) / (values.length - 1) : 0;

    ctx.beginPath();
    values.forEach((v, i) => {
        const x = pad + i * stepX;
        const y = canvas.height - pad - ((v - min) / range) * (canvas.height - pad * 2);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * dpr;
    ctx.lineJoin = "round";
    ctx.stroke();

    // fill under line
    ctx.lineTo(pad + (values.length - 1) * stepX, canvas.height - pad);
    ctx.lineTo(pad, canvas.height - pad);
    ctx.closePath();
    ctx.fillStyle = color + "22";
    ctx.fill();
}

/* ==========================================================================
   CSV Export
   ========================================================================== */
function setupExport() {
    document.getElementById("exportBtn").addEventListener("click", () => {
        const data = loadReadings();
        if (data.length === 0) {
            showToast("No data available for export.");
            return;
        }
        const rows = [["timestamp_iso", "avg_temperature_c", "avg_humidity_rh"]];
        data.forEach(r => rows.push([new Date(r.t).toISOString(), r.temp.toFixed(2), r.hum.toFixed(2)]));
        const csv = rows.map(r => r.join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "grainguard_readings_" + new Date().toISOString().slice(0, 10) + ".csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("Export started.");
    });
}

/* ==========================================================================
   Toast
   ========================================================================== */
let toastTimer = null;
function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}
