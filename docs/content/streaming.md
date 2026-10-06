# Streaming: SSE and WebSocket

The HTTP server offers two push channels in addition to MQTT and OPC UA subscriptions:

| Channel | URL | Intended for |
|---|---|---|
| Server-Sent Events | `http://127.0.0.1:8080/api/v1/stream` | Simple dashboards and scripts that want status and KPIs without polling. |
| WebSocket | `ws://127.0.0.1:8080/ws` | The 3D viewer. Compact, viewer-oriented messages. |

> **Note**
> The WebSocket messages `f` and `s` are shaped for the viewer and may change whenever the viewer does. For an integration, use [REST](#/rest-api), [MQTT](#/mqtt) or [OPC UA](#/opc-ua), which are the stable contracts.

## Server-Sent Events

`GET /api/v1/stream` keeps the connection open and sends two events once a second in **real time**, starting immediately on connect:

| Event | Data |
|---|---|
| `status` | The [status](#/data-model/status) object, same as `GET /status`. |
| `kpis` | The [KPIs](#/data-model/kpis) object, same as `GET /kpis`. |

Properties:

- The period is one real second regardless of the speed multiplier. At speed 10 consecutive events are about 10 simulated seconds apart.
- Events continue while the simulation is paused; `status.paused` is true and the simulated time does not advance.
- Events carry no `id` field and the server keeps no backlog, so there is nothing to replay after a reconnect. `EventSource` reconnects by itself and simply continues with current values.
- The response has the same CORS headers as the REST API, so `EventSource` works from any origin.
- There is no filter; machine, AGV and warehouse data are not on this stream.

With curl (`-N` turns off buffering):

```bash
curl -N http://127.0.0.1:8080/api/v1/stream
```

```text
event: status
data: {"plant":{"id":"kestrel-line2","company":"Kestrel Brake Works","line":"Line 2","product":"Vented brake disc, 300 mm"},"mode":"running","lineMode":"running","paused":false,"speed":10,"simTime":{"seconds":2570.22,"clock":"06:42:50","iso":"2026-10-06T03:42:50.215Z"},"wallTime":"...","uptimeS":228}

event: kpis
data: {"simTime":{"seconds":2570.22,"clock":"06:42:50","iso":"2026-10-06T03:42:50.215Z"},"plannedProductionTimeS":2570.2,"oee":{"oee":87.7,"availability":99.36,"performance":95.46,"quality":92.45},"production":{"good":49,"scrap":4,"...":"..."},"energy":{"...":"..."}}

event: status
data: {"...":"one second later"}
```

In a browser:

```js
const stream = new EventSource('http://127.0.0.1:8080/api/v1/stream');

stream.addEventListener('status', e => {
  const status = JSON.parse(e.data);
  console.log(status.simTime.clock, status.mode, `x${status.speed}`);
});

stream.addEventListener('kpis', e => {
  const kpis = JSON.parse(e.data);
  console.log('OEE', kpis.oee.oee, 'good', kpis.production.good, 'power', kpis.energy.powerKw);
});
```

The events are named, so `stream.onmessage` does not fire; use `addEventListener` with the event name.

## WebSocket

Connect to `ws://127.0.0.1:8080/ws`. No subprotocol, no authentication. All messages in both directions are JSON text frames. Each server message has a kind in the field `k`.

| `k` | Sent | Content |
|---|---|---|
| `h` | Once, on connect. | Hello: protocol version and frame rate. |
| `f` | 30 times a second in real time. | Frame: positions and states needed to draw the scene. About 1 kB. |
| `s` | On connect, every 0.5 s in real time, and right after any accepted command. | Stats: the dashboard data. About 50 kB. |
| `r` | In reply to a message from this client. | Result of a command. |

Frames and stats are sent while the simulation is paused too; the content just stops changing.

If a client reads too slowly and more than 1 MB is waiting in its send buffer, the server drops messages for that client instead of queueing more. A client must tolerate missing `f` and `s` messages.

### Hello, `h`

```json
{ "k": "h", "version": "1.0.0", "frameHz": 30 }
```

### Frame, `f`

A compact snapshot for rendering. Field names are abbreviated and values are raw simulation values.

```json
{
  "k": "f", "t": 2596.34, "mode": "running", "paused": false, "speed": 10,
  "buf": { "ain": [0, 0, 0, 0, 0, 0, 0, 0], "aout": [2], "bin": [] },
  "conv": [[], [], [], [[2.3, 2], [1.58, 2], [0.86, 2]], [], [], []],
  "pallet": 4,
  "mach": [ { "s": "RUN", "p": 0, "f": 0.829 }, { "s": "RUN", "p": 1, "f": 0.793 }, "..." ],
  "agv": [ { "s": 45, "st": "idle", "mv": false, "low": false, "kind": null, "load": [], "bat": 100 }, "..." ],
  "tech": { "x": 7, "z": 1, "yaw": 0, "st": "home" },
  "op1": { "x": -8.5, "z": -3.3, "yaw": 3.142, "st": "hold", "c": 0 },
  "wh": {
    "slots": [0, 12, 0, 0, 12, 0, "..."], "raw": [12, 6], "fg": [0, 0],
    "fork": { "x": -31.334, "z": 0, "yaw": -1.571, "lift": 0.15, "st": "toDrop", "load": ["fg", 8] },
    "inb": { "st": "due", "pos": 0, "n": 0 },
    "out": { "st": "docked", "pos": 1, "n": 9 }
  }
}
```

| Field | Content |
|---|---|
| `t` | Simulated seconds since the start of the shift, unrounded. |
| `mode` | Line mode (`running`, `stopping`, `stopped`); pause is the separate `paused` flag. |
| `buf` | Part stages (0 to 4) of the parts on buffers A-in, A-out and B-in. |
| `conv` | Per conveyor C1 to C7, a list of `[position in m, stage]`. |
| `pallet` | Discs on the palletiser pallet. |
| `mach` | Per station: `s` state, `p` stage of the part inside or -1, `f` cycle progress 0 to 1. |
| `agv` | Per AGV: `s` loop position in m, `st` state, `mv` moving, `low` low battery, `kind` load kind, `load` stages of the parts on board, `bat` battery %. |
| `tech`, `op1` | Technician and M1 operator: position, heading in radians and internal state; `c` is the stage of the casting being carried or -1. |
| `wh.slots` | Quantity on the pallet in each of the 36 rack slots, 0 for empty. |
| `wh.raw`, `wh.fg` | Quantity on each stand. |
| `wh.fork` | Forklift pose, fork height, state and load as `[type, quantity]`. |
| `wh.inb`, `wh.out` | Trucks: state, approach position 0 to 1, pallets on board. |

### Stats, `s`

The data behind the viewer's panels, in one message:

| Field | Content |
|---|---|
| `status`, `kpis`, `agvs`, `material`, `people`, `warehouse` | The same objects as the REST routes of those names. |
| `machines` | The [machine](#/data-model/machine) objects, each with an extra `segs` array of `[state, startS]` pairs covering the last 1800 s. |
| `hist` | Line history samples in the engine's short field names (`t`, `rate`, `kw`, `oee`, `a`, `p`, `q`, `good`, `scrap`, `raw`, `fg`). |
| `events` | The latest 80 [events](#/data-model/events). |
| `services` | The same object as `GET /connectivity`. |

### Sending commands

Send a JSON object with an `action` and, if you want to match the reply, an `id` of your choice:

```json
{ "action": "speed", "speed": 20, "id": "a1" }
```

| `action` | Other fields | Effect |
|---|---|---|
| `start`, `stop`, `pause`, `resume`, `reset` | none | Same as [`POST /control/{action}`](#/rest-api/post-control-action). |
| `speed` | `speed`: number, 0.1 to 120 | Set the speed multiplier. |
| `fault` | `machine`: station id, for example `"M4"` | Inject a fault. |
| `truck` | `direction`: `"inbound"` or `"outbound"` | Call a truck. |

The server replies to the sending client with an `r` message that echoes the `id`:

```json
{ "k": "r", "id": "a1", "ok": true, "source": "websocket" }
```

```json
{ "k": "r", "id": 2, "ok": false, "error": "speed must be a number between 0.1 and 120", "source": "websocket" }
```

Other replies are `unknown action`, `unknown machine id`, `machine is already down`, the truck errors listed under [REST errors](#/rest-api/errors), and, for a frame that is not JSON:

```json
{ "k": "r", "ok": false, "error": "message is not valid JSON" }
```

After an accepted command every connected WebSocket client immediately receives a fresh `s` message, whichever protocol the command came in on.

> **Warning**
> Always send a JSON **object**. Any other valid JSON value, such as `null` or a number, is answered with `{"k":"r","ok":false,"error":"message must be a JSON object"}`.

### Example client

Node.js with the `ws` package, which is already installed as a dependency of the server. Save as `watch.mjs` in the project folder and run `node watch.mjs`:

```js
import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:8080/ws');

ws.on('open', () => {
  ws.send(JSON.stringify({ action: 'speed', speed: 10, id: 'set-speed' }));
});

ws.on('message', data => {
  const msg = JSON.parse(data);
  if (msg.k === 'h') console.log('connected, protocol', msg.version, 'at', msg.frameHz, 'frames/s');
  else if (msg.k === 'r') console.log('reply to', msg.id, msg.ok ? 'accepted' : `rejected: ${msg.error}`);
  else if (msg.k === 's') console.log(msg.status.simTime.clock, 'OEE', msg.kpis.oee.oee, 'good', msg.kpis.production.good);
  // msg.k === 'f' arrives 30 times a second; ignore it unless you are drawing
});
```

In a browser, `new WebSocket('ws://127.0.0.1:8080/ws')` with `onmessage` works the same way; `event.data` is the JSON string.

### Other WebSocket paths

`ws://127.0.0.1:8080/mqtt` speaks MQTT over WebSocket and is described in [MQTT](#/mqtt/connection). An upgrade request for any other path is closed without a response.
