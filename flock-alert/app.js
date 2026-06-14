/* FlockAlert — ALPR / Flock Safety camera proximity warnings (PWA)
 * Data: DeFlock / OpenStreetMap (Overpass API) + user-added points.
 * No backend, no tracking. Everything runs in the browser; manual points
 * and settings live in localStorage only.
 */
"use strict";

/* ------------------- Smooth (Apple-Maps-like) wheel zoom ------------------ *
 * Continuous, momentum-feel zoom for mouse wheel / trackpad. Adapted from
 * Leaflet.SmoothWheelZoom (MIT, github.com/mutsuyuki/Leaflet.SmoothWheelZoom).
 * On touch devices, pinch zoom is smoothed separately via zoomSnap: 0 below. */
L.Map.mergeOptions({ smoothWheelZoom: true, smoothSensitivity: 1 });

L.Map.SmoothWheelZoom = L.Handler.extend({
  addHooks: function () {
    L.DomEvent.on(this._map._container, "wheel", this._onWheelScroll, this);
  },
  removeHooks: function () {
    L.DomEvent.off(this._map._container, "wheel", this._onWheelScroll, this);
  },
  _onWheelScroll: function (e) {
    if (!this._isWheeling) this._onWheelStart(e);
    this._onWheeling(e);
  },
  _onWheelStart: function (e) {
    var map = this._map;
    this._isWheeling = true;
    this._wheelMousePosition = map.mouseEventToContainerPoint(e);
    this._centerPoint = map.getSize()._divideBy(2);
    this._startLatLng = map.containerPointToLatLng(this._centerPoint);
    this._wheelStartLatLng = map.containerPointToLatLng(this._wheelMousePosition);
    this._startZoom = map.getZoom();
    this._moved = false;
    map.stop();
    if (map._panAnim) map._panAnim.stop();
    this._goalZoom = map.getZoom();
    this._prevZoom = map.getZoom();
    this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
  },
  _onWheeling: function (e) {
    var map = this._map;
    this._goalZoom = this._goalZoom - e.deltaY * 0.003 * map.options.smoothSensitivity;
    if (this._goalZoom < map.getMinZoom() || this._goalZoom > map.getMaxZoom()) {
      this._goalZoom = map._limitZoom(this._goalZoom);
    }
    this._wheelMousePosition = map.mouseEventToContainerPoint(e);
    clearTimeout(this._timeoutId);
    this._timeoutId = setTimeout(this._onWheelEnd.bind(this), 200);
    L.DomEvent.preventDefault(e);
    L.DomEvent.stopPropagation(e);
  },
  _onWheelEnd: function () {
    this._isWheeling = false;
    cancelAnimationFrame(this._zoomAnimationId);
    this._map._moveEnd(true);
  },
  _updateWheelZoom: function () {
    var map = this._map;
    if (!map.getCenter() || !this._wheelMousePosition) return;
    var zoom = map.getZoom();
    zoom = zoom + (this._goalZoom - zoom) * 0.3;
    zoom = Math.round(zoom * 100) / 100;
    var delta = this._wheelMousePosition.subtract(this._centerPoint);
    var center = map.unproject(
      map.project(this._wheelStartLatLng, zoom).subtract(delta),
      zoom
    );
    map.setView(center, zoom, { animate: false });
    this._prevZoom = zoom;
    this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
  },
});
L.Map.addInitHook("addHandler", "smoothWheelZoom", L.Map.SmoothWheelZoom);

/* ----------------------------- Config & state ---------------------------- */

// Optional providers/keys from config.js (all optional — blank = free shared services).
const CFG = (typeof window !== "undefined" && window.FLOCKALERT_CONFIG) || {};
const OVERPASS_ENDPOINTS =
  CFG.overpassEndpoints && CFG.overpassEndpoints.length
    ? CFG.overpassEndpoints
    : ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

const DEFAULTS = {
  distance: 300,      // alert radius in meters
  units: "metric",    // "metric" | "imperial"
  sound: true,
  voice: false,
  vibrate: true,
  osm: true,          // load DeFlock/OSM cameras
};

const state = {
  settings: loadSettings(),
  driving: false,
  watchId: null,
  me: null,                 // {lat, lon, accuracy, heading, speed}
  osmCameras: [],           // [{id, lat, lon, source:'osm', name}]
  manualCameras: loadManual(),
  markers: new Map(),       // id -> leaflet marker
  alerted: new Map(),       // cameraId -> timestamp last alerted
  lastFetchCenter: null,    // {lat, lon} where we last queried Overpass
  fetching: false,
  addMode: false,
  audioCtx: null,
};

