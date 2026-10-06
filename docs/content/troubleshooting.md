# Troubleshooting

Start with the service status. It tells you which protocols are up and why one is not:

```bash
curl -s http://127.0.0.1:8080/api/v1/connectivity | jq 'map_values({status, url, error})'
```

## Port already in use

What happens depends on which port is taken.

**MQTT (1883) or OPC UA (4840).** The server reports the problem and keeps running with the remaining services. The start-up output shows it:

```text
  Kestrel digital twin
  Viewer      http://127.0.0.1:8080/
  Docs        http://127.0.0.1:8080/docs/
  REST API    http://127.0.0.1:8080/api/v1
  MQTT        not started: port 1883 is already in use (set MQTT_PORT to change it)
  OPC UA      not started: listen EADDRINUSE: address already in use :::4840
```

and so does `GET /api/v1/connectivity`:

```json
{
  "mqtt": { "status": "error", "error": "port 1883 is already in use (set MQTT_PORT to change it)" },
  "opcua": { "status": "error", "error": "listen EADDRINUSE: address already in use :::4840" }
}
```

The simulation, the viewer, REST and the WebSocket stream work normally in that state. MQTT over WebSocket (`/mqtt`) is unavailable when the broker did not start. The server does not retry; fix the conflict and restart it.

A local Mosquitto service is the usual owner of 1883, and another OPC UA server or a second copy of the twin the usual owner of 4840.

**HTTP (8080).** The process exits with:

```text
HTTP server failed: listen EADDRINUSE: address already in use 127.0.0.1:8080
```

To resolve either case, find what is using the port:

```bash
lsof -nP -iTCP:1883 -sTCP:LISTEN        # macOS, Linux
netstat -ano | findstr :1883            # Windows
```

and stop it, or move the twin:

```bash
HTTP_PORT=8081 MQTT_PORT=1884 OPCUA_PORT=4841 npm start
```

If you do not need a protocol, switch it off with `MQTT_ENABLED=false` or `OPCUA_ENABLED=false`.

## The first OPC UA start is slow

The first time the OPC UA server starts for a user account, node-opcua creates a certificate store and generates a self-signed application certificate. This makes the first start noticeably slower than later ones, and it can take tens of seconds on a slow machine. During that time:

- the start-up output stops after the `MQTT` line; the `OPC UA` line appears when the server is ready,
- `GET /api/v1/connectivity` shows `"status": "starting"` for `opcua`,
- everything else (viewer, REST, MQTT) is already working.

Later starts reuse the certificate and are quick. The store is kept in node-opcua's default configuration folder for the user (on macOS `~/Library/Preferences/node-opcua-default-nodejs`).

If the OPC UA line never appears and no error is printed, check that the process may write to that folder.

## npm cache permission errors

If `npm install` fails with `EACCES` or `EPERM` errors that mention the npm cache directory (typically `~/.npm`), the cache contains files owned by another user, often after an earlier `sudo npm`. Point npm at a cache directory you own for this install:

```bash
npm install --cache /tmp/npm-cache-kestrel
```

Any writable directory works. Do not run `npm install` with `sudo` to get around it; that is what creates the problem.

## Nothing is reachable from another machine

By default the HTTP server and the MQTT broker listen on `127.0.0.1` only, so they accept connections from the same machine and nothing else. A browser, MQTT client or Node-RED instance on another computer, in a virtual machine or in a container gets "connection refused".

Start the twin with:

```bash
HOST=0.0.0.0 npm start
```

and connect to the machine's IP address or name. The URLs the server prints then say `localhost`; replace that with the address.

