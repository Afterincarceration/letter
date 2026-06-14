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
  line: null,            // L.polyline of the route
  camLayer: null,        // L.layerGroup of route-camera markers
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
  distance: el("route-distance"),
  duration: el("route-duration"),
  camcount: el("route-camcount"),
  name: el("route-name"),
  save: el("btn-route-save"),
  camList: el("route-cam-list"),
  savedList: el("saved-routes"),
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

async function fetchRouteCameras(coords, buffer) {
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  for (const [la, lo] of coords) {
    if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
    if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo;
  }
  const padLat = (buffer + 50) / 111000;
  const padLon = padLat / Math.max(0.2, Math.cos((minLat + maxLat) / 2 * Math.PI / 180));
  const bbox = `${minLat - padLat},${minLon - padLon},${maxLat + padLat},${maxLon + padLon}`;

  const q = `
    [out:json][timeout:30];
    (
      node["man_made"="surveillance"]["surveillance:type"="ALPR"](${bbox});
      node["man_made"="surveillance"]["camera:type"="alpr"](${bbox});
    );
    out body;`;

  let candidates = [];
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
        .map((e) => ({
          id: "osm-" + e.id, lat: e.lat, lon: e.lon, source: "osm",
          name: e.tags?.brand || e.tags?.operator || "ALPR camera",
        }));
      break;
    } catch (err) {
      console.warn("Overpass (route) failed:", url, err);
    }
  }

  // Include the user's own points that fall inside the bbox.
  for (const c of state.manualCameras) {
    if (c.lat >= minLat - padLat && c.lat <= maxLat + padLat &&
        c.lon >= minLon - padLon && c.lon <= maxLon + padLon) {
      candidates.push(c);
    }
  }

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
  if (routeState.line) { map.removeLayer(routeState.line); routeState.line = null; }
  if (routeState.camLayer) { map.removeLayer(routeState.camLayer); routeState.camLayer = null; }
}

function drawRoute(coords, cameras) {
  clearRouteLayers();
  routeState.line = L.polyline(coords, { color: "#4f8cff", weight: 5, opacity: 0.85 }).addTo(map);

  routeState.camLayer = L.layerGroup().addTo(map);
  cameras.forEach((cam, i) => {
    const manual = cam.source === "manual";
    const m = L.marker([cam.lat, cam.lon], {
      icon: L.divIcon({
        className: "",
        html: `<div class="cam-marker cam-marker--route ${manual ? "cam-marker--manual" : ""}"></div>`,
        iconSize: [22, 22], iconAnchor: [11, 11],
      }),
      zIndexOffset: 500,
    });
    m.bindPopup(
      `<strong>#${i + 1} · ${escapeHtml(cam.name || "ALPR camera")}</strong><br>` +
      `<small>${manual ? "Added by you" : "DeFlock / OSM"} · ${formatDistance(cam.along)} into trip</small>`
    );
    routeState.camLayer.addLayer(m);
  });

  map.fitBounds(routeState.line.getBounds(), { padding: [50, 50] });
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

async function planRoute(opts = {}) {
  if (routeState.busy) return;
  routeState.busy = true;
  rUi.go.disabled = true;
  rUi.go.textContent = "Finding…";
  try {
    const start = opts.start || (await resolveStart());
    const end = opts.end || (rUi.end.value.trim() ? await geocode(rUi.end.value) : null);
    if (!end) throw new Error("Enter a destination.");

    toast("Calculating route…");
    const route = await getRoute(start, end);

    toast("Scanning route for cameras…");
    const cameras = await fetchRouteCameras(route.coords, routeState.buffer);

    drawRoute(route.coords, cameras);

    routeState.current = { start, end, ...route, buffer: routeState.buffer, cameras };
    showRouteResult(routeState.current);
    if (!opts.start) rUi.name.value = suggestName(start, end);
  } catch (err) {
    console.warn(err);
    toast(err.message || "Something went wrong planning that route.");
  } finally {
    routeState.busy = false;
    rUi.go.disabled = false;
    rUi.go.textContent = "🔍 Find cameras on route";
  }
}

function suggestName(start, end) {
  const short = (l) => (l === "My location" ? "Home" : String(l).split(",")[0]);
  return `${short(start.label)} → ${short(end.label)}`;
}

function showRouteResult(r) {
  rUi.result.classList.remove("hidden");
  rUi.distance.textContent = formatDistance(r.distance);
  rUi.duration.textContent = formatDuration(r.duration);
  rUi.camcount.textContent = r.cameras.length;

  if (r.cameras.length === 0) {
    rUi.camList.innerHTML = `<div class="rcam">No mapped ALPR cameras within ${formatDistance(r.buffer)} of this route. (Coverage may be incomplete.)</div>`;
    return;
  }
  rUi.camList.innerHTML = "";
  r.cameras.forEach((cam, i) => {
    const row = document.createElement("div");
    row.className = "rcam" + (cam.source === "manual" ? " rcam--manual" : "");
    row.innerHTML =
      `<span class="rcam__idx">${i + 1}</span>` +
      `<span class="rcam__name">${escapeHtml(cam.name || "ALPR camera")}</span>` +
      `<span class="rcam__along">${formatDistance(cam.along)} in</span>`;
    row.addEventListener("click", () => {
      map.setView([cam.lat, cam.lon], 17);
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
  toast(`Saved "${name}"`);
}

function deleteSavedRoute(id) {
  routeState.saved = routeState.saved.filter((r) => r.id !== id);
  persistRoutes();
  renderSavedRoutes();
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
