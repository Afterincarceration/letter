/* FlockAlert — route planner.
 * Plan a trip (start -> destination), draw the driving route, and find every
 * ALPR camera within a buffer of that route. Save regular commutes so you can
 * re-check them anytime. Reuses globals from app.js (map, state, haversine,
 * formatDistance, toast, escapeHtml).
 *
 * Free OSM stack — no API keys:
 *   - Nominatim  : address/place geocoding
 *   - OSRM       : driving route geometry
 *   - Overpass   : ALPR cameras in the route bounding box
 */
"use strict";

const routeState = {
  line: null,            // google.maps.Polyline of the route
  markers: [],           // google.maps.Marker[] for route cameras
  current: null,         // { start, end, coords, distance, duration, buffer, cameras }
  buffer: Number(localStorage.getItem("fa_routebuffer")) || 150,
  saved: loadRoutes(),
  busy: false,
};

const rUi = {
  sheet: el("routes"),
  open: el("btn-routes"),
  close: el("btn-routes-close"),
  start: el("route-start"),
  end: el("route-end"),
  startMe: el("btn-route-start-me"),
  buffer: el("route-buffer"),
  bufferOut: el("route-buffer-out"),
  go: el("btn-route-go"),
  result: el("route-result"),
  options: el("route-options"),
  distance: el("route-distance"),
  duration: el("route-duration"),
  camcount: el("route-camcount"),
  name: el("route-name"),
  save: el("btn-route-save"),
  camList: el("route-cam-list"),
  savedList: el("saved-routes"),
  openGmaps: el("open-gmaps"),
  openWaze: el("open-waze"),
  openApple: el("open-apple"),
  openNote: el("route-open__note") || document.querySelector(".route-open__note"),
};

/* ------------------------------ Persistence ------------------------------ */

function loadRoutes() {
  try { return JSON.parse(localStorage.getItem("fa_routes") || "[]"); }
  catch { return []; }
}
function persistRoutes() {
  localStorage.setItem("fa_routes", JSON.stringify(routeState.saved));
}

/* ----------------------------- Geo / routing ----------------------------- */

async function geocode(query) {
  // Geoapify (keyed, scalable) when configured; otherwise free Nominatim.
  if (CFG.geoapifyKey) {
    const url =
      "https://api.geoapify.com/v1/geocode/search?format=json&limit=1&text=" +
      encodeURIComponent(query) + "&apiKey=" + CFG.geoapifyKey;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Geocoding failed (" + res.status + ")");
    const data = await res.json();
    const r = data.results && data.results[0];
    if (!r) throw new Error(`Couldn't find "${query}"`);
    return { lat: r.lat, lon: r.lon, label: r.formatted };
  }
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" +
    encodeURIComponent(query);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Geocoding failed (" + res.status + ")");
  const data = await res.json();
  if (!data.length) throw new Error(`Couldn't find "${query}"`);
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), label: data[0].display_name };
}

