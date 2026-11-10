# Tellering Offices Map

Static map of tellering offices (Puerto, Tagoloan, Villanueva, Jasaan), built with Leaflet + OpenStreetMap. No build step.

## Deploy on Netlify
1. Push this folder to a GitHub repo.
2. Netlify > Add new site > Import from Git > pick the repo.
3. Build command: (leave empty). Publish directory: `.` (already set in netlify.toml).

## Add or edit an office
Edit `offices.json` (name, lat, lng, streetview). Commit and push; Netlify redeploys.

## Run locally
`python3 -m http.server 8000` then open http://localhost:8000

## Customer location and navigation
- "Use my current location" asks the browser for GPS permission (needs HTTPS, which Netlify provides).
- If GPS is denied or unavailable, customers tap the map to pin their location and can drag the pin.
- The nearest office is highlighted and offices are sorted by distance. Tapping an office makes it the preferred one.
- Clicking a marker shows a photo of the office (images/ folder, set per office in offices.json); tap it to enlarge.
- A Google-style blue route, travel time, distance and step-by-step directions are drawn in the page using free OSRM servers (routing.openstreetmap.de; no API key). Public transport is not supported there, so it falls back to the "Open in Google Maps app" button.
- The nearest office is picked by road distance when the routing service is reachable, otherwise by straight-line distance.
- For heavy production use, switch to your own routing key (OpenRouteService, Mapbox or Google Directions) because the free servers have fair-use limits.

## Reliable road routing (recommended)
Edit `config.js`:
- `googleMapsKey`: uses Google Directions (same roads and routes as Google Maps, also supports public transport). Enable "Maps JavaScript API" in Google Cloud, enable billing (there is a monthly free credit) and restrict the key to your Netlify domain.
- `orsKey`: free OpenRouteService key, no credit card.
If both are empty, the free OSRM servers are used. Providers are tried in this order: Google, OpenRouteService, OSRM.
