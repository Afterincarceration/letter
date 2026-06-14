# FlockAlert 📷

A privacy tool that **alerts you when you're driving near Flock Safety and other
ALPR (Automated License Plate Reader) cameras.** It runs entirely in your phone's
browser — no account, no backend, no tracking of you.

It's an installable **Progressive Web App (PWA)**: open it once, "Add to Home
Screen," and it behaves like a native app.

## How it works

1. **Open the app** and tap **Start driving mode**. Grant location permission.
2. The map shows your position plus nearby ALPR cameras.
3. When you come within your chosen **alert distance** of a camera, you get a
   **visual banner + beep + vibration** (and an optional spoken warning).

### Where the camera data comes from

- **DeFlock / OpenStreetMap** — a live, crowdsourced map of ALPR cameras,
  queried from the public [Overpass API](https://overpass-api.de). No API key
  needed. Data is fetched around your location and refreshed as you travel.
- **Your own points** — tap **➕ Add camera** to drop a marker on the map (tap a
  spot, or use your current location). These are stored only in your browser
  (`localStorage`) and are merged with the crowdsourced data for alerts.

> Coverage varies by area. If your region looks empty, consider contributing
> sightings back to [deflock.me](https://deflock.me) so everyone benefits.

## Plan a route 🛣️

Tap **🛣️ Plan a route** to check your regular trips *before* you drive them:

1. Enter a **start** (or tap 🎯 to use your current location) and a **destination**.
2. The app geocodes both, draws the driving route, and lists **every ALPR camera
   within your detection buffer** of that route — in travel order, with how far
   into the trip each one sits.
3. **Save** the route (e.g. "Home → Work") and re-open it anytime to re-scan with
   fresh crowdsourced data. Tap any camera in the list to jump to it on the map.

Routing uses the public [OSRM](https://project-osrm.org) server, address search
uses [OpenStreetMap Nominatim](https://nominatim.org), and cameras come from the
same DeFlock/OSM + your-own-points data as driving mode. Saved routes live only
in your browser's `localStorage`.

## Features

- 🗺️ Live dark map (Leaflet + OpenStreetMap/CARTO tiles)
- 📍 Continuous GPS tracking in "driving mode" (`watchPosition`)
- ⚠️ Proximity alerts: banner + beep + vibration + optional voice
- 🛣️ **Route planner** — map a trip and see all cameras you'll cross; save commutes
- 🎚️ Adjustable alert radius (50 m – 1 km), metric or imperial units
- ➕ Add / remove your own camera points
- 🔆 Screen **wake lock** so the display stays on while driving
- 📴 Installable & works offline (app shell cached; data fetched live)
- 🔒 Privacy-first: your location never leaves the device

## Running it

It's plain static files — no build step.

```bash
# from this folder
python3 -m http.server 8000
# then open http://localhost:8000 on your phone (same Wi-Fi) or desktop
```

> **Note:** Geolocation, service workers, and wake lock require a **secure
> context** (HTTPS) — or `localhost` for testing. Deploy to any static host
> (GitHub Pages, Vercel, Netlify, Cloudflare Pages) to use it on the road.

## Scaling for wide release (API keys)

Out of the box the app uses **free, shared community services** (CARTO map tiles,
OpenStreetMap Nominatim geocoding, OSRM routing, public Overpass for cameras).
That's perfect for testing and sharing with individuals or your organization, but
those services are rate-limited and not meant for heavy traffic.

For a **public / high-traffic** release, open **`config.js`** and paste in keys —
no code changes needed, the app switches providers automatically:

| Need | Provider | Where to get a free key |
|------|----------|-------------------------|
| Map tiles | [MapTiler](https://cloud.maptiler.com) | Account → API keys → set `maptilerKey` |
| Geocoding **+** routing | [Geoapify](https://myprojects.geoapify.com) (one key does both) | set `geoapifyKey` |
| Camera data | Overpass (DeFlock/OSM) | optional: point `overpassEndpoints` at your own instance |

Leave any field blank to keep using the free fallback for that piece. Keys in
`config.js` are public (client-side) by design — use keys restricted by HTTP
referrer (both MapTiler and Geoapify support locking a key to your domain).

## Important & safety

- Camera data is crowdsourced and **may be incomplete or out of date.** Absence
  of an alert does **not** mean there are no cameras.
- **Don't interact with the app while driving.** Set it up before you go; let the
  audio/voice/vibration alerts do the work hands-free.
- This tool is for **lawful privacy awareness.** It does not help anyone evade
  law enforcement or break traffic laws.

## Tech

Vanilla JS, Leaflet, the browser Geolocation / Web Audio / Vibration / Wake Lock
/ Speech Synthesis APIs, and a service worker. No frameworks, no bundler.
