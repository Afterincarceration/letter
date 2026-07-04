/* FlockAlert — ALPR / Flock Safety camera proximity warnings (Google Maps).
 * Data: DeFlock / OpenStreetMap (Overpass API) + user-added points.
 * Map engine: Google Maps JS API (native smooth zoom/pan). Tapping a camera
 * shows a Google Street View image aimed down the camera's direction.
 * No backend; manual points and settings live in localStorage only.
 */
"use strict";

/* ----------------------------- Config & state ---------------------------- */

const CFG = (typeof window !== "undefined" && window.FLOCKALERT_CONFIG) || {};
const OVERPASS_ENDPOINTS =
  CFG.overpassEndpoints && CFG.overpassEndpoints.length
    ? CFG.overpassEndpoints
    : ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

const DEFAULTS = {
  distance: 300, units: "metric", sound: true, voice: false, vibrate: true,
  osm: true,        // Flock / ALPR cameras
  speed: true,      // speed cameras
  notify: false,    // system (Web) notifications
};

const state = {
  settings: loadSettings(),
  driving: false,
  watchId: null,
  me: null,
  osmCameras: [],
  manualCameras: loadManual(),
  markers: new Map(),       // id -> google.maps.Marker
  alerted: new Map(),
  lastFetchCenter: null,
  fetching: false,
  addMode: false,
  audioCtx: null,
};

const ALERT_COOLDOWN_MS = 60_000;
const REFETCH_DISTANCE_M = 2_000;
const FETCH_RADIUS_M = 6_000;

let map = null;
let infoWindow = null;
let meMarker = null;
let meAccuracyCircle = null;
let alertRadiusCircle = null;

/* Dark map style (no Cloud Map ID needed). */
const DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0e1426" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8ea0c0" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b1020" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#26324d" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3a4a72" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9aa3bd" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a1120" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#2a3450" }] },
];

/* ------------------------------- DOM refs -------------------------------- */

const el = (id) => document.getElementById(id);
const ui = {
  status: el("status"),
  alertBanner: el("alert-banner"),
  alertDistance: el("alert-distance"),
  dash: el("dash"),
  dashDist: el("dash-dist"),
  dashSub: el("dash-sub"),
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
  setSpeed: el("set-speed"),
  setNotify: el("set-notify"),
  alertTitle: el("alert-title"),
  manualList: el("manual-list"),
  btnClearManual: el("btn-clear-manual"),
  toast: el("toast"),
};

/* ------------------------------ Persistence ------------------------------ */

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("fa_settings") || "{}") }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings() { localStorage.setItem("fa_settings", JSON.stringify(state.settings)); }
function loadManual() {
  try { return JSON.parse(localStorage.getItem("fa_manual") || "[]"); } catch { return []; }
}
function saveManual() { localStorage.setItem("fa_manual", JSON.stringify(state.manualCameras)); }

/* ------------------------------- Geo math -------------------------------- */

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
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

/* --------------------------- Map bootstrapping --------------------------- */

function loadGoogleMaps() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) return resolve();
    window.__faGmapsCb = () => resolve();
    const s = document.createElement("script");
    s.async = true;
    s.onerror = () => reject(new Error("Google Maps failed to load"));
    s.src =
      "https://maps.googleapis.com/maps/api/js?key=" +
      encodeURIComponent(CFG.googleMapsKey) +
      "&loading=async&libraries=geometry,places&callback=__faGmapsCb";
    document.head.appendChild(s);
  });
}

function showMapMessage(title, body) {
  el("map").innerHTML =
    `<div class="map-msg"><h2>${title}</h2><p>${body}</p></div>`;
}

