// Optional keys for the most reliable road routing. Leave empty to use the free OSRM servers.
// 1) Google Maps (best, Google-identical routes; needs billing account, has a monthly free credit):
//    enable "Maps JavaScript API" in Google Cloud and restrict the key to your Netlify domain (HTTP referrers).
// 2) OpenRouteService (free, no credit card): https://openrouteservice.org/dev/#/signup
window.APP_CONFIG = {
  googleMapsKey: "",
  orsKey: ""
};
