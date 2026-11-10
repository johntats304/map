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
  if (!offices.length) return;
  const order = offices.map((_, i) => i);
  if (userPos) order.sort((a, b) => distTo(a) - distTo(b));

  listEl.innerHTML = '';
  order.forEach(i => {
    const o = offices[i];
    const li = document.createElement('li');
    if (i === selectedIdx) li.classList.add('selected');
    const short = o.name.replace(' Tellering Office', '');
    li.innerHTML = `<img class="thumb" src="${o.image}" alt="" loading="lazy"><div class="li-body"><div class="li-name">${short}</div><div class="li-sub">Tellering Office</div></div>` +
      (userPos ? `<div class="li-dist"><b>${fmtKm(distTo(i))}</b>${roadKm ? '' : '<small>approx.</small>'}</div>` : '');
    li.addEventListener('click', () => { selectedIdx = i; refresh(false); map.setView([o.lat, o.lng], 15); o.marker.openPopup(); });
    listEl.appendChild(li);
  });

  if (!userPos && selectedIdx === null) { nearestEl.classList.add('hidden'); clearRoute(); return; }
  const idx = selectedIdx !== null ? selectedIdx : nearestIdx();
  const o = offices[idx];
  const isNearest = userPos && idx === nearestIdx();
  const title = selectedIdx !== null ? (isNearest ? 'Your preferred office (also the nearest)' : 'Your preferred office') : 'Nearest office';

  nearestEl.classList.remove('hidden');
  nearestEl.innerHTML = `<div class="res-label">${title}</div><div class="res-name">${o.name}</div>
    <div id="route-info" class="hint">${userPos ? 'Finding the best route…' : 'Set your location to get directions.'}</div>
    <div id="route-steps"></div>
    <div class="actions">
      <a class="btn btn-go" href="${gmapsUrl(o)}" target="_blank" rel="noopener">Open in Google Maps</a>` +
      (selectedIdx !== null && userPos ? `<button id="btn-nearest" class="btn" type="button">Switch to nearest</button>` : '') +
    `</div>`;
  const bn = $('btn-nearest');
  if (bn) bn.addEventListener('click', () => { selectedIdx = null; refresh(true); });

  showRoute(idx, fit);
}

// ---------- routing (Google-style blue route) ----------
function clearRoute() { routeLayers.forEach(l => map.removeLayer(l)); routeLayers = []; }

