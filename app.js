const map = L.map('map').setView([8.58, 124.76], 11);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const $ = id => document.getElementById(id);
const listEl = $('list'), statusEl = $('status'), nearestEl = $('nearest'), modeEl = $('mode');

let offices = [];
let userPos = null;      // {lat, lng}
let userMarker = null;
let selectedIdx = null;  // preferred office (user-chosen), else nearest is used
let routeLine = null;

const youIcon = L.divIcon({ className: '', html: '<div style="width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 2px #2563eb"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

function km(a, b) { // haversine, straight-line distance
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmt = d => d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km';

function navUrl(o) {
  const dest = `${o.lat},${o.lng}`;
  const origin = userPos ? `&origin=${userPos.lat},${userPos.lng}` : '';
  return `https://www.google.com/maps/dir/?api=1${origin}&destination=${dest}&travelmode=${modeEl.value}`;
}

function setUser(lat, lng, label) {
  userPos = { lat, lng };
  if (!userMarker) {
    userMarker = L.marker([lat, lng], { icon: youIcon, draggable: true, title: 'You' }).addTo(map);
    userMarker.on('dragend', () => {
      const p = userMarker.getLatLng();
      setUser(p.lat, p.lng, 'Pin moved.');
    });
  } else {
    userMarker.setLatLng([lat, lng]);
  }
  userMarker.bindPopup('You are here (drag to adjust)');
  statusEl.textContent = label || '';
  refresh(true);
}

function nearestIdx() {
  let best = 0, bestD = Infinity;
  offices.forEach((o, i) => { const d = km(userPos, o); if (d < bestD) { bestD = d; best = i; } });
  return best;
}

function refresh(fit) {
  // render list (sorted by distance if we know the user's position)
  const order = offices.map((o, i) => i);
  if (userPos) order.sort((a, b) => km(userPos, offices[a]) - km(userPos, offices[b]));

  listEl.innerHTML = '';
  order.forEach(i => {
    const o = offices[i];
    const li = document.createElement('li');
    if (i === selectedIdx) li.classList.add('selected');
    li.innerHTML = `<strong>${o.name}</strong>` + (userPos ? `<span class="dist">${fmt(km(userPos, o))}</span>` : '');
    li.addEventListener('click', () => { selectedIdx = i; refresh(false); map.setView([o.lat, o.lng], 15); o.marker.openPopup(); });
    listEl.appendChild(li);
  });

  // pick target: preferred if chosen, otherwise nearest
  if (!userPos && selectedIdx === null) { nearestEl.classList.add('hidden'); clearRoute(); return; }
  const idx = selectedIdx !== null ? selectedIdx : nearestIdx();
  const o = offices[idx];
  const isNearest = userPos && idx === nearestIdx();
  const title = selectedIdx !== null ? (isNearest ? 'Your preferred office (also the nearest)' : 'Your preferred office') : 'Nearest office';
  nearestEl.classList.remove('hidden');
  nearestEl.innerHTML = `<strong>${title}</strong><br>${o.name}` +
    (userPos ? `<br><span class="hint">About ${fmt(km(userPos, o))} away in a straight line</span>` : '<br><span class="hint">Set your location to get directions from where you are.</span>') +
    `<br><a class="go" href="${navUrl(o)}" target="_blank" rel="noopener">🧭 Navigate to ${o.name.replace(' Tellering Office', '')}</a>` +
    (selectedIdx !== null && userPos ? `<br><button id="btn-nearest" style="margin-top:8px">Switch back to nearest</button>` : '');
  const bn = $('btn-nearest');
  if (bn) bn.addEventListener('click', () => { selectedIdx = null; refresh(false); });

  drawRoute(o);
  if (fit && userPos) map.fitBounds([[userPos.lat, userPos.lng], [o.lat, o.lng]], { padding: [60, 60] });
}

function clearRoute() { if (routeLine) { map.removeLayer(routeLine); routeLine = null; } }
function drawRoute(o) {
  clearRoute();
  if (!userPos) return;
  routeLine = L.polyline([[userPos.lat, userPos.lng], [o.lat, o.lng]], { color: '#16a34a', weight: 4, dashArray: '8 8' }).addTo(map);
}

// --- GPS ---
$('btn-gps').addEventListener('click', () => {
  if (!navigator.geolocation) { statusEl.textContent = 'GPS is not supported on this device. Tap the map to pin your location.'; return; }
  statusEl.textContent = 'Getting your location…';
  navigator.geolocation.getCurrentPosition(
    pos => setUser(pos.coords.latitude, pos.coords.longitude, 'Location found. You can drag the pin if it is off.'),
    err => {
      const msg = err.code === 1 ? 'Location permission denied. Turn on GPS/location for this site, or tap the map to pin your location.'
        : 'Could not get your location. Tap the map to pin it manually.';
      statusEl.textContent = msg;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
});

// --- manual pin ---
map.on('click', e => setUser(e.latlng.lat, e.latlng.lng, 'Pinned manually. Drag the pin to adjust.'));

modeEl.addEventListener('change', () => refresh(false));

// --- load offices ---
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

// --- photo lightbox (tap a photo in a popup to enlarge, tap again to close) ---
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
