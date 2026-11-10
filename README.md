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
- "Navigate" opens Google Maps turn-by-turn directions from the customer's pin to the office. Distances shown in the app are straight-line.