async function getRoute(start, end) {
  // Geoapify (keyed, scalable) when configured; otherwise free OSRM demo server.
  if (CFG.geoapifyKey) {
    const url =
      `https://api.geoapify.com/v1/routing?waypoints=` +
      `${start.lat},${start.lon}|${end.lat},${end.lon}` +
      `&mode=drive&apiKey=${CFG.geoapifyKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Routing failed (" + res.status + ")");
    const data = await res.json();
    const f = data.features && data.features[0];
    if (!f) throw new Error("No route found between those points.");
    const g = f.geometry;
    const coords = [];
    const lines = g.type === "MultiLineString" ? g.coordinates : [g.coordinates];
    for (const line of lines) for (const [lon, lat] of line) coords.push([lat, lon]);
    return { coords, distance: f.properties.distance, duration: f.properties.time };
  }
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${start.lon},${start.lat};${end.lon},${end.lat}` +
    `?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Routing failed (" + res.status + ")");
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) throw new Error("No route found between those points.");
  const r = data.routes[0];
  // GeoJSON is [lon, lat]; Leaflet wants [lat, lon].
  const coords = r.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  return { coords, distance: r.distance, duration: r.duration };
}

/* --------------------- Point-to-route distance (meters) ------------------ */
/* Uses a single equirectangular projection (ref = route mid-latitude) so we
 * can do fast planar segment math. Accurate enough at metro scale. Returns
 * { dist, along } where `along` is meters traveled from the route start to the
 * closest point on the route. */

function projectRoute(coords) {
  const R = 6371000;
  const refLat = coords[Math.floor(coords.length / 2)][0] * Math.PI / 180;
  const cosRef = Math.cos(refLat);
  const pts = coords.map(([lat, lon]) => ({
    x: (lon * Math.PI / 180) * cosRef * R,
    y: (lat * Math.PI / 180) * R,
  }));
  const cum = [0];
  const segLen = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segLen.push(d);
    cum.push(cum[i - 1] + d);
  }
  return { pts, cum, segLen, cosRef, R };
}

function distToRoute(lat, lon, proj) {
  const px = (lon * Math.PI / 180) * proj.cosRef * proj.R;
  const py = (lat * Math.PI / 180) * proj.R;
  let best = Infinity, bestAlong = 0;
  for (let i = 1; i < proj.pts.length; i++) {
    const a = proj.pts[i - 1], b = proj.pts[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx, cy = a.y + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best) {
      best = d;
      bestAlong = proj.cum[i - 1] + t * proj.segLen[i - 1];
    }
  }
  return { dist: best, along: bestAlong };
}

/* --------------------- Cameras along the planned route ------------------- */

// Fetch all ALPR cameras (OSM + your own points) in the bounding box that
// covers EVERY candidate route, in a single Overpass call.
async function fetchCandidates(allCoords, buffer) {
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  for (const [la, lo] of allCoords) {
    if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
    if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo;
  }
  const padLat = (buffer + 50) / 111000;
  const padLon = padLat / Math.max(0.2, Math.cos((minLat + maxLat) / 2 * Math.PI / 180));
  const bbox = `${minLat - padLat},${minLon - padLon},${maxLat + padLat},${maxLon + padLon}`;

  const parts = [];
  if (state.settings.osm) {
    parts.push(`node["man_made"="surveillance"]["surveillance:type"="ALPR"](${bbox});`);
    parts.push(`node["man_made"="surveillance"]["camera:type"="alpr"](${bbox});`);
  }
  if (state.settings.speed) {
    parts.push(`node["highway"="speed_camera"](${bbox});`);
    parts.push(`node["enforcement"="maxspeed"](${bbox});`);
  }

  let candidates = [];
  if (parts.length) {
    const q = `[out:json][timeout:30];(${parts.join("")});out body;`;
    for (const url of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          body: "data=" + encodeURIComponent(q),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        candidates = (data.elements || [])
          .filter((e) => e.lat && e.lon)
          .map((e) => {
            const t = e.tags || {};
            const isSpeed = t.highway === "speed_camera" || t.enforcement === "maxspeed";
            return {
              id: (isSpeed ? "spd-" : "osm-") + e.id, lat: e.lat, lon: e.lon, source: "osm",
              type: isSpeed ? "speed" : "alpr",
              name: isSpeed ? "Speed camera" : (t.brand || t.operator || "ALPR camera"),
              dir: t.direction != null ? Number(t.direction) : null,
            };
          });
        break;
      } catch (err) {
        console.warn("Overpass (route) failed:", url, err);
      }
    }
  }

  for (const c of state.manualCameras) {
    if (c.lat >= minLat - padLat && c.lat <= maxLat + padLat &&
        c.lon >= minLon - padLon && c.lon <= maxLon + padLon) {
      candidates.push(c);
    }
  }
  return candidates;
}

// Which of the candidate cameras fall within `buffer` of a given route.
function camerasOnRoute(coords, candidates, buffer) {
  const proj = projectRoute(coords);
  const onRoute = [];
  for (const cam of candidates) {
    const { dist, along } = distToRoute(cam.lat, cam.lon, proj);
    if (dist <= buffer) onRoute.push({ ...cam, dist, along });
  }
  onRoute.sort((a, b) => a.along - b.along);
  return onRoute;
}

/* ------------------------------- Drawing --------------------------------- */

function clearRouteLayers() {
  if (routeState.line) { routeState.line.setMap(null); routeState.line = null; }
  routeState.markers.forEach((m) => m.setMap(null));
  routeState.markers = [];
}

function drawRoute(coords, cameras) {
  clearRouteLayers();
  const path = coords.map(([lat, lon]) => ({ lat, lng: lon }));
  routeState.line = new google.maps.Polyline({
    path, map, strokeColor: "#4f8cff", strokeOpacity: 0.9, strokeWeight: 5,
  });

  const bounds = new google.maps.LatLngBounds();
  path.forEach((p) => bounds.extend(p));

  cameras.forEach((cam, i) => {
    const m = new google.maps.Marker({
      position: { lat: cam.lat, lng: cam.lon },
      map,
      icon: camIcon(cam, true),
      zIndex: 600,
      title: `#${i + 1} · ${cam.name || "ALPR camera"}`,
    });
    m.addListener("click", () => openCameraInfo(cam, m, i + 1));
    routeState.markers.push(m);
  });

  map.fitBounds(bounds, 60);
}

