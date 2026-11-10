const map = L.map('map').setView([8.58, 124.76], 11);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const list = document.getElementById('list');

fetch('offices.json')
  .then(r => r.json())
  .then(offices => {
    const bounds = [];
    offices.forEach(o => {
      const gmaps = `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`;
      const popup = `<strong>${o.name}</strong><br>
        <a href="${gmaps}" target="_blank" rel="noopener">Open in Google Maps</a><br>
        <a href="${o.streetview}" target="_blank" rel="noopener">Street View</a>`;
      const marker = L.marker([o.lat, o.lng]).addTo(map).bindPopup(popup);
      bounds.push([o.lat, o.lng]);

      const li = document.createElement('li');
      li.innerHTML = `<strong>${o.name}</strong><br><a href="${gmaps}" target="_blank" rel="noopener">Google Maps</a>`;
      li.addEventListener('click', e => {
        if (e.target.tagName === 'A') return;
        map.setView([o.lat, o.lng], 16);
        marker.openPopup();
      });
      list.appendChild(li);
    });
    map.fitBounds(bounds, { padding: [40, 40] });
  });
