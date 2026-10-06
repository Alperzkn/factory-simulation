# Recipes

Short, practical integrations. All of them assume the default addresses; adjust host, ports and base topic if you changed the [configuration](#/configuration).

## Log KPIs to CSV with curl and jq

Poll `GET /kpis` and append one CSV row per poll:

```bash
echo 'time,oee,availability,performance,quality,good,scrap,throughputPerHour,powerKw' > kpis.csv

while true; do
  curl -s http://127.0.0.1:8080/api/v1/kpis \
    | jq -r '[.simTime.iso, .oee.oee, .oee.availability, .oee.performance, .oee.quality,
              .production.good, .production.scrap, .production.throughputPerHour, .energy.powerKw] | @csv' \
    >> kpis.csv
  sleep 2
done
```

```text
time,oee,availability,performance,quality,good,scrap,throughputPerHour,powerKw
"2026-10-06T04:17:20.605Z",84.26,98.95,91.16,93.41,85,6,84,124.75
```

`sleep 2` is real time. At speed 10 the rows are about 20 simulated seconds apart, and the spacing is only as regular as the shell loop.

For evenly spaced samples, let the server do the sampling and read its history buffer instead. `GET /history` holds one sample every 20 simulated seconds:

```bash
curl -s http://127.0.0.1:8080/api/v1/history \
  | jq -r '.samples[] | [.time, .t, .oee, .throughputPerHour, .powerKw, .good, .scrap] | @csv' > history.csv
```

The buffer holds the last two simulated hours. For longer recordings see [Generate a dataset](#/recipes/generate-a-dataset-faster-than-real-time).

## Node-RED flow for MQTT

An outline of a flow that shows station states and raises a notification when a station goes down. It uses only core nodes.

1. **Broker configuration.** Add an `mqtt-broker` config node: server `127.0.0.1`, port `1883`, protocol MQTT V3.1.1, no TLS, no credentials. If Node-RED runs on another machine or in a container, the twin must be started with `HOST=0.0.0.0` and you use that machine's address (see the [warning](#/configuration/network-exposure)).
2. **State changes.** Add an `mqtt in` node: topic `kestrel/line2/machines/+/state`, QoS 0, output "a parsed JSON object". Because the topic is retained, the flow receives the current state of all seven stations as soon as it connects.
3. **Detect a stop.** Wire it to a `switch` node on `msg.payload.state` with the rule `== DOWN`. Each fault produces two messages (station down, technician arrived); add a second rule `msg.payload.fault.technicianOnSite` `is false` in a following `switch` node if you want only the first.
4. **Format.** Add a `function` node:

   ```js
   const s = msg.payload;
   msg.payload = `${s.id} is down: ${s.fault.reason} (${s.ts})`;
   return msg;
   ```

5. **Deliver.** Wire to a `debug` node, or to an email, Slack or dashboard node of your choice.
6. **Telemetry.** For charts, add a second `mqtt in` node on `kestrel/line2/machines/M1/telemetry` and a `change` node that sets `msg.payload` to `msg.payload.spindleLoad` (or another tag) and `msg.topic` to the tag name before a chart node. Telemetry arrives about 10 times a second at the default speed; put a `delay` node in rate-limit mode in front of anything slow.
7. **Commands.** To control the twin from the flow, wire an `inject` node with a JSON payload such as `{"speed": 20}` to an `mqtt out` node with topic `kestrel/line2/cmd/speed`. Add an `mqtt in` node on `kestrel/line2/cmd/response` and a `debug` node to see the result.

Events are available on `kestrel/line2/events` as one message per event if you prefer text that is ready to display.

## Grafana

Two approaches work without writing code. Both need a data source plugin installed in Grafana.

### Live panels over MQTT

Install the MQTT data source plugin and point it at `tcp://127.0.0.1:1883` with no credentials. In a panel, subscribe to a topic; the plugin turns numeric JSON fields into series.

| Panel | Topic | Fields |
|---|---|---|
| Line OEE | `kestrel/line2/kpi/oee` | `oee`, `availability`, `performance`, `quality` |
| Throughput | `kestrel/line2/kpi/production` | `throughputPerHour`, `targetPerHour` |
| Total load | `kestrel/line2/kpi/energy` | `powerKw` |
| Lathe signals | `kestrel/line2/machines/M1/telemetry` | `spindleLoad`, `vibration`, `coolantTemp` |
| AGV battery | `kestrel/line2/agvs/AGV-1/telemetry` | `batteryPct` |

Live MQTT panels plot values against their arrival time, so the X axis is real time and the speed multiplier only compresses what you see.

### History over HTTP

Install a JSON/HTTP data source such as Infinity and query the REST API:

- URL `http://127.0.0.1:8080/api/v1/history`, type JSON, rows at `samples`.
- Columns: `time` as timestamp, `oee`, `throughputPerHour`, `powerKw`, `good`, `scrap` as numbers.
- For a station: `http://127.0.0.1:8080/api/v1/machines/M1/history`, rows at `samples`, columns `time`, `kw` and the tag keys.
- For tables and stat panels, `http://127.0.0.1:8080/api/v1/machines` returns an array with one row per station; use fields such as `id`, `state`, `oee.oee` and `counters.parts`.

> **Note**
> Timestamps in the history are **simulated** time. The shift starts at 06:00 local time on the day the server was started and then runs at the speed multiplier, so at speed 10 the data is soon hours ahead of the wall clock and a dashboard range of "last 15 minutes" shows nothing. Set the dashboard time range to cover the simulated shift (for example today 06:00 to tomorrow 06:00), or run the twin with `SIM_SPEED=1`.

If Grafana runs in a container or on another host, `127.0.0.1` is not the twin; start the twin with `HOST=0.0.0.0` and use the host's address.

## Trigger a fault and watch it on all three protocols

This script subscribes to the washer (M4) over MQTT and OPC UA, injects a fault over REST, and polls the REST event log. It shows the same incident arriving on each interface.

Save as `fault.mjs` in the project folder (so that `mqtt` and `node-opcua` resolve) and run `node fault.mjs`. Requires Node.js 18 for the built-in `fetch`.

```js
import mqtt from 'mqtt';
import { OPCUAClient, AttributeIds, TimestampsToReturn } from 'node-opcua';

const MACHINE = 'M4';
const REST = 'http://127.0.0.1:8080/api/v1';
const log = (via, text) => console.log(new Date().toISOString().slice(11, 23), via.padEnd(7), text);

// MQTT: state changes of the station and plant events
const mq = mqtt.connect('mqtt://127.0.0.1:1883');
mq.on('connect', () => mq.subscribe([`kestrel/line2/machines/${MACHINE}/state`, 'kestrel/line2/events']));
mq.on('message', (topic, payload, packet) => {
  if (packet.retain) return;                               // skip the last known value sent on subscribe
  const m = JSON.parse(payload.toString());
  if (topic.endsWith('/events')) { if (m.source === MACHINE) log('MQTT', `event ${m.id} [${m.severity}] ${m.message}`); }
  else log('MQTT', `state ${m.state}${m.fault ? `, ${m.fault.reason}, technician on site: ${m.fault.technicianOnSite}` : ''}`);
});

// OPC UA: monitor State and FaultReason
const ua = OPCUAClient.create({ endpointMustExist: false });
await ua.connect('opc.tcp://127.0.0.1:4840/UA/Kestrel');
const session = await ua.createSession();
const sub = await session.createSubscription2({ requestedPublishingInterval: 250, requestedLifetimeCount: 120, requestedMaxKeepAliveCount: 20, publishingEnabled: true });
for (const name of ['State', 'FaultReason']) {
  const item = await sub.monitor({ nodeId: `ns=1;s=Line2.Machines.${MACHINE}.${name}`, attributeId: AttributeIds.Value }, { samplingInterval: 250, queueSize: 10, discardOldest: true }, TimestampsToReturn.Both);
  item.on('changed', dv => log('OPC UA', `${name} = "${dv.value.value}"`));
}

// REST: remember the newest event id, trigger the fault, then poll for new events
let lastId = (await (await fetch(`${REST}/events?limit=1`)).json())[0]?.id ?? 0;
await new Promise(resolve => setTimeout(resolve, 1000));
const res = await (await fetch(`${REST}/machines/${MACHINE}/fault`, { method: 'POST' })).json();
log('REST', res.ok ? 'fault accepted' : `fault rejected: ${res.error}`);

const poll = setInterval(async () => {
  const events = await (await fetch(`${REST}/events?sinceId=${lastId}&limit=200`)).json();
  for (const e of events.reverse()) {
    lastId = e.id;
    if (e.source === MACHINE) log('REST', `event ${e.id} [${e.severity}] ${e.message}`);
  }
}, 500);

// stop after 40 real seconds, long enough to see the repair at speed 10
setTimeout(async () => { clearInterval(poll); mq.end(); await sub.terminate(); await session.close(); await ua.disconnect(); }, 40000);
```

Output from a run at speed 10 (the left column is real time):

```text
08:55:51.604 OPC UA  State = "RUN"
08:55:51.605 OPC UA  FaultReason = ""
08:55:52.238 MQTT    state IDLE
08:55:52.372 REST    fault accepted
08:55:52.373 MQTT    state DOWN, fault triggered manually, technician on site: false
08:55:52.373 MQTT    event 2 [alarm] M4 Washer down: fault triggered manually
08:55:52.606 OPC UA  State = "IDLE"
08:55:52.680 MQTT    state DOWN, fault triggered manually, technician on site: true
08:55:52.856 OPC UA  State = "DOWN"
08:55:52.857 OPC UA  FaultReason = "fault triggered manually"
08:55:52.877 REST    event 2 [alarm] M4 Washer down: fault triggered manually
08:56:06.543 MQTT    state RUN
08:56:06.544 MQTT    event 3 [info] M4 Washer repaired after 2:22
08:56:06.910 REST    event 3 [info] M4 Washer repaired after 2:22
08:56:06.927 OPC UA  State = "RUN"
08:56:06.928 OPC UA  FaultReason = ""
```

What to notice:

- MQTT delivers the change within one simulation tick (about 33 ms). OPC UA follows within its 250 ms sampling interval, REST within your polling interval.
- OPC UA sampling can miss a state that lasts less than 250 ms of real time. At high speed multipliers short states are skipped; MQTT `state` messages and the REST timeline record every change.
- The repair took 2 min 22 s of simulated time, 14 s of real time at speed 10. That downtime includes the technician's walk to the station, which is why it is longer than the hands-on repair time alone.

The same fault can be injected over the other interfaces:

```bash
mosquitto_pub -h 127.0.0.1 -t 'kestrel/line2/cmd/machines/M4/fault' -n
```

Over OPC UA, call the method `ns=1;s=Line2.Machines.M4.TriggerFault` on the object `ns=1;s=Line2.Machines.M4`.

## Generate a dataset faster than real time

At the maximum speed of 120, an eight-hour shift takes four minutes. The plant behaves the same at any speed, so this is a quick way to produce hours of labelled data with faults, scrap and logistics events.

### 1. Start from a clean shift at high speed

Either start a dedicated instance:

```bash
SIM_SPEED=120 npm start
```

or reset a running one and speed it up:

```bash
API=http://127.0.0.1:8080/api/v1
curl -s -X POST $API/control/reset > /dev/null
curl -s -X PUT  $API/control/speed -H 'Content-Type: application/json' -d '{"speed": 120}' > /dev/null
curl -s -X POST $API/control/start > /dev/null
```

> **Warning**
> `reset` discards the current simulation for everyone connected to this server. Use a separate instance on other ports if the server is shared; see the last example in [Configuration](#/configuration/examples).

### 2. Record the server-side history buffers

The history buffers are sampled by the server in simulated time, so they are evenly spaced whatever the speed. They hold 360 samples each, which at speed 120 is 60 real seconds of line history and 30 real seconds of machine history. Poll more often than that and keep only new samples.

Line history, using the `sinceS` cursor:

```bash
#!/usr/bin/env bash
# Append new line-history samples to line.csv until interrupted.
API=http://127.0.0.1:8080/api/v1
OUT=line.csv
since=-1
echo 't,time,oee,availability,performance,quality,throughputPerHour,powerKw,good,scrap,rawDiscs,finishedPallets' > "$OUT"
while true; do
  curl -s "$API/history?sinceS=$since" \
    | jq -r '.samples[] | [.t, .time, .oee, .availability, .performance, .quality, .throughputPerHour, .powerKw, .good, .scrap, .rawDiscs, .finishedPallets] | @csv' >> "$OUT"
  last=$(tail -n 1 "$OUT" | cut -d, -f1)
  [ "$last" != "t" ] && since=$last
  sleep 30
done
```

Machine history (state, load and every process tag, one CSV per station). Save as `machines.mjs` and run `node machines.mjs`:

```js
import { appendFileSync, writeFileSync } from 'node:fs';

const API = 'http://127.0.0.1:8080/api/v1';
const IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'];
const last = Object.fromEntries(IDS.map(id => [id, -1]));
const started = new Set();

async function collect() {
  for (const id of IDS) {
    const { samples } = await (await fetch(`${API}/machines/${id}/history`)).json();
    const fresh = samples.filter(s => s.t > last[id]);
    if (!fresh.length) continue;
    const file = `${id}.csv`, columns = Object.keys(fresh[0]);
    if (!started.has(id)) { writeFileSync(file, columns.join(',') + '\n'); started.add(id); }
    appendFileSync(file, fresh.map(s => columns.map(c => s[c]).join(',')).join('\n') + '\n');
    last[id] = fresh[fresh.length - 1].t;
  }
}

await collect();
setInterval(collect, 20000);     // real time; must be shorter than 3600 / speed seconds
```

```text
time,t,state,kw,spindleSpeed,spindleLoad,coolantTemp,vibration,chuckPressure,toolLife
2026-10-06T05:24:10.200Z,8650.2,RUN,25.9,1458,60.2,28.4,1.69,31.9,32.7
```

### 3. Record labels

The event log gives you the ground truth for faults, repairs, scrap and tool changes. It holds 200 events, which is plenty for a polling interval of a few seconds:

```bash
curl -s 'http://127.0.0.1:8080/api/v1/events?limit=200' \
  | jq -r '.[] | [.id, .time.seconds, .severity, .source, .message] | @csv'
```

Poll it with `sinceId` as in the fault recipe above, or subscribe to `kestrel/line2/events` over MQTT, where every event is delivered once. `GET /machines/{id}/timeline?windowS=7200` gives the exact state intervals of a station for up to the last two simulated hours (the server keeps the latest 600 state changes per station).

### 4. Put the speed back

```bash
curl -s -X PUT http://127.0.0.1:8080/api/v1/control/speed -H 'Content-Type: application/json' -d '{"speed": 10}'
```

### Notes on density

- History samples are 20 s (line) and 10 s (machines) apart in simulated time at any speed.
- MQTT telemetry is limited to about 10 messages a second per station in real time by default, which at speed 120 is one sample every 12 simulated seconds. Start the server with `TELEMETRY_MIN_REAL_MS=0` to get one sample per simulation tick, about every 4 simulated seconds at speed 120. For 1 s resolution over MQTT, run at speed 10 or lower.
- The simulation step is at most 0.25 simulated seconds at every speed, so the dynamics are not coarser at high speed. Only the sampling is.
- Runs are not reproducible sample for sample; see [Time stepping](#/simulation-model/time-stepping).