/* --------------------------------- Plan ---------------------------------- */

function formatDuration(sec) {
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function isMyLocationInput(v) {
  return !v || !v.trim() || /my location|current location/i.test(v);
}

async function resolveStart() {
  const v = rUi.start.value;
  if (isMyLocationInput(v)) {
    if (state.me) return { lat: state.me.lat, lon: state.me.lon, label: "My location" };
    throw new Error("Enable location (tap 🎯) or type a start address.");
  }
  return geocode(v);
}

// Google Directions via the Maps JS API (browser-safe; the Directions web
// service blocks CORS). Returns native route objects with alternatives.
function gmDirections(start, end) {
  return new Promise((resolve, reject) => {
    const svc = new google.maps.DirectionsService();
    svc.route(
      {
        origin: { lat: start.lat, lng: start.lon },
        destination: { lat: end.lat, lng: end.lon },
        travelMode: google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: true,
      },
      (res, status) => {
        if (status === "OK" && res.routes && res.routes.length) resolve(res.routes);
        else reject(new Error("Google Directions: " + status));
      }
    );
  });
}

// Get up to ~3 driving routes (alternatives). Prefers Google Directions
// (best alternatives); falls back to OSRM if Google is unavailable/denied.
async function getRoutes(start, end) {
  if (window.google && google.maps && google.maps.DirectionsService) {
    try {
      const groutes = await gmDirections(start, end);
      return groutes.map((r) => {
        const coords = (r.overview_path || []).map((p) => [p.lat(), p.lng()]);
        let distance = 0, duration = 0;
        (r.legs || []).forEach((l) => { distance += l.distance?.value || 0; duration += l.duration?.value || 0; });
        return { coords, distance, duration };
      });
    } catch (e) {
      console.warn("Google Directions failed; falling back to OSRM.", e);
    }
  }
  if (CFG.geoapifyKey) return [await getRoute(start, end)];
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${start.lon},${start.lat};${end.lon},${end.lat}` +
    `?overview=full&geometries=geojson&alternatives=3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Routing failed (" + res.status + ")");
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) throw new Error("No route found between those points.");
  return data.routes.map((r) => ({
    coords: r.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
    distance: r.distance,
    duration: r.duration,
  }));
}

// 0-100 exposure score for a route: more cameras, and closer to your path,
// push it higher (saturating). Lower = less surveilled.
function exposureScore(cameras, buffer) {
  let weighted = 0;
  for (const c of cameras) weighted += 1 - 0.6 * Math.min(1, (c.dist || 0) / buffer);
  return Math.round(100 * (1 - Math.exp(-weighted / 6)));
}
function scoreClass(s) { return s <= 20 ? "low" : s <= 50 ? "mid" : "high"; }