const ALERT_COOLDOWN_MS = 60_000;   // don't re-alert same camera within a minute
const REFETCH_DISTANCE_M = 2_000;   // refetch OSM when moved this far from last query
const FETCH_RADIUS_M = 6_000;       // Overpass search radius around the user

/* ------------------------------- Map setup ------------------------------- */

const map = L.map("map", {
  zoomControl: false,
  attributionControl: true,
  // Apple-Maps-like feel:
  scrollWheelZoom: false,    // replaced by smoothWheelZoom handler above
  smoothWheelZoom: true,
  smoothSensitivity: 1.5,
  zoomSnap: 0,               // continuous zoom — pinch/scroll never "snaps" to a level
  zoomDelta: 1,              // +/- buttons & double-tap still step by one, animated
  wheelPxPerZoomLevel: 120,
  inertia: true,
  inertiaDeceleration: 2000, // longer, smoother glide when you flick to pan
  inertiaMaxSpeed: 2000,
  easeLinearity: 0.2,
  zoomAnimation: true,
  fadeAnimation: true,
  markerZoomAnimation: true,
  bounceAtZoomLimits: true,
  doubleClickZoom: true,
}).setView([39.5, -98.35], 4);

if (CFG.maptilerKey) {
  const style = CFG.maptilerStyle || "streets-v2-dark";
  L.tileLayer(`https://api.maptiler.com/maps/${style}/{z}/{x}/{y}.png?key=${CFG.maptilerKey}`, {
    maxZoom: 20,
    tileSize: 512,
    zoomOffset: -1,
    attribution:
      '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · cameras via <a href="https://deflock.me">DeFlock</a>',
  }).addTo(map);
} else {
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a> · cameras via <a href="https://deflock.me">DeFlock</a>',
  }).addTo(map);
}

L.control.zoom({ position: "topright" }).addTo(map);

let meMarker = null;
let meAccuracyCircle = null;
let alertRadiusCircle = null;

/* ------------------------------- DOM refs -------------------------------- */

const el = (id) => document.getElementById(id);
const ui = {
  status: el("status"),
  alertBanner: el("alert-banner"),
  alertDistance: el("alert-distance"),
  nearest: el("nearest"),
  nearestDistance: el("nearest-distance"),
  nearestCount: el("nearest-count"),
  btnStart: el("btn-start"),
  btnLocate: el("btn-locate"),
  btnAdd: el("btn-add"),
  btnSettings: el("btn-settings"),
  addHint: el("add-hint"),
  btnAddHere: el("btn-add-here"),
  btnAddCancel: el("btn-add-cancel"),
  settings: el("settings"),
  btnSettingsClose: el("btn-settings-close"),
  setDistance: el("set-distance"),
  setDistanceOut: el("set-distance-out"),
  setUnits: el("set-units"),
  setSound: el("set-sound"),
  setVoice: el("set-voice"),
  setVibrate: el("set-vibrate"),
  setOsm: el("set-osm"),
  manualList: el("manual-list"),
  btnClearManual: el("btn-clear-manual"),
  toast: el("toast"),
};

/* ------------------------------ Persistence ------------------------------ */

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("fa_settings") || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings() {
  localStorage.setItem("fa_settings", JSON.stringify(state.settings));
}
function loadManual() {
  try {
    return JSON.parse(localStorage.getItem("fa_manual") || "[]");
  } catch {
    return [];
  }
}
function saveManual() {
  localStorage.setItem("fa_manual", JSON.stringify(state.manualCameras));
}

