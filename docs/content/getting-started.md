# Getting started

## Requirements

- Node.js 18 or newer (`node --version`).
- npm, to install the dependencies.
- Free TCP ports 8080, 1883 and 4840, or other ports of your choice set through [environment variables](#/configuration).

Optional, for trying the interfaces: `curl`, `jq`, an MQTT client such as `mosquitto_sub`, and an OPC UA client such as UaExpert.

## Install and run

```bash
npm install
npm start
```

`npm start` runs `node server/index.js`. When everything is listening the server prints its addresses:

```text
  Kestrel digital twin
  Viewer      http://127.0.0.1:8080/
  Docs        http://127.0.0.1:8080/docs/
  REST API    http://127.0.0.1:8080/api/v1
  MQTT        mqtt://127.0.0.1:1883  (topics under kestrel/line2/#)
  OPC UA      opc.tcp://127.0.0.1:4840/UA/Kestrel
```

The simulation starts immediately: the shift begins at 06:00 on the simulated clock, the line is running, and time advances at 10 times real time unless you set `SIM_SPEED`.

`npm run dev` starts the same server with `node --watch`, which restarts it when a source file changes. A restart creates a new simulation; nothing is persisted.

Stop the server with Ctrl+C.

> **Note**
> If the MQTT or OPC UA port is taken, the server prints `not started: ...` for that service and carries on with the others. If the HTTP port is taken, the process exits. See [Troubleshooting](#/troubleshooting/port-already-in-use).

## Addresses

| What | URL |
|---|---|
| 3D viewer | `http://127.0.0.1:8080/` |
| This documentation | `http://127.0.0.1:8080/docs/` |
| REST API index | `http://127.0.0.1:8080/api/v1` |
| Service status | `http://127.0.0.1:8080/api/v1/connectivity` |
| MQTT broker | `mqtt://127.0.0.1:1883`, topics under `kestrel/line2/` |
| OPC UA endpoint | `opc.tcp://127.0.0.1:4840/UA/Kestrel`, namespace index 1 |

## First calls with curl

Line status:

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

Line OEE and one station, picked apart with `jq`:

```bash
curl -s http://127.0.0.1:8080/api/v1/kpis | jq '.oee, .production'
curl -s http://127.0.0.1:8080/api/v1/machines/M1 | jq '{state, oee, tags}'
```

Change the simulation speed to 20 times real time, then back to 10:

```bash
curl -s -X PUT http://127.0.0.1:8080/api/v1/control/speed \
  -H 'Content-Type: application/json' -d '{"speed": 20}'

curl -s -X PUT http://127.0.0.1:8080/api/v1/control/speed \
  -H 'Content-Type: application/json' -d '{"speed": 10}'
```

Check which services are up:

```bash
curl -s http://127.0.0.1:8080/api/v1/connectivity | jq 'map_values(.status)'
```

```json
{
  "http": "running",
  "websocket": "running",
  "mqtt": "running",
  "opcua": "running",
  "docs": "running"
}
```

The full list of routes is in [REST API](#/rest-api).

## First messages over MQTT

With the Mosquitto command-line clients, subscribe to everything the twin publishes:

```bash
mosquitto_sub -h 127.0.0.1 -p 1883 -t 'kestrel/line2/#' -v
```

That is roughly 100 messages a second at the default speed. Narrower subscriptions are usually more useful:

```bash
# station state changes and plant events
mosquitto_sub -h 127.0.0.1 -t 'kestrel/line2/machines/+/state' -t 'kestrel/line2/events' -v

# line OEE, republished every 5 simulated seconds
mosquitto_sub -h 127.0.0.1 -t 'kestrel/line2/kpi/oee'
```

```json
{"ts":"2026-10-06T03:34:26.214Z","simS":2066.21,"oee":84.6,"availability":99.21,"performance":92.01,"quality":92.68}
```

Without Mosquitto, the `mqtt` package that `npm install` put in `node_modules` does the same. Save this as `sub.mjs` in the project folder and run `node sub.mjs`:

```js
import mqtt from 'mqtt';

const client = mqtt.connect('mqtt://127.0.0.1:1883');
client.on('connect', () => client.subscribe('kestrel/line2/kpi/oee'));
client.on('message', (topic, payload) => console.log(topic, payload.toString()));
```

Topics, payloads and commands are described in [MQTT](#/mqtt).

## First read over OPC UA

Connect any OPC UA client to `opc.tcp://127.0.0.1:4840/UA/Kestrel` with security policy **None** and **anonymous** user. The twin's nodes are under `Objects > KestrelBrakeWorks > Line2` and use string node ids in namespace 1, for example `ns=1;s=Line2.KPI.OEE`.

The `node-opcua` package is already installed as a dependency of the server, so a client script runs from the project folder without installing anything. Save as `read.mjs` and run `node read.mjs`:

```js
import { OPCUAClient, AttributeIds } from 'node-opcua';

const client = OPCUAClient.create({ endpointMustExist: false });
await client.connect('opc.tcp://127.0.0.1:4840/UA/Kestrel');
const session = await client.createSession();

const oee = await session.read({ nodeId: 'ns=1;s=Line2.KPI.OEE', attributeId: AttributeIds.Value });
const m1 = await session.read({ nodeId: 'ns=1;s=Line2.Machines.M1.State', attributeId: AttributeIds.Value });
console.log('line OEE', oee.value.value, '%, M1 is', m1.value.value);

await session.close();
await client.disconnect();
```

```text
line OEE 86.68 %, M1 is RUN
```

The node list, methods and more client examples are in [OPC UA](#/opc-ua).

## Where to go next

- [Simulation model](#/simulation-model) explains what the numbers mean before you build on them.
- [Data model](#/data-model) is the field-by-field reference shared by all interfaces.
- [Recipes](#/recipes) has short end-to-end examples.