function initMap() {
  map = new google.maps.Map(el("map"), {
    center: { lat: 39.5, lng: -98.35 },
    zoom: 4,
    styles: DARK_STYLE,
    gestureHandling: "greedy",      // one-finger pan + native smooth zoom
    disableDefaultUI: true,
    zoomControl: true,
    clickableIcons: false,
    keyboardShortcuts: false,
    backgroundColor: "#0b1020",
  });
  infoWindow = new google.maps.InfoWindow();

  map.addListener("click", (e) => {
    if (state.addMode) {
      addManual(e.latLng.lat(), e.latLng.lng());
      exitAddMode();
    } else {
      infoWindow.close();
    }
  });

  // Load cameras for whatever area is on screen, whenever the map settles.
  map.addListener("idle", scheduleViewFetch);

  // Attach place autocomplete to the route inputs (defined in routes.js).
  if (typeof initRouteAutocomplete === "function") initRouteAutocomplete();

  renderCameras();

  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onPosition(p);
        map.setCenter({ lat: p.coords.latitude, lng: p.coords.longitude });
        map.setZoom(15);   // 'idle' fires after this → cameras load for the view
      },
      (e) => console.info("Initial location unavailable", e),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }
}

function requireMap() {
  if (!map) { toast("Map is still loading…"); return false; }
  return true;
}

/* ------------------------------ Icons / SV ------------------------------- */

function camColor(cam) {
  if (cam && cam.source === "manual") return "#ffb020";   // your points — amber
  if (cam && cam.type === "speed") return "#b07cff";       // speed cameras — purple
  return "#ff5d5d";                                        // ALPR / Flock — red
}
function camIcon(cam, big) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: big ? 9 : 6,
    fillColor: camColor(cam),
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 2,
  };
}
function meIcon() {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 7,
    fillColor: "#4f8cff",
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 3,
  };
}

function streetViewUrl(lat, lon, heading) {
  if (!CFG.googleMapsKey) return "";
  const h = heading != null && !isNaN(heading) ? `&heading=${Math.round(heading)}` : "";
  return (
    "https://maps.googleapis.com/maps/api/streetview?size=440x220" +
    `&location=${lat},${lon}${h}&fov=80&pitch=2&source=outdoor&key=${encodeURIComponent(CFG.googleMapsKey)}`
  );
}

function openCameraInfo(cam, marker, label) {
  const manual = cam.source === "manual";
  const sv = streetViewUrl(cam.lat, cam.lon, cam.dir);
  const osmId = String(cam.id).replace(/^osm-/, "");
  const html =
    `<div class="iw">` +
    (sv ? `<img class="iw-sv" src="${sv}" alt="Street view of this corner" referrerpolicy="no-referrer" onerror="this.style.display='none'"/>` : "") +
    `<div class="iw-title">${label ? "#" + label + " · " : ""}${escapeHtml(cam.name || "ALPR camera")}</div>` +
    `<div class="iw-sub">${manual ? "Added by you" : "DeFlock / OSM"}${cam.dir != null ? ` · faces ${Math.round(cam.dir)}°` : ""}</div>` +
    `<div class="iw-links">` +
    (manual ? `<a href="#" id="iw-del">Remove this point</a>` : `<a href="https://www.openstreetmap.org/node/${osmId}" target="_blank" rel="noopener">View OSM record</a>`) +
    `</div></div>`;
  infoWindow.setContent(html);
  infoWindow.open({ map, anchor: marker });
  if (manual) {
    google.maps.event.addListenerOnce(infoWindow, "domready", () => {
      const d = document.getElementById("iw-del");
      if (d) d.addEventListener("click", (e) => { e.preventDefault(); removeManual(cam.id); infoWindow.close(); });
    });
  }
}

/* --------------------------- Camera data layer --------------------------- */

function allCameras() {
  const osm = state.osmCameras.filter((c) =>
    c.type === "speed" ? state.settings.speed : state.settings.osm
  );
  return [...osm, ...state.manualCameras];
}

let viewTimer = null;
let lastViewKey = "";

// Debounced: re-load cameras whenever the map settles (pan/zoom or GPS follow).
function scheduleViewFetch() {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(fetchCamerasInView, 500);
}

