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