function stepText(s) {
  if (s.text) return s.text;
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

// ---------- routing providers: Google (key) -> OpenRouteService (key) -> free OSRM ----------
const CFG = window.APP_CONFIG || {};
let googlePromise = null;
function loadGoogle() {
  if (googlePromise) return googlePromise;
  googlePromise = new Promise((resolve, reject) => {
    window.gm_authFailure = () => reject(new Error('Google Maps key rejected (check key, billing and referrer restriction)'));
    window.__gmReady = () => resolve(window.google);
    const sc = document.createElement('script');
    sc.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CFG.googleMapsKey)}&callback=__gmReady`;
    sc.onerror = () => reject(new Error('Could not load Google Maps script'));
    document.head.appendChild(sc);
  });
  return googlePromise;
}

async function routesGoogle(mode, me, o) {
  const g = await loadGoogle();
  const modes = { driving: 'DRIVING', walking: 'WALKING', bicycling: 'BICYCLING', transit: 'TRANSIT' };
  const res = await new Promise((resolve, reject) => {
    new g.maps.DirectionsService().route({
      origin: { lat: me.lat, lng: me.lng },
      destination: { lat: o.lat, lng: o.lng },
      travelMode: g.maps.TravelMode[modes[mode]],
      provideRouteAlternatives: true
    }, (r, status) => status === 'OK' ? resolve(r) : reject(new Error('Google Directions: ' + status)));
  });
  return res.routes.map(r => {
    const leg = r.legs[0];
    const coords = [];
    leg.steps.forEach(st => st.path.forEach(p => coords.push([p.lng(), p.lat()])));
    return {
      geometry: { coordinates: coords },
      distance: leg.distance.value,
      duration: leg.duration.value,
      legs: [{ steps: leg.steps.map(st => ({ distance: st.distance.value, text: st.instructions.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() })) }]
    };
  });
}

async function routesORS(mode, me, o) {
  const profile = { driving: 'driving-car', walking: 'foot-walking', bicycling: 'cycling-regular' }[mode];
  if (!profile) throw new Error('ORS: unsupported mode');
  const call = body => fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': CFG.orsKey },
    body: JSON.stringify(body)
  });
  const coordinates = [[me.lng, me.lat], [o.lng, o.lat]];
  let r = await call({ coordinates, instructions: true, alternative_routes: { target_count: 3, share_factor: 0.6, weight_factor: 1.6 } });
  if (!r.ok) r = await call({ coordinates, instructions: true });
  if (!r.ok) throw new Error('OpenRouteService HTTP ' + r.status);
  const j = await r.json();
  return j.features.map(f => ({
    geometry: { coordinates: f.geometry.coordinates },
    distance: f.properties.summary.distance,
    duration: f.properties.summary.duration,
    legs: [{ steps: f.properties.segments.flatMap(sg => sg.steps).map(st => ({ distance: st.distance, text: st.instruction })) }]
  }));
}

async function routesOSRM(mode, me, o) {
  const path = `${me.lng},${me.lat};${o.lng},${o.lat}`;
  const bases = [ROUTERS[mode]];
  if (mode === 'driving') bases.push('https://router.project-osrm.org/route/v1/driving');
  const opts = ['overview=full&geometries=geojson&steps=true&alternatives=true', 'overview=full&geometries=geojson&steps=true'];
  for (const base of bases) {
    for (const q of opts) {
      try {
        const j = await (await fetch(`${base}/${path}?${q}`)).json();
        if (j.code === 'Ok' && j.routes && j.routes.length) return j.routes;
      } catch (e) { /* next variant */ }
    }
  }
  throw new Error('free OSRM servers not reachable');
}

async function fetchRoutes(mode, me, o) {
  const providers = [];
  if (CFG.googleMapsKey) providers.push(routesGoogle);
  if (CFG.orsKey && mode !== 'transit') providers.push(routesORS);
  if (ROUTERS[mode]) providers.push(routesOSRM);
  const errors = [];
  for (const p of providers) {
    try { return await p(mode, me, o); } catch (e) { errors.push(e.message); }
  }
  throw new Error(errors.join('; ') || 'no routing provider for this mode');
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

  if (!ROUTERS[mode] && !(CFG.googleMapsKey && mode === 'transit')) {
    if (info()) info().textContent = 'In-app routes are not available for public transport. Use the Google Maps button below.';
    drawLine([[me.lat, me.lng], [o.lat, o.lng]], true);
    return;
  }
  const key = `${mode}|${idx}|${me.lat},${me.lng}`;
  try {
    let routes = routeCache[key];
    if (!routes) {
      routes = routeCache[key] = await fetchRoutes(mode, me, o);
    }
    if (id !== reqId) return;
    renderRoutes(routes, pickRoute(routes), fit);
  } catch (e) {
    if (id !== reqId) return;
    drawLine([[me.lat, me.lng], [o.lat, o.lng]], true);
    if (info()) info().textContent = 'Could not load the road route (' + e.message + '). Showing a straight line; use the Google Maps button for directions.';
    console.error('Routing failed:', e);
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
    const items = chosen.legs[0].steps.map(s => `<li><span class="st">${stepText(s)}</span><span class="sd">${s.distance >= 1 ? fmtKm(s.distance / 1000) : ''}</span></li>`).join('');
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

// ---------- GPS / manual pin / place search ----------
const UA = navigator.userAgent || '';
const IS_IOS = /iPhone|iPad|iPod/i.test(UA);
const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|Line\/|Viber|Snapchat|TikTok|MicroMessenger|Twitter|; wv\)/i.test(UA);
const gpsBtn = $('btn-gps');
let gpsTimer = null;

function setBusy(on) {
  gpsBtn.disabled = on;
  gpsBtn.textContent = on ? 'Finding you…' : '📍 Use my current location';
  if (!on) clearTimeout(gpsTimer);
}
function say(msg) { statusEl.textContent = msg; }

function deniedHelp() {
  return IS_IOS
    ? 'Location is blocked. On iPhone: Settings > Privacy & Security > Location Services (turn On), then Safari Websites > While Using the App. Then reload and tap the button again. Or just tap the map to pin your location.'
    : 'Location is blocked. Tap the lock icon next to the web address > Permissions > Location > Allow, make sure Location is On in your phone settings, then tap the button again. Or just tap the map to pin your location.';
}

function onPosition(pos) {
  setBusy(false);
  try {
    setUser(pos.coords.latitude, pos.coords.longitude, 'Location found. Drag the pin if it is off.');
  } catch (e) {
    console.error(e);
    say('Location found but the page had a problem showing it: ' + e.message + '. Tap the map to pin instead.');
  }
}
function onFail(err) {
  setBusy(false);
  if (err && err.code === 1) say(deniedHelp());
  else if (err && err.code === 2) say('Your phone could not work out where you are. Turn on Location/GPS in your phone settings and try again, or tap the map to pin your location.');
  else say('Finding your location took too long. Try again near a window or outdoors, or tap the map to pin your location.');
}

async function locate() {
  if (!window.isSecureContext) { say('Location only works on a secure (https) page. Open the https link of this site, or tap the map to pin your location.'); return; }
  if (!navigator.geolocation) { say('This browser has no GPS support. Tap the map to pin your location.'); return; }
  try {
    const st = await navigator.permissions.query({ name: 'geolocation' });
    if (st.state === 'denied') { say(deniedHelp()); return; }
  } catch (e) { /* Permissions API not available (e.g. some iOS versions); just try */ }

  setBusy(true);
  say('Finding your location… tap Allow if your phone asks.');
  gpsTimer = setTimeout(() => { setBusy(false); say('No answer from your phone. If no permission box appeared, open this page in Chrome or Safari, or tap the map to pin your location.'); }, 40000);

  // 1) precise GPS (quick try), 2) fall back to network/Wi-Fi location (works indoors)
  navigator.geolocation.getCurrentPosition(onPosition, err => {
    if (err.code === 1) { onFail(err); return; }
    say('Still looking… using network location.');
    navigator.geolocation.getCurrentPosition(onPosition, onFail, { enableHighAccuracy: false, timeout: 20000, maximumAge: 300000 });
  }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
}
gpsBtn.addEventListener('click', locate);

// in-app browsers (Messenger, Facebook, Viber...) often block location
if (IN_APP) {
  const b = $('inapp');
  b.classList.remove('hidden');
  $('btn-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); $('btn-copy').textContent = 'Link copied'; }
    catch (e) { window.prompt('Copy this link and open it in Chrome or Safari:', location.href); }
  });
}

// search an address / barangay / landmark as a backup
async function searchPlace() {
  const q = $('place').value.trim();
  if (!q) return;
  say('Searching…');
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ph&viewbox=124.2,8.2,125.2,9.0&q=' + encodeURIComponent(q);
    const j = await (await fetch(url)).json();
    if (!j.length) { say('No match found. Try a barangay or town name, or tap the map to pin your location.'); return; }
    const r = j[0];
    setUser(parseFloat(r.lat), parseFloat(r.lon), 'Found: ' + r.display_name.split(',').slice(0, 3).join(',') + '. Drag the pin if it is off.');
  } catch (e) { say('Search is not available right now. Tap the map to pin your location.'); }
}
$('btn-search').addEventListener('click', searchPlace);
$('place').addEventListener('keydown', e => { if (e.key === 'Enter') searchPlace(); });
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
      `<a href="${o.streetview}" target="_blank" rel="noopener">Street View</a></div>`, { minWidth: 220, maxWidth: 260, autoPanPadding: [20, 20] });
    o.marker.on('click', () => { selectedIdx = i; refresh(false); });
    pts.push([o.lat, o.lng]);
  });
  map.fitBounds(pts, { padding: [40, 40] });
  refresh(false);
});

// ---------- photo lightbox ----------
const lb = document.createElement('div');
lb.id = 'lightbox';
lb.innerHTML = '<div id="lb-title"></div><img id="lb-img" alt=""><div id="lb-close">Tap anywhere to close</div>';
document.body.appendChild(lb);
lb.addEventListener('click', () => lb.classList.remove('show'));
document.addEventListener('click', e => {
  const img = e.target.closest && e.target.closest('.pop-img');
  if (!img) return;
  $('lb-img').src = img.dataset.full;
  $('lb-title').textContent = img.dataset.title;
  lb.classList.add('show');
});

// ---------- mobile bottom sheet ----------
const panel = $('panel');
$('handle').addEventListener('click', () => {
  panel.classList.toggle('collapsed');
  setTimeout(() => map.invalidateSize(), 300);
});
window.addEventListener('resize', () => map.invalidateSize());