// Load every ALPR + speed camera in the CURRENT MAP VIEW (not just near GPS).
async function fetchCamerasInView() {
  if (!map) return;
  const b = map.getBounds();
  if (!b) return;
  const sw = b.getSouthWest(), ne = b.getNorthEast();
  const spanLat = ne.lat() - sw.lat(), spanLon = ne.lng() - sw.lng();

  if (spanLat > 0.7 || spanLon > 0.7) { setStatus("idle", "Zoom in to load cameras"); return; }
  if (!state.settings.osm && !state.settings.speed) { state.osmCameras = []; renderCameras(); return; }

  const key = `${sw.lat().toFixed(2)},${sw.lng().toFixed(2)},${ne.lat().toFixed(2)},${ne.lng().toFixed(2)}`;
  if (key === lastViewKey && state.osmCameras.length) return;   // this view already loaded
  if (state.fetching) return;

  state.fetching = true;
  setStatus("loading", "Loading cameras…");
  const bbox = `${sw.lat()},${sw.lng()},${ne.lat()},${ne.lng()}`;
  const parts = [];
  if (state.settings.osm) {
    parts.push(`node["man_made"="surveillance"]["surveillance:type"="ALPR"](${bbox});`);
    parts.push(`node["man_made"="surveillance"]["camera:type"="alpr"](${bbox});`);
  }
  if (state.settings.speed) {
    parts.push(`node["highway"="speed_camera"](${bbox});`);
    parts.push(`node["enforcement"="maxspeed"](${bbox});`);
  }
  const q = `[out:json][timeout:25];(${parts.join("")});out body;`;

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
        .map((e) => {
          const t = e.tags || {};
          const isSpeed = t.highway === "speed_camera" || t.enforcement === "maxspeed";
          return {
            id: (isSpeed ? "spd-" : "osm-") + e.id,
            lat: e.lat, lon: e.lon, source: "osm",
            type: isSpeed ? "speed" : "alpr",
            name: isSpeed ? "Speed camera" : (t.brand || t.operator || t.manufacturer || "ALPR camera"),
            dir: t.direction != null ? Number(t.direction) : null,
          };
        });
      lastViewKey = key;
      renderCameras();
      if (state.me) evaluateProximity();
      const nA = state.osmCameras.filter((c) => c.type !== "speed").length;
      const nS = state.osmCameras.filter((c) => c.type === "speed").length;
      setStatus(state.driving ? "active" : "idle", driveLabel());
      toast(`${nA} ALPR · ${nS} speed cameras in view`);
      state.fetching = false;
      return;
    } catch (err) {
      console.warn("Overpass fetch failed:", url, err);
    }
  }
  state.fetching = false;
  setStatus("error", "Camera data unavailable");
}

/* ------------------------------ Rendering -------------------------------- */

function renderCameras() {
  if (!map) return;
  const cams = allCameras();
  const seen = new Set();

  for (const cam of cams) {
    seen.add(cam.id);
    if (state.markers.has(cam.id)) continue;
    const marker = new google.maps.Marker({
      position: { lat: cam.lat, lng: cam.lon },
      map,
      icon: camIcon(cam, false),
      title: cam.name || "ALPR camera",
    });
    marker.addListener("click", () => openCameraInfo(cam, marker));
    state.markers.set(cam.id, marker);
  }

  for (const [id, marker] of state.markers) {
    if (!seen.has(id)) { marker.setMap(null); state.markers.delete(id); }
  }
}

/* ------------------------------ Location --------------------------------- */

function setDriveButton(driving) {
  ui.btnStart.classList.toggle("is-active", driving);
  const ico = ui.btnStart.querySelector(".tab__ico");
  const lbl = ui.btnStart.querySelector(".tab__lbl");
  if (ico) ico.textContent = driving ? "■" : "▶";
  if (lbl) lbl.textContent = driving ? "Stop" : "Drive";
}

function startDriving() {
  if (!requireMap()) return;
  if (!("geolocation" in navigator)) { toast("This device has no GPS / geolocation support."); return; }
  state.driving = true;
  setDriveButton(true);
  ui.dash.classList.add("dash--driving");   // hide the status sub-line for a slimmer bar
  setStatus("active", driveLabel());
  keepAwake(true);
  state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true, maximumAge: 2000, timeout: 15000,
  });
}

function stopDriving() {
  state.driving = false;
  setDriveButton(false);
  ui.dash.classList.remove("dash--driving");
  setStatus("idle", "Idle");
  hideAlert();
  keepAwake(false);
  if (state.watchId != null) { navigator.geolocation.clearWatch(state.watchId); state.watchId = null; }
}

