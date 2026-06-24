/* FlockAlert configuration.
 * Everything here is OPTIONAL. With all keys left blank, the app uses free,
 * shared community services (CARTO tiles, OpenStreetMap Nominatim geocoding,
 * OSRM routing, public Overpass) — great for testing and small-scale sharing.
 *
 * For WIDE / PUBLIC release, paste in API keys below so the app uses providers
 * that won't rate-limit or break under load. No code changes needed — just keys.
 */
window.FLOCKALERT_CONFIG = {
  // --- Google Maps (map engine + Street View) -----------------------------
  // REQUIRED for the map to load. In Google Cloud Console: create an API key,
  // enable "Maps JavaScript API" + "Street View Static API", and turn on billing
  // (there's a generous free monthly tier). Restrict the key to your domain
  // (afterincarceration.github.io and/or your *.vercel.app domain) so it can't
  // be abused. Paste it here:
  googleMapsKey: "",

  // --- Map tiles (legacy / unused with Google Maps) ----------------------
  // Free key at https://cloud.maptiler.com (Account -> API keys).
  // Leave blank to use the free CARTO dark basemap.
  maptilerKey: "",
  maptilerStyle: "streets-v2-dark", // any MapTiler raster style id

  // --- Geocoding (address search) + Routing ------------------------------
  // ONE Geoapify key covers BOTH. Free tier ~3,000 requests/day.
  // Free key at https://myprojects.geoapify.com
  // Leave blank to use Nominatim (geocoding) + OSRM (routing), which are free
  // but rate-limited and not meant for heavy traffic.
  geoapifyKey: "",

  // --- ALPR camera data (DeFlock / OpenStreetMap) ------------------------
  // Cameras come from the Overpass API. These public instances are fine for
  // modest use; for heavy traffic, point this at your own Overpass instance.
  overpassEndpoints: [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ],
};
