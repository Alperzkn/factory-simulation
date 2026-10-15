# Kestrel digital twin

A simulated brake disc machining line and warehouse, viewed in 3D in the browser and served as live data over REST, Server-Sent Events, WebSocket, MQTT and OPC UA.

## Run it

```bash
npm install
npm start
```

| What | Where |
| --- | --- |
| 3D viewer | http://localhost:8080/ |
| Documentation | http://localhost:8080/docs/ |
| REST API | http://localhost:8080/api/v1 |
| MQTT broker | mqtt://localhost:1883, topics under `kestrel/line2/#` |
| OPC UA server | opc.tcp://localhost:4840/UA/Kestrel |

Requires Node 18 or newer. Ports and other settings are environment variables, for example `HTTP_PORT=9000 MQTT_PORT=1884 npm start`. The full list is in the documentation under Configuration.

The server listens on `127.0.0.1` by default. Set `HOST=0.0.0.0` to reach it from other machines, and note that the control endpoints have no authentication.

## Static deployment (simulation only)

```bash
npm run build:static
```

writes `dist/`, a static copy of the viewer and docs in which the simulation runs in the browser. It needs no server, so it can be hosted anywhere that serves files; `vercel.json` already points Vercel at it. This build has no REST API, MQTT broker or OPC UA server, and each visitor gets their own plant.

## Layout

| Path | Contents |
| --- | --- |
| `shared/plant.js` | Plant definition: stations, process tags, conveyors, AGV loop, warehouse |
| `shared/engine.js` | The simulation, KPI formulas and the public data model |
| `server/` | HTTP and WebSocket server, REST API, MQTT broker, OPC UA server |
| `public/` | The 3D viewer |
| `docs/` | Documentation site, served at `/docs/` |
| `archive/` | The original single-file prototype |
