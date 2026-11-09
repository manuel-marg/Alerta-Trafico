---
name: traffic-engine-optimization
description: Workflows for configuring, testing, and optimizing real-time traffic queries with Google Routes API, Distance Matrix fallback, and Mapbox routing.
---

# Traffic Engine Optimization & Multi-Provider Architecture

This skill defines instructions for testing, adjusting, and integrating traffic calculation engines in `server.js`.

---

## 1. Supported Traffic Engines

### Primary Engine: Google Routes API (computeRoutes)
* **Endpoint:** `POST https://routes.googleapis.com/directions/v2:computeRoutes`
* **Headers:**
  * `Content-Type: application/json`
  * `X-Goog-Api-Key: <API_KEY>`
  * `X-Goog-FieldMask: routes.duration,routes.distanceMeters,routes.localizedValues,routes.description`
* **Payload Structure:**
  ```json
  {
    "origin": { "location": { "latLng": { "latitude": 10.4806, "longitude": -66.9036 } } },
    "destination": { "location": { "latLng": { "latitude": 10.4900, "longitude": -66.8500 } } },
    "travelMode": "DRIVE",
    "routingPreference": "TRAFFIC_AWARE"
  }
  ```
* **Duration Parsing:**
  * Returns string such as `"1845s"`.
  * Convert using `parseInt(route.duration.replace('s', ''), 10)`.

### Secondary Engine: Google Distance Matrix API (Fallback)
* **Endpoint:** `GET https://maps.googleapis.com/maps/api/distancematrix/json`
* **Key parameters:** `origins`, `destinations`, `departure_time=now`, `traffic_model=best_guess`, `mode=driving`, `key`.
* **Duration Parsing:** `element.duration_in_traffic.value` (in seconds).

### Future Engine: Mapbox Directions API (Freemium Integration)
* **Endpoint:** `GET https://api.mapbox.com/directions/v5/mapbox/driving-traffic/{lng1},{lat1};{lng2},{lat2}`
* **Parameters:** `access_token=<MAPBOX_TOKEN>`, `geometries=geojson`, `overview=false`.
* **Duration Parsing:** `data.routes[0].duration` (in seconds).

---

## 2. Adaptive Polling Schedule & Quota Rules

To ensure \$0 cost on Google Cloud Platform, the engine must never exceed ~20,000 requests/month (the \$200 monthly free credit threshold):

```
Target Arrival Time: T_target (e.g. 08:00 AM)
Estimated Travel Time: D_traffic (e.g. 35 mins)
Buffer: B_prep (e.g. 15 mins)
Calculated Departure: T_dep = T_target - D_traffic - B_prep (e.g. 07:10 AM)
```

| Window Relative to Departure | Check Frequency | Purpose |
| :--- | :--- | :--- |
| **> 30 minutes away** | Every 15 minutes | Passive tracking, zero urgency |
| **15 to 30 minutes away** | Every 5 minutes | Detect early road blockages |
| **< 15 minutes away** | Every 2 minutes | High-precision departure trigger |
| **Post Departure / Rest of Day** | **0 calls** | Quota completely preserved |

---

## 3. Testing Traffic Provider Endpoints
Test via Node script:
```bash
node -e "
const server = require('./server.js');
// or test endpoint directly:
fetch('http://localhost:3000/api/traffic/check')
  .then(r => r.json())
  .then(console.log);
"
```
