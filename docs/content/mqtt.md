# MQTT

The server embeds an MQTT broker (aedes) and publishes the twin's data into it. You connect a client to that broker; you do not need a broker of your own. Commands are accepted on topics under `cmd/`.

## Connection

| | |
|---|---|
| TCP | `mqtt://127.0.0.1:1883` |
| WebSocket | `ws://127.0.0.1:8080/mqtt` |
| Protocol | MQTT 3.1.1 (and 3.1). MQTT 5 connections are refused with "unacceptable protocol version". |
| TLS | none |
| Authentication | none; any client id, user name and password are accepted |
| Base topic | `kestrel/line2` |

The TCP port is set with `MQTT_PORT`, the base topic with `MQTT_BASE_TOPIC`, and the WebSocket path lives on the HTTP port. See [Configuration](#/configuration).

All payloads are UTF-8 JSON objects. Every topic below is relative to the base topic, so `status` means `kestrel/line2/status`.

> **Warning**
> The broker has no access control. Any connected client can publish to any topic, including the twin's own data topics, and can send commands. Other subscribers cannot tell such messages from the twin's. Keep the broker on a trusted network.

## Topic tree

| Topic | Retained | Published | Payload |
|---|---|---|---|
| `status` | yes | On every change of mode, line mode or speed, and every 5 s | [Status](#/data-model/status) |
| `kpi/oee` | yes | Every 5 s | `ts`, `simS` + line OEE figures |
| `kpi/production` | yes | Every 5 s | `ts`, `simS` + production figures |
| `kpi/energy` | yes | Every 5 s | `ts`, `simS` + [energy](#/data-model/energy) object |
| `machines/{id}/state` | yes | On change of state, fault reason or technician arrival | State and fault |
| `machines/{id}/telemetry` | no | Every 1 s (`TELEMETRY_INTERVAL_S`) | State, load, cycle progress, part count and all process tags |
| `machines/{id}/kpi` | yes | Every 5 s | OEE, counters, state times, energy, maintenance |
| `agvs/{id}/telemetry` | no | Every 1 s | [AGV](#/data-model/agv) object |
| `warehouse/forklift` | no | Every 2 s | [Forklift](#/data-model/forklift) object |
| `warehouse/inventory` | yes | On change, checked every 2 s | Inventory figures and stands |
| `warehouse/trucks` | yes | On change, checked every 2 s | Both trucks |
| `events` | no | Once per event, as it happens | [Event](#/data-model/events) |
| `cmd/response` | no | Once per command received | Command result |
| `cmd/...` | | Published by **you** | See [Commands](#/mqtt/commands) |

`{id}` is `M1` to `M7` for machines and `AGV-1`, `AGV-2` for AGVs. Periods are in **simulated** seconds; the next section explains what that means in real time.

Retained topics give a new subscriber the last known value immediately. Non-retained topics deliver only what is published after you subscribe.

Useful wildcard subscriptions:

| Filter | Receives |
|---|---|
| `kestrel/line2/#` | Everything, about 100 messages a second at the default speed |
| `kestrel/line2/machines/+/state` | State changes of all stations |
| `kestrel/line2/machines/M1/#` | State, telemetry and KPIs of one station |
| `kestrel/line2/kpi/#` | The three line KPI topics |
| `kestrel/line2/warehouse/#` | Forklift, inventory and trucks |

## Publish cadence

A periodic topic is published when **both** conditions hold since its last publication:

1. at least the topic's period has passed in simulated time, and
2. at least the topic's floor has passed in real time.

The check runs 30 times a second, so there is also a hard minimum of about 33 ms between two publications of one topic.

| Topic | Period (simulated) | Floor (real time) |
|---|--:|--:|
| `status` | 5 s | 2000 ms |
| `kpi/*` | 5 s | 500 ms |
| `machines/{id}/telemetry` | `TELEMETRY_INTERVAL_S`, default 1 s | `TELEMETRY_MIN_REAL_MS`, default 100 ms |
| `machines/{id}/kpi` | 5 s | 500 ms |
| `agvs/{id}/telemetry` | 1 s | 2 x `TELEMETRY_MIN_REAL_MS`, default 200 ms |
| `warehouse/*` | 2 s | 400 ms |

The data rate therefore follows the speed multiplier until the floor takes over:

| Speed | Telemetry per station | Simulated time between telemetry samples | `kpi/*` |
|--:|---|--:|---|
| 0.1 | one every 10 s | 1 s | one every 50 s |
| 1 | 1 per second | 1 s | one every 5 s |
| 10 (default) | about 10 per second | about 1 s | 2 per second |
| 60 | about 10 per second | about 6 s | 2 per second |
| 120 | about 10 per second | about 12 s | 2 per second |

At high speed the floor limits the real-time rate, so samples are further apart in simulated time. To record dense data at high speed, lower `TELEMETRY_MIN_REAL_MS`; to reduce load at the default speed, raise `TELEMETRY_INTERVAL_S` or `TELEMETRY_MIN_REAL_MS`.

Other things to know:

- **While the simulation is paused, periodic topics are not published**, because simulated time does not advance. `status` is still published on the change to `paused`.
- `events` and `machines/{id}/state` are driven by what happens in the simulation, not by a timer.
- `warehouse/inventory` and `warehouse/trucks` are compared every 2 simulated seconds and published only if something changed. The inventory comparison includes `rawCoverHours`, so a change in throughput republishes it.
- When the broker starts, events logged before it was up (normally just the shift start) are published once on `events`. After a `reset`, event ids start again at 1.

## Payloads

Payloads built for MQTT begin with two time fields:

| Field | Description |
|---|---|
| `ts` | Simulated timestamp, ISO 8601 UTC. |
| `simS` | Simulated seconds since the start of the shift. |

`status` and `events` are published exactly as the REST API returns them and carry their own time fields (`simTime`, `time`) instead.

The examples below were captured from the broker.

### `status`

```json
{"plant":{"id":"kestrel-line2","company":"Kestrel Brake Works","line":"Line 2","product":"Vented brake disc, 300 mm"},"mode":"running","lineMode":"running","paused":false,"speed":10,"simTime":{"seconds":2050.96,"clock":"06:34:10","iso":"2026-10-06T03:34:10.957Z"},"wallTime":"2026-10-06T08:39:58.436Z","uptimeS":175}
```

### `kpi/oee`

```json
{"ts":"2026-10-06T03:34:26.214Z","simS":2066.21,"oee":84.6,"availability":99.21,"performance":92.01,"quality":92.68}
```

### `kpi/production`

```json
{"ts":"2026-10-06T03:34:26.214Z","simS":2066.21,"good":38,"scrap":3,"firstPassYield":92.68,"throughputPerHour":48,"targetPerHour":66,"planned":38,"planAttainment":100.3,"wip":12,"palletsCompleted":5}
```

### `kpi/energy`

```json
{"ts":"2026-10-06T03:34:26.214Z","simS":2066.21,"powerKw":118.28,"energyKwh":62.519,"peakKw":136.64,"kwhPerGoodPart":1.645,"compressedAirBar":6.4,
 "byConsumer":[{"id":"M1","name":"CNC lathe","powerKw":20.9,"energyKwh":13.387},{"id":"M2","name":"Drilling centre","powerKw":16.4,"energyKwh":7.653},"..."]}
```

### `machines/{id}/state`

Published when the station changes state, when its fault reason changes and when the technician arrives.

```json
{"ts":"2026-10-06T03:33:56.160Z","simS":2036.16,"id":"M2","state":"RUN","stateCode":2,"stateLabel":"Running","fault":null}
```

A fault produces two messages: one when the station goes down, and one when the technician arrives and a repair estimate becomes available.

```json
{"ts":"2026-10-06T03:00:20.977Z","simS":20.98,"id":"M2","state":"DOWN","stateCode":4,"stateLabel":"Down","fault":{"reason":"fault triggered manually","sinceS":0.3,"technicianOnSite":false,"estimatedRepairS":null}}
```

```json
{"ts":"2026-10-06T03:00:29.881Z","simS":29.88,"id":"M2","state":"DOWN","stateCode":4,"stateLabel":"Down","fault":{"reason":"fault triggered manually","sinceS":9.3,"technicianOnSite":true,"estimatedRepairS":142.5}}
```

`fault.sinceS` and `fault.estimatedRepairS` are values at the time of publication; they are not updated in the retained message while the repair is in progress.

### `machines/{id}/telemetry`

The fixed fields are followed by one field per [process tag](#/data-model/process-tags) of the station.

```json
{"ts":"2026-10-06T03:34:26.547Z","simS":2066.55,"id":"M1","state":"RUN","powerKw":20.7,"cycleProgress":88.4,"partCount":41,"spindleSpeed":1454,"spindleLoad":63.8,"coolantTemp":28.5,"vibration":1.72,"chuckPressure":31.8,"toolLife":53.2}
```

```json
{"ts":"2026-10-06T03:34:26.547Z","simS":2066.55,"id":"M5","state":"RUN","powerKw":35.63,"cycleProgress":23.6,"partCount":41,"zone1Temp":81.3,"zone2Temp":312.7,"exhaustFlow":2423,"paintPressure":2.8,"coatThickness":10.6}
```

| Field | Description |
|---|---|
| `id` | Station id. |
| `state` | `OFF`, `IDLE`, `RUN`, `BLOCKED` or `DOWN`. |
| `powerKw` | Electrical load. |
| `cycleProgress` | 0 to 100 %. |
| `partCount` | Cycles completed this shift. |
| tag keys | Current tag values, numbers. |

### `machines/{id}/kpi`

```json
{"ts":"2026-10-06T03:34:26.214Z","simS":2066.21,"id":"M4","oee":{"oee":48.78,"availability":94.46,"performance":51.64,"quality":100},"counters":{"parts":42,"scrap":0,"stops":1},"timeS":{"run":1083.4,"idle":868.5,"blocked":0,"down":114.4,"off":0},"energy":{"powerKw":20.78,"energyKwh":7.383,"kwhPerPart":0.176},"maintenance":{"mtbfS":1083,"mttrS":114,"downtimeS":114.4},"cycle":{"idealS":24,"lastS":24.77}}
```

### `agvs/{id}/telemetry`

```json
{"ts":"2026-10-06T03:34:27.594Z","simS":2067.59,"id":"AGV-1","state":"idle","charging":false,"lowBattery":false,"batteryPct":100,"task":null,"position":{"loopM":95,"x":-17.5,"z":-5},"load":{"kind":null,"quantity":0},"trips":11,"distanceM":575,"utilisation":28.41}
```

### `warehouse/forklift`

```json
{"ts":"2026-10-06T03:34:28.299Z","simS":2068.3,"id":"FLT-1","state":"picking","task":{"kind":"load","from":"rack slot F-02-1","to":"outbound truck"},"position":{"x":-26.6,"z":-4.8},"forkHeightM":0.17,"load":null,"moves":9,"distanceM":396.8,"utilisation":17.87}
```

### `warehouse/inventory`

The inventory figures, plus the contents of the stands. The rack slot list is not published over MQTT; use `GET /warehouse` for it.

```json
{"ts":"2026-10-06T03:33:46.822Z","simS":2026.82,"rawPallets":8,"rawDiscs":90,"rawCoverHours":1.88,"finishedPallets":8,"finishedDiscs":64,"rackSlots":36,"rackOccupied":14,"rackOccupancy":38.89,"reorderPointPallets":7,
 "stands":{"raw":[{"id":"RP-0005","type":"raw","quantity":12,"ageS":2027},{"id":"RP-0015","type":"raw","quantity":6,"ageS":2027}],"finished":[null,null]}}
```

### `warehouse/trucks`

Published when a truck changes state or its pallet count changes. `etaS` and `dockedForS` are values at the time of publication.

```json
{"ts":"2026-10-06T03:34:07.477Z","simS":2047.48,"inbound":{"state":"due","number":0,"etaS":570,"dockedForS":null,"palletsOnBoard":0,"capacity":8},"outbound":{"state":"docked","number":1,"etaS":null,"dockedForS":75,"palletsLoaded":1,"capacity":10}}
```

### `events`

```json
{"id":2,"time":{"seconds":20.63,"clock":"06:00:20","iso":"2026-10-06T03:00:20.629Z"},"severity":"alarm","source":"M2","message":"M2 Drilling centre down: fault triggered manually"}
```

## Commands

Publish to a topic under `kestrel/line2/cmd/`. The payload is a JSON object, or empty where no field is needed.

| Topic | Payload | Effect |
|---|---|---|
| `cmd/control` | `{"action": "start"}` with `start`, `stop`, `pause`, `resume` or `reset` | Line control, as [`POST /control/{action}`](#/rest-api/post-control-action) |
| `cmd/speed` | `{"speed": 20}`, or just the number `20` | Set the speed multiplier, 0.1 to 120 |
| `cmd/machines/{id}/fault` | empty, or `{}` | Inject a fault into station `{id}` (not case sensitive) |
| `cmd/warehouse/truck` | `{"direction": "inbound"}` or `{"direction": "outbound"}` | Call a truck |

Any payload object may include a `requestId` of your choice. It is copied into the response so you can match replies to requests.

### Response topic

The result of every command is published on `cmd/response` (QoS 0, not retained). Subscribe to it before sending.

```json
{"ok":true,"topic":"kestrel/line2/cmd/speed","requestId":"s1","client":"docs-test","ts":"2026-10-06T03:00:30.570Z","simS":30.57}
```

```json
{"ok":false,"error":"machine is already down","topic":"kestrel/line2/cmd/machines/m2/fault","requestId":"r-17","client":"docs-test","ts":"2026-10-06T03:00:23.727Z","simS":23.73}
```

| Field | Description |
|---|---|
| `ok` | True if the command was accepted. |
| `error` | Reason, present only when `ok` is false. |
| `topic` | The full topic the command was published to. |
| `requestId` | Copied from the command payload; absent if none was given. |
| `client` | The MQTT client id of the sender. |
| `ts`, `simS` | Simulated time at which the command was handled. |

Errors:

| `error` | Cause |
|---|---|
| `payload is not valid JSON` | The payload was neither empty nor JSON. This response has only `ok`, `error` and `topic`. |
| `unknown command topic` | Published under `cmd/` to a topic not in the table above. |
| `unknown action` | `cmd/control` without a valid `action`. |
| `speed must be a number between 0.1 and 120` | |
| `unknown machine id` | |
| `machine is already down` | |
| `direction must be inbound or outbound` | |
| `an inbound truck is already scheduled or at the dock` | Same for `outbound`. |

All clients share the one response topic, so every subscriber sees the responses to everyone's commands. Use `requestId` or `client` to pick out your own.

## QoS and sessions

- **The twin publishes everything at QoS 0.** Subscribing with QoS 1 or 2 is accepted, but messages from the twin are still delivered at QoS 0: there is no redelivery and no queueing for a client that is offline.
- **Commands may be published at QoS 0 or 1.** With QoS 1 the broker acknowledges receipt of the publish; whether the command was accepted is reported only on `cmd/response`.
- Do not set the retain flag on command messages.
- Retained data topics are the way to get the current value after connecting. There is no persistence across server restarts: the broker keeps retained messages in memory only.
- A reconnecting client with a persistent session does not get telemetry it missed.

## Examples

### mosquitto_sub and mosquitto_pub

```bash
# everything, with topic names
mosquitto_sub -h 127.0.0.1 -p 1883 -t 'kestrel/line2/#' -v

# state changes and events only
mosquitto_sub -h 127.0.0.1 -t 'kestrel/line2/machines/+/state' -t 'kestrel/line2/events' -v

# the retained line OEE, then exit
mosquitto_sub -h 127.0.0.1 -t 'kestrel/line2/kpi/oee' -C 1
```

Send commands while watching the response topic in another terminal:

```bash
mosquitto_sub -h 127.0.0.1 -t 'kestrel/line2/cmd/response' -v
```

```bash
# set the speed
mosquitto_pub -h 127.0.0.1 -t 'kestrel/line2/cmd/speed' -m '{"speed": 20, "requestId": "cli-1"}'

# pause and resume
mosquitto_pub -h 127.0.0.1 -t 'kestrel/line2/cmd/control' -m '{"action": "pause"}'
mosquitto_pub -h 127.0.0.1 -t 'kestrel/line2/cmd/control' -m '{"action": "resume"}'

# inject a fault into the washer (-n sends an empty payload)
mosquitto_pub -h 127.0.0.1 -t 'kestrel/line2/cmd/machines/M4/fault' -n

# call an outbound truck
mosquitto_pub -h 127.0.0.1 -t 'kestrel/line2/cmd/warehouse/truck' -m '{"direction": "outbound"}'
```

### Node.js

Uses the `mqtt` package, which `npm install` puts in the project's `node_modules`. Save as a `.mjs` file in the project folder, or run `npm install mqtt` in a project of your own.

```js
import mqtt from 'mqtt';

const base = 'kestrel/line2';
const client = mqtt.connect('mqtt://127.0.0.1:1883');

client.on('connect', () => {
  client.subscribe([`${base}/kpi/oee`, `${base}/machines/+/state`, `${base}/events`, `${base}/cmd/response`]);
  // ask for a speed change and tag the request so the reply can be matched
  client.publish(`${base}/cmd/speed`, JSON.stringify({ speed: 10, requestId: 'node-1' }), { qos: 1 });
});

client.on('message', (topic, payload) => {
  const msg = JSON.parse(payload.toString());
  if (topic.endsWith('/kpi/oee')) console.log(`OEE ${msg.oee} %  (A ${msg.availability}, P ${msg.performance}, Q ${msg.quality})`);
  else if (topic.endsWith('/state')) console.log(`${msg.id} is ${msg.state}${msg.fault ? `: ${msg.fault.reason}` : ''}`);
  else if (topic.endsWith('/events')) console.log(`[${msg.severity}] ${msg.time.clock} ${msg.message}`);
  else if (topic.endsWith('/cmd/response')) console.log('command reply', msg);
});
```

```text
OEE 86.61 %  (A 99.53, P 93.6, Q 92.96)
command reply { ok: true, topic: 'kestrel/line2/cmd/speed', requestId: 'node-1', client: 'mqttjs_313f4c7c', ts: '2026-10-06T03:58:28.958Z', simS: 3508.96 }
M1 is RUN
M2 is RUN
M3 is RUN
M4 is IDLE
...
```

The first OEE value and the seven states arrive at once because those topics are retained.

From a browser, the same package connects over WebSocket: `mqtt.connect('ws://127.0.0.1:8080/mqtt')`.

### Python

Uses `paho-mqtt` version 2 (`pip install paho-mqtt`).

```python
import json
import paho.mqtt.client as mqtt

BASE = "kestrel/line2"


def on_connect(client, userdata, flags, reason_code, properties):
    client.subscribe([(f"{BASE}/machines/+/telemetry", 0), (f"{BASE}/cmd/response", 0)])
    client.publish(f"{BASE}/cmd/speed", json.dumps({"speed": 10, "requestId": "py-1"}), qos=1)


def on_message(client, userdata, msg):
    data = json.loads(msg.payload)
    if msg.topic.endswith("/telemetry"):
        print(data["ts"], data["id"], data["state"], data["powerKw"], "kW")
    else:
        print("command reply", data)


client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_connect = on_connect
client.on_message = on_message
client.connect("127.0.0.1", 1883)
client.loop_forever()
```

```text
command reply {'ok': True, 'topic': 'kestrel/line2/cmd/speed', 'requestId': 'py-1', 'client': 'aedes_1WcJqNZwR+yJvhjpVclu4w/0', 'ts': '2026-10-06T03:58:58.476Z', 'simS': 3538.48}
2026-10-06T03:58:58.818Z M4 IDLE 7 kW
2026-10-06T03:58:58.818Z M5 RUN 36.37 kW
2026-10-06T03:58:58.818Z M6 RUN 3.19 kW
...
```

With `paho-mqtt` 1.x, create the client with `mqtt.Client()` and use the callback signature `on_connect(client, userdata, flags, rc)`.
