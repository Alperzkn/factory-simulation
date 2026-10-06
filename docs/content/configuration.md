# Configuration

The server is configured with environment variables only. They are read once at start-up in `server/index.js`; there is no configuration file.

```bash
HTTP_PORT=9000 MQTT_PORT=1884 SIM_SPEED=1 npm start
```

On Windows PowerShell set them first: `$env:HTTP_PORT = 9000; npm start`.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` | Address the HTTP server (REST, SSE, WebSocket, viewer, docs) and the MQTT TCP listener bind to. Also used in the URLs the server reports. See [Network exposure](#/configuration/network-exposure). |
| `HTTP_PORT` | `8080` | Port for HTTP and both WebSocket paths (`/ws`, `/mqtt`). |
| `PORT` | none | Used as the HTTP port when `HTTP_PORT` is not set. |
| `MQTT_PORT` | `1883` | TCP port of the embedded MQTT broker. |
| `OPCUA_PORT` | `4840` | TCP port of the OPC UA server. |
| `MQTT_BASE_TOPIC` | `kestrel/line2` | Prefix of every MQTT topic, without a trailing slash. |
| `MQTT_ENABLED` | enabled | Set to `false` to not start the MQTT broker. Any other value leaves it enabled. |
| `OPCUA_ENABLED` | enabled | Set to `false` to not start the OPC UA server. Any other value leaves it enabled. |
| `SIM_SPEED` | `10` | Initial speed multiplier: simulated seconds per real second. Accepted range 0.1 to 120. |
| `TELEMETRY_INTERVAL_S` | `1` | Period of the MQTT `machines/{id}/telemetry` topics, in **simulated** seconds. |
| `TELEMETRY_MIN_REAL_MS` | `100` | Minimum **real-time** gap between two publications of the same telemetry topic, in milliseconds. AGV telemetry uses twice this value. |

Details that are easy to miss:

- **`SIM_SPEED` out of range is ignored silently.** A value below 0.1, above 120 or not a number leaves the speed at 10. The speed can be changed at run time over every interface; see [speed multiplier](#/simulation-model/speed-multiplier-and-simulated-time).
- **`MQTT_ENABLED` and `OPCUA_ENABLED` only react to the exact string `false`.** `0`, `no` or `FALSE` do not disable the service.
- **Disabling MQTT also disables MQTT over WebSocket.** The `/mqtt` upgrade is refused when the broker is not running.
- **Telemetry rate is a combination of two settings and the speed.** A telemetry topic is published when at least `TELEMETRY_INTERVAL_S` simulated seconds *and* at least `TELEMETRY_MIN_REAL_MS` real milliseconds have passed since its last publication. The check runs 30 times a second, so no topic is ever published more often than about every 33 ms. See [MQTT cadence](#/mqtt/publish-cadence) for worked numbers.
- The frame rate of the simulation loop and the WebSocket viewer stream is fixed at 30 Hz and is not configurable.
- The SSE stream period (1 s real time) and the non-telemetry MQTT periods are fixed in code.

The resulting addresses can be read from `GET /api/v1/connectivity`, which lists each service with its status and URL.

## Network exposure

> **Warning**
> There is no authentication on any interface. Anyone who can reach the HTTP port, the MQTT port or the OPC UA port can stop or reset the line, change the speed, inject faults and call trucks. Setting `HOST=0.0.0.0` exposes these unauthenticated control endpoints to every network the machine is attached to. Do it only on a network you trust.

What `HOST` does and does not control:

- **HTTP** (REST, SSE, `/ws`, `/mqtt`, viewer, docs) binds to `HOST`. With the default `127.0.0.1` it is reachable only from the same machine.
- **MQTT over TCP** binds to `HOST` as well.
- **OPC UA follows `HOST` too.** With the default `HOST=127.0.0.1` the OPC UA server listens on the loopback interface only. With `HOST=0.0.0.0` it listens on all interfaces and advertises the machine's host name in its endpoint URL.

When `HOST=0.0.0.0`, the URLs printed at start-up and returned by `/connectivity` show `localhost` for HTTP, WebSocket and MQTT. Replace it with the machine's address when connecting from elsewhere.

The REST API sends `Access-Control-Allow-Origin: *`, so a web page from any origin can read data and send commands from the browser of a user who can reach the server.

## Examples

Real-time simulation with one telemetry message per station per second:

```bash
SIM_SPEED=1 npm start
```

REST only, no broker and no OPC UA server:

```bash
MQTT_ENABLED=false OPCUA_ENABLED=false npm start
```

A second instance next to a running one:

```bash
HTTP_PORT=8081 MQTT_PORT=1884 OPCUA_PORT=4841 MQTT_BASE_TOPIC=kestrel/line2b npm start
```

Reachable from other machines on a trusted lab network:

```bash
HOST=0.0.0.0 npm start
```