/* ------------------------------- Geo math -------------------------------- */

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000; // meters
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatDistance(m) {
  if (state.settings.units === "imperial") {
    const ft = m * 3.28084;
    if (ft < 1000) return `${Math.round(ft / 10) * 10} ft`;
    return `${(ft / 5280).toFixed(ft / 5280 < 10 ? 2 : 1)} mi`;
  }
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m / 1000 < 10 ? 2 : 1)} km`;
}

/* --------------------------- Camera data layer --------------------------- */

function allCameras() {
  const osm = state.settings.osm ? state.osmCameras : [];
  return [...osm, ...state.manualCameras];
}

async function fetchOsmCameras(lat, lon) {
  if (!state.settings.osm || state.fetching) return;
  state.fetching = true;
  setStatus("loading", "Loading cameras…");

  // DeFlock / OSM tag conventions for automated license plate readers.
  const q = `
    [out:json][timeout:25];
    (
      node["man_made"="surveillance"]["surveillance:type"="ALPR"](around:${FETCH_RADIUS_M},${lat},${lon});
      node["man_made"="surveillance"]["camera:type"="alpr"](around:${FETCH_RADIUS_M},${lat},${lon});
    );
    out body;`;

  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: "data=" + encodeURIComponent(q),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      state.osmCameras = (data.elements || [])
        .filter((e) => e.lat && e.lon)
        .map((e) => ({
          id: "osm-" + e.id,
          lat: e.lat,
          lon: e.lon,
          source: "osm",
          name: e.tags?.brand || e.tags?.operator || "ALPR camera",
        }));
      state.lastFetchCenter = { lat, lon };
      renderCameras();
      setStatus(state.driving ? "active" : "idle", driveLabel());
      toast(`${state.osmCameras.length} cameras loaded nearby`);
      state.fetching = false;
      return;
    } catch (err) {
      console.warn("Overpass fetch failed:", url, err);
    }
  }

  state.fetching = false;
  setStatus("error", "Camera data unavailable");
  toast("Couldn't reach the camera database. Your added cameras still work.");
}

function maybeRefetch(lat, lon) {
  if (!state.settings.osm) return;
  if (
    !state.lastFetchCenter ||
    haversine(lat, lon, state.lastFetchCenter.lat, state.lastFetchCenter.lon) > REFETCH_DISTANCE_M
  ) {
    fetchOsmCameras(lat, lon);
  }
}

/* ------------------------------ Rendering -------------------------------- */

function renderCameras() {
  const cams = allCameras();
  const seen = new Set();

  for (const cam of cams) {
    seen.add(cam.id);
    if (state.markers.has(cam.id)) continue;
    const isManual = cam.source === "manual";
    const marker = L.marker([cam.lat, cam.lon], {
      icon: L.divIcon({
        className: "",
        html: `<div class="cam-marker ${isManual ? "cam-marker--manual" : ""}"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
    });
    marker.bindPopup(
      `<strong>${escapeHtml(cam.name || "ALPR camera")}</strong><br>` +
        `<small>${isManual ? "Added by you" : "DeFlock / OSM"}</small>` +
        (isManual ? `<br><a href="#" data-del="${cam.id}">Remove this point</a>` : "")
    );
    marker.addTo(map);
    state.markers.set(cam.id, marker);
  }

  // Remove markers for cameras that no longer exist
  for (const [id, marker] of state.markers) {
    if (!seen.has(id)) {
      map.removeLayer(marker);
      state.markers.delete(id);
    }
  }
}

// Handle "remove" links inside popups
map.on("popupopen", (e) => {
  const link = e.popup.getElement()?.querySelector("[data-del]");
  if (link) {
    link.addEventListener("click", (ev) => {
      ev.preventDefault();
      removeManual(link.getAttribute("data-del"));
      map.closePopup();
    });
  }
});

/* ------------------------------ Location --------------------------------- */

function startDriving() {
  if (!("geolocation" in navigator)) {
    toast("This device has no GPS / geolocation support.");
    return;
  }
  state.driving = true;
  ui.btnStart.textContent = "■ Stop driving mode";
  ui.btnStart.classList.add("is-active");
  setStatus("active", driveLabel());
  keepAwake(true);

  state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 15000,
  });
}