> **Warning**
> This exposes unauthenticated control endpoints (stop, reset, fault injection) to every network the machine is on. See [Network exposure](#/configuration/network-exposure).

Related symptoms:

- **An OPC UA client on another machine reaches the port but complains about the endpoint URL or cannot open a session.** With `HOST=0.0.0.0` the server advertises the machine's host name in its endpoint URL. Make sure the client can resolve that name; or tell the client to keep the URL you entered (`endpointMustExist: false` in node-opcua; UaExpert asks whether to use the URL you entered).
- **Still refused after setting `HOST`.** Check the operating system firewall for ports 8080, 1883 and 4840.
- **Docker.** `127.0.0.1` inside a container is the container. Use the host's address, or `host.docker.internal` where available, and start the twin with `HOST=0.0.0.0`.
- **A web page on another origin cannot call the API.** The REST API allows all origins, so this is normally a network problem, not CORS. One exception: a request with a malformed JSON body gets a 400 without CORS headers, which the browser reports as a CORS failure.

## Data rate too high or too low

The MQTT data rate depends on the speed multiplier and two settings; the details are in [Publish cadence](#/mqtt/publish-cadence).

| Symptom | Cause | Remedy |
|---|---|---|
| About 100 MQTT messages a second, too much for the consumer | Default speed 10 with 1 s telemetry is about 10 messages a second per station | Subscribe to fewer topics (avoid `#`), or raise `TELEMETRY_MIN_REAL_MS` (for example `1000` for one message a second per station), or raise `TELEMETRY_INTERVAL_S`, or lower the speed |
| Telemetry timestamps are more than 1 s apart | At speeds above 10 the real-time floor spreads samples out in simulated time | Lower the speed, or lower `TELEMETRY_MIN_REAL_MS` |
| Only one telemetry message a second | Speed is 1, where one simulated second is one real second | Lower `TELEMETRY_INTERVAL_S` (for example `0.2`) |
| MQTT goes quiet | The simulation is paused; periodic topics follow simulated time | Send `resume`; check `GET /status` |
| Station topics show `OFF`, counters do not move | The line is stopped, for example after a `reset` | Send `start` |
| KPIs change very slowly | Speed is low | `PUT /control/speed`, or start with a higher `SIM_SPEED` |
| `SIM_SPEED` seems to be ignored | The value is outside 0.1 to 120 | Use a value in range |
| OPC UA values update at most four times a second | The minimum sampling interval is 250 ms | Use MQTT for faster data |
| SSE events arrive once a second regardless of speed | The SSE period is fixed in real time | Use MQTT, or poll REST |

Settings are read at start-up, so changing `TELEMETRY_INTERVAL_S` or `TELEMETRY_MIN_REAL_MS` needs a restart. The speed can be changed at any time.

## Timestamps look wrong

Timestamps in the data are simulated: the shift starts at 06:00 local time on the day the server was started and then advances at the speed multiplier. At speed 10 they pass the wall clock quickly and continue into the following days. This is by design; see [Speed multiplier and simulated time](#/simulation-model/speed-multiplier-and-simulated-time). The real time is in `wallTime` of `GET /status`.

ISO timestamps are in UTC, so `simTime.iso` differs from `simTime.clock` by your UTC offset.

## Counters went back to zero

Someone sent `reset`, or the server was restarted. Both create a new simulation: counters, history and events are cleared, event ids restart at 1 and simulated time restarts at 06:00. After a `reset` the line is in mode `stopped` until it receives `start`. `uptimeS` in the status tells the two apart: it keeps counting after a `reset` and starts from 0 after a restart.

## A command had no effect

- Check the reply. REST returns `{"ok": false, "error": "..."}` with status 400, MQTT publishes the result on `kestrel/line2/cmd/response`, OPC UA methods return `Accepted = false` with a `Message` while the call itself reports `Good`.
- `pause` and `stop` are different things. After `pause`, send `resume`. After `stop` or `reset`, send `start`. See [Line modes and pause](#/simulation-model/line-modes-and-pause).
- A fault on a station that is already down is rejected, as is a truck call while one is scheduled or at the dock.
- `PUT /control/speed` needs the header `Content-Type: application/json`.

## The docs or the viewer do not load

- The documentation is served at `/docs/` and needs the server; opening `docs/index.html` from the file system does not work because it loads its content over HTTP.
- Fonts and libraries are served from `node_modules` under `/vendor/`. If pages render unstyled or stay blank, run `npm install` again.