function onPosition(pos) {
  const { latitude, longitude, accuracy, heading, speed } = pos.coords;
  state.me = { lat: latitude, lon: longitude, accuracy, heading, speed };
  updateMeMarker();
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
  if (!state.me || !map) return;
  const pos = { lat: state.me.lat, lng: state.me.lon };
  const acc = state.me.accuracy || 20;

  if (!meMarker) {
    meMarker = new google.maps.Marker({ position: pos, map, icon: meIcon(), zIndex: 9999 });
    meAccuracyCircle = new google.maps.Circle({
      center: pos, radius: acc, map,
      strokeColor: "#4f8cff", strokeOpacity: 0.4, strokeWeight: 1, fillColor: "#4f8cff", fillOpacity: 0.06,
    });
    alertRadiusCircle = new google.maps.Circle({
      center: pos, radius: state.settings.distance, map,
      strokeColor: "#ffb020", strokeOpacity: 0.5, strokeWeight: 1, fillColor: "#ffb020", fillOpacity: 0.06,
    });
    map.setCenter(pos); map.setZoom(16);
  } else {
    meMarker.setPosition(pos);
    meAccuracyCircle.setCenter(pos); meAccuracyCircle.setRadius(acc);
    alertRadiusCircle.setCenter(pos); alertRadiusCircle.setRadius(state.settings.distance);
    if (state.driving || recenter) map.panTo(pos);
  }
}

/* --------------------------- Proximity engine ---------------------------- */

function evaluateProximity() {
  if (!state.me) return;
  const cams = allCameras();
  if (cams.length === 0) {
    ui.dashDist.textContent = "—";
    ui.dashSub.textContent = "No cameras mapped nearby";
    return;
  }

  let nearest = null, nearestDist = Infinity, withinAlert = 0;
  for (const cam of cams) {
    const d = haversine(state.me.lat, state.me.lon, cam.lat, cam.lon);
    if (d < nearestDist) { nearestDist = d; nearest = cam; }
    if (d <= state.settings.distance) withinAlert++;
  }

  ui.dashDist.textContent = formatDistance(nearestDist) + " to nearest";
  ui.dashSub.textContent = `${withinAlert} in range · ${cams.length} mapped nearby`;

  if (nearest && nearestDist <= state.settings.distance) triggerAlert(nearest, nearestDist, withinAlert);
  else hideAlert();
}

function triggerAlert(cam, dist, count) {
  const label = cam.type === "speed" ? "Speed camera" : "License-plate camera";
  ui.alertTitle.textContent = `${label} ahead`;
  ui.alertBanner.classList.remove("hidden");
  ui.alertDistance.textContent = `${formatDistance(dist)} away` + (count > 1 ? ` · ${count} cameras in range` : "");
  const last = state.alerted.get(cam.id) || 0;
  const now = Date.now();
  if (now - last < ALERT_COOLDOWN_MS) return;
  state.alerted.set(cam.id, now);
  if (state.settings.vibrate && navigator.vibrate) navigator.vibrate([200, 80, 200]);
  if (state.settings.sound) beep();
  if (state.settings.voice) speak(`${label} ${formatDistance(dist)} ahead`);
  if (state.settings.notify) systemNotify(`${label} ahead`, `${formatDistance(dist)} away`);
}

function hideAlert() { ui.alertBanner.classList.add("hidden"); }

function systemNotify(title, body) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification(title, { body, icon: "icon.svg", tag: "flockalert", renotify: true });
  } catch (e) { console.warn("notify failed", e); }
}

/* ------------------------------- Alerts ---------------------------------- */

function beep() {
  try {
    if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = state.audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime;
    [880, 1100].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      const start = t + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.4, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start); osc.stop(start + 0.18);
    });
  } catch (e) { console.warn("beep failed", e); }
}

function speak(text) {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; speechSynthesis.speak(u);
  } catch (e) { console.warn("speak failed", e); }
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
      await wakeLock.release(); wakeLock = null;
    }
  } catch (e) { console.warn("wakeLock", e); }
}
async function reacquireWakeLock() {
  if (state.driving && document.visibilityState === "visible" && "wakeLock" in navigator) {
    try { wakeLock = await navigator.wakeLock.request("screen"); } catch {}
  }
}

