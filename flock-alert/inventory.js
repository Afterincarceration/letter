/* FlockAlert — camera inventory.
 * Lists every ALPR camera in the current map view (DeFlock/OSM via Overpass),
 * with coordinates, brand, direction, and the OSM contributor. Copy or export
 * to CSV. Reuses globals from app.js (el, map, OVERPASS_ENDPOINTS, escapeHtml,
 * toast). This runs in the user's browser, so it works even where automated/
 * server-side fetches to Overpass are blocked.
 */
"use strict";

const invUi = {
  sheet: el("inventory"),
  open: el("btn-inventory"),
  close: el("btn-inventory-close"),
  summary: el("inv-summary"),
  list: el("inv-list"),
  copy: el("btn-inv-copy"),
  csv: el("btn-inv-csv"),
};

let invData = [];

function invCompass(deg) {
  if (deg == null || isNaN(deg)) return "";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

async function runInventory() {
  const b = map.getBounds();
  const bbox =
    `${b.getSouth().toFixed(5)},${b.getWest().toFixed(5)},` +
    `${b.getNorth().toFixed(5)},${b.getEast().toFixed(5)}`;

  invUi.summary.textContent = "Scanning the current map area…";
  invUi.list.innerHTML = "";
  invData = [];

  const q = `
    [out:json][timeout:30];
    (
      node["man_made"="surveillance"]["surveillance:type"="ALPR"](${bbox});
      node["man_made"="surveillance"]["camera:type"="alpr"](${bbox});
    );
    out meta;`;

  let elements = null;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: "data=" + encodeURIComponent(q),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      elements = data.elements || [];
      break;
    } catch (e) {
      console.warn("inventory overpass failed", url, e);
    }
  }

  if (elements === null) {
    invUi.summary.textContent = "Couldn't reach the camera database — try again in a moment.";
    return;
  }

  invData = elements
    .filter((e) => e.lat && e.lon)
    .map((e) => ({
      id: e.id,
      lat: e.lat,
      lon: e.lon,
      brand: e.tags?.brand || e.tags?.manufacturer || e.tags?.operator || "",
      dir: e.tags?.direction != null ? Number(e.tags.direction) : null,
      user: e.user || "",
      ts: e.timestamp ? e.timestamp.slice(0, 10) : "",
    }))
    .sort((a, b) => (a.lat === b.lat ? a.lon - b.lon : b.lat - a.lat)); // north -> south

  renderInventory();
}

function renderInventory() {
  const n = invData.length;
  const brands = {};
  invData.forEach((c) => {
    const k = c.brand || "unspecified";
    brands[k] = (brands[k] || 0) + 1;
  });
  const brandStr = Object.entries(brands)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");

  invUi.summary.innerHTML =
    `<strong>${n}</strong> ALPR camera${n === 1 ? "" : "s"} in the current map view` +
    (brandStr ? `<br><span class="inv-brands">${escapeHtml(brandStr)}</span>` : "");

  invUi.list.innerHTML = "";
  invData.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "inv-row";
    const dir = c.dir != null ? ` · faces ${invCompass(c.dir)} (${c.dir}°)` : "";
    row.innerHTML =
      `<span class="inv-idx">${i + 1}</span>` +
      `<div class="inv-main">` +
      `<div class="inv-coords">${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}</div>` +
      `<div class="inv-meta">${escapeHtml(c.brand || "ALPR")}${dir} · by ${escapeHtml(c.user || "?")}</div>` +
      `</div>` +
      `<a class="inv-osm" href="https://www.openstreetmap.org/node/${c.id}" target="_blank" rel="noopener">OSM</a>`;
    row.addEventListener("click", (e) => {
      if (e.target.tagName === "A") return;
      map.setView([c.lat, c.lon], 17);
      invUi.sheet.classList.add("hidden");
    });
    invUi.list.appendChild(row);
  });
}

function inventoryCSV() {
  const esc = (s) => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
  const header = "index,osm_id,lat,lon,brand,direction_deg,direction_compass,contributor,last_edit\n";
  const rows = invData
    .map((c, i) =>
      [i + 1, c.id, c.lat, c.lon, esc(c.brand), c.dir ?? "", invCompass(c.dir), esc(c.user), c.ts].join(",")
    )
    .join("\n");
  return header + rows;
}

invUi.open.addEventListener("click", () => {
  invUi.sheet.classList.remove("hidden");
  runInventory();
});
invUi.close.addEventListener("click", () => invUi.sheet.classList.add("hidden"));
invUi.sheet.addEventListener("click", (e) => {
  if (e.target === invUi.sheet) invUi.sheet.classList.add("hidden");
});

invUi.copy.addEventListener("click", async () => {
  if (!invData.length) { toast("Nothing to copy yet."); return; }
  const text = invData
    .map((c, i) =>
      `${i + 1}. ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)} — ${c.brand || "ALPR"}` +
      `${c.dir != null ? ` (faces ${invCompass(c.dir)})` : ""} — OSM ${c.id} by ${c.user || "?"}`
    )
    .join("\n");
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${invData.length} cameras.`);
  } catch {
    toast("Copy failed — try the CSV export.");
  }
});

invUi.csv.addEventListener("click", () => {
  if (!invData.length) { toast("Nothing to export yet."); return; }
  const blob = new Blob([inventoryCSV()], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "alpr-cameras.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
