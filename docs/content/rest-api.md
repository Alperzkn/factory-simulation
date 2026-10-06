# REST API

Base URL: `http://127.0.0.1:8080/api/v1`

- All responses are JSON (`application/json; charset=utf-8`), except the SSE stream.
- There is no authentication and no rate limit.
- `GET` routes return a snapshot of the current simulation state. Responses carry `Cache-Control: no-store`.
- Command routes (`POST`, `PUT`) take effect immediately and return the new line status.
- Objects are described field by field in [Data model](#/data-model). Examples below were captured from a running server and shortened where marked with `...`.

> **Note**
> Quote URLs that contain `?` in your shell, for example `curl -s 'http://127.0.0.1:8080/api/v1/events?limit=5'`. zsh otherwise treats the `?` as a wildcard.

## Overview

| Route | Purpose |
|---|---|
| `GET /` | API index |
| `GET /status` | Line mode, speed, simulated time |
| `GET /state` | Everything in one object |
| `GET /kpis` | Line OEE, production and energy |
| `GET /energy` | Energy by consumer |
| `GET /machines` | All stations |
| `GET /machines/{id}` | One station |
| `GET /machines/{id}/tags` | Process tag values and definitions |
| `GET /machines/{id}/timeline` | State timeline |
| `GET /machines/{id}/history` | Sampled state, load and tags |
| `GET /agvs` | Both AGVs |
| `GET /agvs/{id}` | One AGV |
| `GET /material` | Buffers, pallet and conveyors |
| `GET /people` | Operators, technician, forklift driver |
| `GET /warehouse` | Inventory, slots, stands, forklift, trucks, statistics |
| `GET /warehouse/inventory` | Inventory, slots and stands |
| `GET /warehouse/trucks` | Truck status |
| `GET /history` | Sampled line KPIs |
| `GET /events` | Event log |
| `GET /connectivity` | Status of each protocol service |
| `GET /stream` | Server-Sent Events, see [Streaming](#/streaming) |
| `POST /control/{action}` | `start`, `pause`, `resume`, `stop`, `reset` |
| `PUT /control/speed` | Set the speed multiplier |
| `POST /machines/{id}/fault` | Inject a fault |
| `POST /warehouse/trucks/{direction}` | Call a truck |

## Line

### `GET /`

Lists the API name, version and routes.

```bash
curl -s http://127.0.0.1:8080/api/v1
```

```json
{
  "name": "Kestrel digital twin API",
  "version": "1.0.0",
  "docs": "/docs/",
  "endpoints": ["GET /status", "GET /state", "GET /kpis", "..."]
}
```

### `GET /status`

```bash
curl -s http://127.0.0.1:8080/api/v1/status
```

```json
{
  "plant": { "id": "kestrel-line2", "company": "Kestrel Brake Works", "line": "Line 2", "product": "Vented brake disc, 300 mm" },
  "mode": "running",
  "lineMode": "running",
  "paused": false,
  "speed": 10,
  "simTime": { "seconds": 1224.84, "clock": "06:20:24", "iso": "2026-10-06T03:20:24.841Z" },
  "wallTime": "2026-10-06T08:38:35.844Z",
  "uptimeS": 93
}
```

`mode` is `running`, `stopping`, `stopped` or `paused`. See [Line modes and pause](#/simulation-model/line-modes-and-pause).

### `GET /state`

The complete public state in one response: `status`, `kpis`, `machines`, `agvs`, `material`, `people` and `warehouse`, each identical to the dedicated route. About 15 kB. Use it when you need a consistent snapshot of everything; use the dedicated routes for polling.

```bash
curl -s http://127.0.0.1:8080/api/v1/state | jq 'keys'
```

```json
["agvs", "kpis", "machines", "material", "people", "status", "warehouse"]
```

### `GET /kpis`

```bash
curl -s http://127.0.0.1:8080/api/v1/kpis
```

```json
{
  "simTime": { "seconds": 1224.84, "clock": "06:20:24", "iso": "2026-10-06T03:20:24.841Z" },
  "plannedProductionTimeS": 1224.8,
  "oee": { "oee": 86.38, "availability": 98.67, "performance": 91.35, "quality": 95.83 },
  "production": {
    "good": 23,
    "scrap": 1,
    "firstPassYield": 95.83,
    "throughputPerHour": 84,
    "targetPerHour": 66,
    "planned": 22,
    "planAttainment": 102.4,
    "wip": 13,
    "palletsCompleted": 3
  },
  "energy": { "powerKw": 133.49, "energyKwh": 37.139, "...": "same object as GET /energy" }
}
```

### `GET /energy`

```bash
curl -s http://127.0.0.1:8080/api/v1/energy
```

```json
{
  "powerKw": 133.26,
  "energyKwh": 37.151,
  "peakKw": 135.82,
  "kwhPerGoodPart": 1.615,
  "compressedAirBar": 6.4,
  "byConsumer": [
    { "id": "M1", "name": "CNC lathe", "powerKw": 25.07, "energyKwh": 7.927 },
    { "id": "M2", "name": "Drilling centre", "powerKw": 17.73, "energyKwh": 4.536 },
    "...",
    { "id": "AUX", "name": "Lighting and compressed air", "powerKw": 14, "energyKwh": 4.765 },
    { "id": "AGV", "name": "AGV charging", "powerKw": null, "energyKwh": 0.173 },
    { "id": "WH", "name": "Warehouse", "powerKw": null, "energyKwh": 1.539 }
  ]
}
```

### `GET /history`

Line KPIs sampled every 20 simulated seconds. The server keeps the latest 360 samples (two simulated hours).

| Query parameter | Type | Default | Description |
|---|---|---|---|
| `sinceS` | number | none | Return only samples with `t` greater than this value (simulated seconds since shift start). Use the `t` of the last sample you have to fetch only new ones. |

```bash
curl -s 'http://127.0.0.1:8080/api/v1/history?sinceS=1190'
```

```json
{
  "sampleIntervalS": 20,
  "samples": [
    { "time": "2026-10-06T03:20:00.000Z", "t": 1200, "oee": 84.3, "availability": 98.6, "performance": 89.4, "quality": 95.7,
      "throughputPerHour": 84, "powerKw": 111.2, "good": 22, "scrap": 1, "rawDiscs": 108, "finishedPallets": 7 },
    { "time": "2026-10-06T03:20:20.200Z", "t": 1220.2, "oee": 86.7, "availability": 98.7, "performance": 91.7, "quality": 95.8,
      "throughputPerHour": 84, "powerKw": 119.5, "good": 23, "scrap": 1, "rawDiscs": 108, "finishedPallets": 6 }
  ]
}
```

After a `reset`, `t` starts again from 0. A client that passes an old, larger `sinceS` gets an empty list until the new run passes that value, so reset your cursor when `status.simTime.seconds` goes backwards.

### `GET /events`

The event log, newest first.

| Query parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 50 | Maximum number of events, 1 to 200. |
| `sinceId` | integer | 0 | Return only events with an `id` greater than this. |

```bash
curl -s 'http://127.0.0.1:8080/api/v1/events?limit=3'
```

```json
[
  { "id": 7, "time": { "seconds": 1188.97, "clock": "06:19:48", "iso": "2026-10-06T03:19:48.973Z" },
    "severity": "logistics", "source": "AGV-2", "message": "Pallet FP-0018 handed to the warehouse by AGV 2" },
  { "id": 6, "time": { "seconds": 811.39, "clock": "06:13:31", "iso": "2026-10-06T03:13:31.392Z" },
    "severity": "quality", "source": "M6", "message": "Disc 25 scrapped at M6 inspection cell, defect from M1" },
  { "id": 5, "time": { "seconds": 712.27, "clock": "06:11:52", "iso": "2026-10-06T03:11:52.267Z" },
    "severity": "info", "source": "M4", "message": "M4 Washer repaired after 1:54" }
]
```

To poll for new events, remember the highest `id` you have seen and pass it as `sinceId`. When more than `limit` new events exist, the newest `limit` are returned and the older ones in between are skipped, so poll with `limit=200` if you must not miss any. Event ids restart at 1 after a `reset`.

### `GET /connectivity`

Status of each service as seen by the server. `status` is `running`, `starting`, `disabled` (switched off by configuration) or `error` (failed to start, with an `error` text).

```bash
curl -s http://127.0.0.1:8080/api/v1/connectivity
```

```json
{
  "http": { "name": "REST API", "status": "running", "url": "http://127.0.0.1:8080/api/v1" },
  "websocket": { "name": "WebSocket stream", "status": "running", "url": "ws://127.0.0.1:8080/ws" },
  "mqtt": { "name": "MQTT broker", "status": "running", "url": "mqtt://127.0.0.1:1883", "wsUrl": "ws://127.0.0.1:8080/mqtt",
            "baseTopic": "kestrel/line2", "clients": 0 },
  "opcua": { "name": "OPC UA server", "status": "running", "url": "opc.tcp://127.0.0.1:4840/UA/Kestrel", "sessions": 1,
             "namespaceUri": "urn:kestrel:digital-twin", "namespaceIndex": 1 },
  "docs": { "name": "Documentation", "status": "running", "url": "http://127.0.0.1:8080/docs/" }
}
```

`mqtt.clients` is the number of connected MQTT clients and `opcua.sessions` the number of open OPC UA sessions. A service that failed looks like this:

```json
{ "name": "MQTT broker", "status": "error", "error": "port 1883 is already in use (set MQTT_PORT to change it)", "...": "..." }
```

## Machines

`{id}` is `M1` to `M7` and is not case sensitive. An unknown id returns 404 with the list of known ids.

### `GET /machines`

An array with all seven stations, each in the format of `GET /machines/{id}`.

```bash
curl -s http://127.0.0.1:8080/api/v1/machines | jq -r '.[] | [.id, .state, .oee.oee, .counters.parts] | @tsv'
```

```text
M1	RUN	90.2	94
M2	RUN	75.33	94
M3	RUN	60.77	94
M4	RUN	48.1	93
M5	RUN	76.71	90
M6	IDLE	42.67	90
M7	RUN	25.64	85
```

### `GET /machines/{id}`

```bash
curl -s http://127.0.0.1:8080/api/v1/machines/M1
```

```json
{
  "id": "M1",
  "name": "CNC lathe",
  "operation": "OP10",
  "description": "Turns both braking faces and the hat",
  "type": "lathe",
  "crewed": true,
  "state": "RUN",
  "stateCode": 2,
  "stateLabel": "Running",
  "stateSinceS": 1218,
  "fault": null,
  "cycle": { "progress": 69.8, "idealS": 46, "lastS": 50.08, "partId": 42 },
  "counters": { "parts": 24, "scrap": 1, "stops": 0 },
  "oee": { "oee": 86.36, "availability": 100, "performance": 90.11, "quality": 95.83 },
  "timeS": { "run": 1218, "idle": 7.2, "blocked": 0, "down": 0, "off": 0 },
  "energy": { "powerKw": 25.07, "energyKwh": 7.927, "kwhPerPart": 0.33 },
  "maintenance": { "mtbfS": null, "mttrS": null, "downtimeS": 0 },
  "tags": {
    "spindleSpeed": { "name": "Spindle speed", "unit": "rpm", "value": 1455 },
    "spindleLoad": { "name": "Spindle load", "unit": "%", "value": 63.8 },
    "coolantTemp": { "name": "Coolant temperature", "unit": "°C", "value": 28.5 },
    "vibration": { "name": "Spindle vibration", "unit": "mm/s", "value": 1.77 },
    "chuckPressure": { "name": "Chuck pressure", "unit": "bar", "value": 32.1 },
    "toolLife": { "name": "Insert life remaining", "unit": "%", "value": 68.3 }
  }
}
```

While a station is down, `fault` is an object:

```json
"fault": { "reason": "fault triggered manually", "sinceS": 9.3, "technicianOnSite": true, "estimatedRepairS": 142.5 }
```

### `GET /machines/{id}/tags`

Current tag values as a flat object, plus the definition of each tag.

```bash
curl -s http://127.0.0.1:8080/api/v1/machines/M1/tags
```

```json
{
  "id": "M1",
  "time": { "seconds": 1225.17, "clock": "06:20:25", "iso": "2026-10-06T03:20:25.170Z" },
  "tags": { "spindleSpeed": 1446, "spindleLoad": 59.8, "coolantTemp": 28.5, "vibration": 1.88, "chuckPressure": 31.9, "toolLife": 68.3 },
  "definitions": [
    { "key": "spindleSpeed", "name": "Spindle speed", "unit": "rpm", "kind": "continuous" },
    { "key": "spindleLoad", "name": "Spindle load", "unit": "%", "kind": "continuous" },
    { "key": "coolantTemp", "name": "Coolant temperature", "unit": "°C", "kind": "continuous" },
    { "key": "vibration", "name": "Spindle vibration", "unit": "mm/s", "kind": "continuous" },
    { "key": "chuckPressure", "name": "Chuck pressure", "unit": "bar", "kind": "continuous" },
    { "key": "toolLife", "name": "Insert life remaining", "unit": "%", "kind": "wear counter" }
  ]
}
```

`kind` is `continuous`, `per-part measurement` or `wear counter`. All tags are listed in [Process tags](#/data-model/process-tags).

### `GET /machines/{id}/timeline`

The sequence of states the station has been in.

| Query parameter | Type | Default | Description |
|---|---|---|---|
| `windowS` | number | 1800 | How far back to look, in simulated seconds. Clamped to 60 to 7200. |

```bash
curl -s 'http://127.0.0.1:8080/api/v1/machines/M1/timeline?windowS=300'
```

```json
{
  "id": "M1",
  "windowS": 300,
  "segments": [
    { "state": "RUN", "from": "2026-10-06T03:00:07.174Z", "fromS": 7.2, "durationS": 1218 }
  ]
}
```

Segments that end inside the window are returned whole, not clipped to it, so the first segment can start before the window as in this example. The last segment is the current state and its duration runs up to now.

### `GET /machines/{id}/history`

State, load and tag values sampled every 10 simulated seconds. The server keeps the latest 360 samples (one simulated hour). There are no query parameters.

```bash
curl -s http://127.0.0.1:8080/api/v1/machines/M1/history
```

```json
{
  "id": "M1",
  "sampleIntervalS": 10,
  "samples": [
    "...",
    { "time": "2026-10-06T03:20:20.200Z", "t": 1220.2, "state": "RUN", "kw": 26.4,
      "spindleSpeed": 1451, "spindleLoad": 61.4, "coolantTemp": 28.4, "vibration": 1.86, "chuckPressure": 32.2, "toolLife": 68.3 }
  ]
}
```

## AGVs, material and people

### `GET /agvs`

An array with both AGVs, each in the format of `GET /agvs/{id}`.

### `GET /agvs/{id}`

`{id}` is `AGV-1` or `AGV-2` (not case sensitive), or just `1` or `2`.

```bash
curl -s http://127.0.0.1:8080/api/v1/agvs/AGV-2
```

```json
{
  "id": "AGV-2",
  "state": "loading",
  "charging": false,
  "lowBattery": false,
  "batteryPct": 96.8,
  "task": { "type": "fg", "description": "Finished pallet to the warehouse", "pickUp": "Pallet pick-up", "dropOff": "Finished goods drop-off" },
  "position": { "loopM": 85, "x": -17.5, "z": 5 },
  "load": { "kind": null, "quantity": 0 },
  "trips": 25,
  "distanceM": 1325,
  "utilisation": 28.75
}
```

### `GET /material`

An array of 11 locations: buffers `A-in`, `A-out`, `B-in`, the pallet `PAL-1` and conveyors `C1` to `C7`.

```bash
curl -s http://127.0.0.1:8080/api/v1/material
```

```json
[
  { "id": "A-in", "name": "Raw casting buffer", "kind": "buffer", "quantity": 6, "capacity": 12,
    "parts": [ { "id": 1, "stage": "Raw casting" }, { "id": 2, "stage": "Raw casting" }, "..." ] },
  "...",
  { "id": "PAL-1", "name": "Palletiser pallet", "kind": "pallet", "quantity": 2, "capacity": 8,
    "parts": [ { "id": 30, "stage": "Coated" }, { "id": 29, "stage": "Coated" } ] },
  "...",
  { "id": "C4", "name": "Conveyor Buffer B-in to M4", "kind": "conveyor", "lengthM": 2.3, "speedMps": 0.3, "quantity": 1, "capacity": 4,
    "parts": [ { "id": 36, "stage": "Drilled and balanced", "positionM": 2.3 } ] },
  "..."
]
```

### `GET /people`

```bash
curl -s http://127.0.0.1:8080/api/v1/people
```

```json
[
  { "id": "OP-M1", "role": "Machine operator", "station": "M1", "activity": "Waiting to load the lathe", "position": { "x": -8.5, "z": -3.3 }, "partsLoaded": 25 },
  { "id": "OP-M3", "role": "Machine operator", "station": "M3", "activity": "Running the balancer", "position": { "x": 3.65, "z": -3.5 } },
  { "id": "OP-M6", "role": "Quality inspector", "station": "M6", "activity": "Supervising inspection", "position": { "x": -7.9, "z": 6.45 } },
  { "id": "TECH-1", "role": "Maintenance technician", "station": "Line 2", "activity": "On standby", "position": { "x": 7, "z": 1 },
    "repairsCompleted": 1, "openCalls": 0, "utilisation": 9.6 },
  { "id": "FLT-1", "role": "Forklift driver", "station": "Warehouse", "activity": "putaway: finished goods stand to rack slot F-01-2", "position": { "x": -26.6, "z": -3.2 } }
]
```

## Warehouse

### `GET /warehouse`

```bash
curl -s http://127.0.0.1:8080/api/v1/warehouse
```

```json
{
  "inventory": { "rawPallets": 10, "rawDiscs": 108, "rawCoverHours": 1.29, "finishedPallets": 6, "finishedDiscs": 48,
                 "rackSlots": 36, "rackOccupied": 14, "rackOccupancy": 38.89, "reorderPointPallets": 7 },
  "slots": [
    { "id": "R-01-1", "zone": "raw", "bay": 1, "level": 1, "pallet": null },
    { "id": "R-01-2", "zone": "raw", "bay": 1, "level": 2, "pallet": { "id": "RP-0002", "type": "raw", "quantity": 12, "ageS": 1226 } },
    "..."
  ],
  "stands": {
    "raw": [ { "id": "RP-0001", "type": "raw", "quantity": 6, "ageS": 1226 }, { "id": "RP-0015", "type": "raw", "quantity": 6, "ageS": 1226 } ],
    "finished": [ null, null ]
  },
  "forklift": {
    "id": "FLT-1", "state": "dropping",
    "task": { "kind": "putaway", "from": "finished goods stand", "to": "rack slot F-01-2" },
    "position": { "x": -26.6, "z": -3.2 }, "forkHeightM": 1.62,
    "load": { "id": "FP-0018", "type": "fg", "quantity": 8, "ageS": 37 },
    "moves": 3, "distanceM": 171.1, "utilisation": 11.9
  },
  "trucks": {
    "inbound": { "state": "none", "number": 0, "etaS": null, "dockedForS": null, "palletsOnBoard": 0, "capacity": 8 },
    "outbound": { "state": "none", "number": 0, "etaS": null, "dockedForS": null, "palletsLoaded": 0, "capacity": 8 }
  },
  "stats": { "receivedPallets": 0, "receivedDiscs": 0, "shippedPallets": 0, "shippedDiscs": 0, "trucksIn": 0, "trucksOut": 0,
             "putaways": 2, "replenishments": 1, "stockoutS": 0, "dockToStockAvgS": null }
}
```

### `GET /warehouse/inventory`

The `inventory`, `slots` and `stands` parts of `GET /warehouse`.

```bash
curl -s http://127.0.0.1:8080/api/v1/warehouse/inventory | jq '.inventory'
```

```json
{
  "rawPallets": 12,
  "rawDiscs": 132,
  "rawCoverHours": 1.57,
  "finishedPallets": 4,
  "finishedDiscs": 32,
  "rackSlots": 36,
  "rackOccupied": 14,
  "rackOccupancy": 38.89,
  "reorderPointPallets": 7
}
```

### `GET /warehouse/trucks`

The `trucks` part of `GET /warehouse`.

```bash
curl -s http://127.0.0.1:8080/api/v1/warehouse/trucks
```

```json
{
  "inbound": { "state": "due", "number": 0, "etaS": 570, "dockedForS": null, "palletsOnBoard": 0, "capacity": 8 },
  "outbound": { "state": "docked", "number": 1, "etaS": null, "dockedForS": 75, "palletsLoaded": 1, "capacity": 8 }
}
```

## Commands

Every command route answers the same way. On success, HTTP 200 with the new status:

```json
{ "ok": true, "status": { "mode": "running", "lineMode": "running", "paused": false, "speed": 10, "...": "full GET /status object" } }
```

On rejection, HTTP 400 with a reason:

```json
{ "ok": false, "error": "speed must be a number between 0.1 and 120" }
```

Commands sent over REST, WebSocket, MQTT and OPC UA are equivalent; they all end in the same function.

### `POST /control/{action}`

`{action}` is one of:

| Action | Effect |
|---|---|
| `start` | Set the line mode to `running` and clear a pause. |
| `stop` | Request a controlled stop: `running` becomes `stopping`, then `stopped` once the stations have finished their parts. Clears a pause. |
| `pause` | Freeze the simulation clock. |
| `resume` | Unfreeze the simulation clock. |
| `reset` | Discard the simulation and create a fresh one, in mode `stopped`. Send `start` to run it. |

No request body is needed. These actions always succeed; sending `pause` twice or `stop` on a stopped line returns `ok: true` and changes nothing. Any other action name returns 404.

```bash
curl -s -X POST http://127.0.0.1:8080/api/v1/control/pause
curl -s -X POST http://127.0.0.1:8080/api/v1/control/resume
```

> **Warning**
> `reset` discards all counters, history and events of the running simulation, for every connected client. There is no confirmation and no undo.

### `PUT /control/speed`

Sets the speed multiplier. `POST /control/speed` is accepted as well and behaves identically.

| Body field | Type | Description |
|---|---|---|
| `speed` | number | 0.1 to 120. A numeric string such as `"25"` is accepted. |

```bash
curl -s -X PUT http://127.0.0.1:8080/api/v1/control/speed \
  -H 'Content-Type: application/json' -d '{"speed": 20}'
```

The body must be sent with `Content-Type: application/json`; without it the body is ignored and the request is rejected as if `speed` were missing.

### `POST /machines/{id}/fault`

Puts the station into `DOWN` with the reason "fault triggered manually". The technician is called as for a random fault. No request body.

```bash
curl -s -X POST http://127.0.0.1:8080/api/v1/machines/M4/fault
```

Returns 400 `machine is already down` if the station is down, and 404 for an unknown station id.

### `POST /warehouse/trucks/{direction}`

`{direction}` is `inbound` (order raw castings) or `outbound` (book a collection of finished pallets). The truck arrives 20 simulated seconds later. No request body.

```bash
curl -s -X POST http://127.0.0.1:8080/api/v1/warehouse/trucks/inbound
```

Returns 400 if a truck in that direction is already scheduled, on its way, docked or leaving:

```json
{ "ok": false, "error": "an inbound truck is already scheduled or at the dock" }
```

Any other direction returns 400 `direction must be inbound or outbound`.

## Errors

Errors are JSON objects with an `error` string. Rejected commands additionally carry `"ok": false`.

| Status | When | Body |
|--:|---|---|
| 200 | Success. | The resource, or `{ "ok": true, "status": {...} }` for commands. |
| 204 | `OPTIONS` pre-flight request. | Empty. |
| 400 | A command was rejected. | `{ "ok": false, "error": "..." }` |
| 400 | The request body is not valid JSON. | `{ "error": "request body is not valid JSON" }` |
| 404 | Unknown station id. | `{ "error": "unknown machine 'M9'", "known": ["M1", "M2", "M3", "M4", "M5", "M6", "M7"] }` |
| 404 | Unknown AGV id. | `{ "error": "unknown AGV '9'", "known": ["AGV-1", "AGV-2"] }` |
| 404 | Unknown route under `/api/v1`, including an unsupported method. | `{ "error": "not found", "see": "/api/v1" }` |
| 404 | Unknown route under `/api` outside `/api/v1`. | `{ "error": "not found", "hint": "the API lives under /api/v1, see /docs/" }` |
| 413 | Request body larger than 64 kB. | `{ "error": "internal error" }` |
| 500 | Unexpected server error. | `{ "error": "internal error" }` |

Command error texts:

| Error | Cause |
|---|---|
| `speed must be a number between 0.1 and 120` | Missing, non-numeric or out-of-range speed. |
| `machine is already down` | Fault injected into a station that is down. |
| `direction must be inbound or outbound` | Bad truck direction. |
| `an inbound truck is already scheduled or at the dock` | Same for `outbound`. |
| `unknown machine id`, `unknown action` | Not reachable through the REST routes, which answer 404 first, but returned over WebSocket and MQTT. |

Query parameters are lenient: a value that is not a number falls back to the default instead of producing an error.

## CORS

Every response from a route under `/api/v1` carries:

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,POST,PUT,OPTIONS
Access-Control-Allow-Headers: Content-Type
Cache-Control: no-store
```

`OPTIONS` requests are answered with 204 and these headers, so browser pre-flight requests for `PUT` or for JSON bodies succeed from any origin. Credentials are not involved.

Two responses do not carry the CORS headers because they are produced outside the API router: the 400 for a body that is not valid JSON (and the 413 for an oversized body), and the 404 for paths under `/api` outside `/api/v1`. A browser script on another origin sees those as a network error rather than a readable response.