function stopDriving() {
  state.driving = false;
  ui.btnStart.textContent = "▶ Start driving mode";
  ui.btnStart.classList.remove("is-active");
  setStatus("idle", "Idle");
  hideAlert();
  keepAwake(false);
  if (state.watchId != null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
}

function onPosition(pos) {
  const { latitude, longitude, accuracy, heading, speed } = pos.coords;
  state.me = { lat: latitude, lon: longitude, accuracy, heading, speed };
  updateMeMarker();
  maybeRefetch(latitude, longitude);
  evaluateProximity();
}

function onPositionError(err) {
  console.warn("Geolocation error", err);
  if (err.code === err.PERMISSION_DENIED) {
    setStatus("error", "Location permission denied");
    toast("Allow location access to get camera alerts.");
    stopDriving();
  } else {
    setStatus("error", "Waiting for GPS…");
  }
}

function updateMeMarker(recenter = false) {
  if (!state.me) return;
  const { lat, lon, accuracy } = state.me;
  const ll = [lat, lon];

  if (!meMarker) {
    meMarker = L.marker(ll, {
      icon: L.divIcon({ className: "", html: '<div class="me-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      zIndexOffset: 1000,
    }).addTo(map);
    meAccuracyCircle = L.circle(ll, { radius: accuracy || 20, color: "#4f8cff", weight: 1, opacity: 0.4, fillOpacity: 0.06 }).addTo(map);
    alertRadiusCircle = L.circle(ll, { radius: state.settings.distance, className: "alert-radius", weight: 1 }).addTo(map);
    map.setView(ll, 16);
  } else {
    meMarker.setLatLng(ll);
    meAccuracyCircle.setLatLng(ll).setRadius(accuracy || 20);
    alertRadiusCircle.setLatLng(ll).setRadius(state.settings.distance);
    if (state.driving || recenter) map.panTo(ll, { animate: true, duration: 0.5 });
  }
}

/* --------------------------- Proximity engine ---------------------------- */

function evaluateProximity() {
  if (!state.me) return;
  const cams = allCameras();
  if (cams.length === 0) {
    ui.nearest.classList.add("hidden");
    return;
  }

  let nearest = null;
  let nearestDist = Infinity;
  let withinAlert = 0;

  for (const cam of cams) {
    const d = haversine(state.me.lat, state.me.lon, cam.lat, cam.lon);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = cam;
    }
    if (d <= state.settings.distance) withinAlert++;
  }

  // Update nearest readout
  ui.nearest.classList.remove("hidden");
  ui.nearestDistance.textContent = formatDistance(nearestDist);
  ui.nearestCount.textContent = `${cams.length} mapped nearby`;

  if (nearest && nearestDist <= state.settings.distance) {
    triggerAlert(nearest, nearestDist, withinAlert);
  } else {
    hideAlert();
  }
}

function triggerAlert(cam, dist, count) {
  ui.alertBanner.classList.remove("hidden");
  ui.alertDistance.textContent =
    `${formatDistance(dist)} away` + (count > 1 ? ` · ${count} cameras in range` : "");

  const last = state.alerted.get(cam.id) || 0;
  const now = Date.now();
  if (now - last < ALERT_COOLDOWN_MS) return; // already warned recently
  state.alerted.set(cam.id, now);

  if (state.settings.vibrate && navigator.vibrate) navigator.vibrate([200, 80, 200]);
  if (state.settings.sound) beep();
  if (state.settings.voice) speak(`Camera ${formatDistance(dist)} ahead`);
}

function hideAlert() {
  ui.alertBanner.classList.add("hidden");
}

/* ------------------------------- Alerts ---------------------------------- */

function beep() {
  try {
    if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = state.audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime;
    [880, 1100].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = t + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.4, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    });
  } catch (e) {
    console.warn("beep failed", e);
  }
}

function speak(text) {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch (e) {
    console.warn("speak failed", e);
  }
}

/* --------------------------- Wake lock (keep on) ------------------------- */

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      document.addEventListener("visibilitychange", reacquireWakeLock);
    } else if (!on && wakeLock) {
      document.removeEventListener("visibilitychange", reacquireWakeLock);
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) {
    console.warn("wakeLock", e);
  }
}
async function reacquireWakeLock() {
  if (state.driving && document.visibilityState === "visible" && "wakeLock" in navigator) {
    try { wakeLock = await navigator.wakeLock.request("screen"); } catch {}
  }
}

/* ------------------------- Manual camera adding -------------------------- */

function enterAddMode() {
  state.addMode = true;
  ui.addHint.classList.remove("hidden");
  toast("Tap the map to drop a camera point.");
  map.getContainer().style.cursor = "crosshair";
}
function exitAddMode() {
  state.addMode = false;
  ui.addHint.classList.add("hidden");
  map.getContainer().style.cursor = "";
}

map.on("click", (e) => {
  if (!state.addMode) return;
  addManual(e.latlng.lat, e.latlng.lng);
  exitAddMode();
});

function addManual(lat, lon, name = "My camera") {
  const cam = { id: "manual-" + Date.now(), lat, lon, source: "manual", name };
  state.manualCameras.push(cam);
  saveManual();
  renderCameras();
  renderManualList();
  if (state.me) evaluateProximity();
  toast("Camera added.");
}

function removeManual(id) {
  state.manualCameras = state.manualCameras.filter((c) => c.id !== id);
  saveManual();
  renderCameras();
  renderManualList();
  if (state.me) evaluateProximity();
}

function renderManualList() {
  if (state.manualCameras.length === 0) {
    ui.manualList.textContent = "None yet.";
    return;
  }
  ui.manualList.innerHTML = "";
  state.manualCameras.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "mitem";
    row.innerHTML = `<span>${i + 1}. ${escapeHtml(c.name)} (${c.lat.toFixed(4)}, ${c.lon.toFixed(4)})</span>`;
    const btn = document.createElement("button");
    btn.textContent = "Remove";
    btn.addEventListener("click", () => removeManual(c.id));
    row.appendChild(btn);
    ui.manualList.appendChild(row);
  });
}