async function planRoute(opts = {}) {
  if (routeState.busy) return;
  routeState.busy = true;
  rUi.go.disabled = true;
  rUi.go.textContent = "Finding…";
  try {
    const start = opts.start || (await resolveStart());
    const end = opts.end || (rUi.end.value.trim() ? await geocode(rUi.end.value) : null);
    if (!end) throw new Error("Enter a destination.");

    toast("Calculating routes…");
    const routes = await getRoutes(start, end);

    toast("Scanning routes for cameras…");
    const candidates = await fetchCandidates(routes.flatMap((r) => r.coords), routeState.buffer);

    // Score each route: cameras passed, weighted by closeness → 0-100 exposure.
    routes.forEach((r) => {
      r.cameras = camerasOnRoute(r.coords, candidates, routeState.buffer);
      r.camCount = r.cameras.length;
      r.score = exposureScore(r.cameras, routeState.buffer);
    });

    // Cameras present on EVERY route = unavoidable.
    let unavoidable = null;
    routes.forEach((r) => {
      const ids = new Set(r.cameras.map((c) => c.id));
      unavoidable = unavoidable === null ? ids : new Set([...unavoidable].filter((x) => ids.has(x)));
    });
    routeState.unavoidable = unavoidable || new Set();

    // Tag fastest + safest; default to lowest exposure (ties → faster).
    const fastestIdx = routes.reduce((b, r, i) => (r.duration < routes[b].duration ? i : b), 0);
    const safestIdx = routes.reduce(
      (b, r, i) => (r.score < routes[b].score || (r.score === routes[b].score && r.duration < routes[b].duration) ? i : b), 0);
    routes.forEach((r, i) => { r.fastest = i === fastestIdx; r.safest = i === safestIdx; });

    routeState.routes = routes;
    routeState.start = start;
    routeState.end = end;
    selectRoute(safestIdx);                 // show the least-surveilled by default
    if (!opts.start) rUi.name.value = suggestName(start, end);
  } catch (err) {
    console.warn(err);
    toast(err.message || "Something went wrong planning that route.");
  } finally {
    routeState.busy = false;
    rUi.go.disabled = false;
    rUi.go.textContent = "🔍 Compare routes by surveillance";
  }
}

function selectRoute(idx) {
  const routes = routeState.routes || [];
  const r = routes[idx];
  if (!r) return;
  routeState.selected = idx;
  drawRoute(r.coords, r.cameras);
  routeState.current = {
    start: routeState.start, end: routeState.end,
    coords: r.coords, distance: r.distance, duration: r.duration,
    buffer: routeState.buffer, cameras: r.cameras,
  };
  renderRouteOptions();
  showRouteResult(routeState.current);
  setNavLinks(r);
}

// Pick n points evenly along the route (excluding endpoints) as waypoints.
function sampleWaypoints(coords, n) {
  if (!coords || coords.length <= 2 || n <= 0) return [];
  const pts = [];
  for (let k = 1; k <= n; k++) {
    const idx = Math.round((k / (n + 1)) * (coords.length - 1));
    pts.push(coords[idx]);
  }
  return pts;
}

// Build "open in nav app" deep links for the selected route.
function setNavLinks(route) {
  const s = routeState.start, e = routeState.end;
  if (!s || !e || !rUi.openGmaps) return;
  const orig = `${s.lat},${s.lon}`;
  const dest = `${e.lat},${e.lon}`;
  const wps = sampleWaypoints(route.coords, 8)
    .map(([la, lo]) => `${la.toFixed(5)},${lo.toFixed(5)}`)
    .join("|");
  // Google Maps: waypoints force it onto THIS low-surveillance route.
  rUi.openGmaps.href =
    `https://www.google.com/maps/dir/?api=1&origin=${orig}&destination=${dest}&travelmode=driving` +
    (wps ? `&waypoints=${encodeURIComponent(wps)}` : "");
  // Waze + Apple: destination only (they choose their own road).
  rUi.openWaze.href = `https://waze.com/ul?ll=${dest}&navigate=yes`;
  rUi.openApple.href = `https://maps.apple.com/?daddr=${dest}&dirflg=d`;
  if (rUi.openNote) {
    rUi.openNote.textContent =
      "Google Maps follows this exact route (via waypoints). Waze & Apple navigate to the destination on their own roads.";
  }
}

