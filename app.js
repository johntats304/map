const map = L.map('map').setView([8.58, 124.76], 11);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const $ = id => document.getElementById(id);
const listEl = $('list'), statusEl = $('status'), nearestEl = $('nearest'), modeEl = $('mode');

// Free OSRM-based routing servers (no API key). Transit is not available, so it falls back to Google Maps.
const ROUTERS = {
  driving: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  walking: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
  bicycling: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving'
};
const CAR_TABLE = 'https://routing.openstreetmap.de/routed-car/table/v1/driving';

let offices = [];
let userPos = null;
let userMarker = null;
let selectedIdx = null;   // preferred office (user-chosen); null = use nearest
let roadKm = null;        // road distances (km) from the user to each office, if available
let routeLayers = [];
let routeCache = {};
let reqId = 0;

const youIcon = L.divIcon({ className: '', html: '<div style="width:18px;height:18px;border-radius:50%;background:#4285F4;border:3px solid #fff;box-shadow:0 0 0 2px #4285F4"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

function straightKm(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const distTo = i => (roadKm && roadKm[i] != null) ? roadKm[i] : straightKm(userPos, offices[i]);
const fmtKm = d => d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km';
const fmtMin = s => { const m = Math.round(s / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };

function gmapsUrl(o) {
  const origin = userPos ? `&origin=${userPos.lat},${userPos.lng}` : '';
  return `https://www.google.com/maps/dir/?api=1${origin}&destination=${o.lat},${o.lng}&travelmode=${modeEl.value}`;
}

function nearestIdx() {
  let best = 0, bestD = Infinity;
  offices.forEach((o, i) => { const d = distTo(i); if (d < bestD) { bestD = d; best = i; } });
  return best;
}

// ---------- user location ----------
let tableTimer = null;
function setUser(lat, lng, label) {
  userPos = { lat, lng };
  roadKm = null;
  routeCache = {};
  if (!userMarker) {
    userMarker = L.marker([lat, lng], { icon: youIcon, draggable: true, title: 'You' }).addTo(map);
    userMarker.on('dragend', () => { const p = userMarker.getLatLng(); setUser(p.lat, p.lng, 'Pin moved.'); });
  } else {
    userMarker.setLatLng([lat, lng]);
  }
  userMarker.bindPopup('You are here (drag to adjust)');
  statusEl.textContent = label || '';
  refresh(true);
  clearTimeout(tableTimer);
  tableTimer = setTimeout(loadRoadDistances, 300);
}

// nearest office by ROAD distance (falls back to straight-line if the service is unreachable)
async function loadRoadDistances() {
  const me = userPos;
  if (!me || !offices.length) return;
  const coords = [`${me.lng},${me.lat}`, ...offices.map(o => `${o.lng},${o.lat}`)].join(';');
  try {
    const r = await fetch(`${CAR_TABLE}/${coords}?sources=0&annotations=distance`);
    const j = await r.json();
    if (me !== userPos || j.code !== 'Ok') return;
    roadKm = j.distances[0].slice(1).map(m => m == null ? null : m / 1000);
    refresh(true);
  } catch (e) { /* keep straight-line distances */ }
}

// ---------- rendering ----------
function refresh(fit) {
  const order = offices.map((_, i) => i);
  if (userPos) order.sort((a, b) => distTo(a) - distTo(b));

  listEl.innerHTML = '';
  order.forEach(i => {
    const o = offices[i];
    const li = document.createElement('li');
    if (i === selectedIdx) li.classList.add('selected');
    li.innerHTML = `<strong>${o.name}</strong>` + (userPos ? `<span class="dist">${fmtKm(distTo(i))}${roadKm ? '' : ' (approx.)'}</span>` : '');
    li.addEventListener('click', () => { selectedIdx = i; refresh(false); map.setView([o.lat, o.lng], 15); o.marker.openPopup(); });
    listEl.appendChild(li);
  });

  if (!userPos && selectedIdx === null) { nearestEl.classList.add('hidden'); clearRoute(); return; }
  const idx = selectedIdx !== null ? selectedIdx : nearestIdx();
  const o = offices[idx];
  const isNearest = userPos && idx === nearestIdx();
  const title = selectedIdx !== null ? (isNearest ? 'Your preferred office (also the nearest)' : 'Your preferred office') : 'Nearest office';

  nearestEl.classList.remove('hidden');
  nearestEl.innerHTML = `<strong>${title}</strong><br>${o.name}
    <div id="route-info" class="hint">${userPos ? 'Finding the best route…' : 'Set your location to get directions.'}</div>
    <div id="route-steps"></div>
    <a class="go" href="${gmapsUrl(o)}" target="_blank" rel="noopener">Open in Google Maps app</a>` +
    (selectedIdx !== null && userPos ? `<br><button id="btn-nearest" style="margin-top:8px">Switch back to nearest</button>` : '');
  const bn = $('btn-nearest');
  if (bn) bn.addEventListener('click', () => { selectedIdx = null; refresh(true); });

  showRoute(idx, fit);
}

// ---------- routing (Google-style blue route) ----------
function clearRoute() { routeLayers.forEach(l => map.removeLayer(l)); routeLayers = []; }

function stepText(s) {
  const m = s.maneuver || {}, name = s.name ? ` onto ${s.name}` : '', mod = m.modifier || '';
  switch (m.type) {
    case 'depart': return `Head ${mod || 'out'}${s.name ? ' on ' + s.name : ''}`;
    case 'arrive': return 'Arrive at the office';
    case 'roundabout': case 'rotary': return `At the roundabout, take exit ${m.exit || ''}${name}`.trim();
    case 'turn': case 'end of road': case 'fork': case 'on ramp': case 'off ramp':
      return `${mod === 'straight' ? 'Continue straight' : 'Turn ' + mod}${name}`;
    case 'new name': case 'continue': return `Continue${s.name ? ' on ' + s.name : ''}`;
    default: return `${mod ? 'Go ' + mod : 'Continue'}${name}`;
  }
}

function pickRoute(routes) {
  const pref = $('pref').value;
  const short = routes.reduce((a, b) => b.distance < a.distance ? b : a);
  const fast = routes.reduce((a, b) => b.duration < a.duration ? b : a);
  if (pref === 'shortest') return short;
  if (pref === 'fastest') return fast;
  // recommended: the shortest route, unless it is much slower than the fastest one
  return short.duration <= fast.duration * 1.25 ? short : fast;
}

async function showRoute(idx, fit) {
  clearRoute();
  if (!userPos) return;
  const o = offices[idx], me = userPos, mode = modeEl.value, id = ++reqId;
  const info = () => $('route-info'), steps = () => $('route-steps');

  if (!ROUTERS[mode]) {
    if (info()) info().textContent = 'In-app routes are not available for public transport. Use the Google Maps button below.';
    drawLine([[me.lat, me.lng], [o.lat, o.lng]], true);
    return;
  }
  const key = `${mode}|${idx}|${me.lat},${me.lng}`;
  try {
    let routes = routeCache[key];
    if (!routes) {
      const url = `${ROUTERS[mode]}/${me.lng},${me.lat};${o.lng},${o.lat}?overview=full&geometries=geojson&steps=true&alternatives=3`;
      const j = await (await fetch(url)).json();
      if (j.code !== 'Ok' || !j.routes.length) throw new Error(j.code);
      routes = routeCache[key] = j.routes;
    }
    if (id !== reqId) return;
    renderRoutes(routes, pickRoute(routes), fit);
  } catch (e) {
    if (id !== reqId) return;
    drawLine([[me.lat, me.lng], [o.lat, o.lng]], true);
    if (info()) info().textContent = 'Could not load the road route right now. Showing a straight line; use the Google Maps button for directions.';
  }
}

function renderRoutes(routes, chosen, fit) {
  clearRoute();
  const toPts = r => r.geometry.coordinates.map(c => [c[1], c[0]]);
  // alternatives in grey (tap one to switch), chosen route in blue on top
  routes.forEach(r => {
    if (r === chosen) return;
    const pts = toPts(r);
    routeLayers.push(L.polyline(pts, { color: '#fff', weight: 9, lineCap: 'round' }).addTo(map));
    const alt = L.polyline(pts, { color: '#9aa0a6', weight: 6, lineCap: 'round' }).addTo(map);
    alt.on('click', ev => { L.DomEvent.stopPropagation(ev); renderRoutes(routes, r, false); });
    routeLayers.push(alt);
  });
  const pts = toPts(chosen);
  drawLine(pts, false);
  if (fit) map.fitBounds(pts, { padding: [60, 60] });

  const info = $('route-info'), steps = $('route-steps');
  if (info) {
    const short = routes.reduce((a, b) => b.distance < a.distance ? b : a);
    const fast = routes.reduce((a, b) => b.duration < a.duration ? b : a);
    const tags = [chosen === short ? 'shortest' : '', chosen === fast ? 'fastest' : ''].filter(Boolean).join(' + ');
    info.innerHTML = `<span class="big">${fmtMin(chosen.duration)}</span> <span>(${fmtKm(chosen.distance / 1000)})</span>` +
      (tags ? ` <span class="tag">${tags}</span>` : '') +
      (routes.length > 1 ? `<br><span class="hint">${routes.length - 1} other route${routes.length > 2 ? 's' : ''} shown in grey. Tap one on the map to switch.</span>` : '');
  }
  if (steps) {
    const items = chosen.legs[0].steps.map(s => `<li>${stepText(s)}<span class="sd">${s.distance >= 1 ? fmtKm(s.distance / 1000) : ''}</span></li>`).join('');
    steps.innerHTML = `<details><summary>Step-by-step directions</summary><ol class="steps">${items}</ol></details>`;
  }
}

function drawLine(pts, dashed) {
  if (dashed) {
    routeLayers.push(L.polyline(pts, { color: '#4285F4', weight: 4, dashArray: '8 8' }).addTo(map));
    return;
  }
  routeLayers.push(L.polyline(pts, { color: '#fff', weight: 10, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(map));
  routeLayers.push(L.polyline(pts, { color: '#4285F4', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(map));
}

// ---------- GPS / manual pin ----------
$('btn-gps').addEventListener('click', () => {
  if (!navigator.geolocation) { statusEl.textContent = 'GPS is not supported on this device. Tap the map to pin your location.'; return; }
  statusEl.textContent = 'Getting your location…';
  navigator.geolocation.getCurrentPosition(
    pos => setUser(pos.coords.latitude, pos.coords.longitude, 'Location found. You can drag the pin if it is off.'),
    err => { statusEl.textContent = err.code === 1 ? 'Location permission denied. Turn on GPS/location for this site, or tap the map to pin your location.' : 'Could not get your location. Tap the map to pin it manually.'; },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
});
map.on('click', e => setUser(e.latlng.lat, e.latlng.lng, 'Pinned manually. Drag the pin to adjust.'));
modeEl.addEventListener('change', () => refresh(true));
$('pref').addEventListener('change', () => refresh(true));

// ---------- load offices ----------
fetch('offices.json').then(r => r.json()).then(data => {
  offices = data;
  const pts = [];
  offices.forEach((o, i) => {
    const gmaps = `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`;
    o.marker = L.marker([o.lat, o.lng]).addTo(map).bindPopup(
      `<div class="pop"><strong>${o.name}</strong>` +
      `<img class="pop-img" src="${o.image}" alt="${o.name}" data-full="${o.image}" data-title="${o.name}">` +
      `<div class="hint">Tap the photo to enlarge. The red arrow points to the office.</div>` +
      `<a href="${gmaps}" target="_blank" rel="noopener">Open in Google Maps</a><br>` +
      `<a href="${o.streetview}" target="_blank" rel="noopener">Street View</a></div>`, { minWidth: 240 });
    o.marker.on('click', () => { selectedIdx = i; refresh(false); });
    pts.push([o.lat, o.lng]);
  });
  map.fitBounds(pts, { padding: [40, 40] });
  refresh(false);
});

// ---------- photo lightbox ----------
const lb = document.createElement('div');
lb.id = 'lightbox';
lb.innerHTML = '<div id="lb-title"></div><img id="lb-img" alt="">';
document.body.appendChild(lb);
lb.addEventListener('click', () => lb.classList.remove('show'));
document.addEventListener('click', e => {
  const img = e.target.closest && e.target.closest('.pop-img');
  if (!img) return;
  $('lb-img').src = img.dataset.full;
  $('lb-title').textContent = img.dataset.title;
  lb.classList.add('show');
});