/* ------------------------------ Settings UI ------------------------------ */

function syncSettingsUI() {
  ui.setDistance.value = state.settings.distance;
  ui.setDistanceOut.textContent = formatDistance(state.settings.distance);
  ui.setUnits.value = state.settings.units;
  ui.setSound.checked = state.settings.sound;
  ui.setVoice.checked = state.settings.voice;
  ui.setVibrate.checked = state.settings.vibrate;
  ui.setOsm.checked = state.settings.osm;
}

ui.setDistance.addEventListener("input", () => {
  state.settings.distance = Number(ui.setDistance.value);
  ui.setDistanceOut.textContent = formatDistance(state.settings.distance);
  if (alertRadiusCircle) alertRadiusCircle.setRadius(state.settings.distance);
  saveSettings();
  if (state.me) evaluateProximity();
});
ui.setUnits.addEventListener("change", () => {
  state.settings.units = ui.setUnits.value;
  saveSettings();
  syncSettingsUI();
  if (state.me) evaluateProximity();
});
ui.setSound.addEventListener("change", () => { state.settings.sound = ui.setSound.checked; saveSettings(); if (ui.setSound.checked) beep(); });
ui.setVoice.addEventListener("change", () => { state.settings.voice = ui.setVoice.checked; saveSettings(); });
ui.setVibrate.addEventListener("change", () => { state.settings.vibrate = ui.setVibrate.checked; saveSettings(); if (ui.setVibrate.checked && navigator.vibrate) navigator.vibrate(120); });
ui.setOsm.addEventListener("change", () => {
  state.settings.osm = ui.setOsm.checked;
  saveSettings();
  if (state.settings.osm && state.me) fetchOsmCameras(state.me.lat, state.me.lon);
  renderCameras();
  if (state.me) evaluateProximity();
});

/* ------------------------------- Buttons --------------------------------- */

ui.btnStart.addEventListener("click", () => {
  // First tap also unlocks audio on iOS/Safari.
  unlockAudio();
  state.driving ? stopDriving() : startDriving();
});

ui.btnLocate.addEventListener("click", () => {
  if (state.me) {
    updateMeMarker(true);
    map.setView([state.me.lat, state.me.lon], 16);
  } else if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (p) => { onPosition(p); map.setView([p.coords.latitude, p.coords.longitude], 16); },
      onPositionError,
      { enableHighAccuracy: true }
    );
  }
});

ui.btnAdd.addEventListener("click", () => (state.addMode ? exitAddMode() : enterAddMode()));
ui.btnAddCancel.addEventListener("click", exitAddMode);
ui.btnAddHere.addEventListener("click", () => {
  if (state.me) { addManual(state.me.lat, state.me.lon); exitAddMode(); }
  else toast("Start driving mode or recenter first to get your location.");
});

ui.btnSettings.addEventListener("click", () => { syncSettingsUI(); renderManualList(); ui.settings.classList.remove("hidden"); });
ui.btnSettingsClose.addEventListener("click", () => ui.settings.classList.add("hidden"));
ui.settings.addEventListener("click", (e) => { if (e.target === ui.settings) ui.settings.classList.add("hidden"); });
ui.btnClearManual.addEventListener("click", () => {
  if (state.manualCameras.length && confirm("Remove all cameras you've added?")) {
    state.manualCameras = [];
    saveManual();
    renderCameras();
    renderManualList();
    if (state.me) evaluateProximity();
  }
});

/* ------------------------------- Helpers --------------------------------- */

function setStatus(kind, text) {
  ui.status.className = "status status--" + kind;
  ui.status.textContent = text;
}
function driveLabel() {
  return state.driving ? "Driving · watching" : "Idle";
}

let toastTimer = null;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.add("hidden"), 3200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function unlockAudio() {
  try {
    if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (state.audioCtx.state === "suspended") state.audioCtx.resume();
  } catch {}
}

/* ------------------------------- Startup --------------------------------- */

function init() {
  syncSettingsUI();
  renderManualList();
  renderCameras();

  // Try to get an initial location (non-blocking) so the map centers nicely.
  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onPosition(p);
        map.setView([p.coords.latitude, p.coords.longitude], 15);
        if (state.settings.osm) fetchOsmCameras(p.coords.latitude, p.coords.longitude);
      },
      (e) => console.info("Initial location unavailable", e),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.info("SW registration failed", e));
  }
}

init();