function renderRouteOptions() {
  const routes = routeState.routes || [];
  if (routes.length <= 1) { rUi.options.innerHTML = ""; return; }
  rUi.options.innerHTML = `<div class="route-options__title">${routes.length} route options — lower exposure score = less surveillance</div>`;
  routes.forEach((r, i) => {
    const tag = r.safest ? "🛡️ Least surveilled" : r.fastest ? "⚡ Fastest" : "Alt";
    const row = document.createElement("button");
    row.className = "route-opt" + (i === routeState.selected ? " is-sel" : "");
    row.innerHTML =
      `<span class="route-opt__tag">${tag}</span>` +
      `<span class="route-opt__meta">${formatDuration(r.duration)} · ${formatDistance(r.distance)} · ${r.camCount} 📷</span>` +
      `<span class="route-opt__cams ${scoreClass(r.score)}">${r.score}</span>`;
    row.addEventListener("click", () => selectRoute(i));
    rUi.options.appendChild(row);
  });
}

function suggestName(start, end) {
  const short = (l) => (l === "My location" ? "Home" : String(l).split(",")[0]);
  return `${short(start.label)} → ${short(end.label)}`;
}

function showRouteResult(r) {
  rUi.result.classList.remove("hidden");
  rUi.distance.textContent = formatDistance(r.distance);
  rUi.duration.textContent = formatDuration(r.duration);
  const score = exposureScore(r.cameras, r.buffer);
  rUi.camcount.textContent = score;
  rUi.camcount.className = "route-stat score-" + scoreClass(score);

  if (r.cameras.length === 0) {
    rUi.camList.innerHTML = `<div class="rcam">No mapped cameras within ${formatDistance(r.buffer)} of this route. (Coverage may be incomplete.)</div>`;
    return;
  }
  rUi.camList.innerHTML = "";
  const unav = routeState.unavoidable ? r.cameras.filter((c) => routeState.unavoidable.has(c.id)).length : 0;
  const worst = r.cameras.slice().sort((a, b) => (a.dist || 0) - (b.dist || 0))[0];
  const hdr = document.createElement("div");
  hdr.className = "rcam-hdr";
  hdr.innerHTML =
    `${r.cameras.length} camera${r.cameras.length === 1 ? "" : "s"} within ${formatDistance(r.buffer)} of your path` +
    (unav ? ` · <b>${unav} unavoidable</b> (on every route)` : "") +
    (worst ? `<br>Closest: ${escapeHtml(worst.name || "camera")} — ${formatDistance(worst.dist || 0)} off your path` : "");
  rUi.camList.appendChild(hdr);
  r.cameras.forEach((cam, i) => {
    const row = document.createElement("div");
    row.className = "rcam" + (cam.source === "manual" ? " rcam--manual" : "");
    row.innerHTML =
      `<span class="rcam__idx">${i + 1}</span>` +
      `<span class="rcam__name">${escapeHtml(cam.name || "ALPR camera")}</span>` +
      `<span class="rcam__along">${formatDistance(cam.along)} in</span>`;
    row.addEventListener("click", () => {
      map.panTo({ lat: cam.lat, lng: cam.lon });
      map.setZoom(17);
      rUi.sheet.classList.add("hidden");
    });
    rUi.camList.appendChild(row);
  });
}

/* ----------------------------- Saved routes ------------------------------ */

function saveCurrentRoute() {
  if (!routeState.current) { toast("Plan a route first."); return; }
  const name = (rUi.name.value.trim()) || suggestName(routeState.current.start, routeState.current.end);
  const c = routeState.current;
  routeState.saved.unshift({
    id: "r-" + Date.now(),
    name,
    start: c.start,
    end: c.end,
    buffer: c.buffer,
    distance: c.distance,
    camCount: c.cameras.length,
  });
  persistRoutes();
  renderSavedRoutes();
  renderDashRoutes();
  toast(`Saved "${name}"`);
}