/* ------------------------- Manual camera adding -------------------------- */

function enterAddMode() {
  if (!requireMap()) return;
  state.addMode = true;
  ui.addHint.classList.remove("hidden");
  toast("Tap the map to drop a camera point.");
  map.setOptions({ draggableCursor: "crosshair" });
}
function exitAddMode() {
  state.addMode = false;
  ui.addHint.classList.add("hidden");
  if (map) map.setOptions({ draggableCursor: null });
}

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
  if (state.manualCameras.length === 0) { ui.manualList.textContent = "None yet."; return; }
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
  ui.setSpeed.checked = state.settings.speed;
  ui.setNotify.checked = state.settings.notify;
}

ui.setDistance.addEventListener("input", () => {
  state.settings.distance = Number(ui.setDistance.value);
  ui.setDistanceOut.textContent = formatDistance(state.settings.distance);
  if (alertRadiusCircle) alertRadiusCircle.setRadius(state.settings.distance);
  saveSettings();
  if (state.me) evaluateProximity();
});
ui.setUnits.addEventListener("change", () => {
  state.settings.units = ui.setUnits.value; saveSettings(); syncSettingsUI();
  if (state.me) evaluateProximity();
});
ui.setSound.addEventListener("change", () => { state.settings.sound = ui.setSound.checked; saveSettings(); if (ui.setSound.checked) beep(); });
ui.setVoice.addEventListener("change", () => { state.settings.voice = ui.setVoice.checked; saveSettings(); });
ui.setVibrate.addEventListener("change", () => { state.settings.vibrate = ui.setVibrate.checked; saveSettings(); if (ui.setVibrate.checked && navigator.vibrate) navigator.vibrate(120); });
ui.setOsm.addEventListener("change", () => {
  state.settings.osm = ui.setOsm.checked; saveSettings();
  lastViewKey = ""; fetchCamerasInView();
});
ui.setSpeed.addEventListener("change", () => {
  state.settings.speed = ui.setSpeed.checked; saveSettings();
  lastViewKey = ""; fetchCamerasInView();
});
ui.setNotify.addEventListener("change", () => {
  state.settings.notify = ui.setNotify.checked; saveSettings();
  if (ui.setNotify.checked && "Notification" in window && Notification.permission !== "granted") {
    Notification.requestPermission().then((p) => {
      if (p !== "granted") { state.settings.notify = false; ui.setNotify.checked = false; saveSettings(); toast("Notifications blocked in browser settings."); }
      else systemNotify("Notifications on", "You'll get alerts as you approach cameras.");
    });
  }
});

/* ------------------------------- Buttons --------------------------------- */

ui.btnStart.addEventListener("click", () => { unlockAudio(); state.driving ? stopDriving() : startDriving(); });

ui.btnLocate.addEventListener("click", () => {
  if (!requireMap()) return;
  if (state.me) { map.panTo({ lat: state.me.lat, lng: state.me.lon }); map.setZoom(16); }
  else if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (p) => { onPosition(p); map.setCenter({ lat: p.coords.latitude, lng: p.coords.longitude }); map.setZoom(16); },
      onPositionError, { enableHighAccuracy: true }
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
    state.manualCameras = []; saveManual(); renderCameras(); renderManualList();
    if (state.me) evaluateProximity();
  }
});

/* ------------------------------- Helpers --------------------------------- */

function setStatus(kind, text) { ui.status.className = "status status--" + kind; ui.status.textContent = text; }
function driveLabel() { return state.driving ? "Driving · watching" : "Idle"; }

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

  if (!CFG.googleMapsKey) {
    showMapMessage("Google Maps key needed",
      "Add your Google Maps API key to <code>config.js</code> (the <code>googleMapsKey</code> field), then reload. Enable “Maps JavaScript API” and “Street View Static API” with billing in Google Cloud Console.");
  } else {
    loadGoogleMaps()
      .then(initMap)
      .catch(() => showMapMessage("Map failed to load",
        "Check that your Google Maps key is valid, has billing enabled, and is allowed for this domain."));
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.info("SW registration failed", e));
  }
}

init();