function deleteSavedRoute(id) {
  routeState.saved = routeState.saved.filter((r) => r.id !== id);
  persistRoutes();
  renderSavedRoutes();
  renderDashRoutes();
}

// Compact saved-routes list shown in the slide-up dashboard.
function renderDashRoutes() {
  const c = el("dash-routes");
  if (!c) return;
  if (!routeState.saved.length) { c.textContent = "No saved routes yet."; return; }
  c.innerHTML = "";
  routeState.saved.forEach((r) => {
    const row = document.createElement("button");
    row.className = "dash-route";
    row.innerHTML =
      `<span class="dash-route__name">${escapeHtml(r.name)}</span>` +
      `<span class="dash-route__badge">${r.camCount} 📷</span>`;
    row.addEventListener("click", () => {
      el("dash").classList.remove("dash--open");
      el("dash").classList.add("dash--peek");
      rUi.sheet.classList.remove("hidden");
      openSavedRoute(r);
    });
    c.appendChild(row);
  });
}

async function openSavedRoute(r) {
  rUi.start.value = r.start.label || "My location";
  rUi.end.value = r.end.label || "";
  routeState.buffer = r.buffer || 150;
  syncBufferUI();
  await planRoute({ start: r.start, end: r.end }); // re-route + re-scan for fresh camera data
}

function renderSavedRoutes() {
  if (!routeState.saved.length) {
    rUi.savedList.textContent = "None saved yet.";
    return;
  }
  rUi.savedList.innerHTML = "";
  for (const r of routeState.saved) {
    const row = document.createElement("div");
    row.className = "sroute";
    const main = document.createElement("div");
    main.className = "sroute__main";
    main.innerHTML =
      `<div class="sroute__name">${escapeHtml(r.name)}</div>` +
      `<div class="sroute__sub">${formatDistance(r.distance)} · last scan: ${r.camCount} cameras</div>`;
    main.addEventListener("click", () => openSavedRoute(r));

    const badge = document.createElement("span");
    badge.className = "sroute__badge";
    badge.textContent = `${r.camCount} 📷`;

    const del = document.createElement("button");
    del.className = "sroute__del";
    del.textContent = "🗑️";
    del.title = "Delete route";
    del.addEventListener("click", (e) => { e.stopPropagation(); deleteSavedRoute(r.id); });

    row.append(main, badge, del);
    rUi.savedList.appendChild(row);
  }
}

/* ------------------------------- UI wiring ------------------------------- */

function syncBufferUI() {
  rUi.buffer.value = routeState.buffer;
  rUi.bufferOut.textContent = formatDistance(routeState.buffer);
}

rUi.open.addEventListener("click", () => {
  syncBufferUI();
  renderSavedRoutes();
  rUi.sheet.classList.remove("hidden");
});
rUi.close.addEventListener("click", () => rUi.sheet.classList.add("hidden"));
rUi.sheet.addEventListener("click", (e) => { if (e.target === rUi.sheet) rUi.sheet.classList.add("hidden"); });

rUi.startMe.addEventListener("click", () => {
  rUi.start.value = "My location";
  if (!state.me && "geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (p) => { state.me = { lat: p.coords.latitude, lon: p.coords.longitude }; toast("Got your location."); },
      () => toast("Couldn't get your location."),
      { enableHighAccuracy: true }
    );
  }
});

rUi.buffer.addEventListener("input", () => {
  routeState.buffer = Number(rUi.buffer.value);
  rUi.bufferOut.textContent = formatDistance(routeState.buffer);
  localStorage.setItem("fa_routebuffer", String(routeState.buffer));
});

rUi.go.addEventListener("click", () => planRoute());
rUi.end.addEventListener("keydown", (e) => { if (e.key === "Enter") planRoute(); });
rUi.save.addEventListener("click", saveCurrentRoute);

syncBufferUI();
