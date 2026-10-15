# Running on Siemens Industrial Edge

On Industrial Edge the simulation runs in **Flow Creator** and publishes its data to the **IE Databus** in the SIMATIC v1 JSON format used by the S7 connectors. The 3D twin app runs as a separate Edge app: it reads the same Databus topics, rebuilds the plant from them, and writes commands back. Any other Edge app (Data Service, Performance Insight, AI Inference Server, a Flow Creator dashboard) can read the same data.

```text
 Flow Creator                      IE Databus                         Kestrel twin app (container)
 kestrel-twin-flow.json   ──►  ie/d/j/simatic/v1/kestreltwin1/dp/r/factory/<chunk>  ──►  3D viewer, dashboards
 simulation + anomalies   ◄──  ie/d/j/simatic/v1/kestreltwin1/dp/w/factory/Control_0 ◄──  Start, Stop, speed, ...
                          ◄──  ie/d/j/simatic/v1/kestreltwin1/dp/w/factory/AI_0      ◄──  AI Inference Server (optional)
```

> **Note**
> The flow has been tested in Node-RED 4 against a local MQTT broker standing in for the Databus, together with the twin app in Databus mode. It has not yet been installed on an Industrial Edge Device. Check the steps below against the documentation of your Flow Creator, Databus and App Publisher versions.

## What is in the repository

| File | Purpose |
| --- | --- |
| `edge/kestrel-twin-flow.json` | Flow Creator flow: simulation, SIMATIC publisher, write handling, manual buttons |
| `edge/tag-catalog.csv` | Every tag with id, data type, unit, access, role and data point, for configuring other Edge apps |
| `edge/build-flow.mjs` | Regenerates both files from `shared/`, so the flow and the app always run the same model |
| `docker-compose.yml` | The twin app as an Edge app in Databus mode |
| `Dockerfile` | Container image of the twin app |

Regenerate the flow after changing the model, or to use another connector name:

```bash
npm run build:flow                 # connector kestreltwin1
node edge/build-flow.mjs mytwin1   # another connector name
```

## Topics

The connector name is `kestreltwin1` and the connection name is `factory`. This mirrors the Pulse Carton example with `pulsecarton1` replaced.

| Topic | Direction | Content |
| --- | --- | --- |
| `ie/m/j/simatic/v1/kestreltwin1/dp` | flow → Databus, retained | Metadata: every data point and tag definition |
| `ie/d/j/simatic/v1/kestreltwin1/dp/r/factory/<chunk>` | flow → Databus | Values, `{"seq":n,"vals":[{"id","qc","ts","val"}]}` |
| `ie/d/j/simatic/v1/kestreltwin1/dp/w/factory/Control_0` | clients → flow | Commands, echoed on the matching `dp/r` topic |
| `ie/d/j/simatic/v1/kestreltwin1/dp/w/factory/AI_0` | detector → flow | Detector results, echoed on the matching `dp/r` topic |

Tags are grouped into data points (chunks) of at most 100 tags:

| Data point | Published | Content |
| --- | --- | --- |
| `Plant_0` | every second | Line status, OEE, production, energy, anomaly ground truth, latest event |
| `M1_0` to `M7_0` | every second | State, fault, cycle, counters, OEE, time in state, energy, reliability and the process tags of each station |
| `Logistics_0` | every second | AGVs, buffers, conveyors and people |
| `Warehouse_0`, `Warehouse_1` | every second | Inventory, forklift, trucks, statistics, every rack slot and handover stand |
| `Twin_0` | every second | Events and the 30 minute state timeline as JSON text, for the viewer |
| `History_0` | every 20 seconds | KPI history as JSON text, for the viewer |
| `Frame_0` | four times a second | Positions and states for the 3D view as JSON text |
| `Control_0` | every second, and on each write | Last values written to the command tags |
| `AI_0` | only when a detector writes | Detector results |

Tag names start with `KBW.`, for example `KBW.Machines.M5.Process.Zone2Temp`. Tags in `Frame_0`, `Twin_0` and `History_0` carry JSON text for the viewer; leave them out of analytics. The full list with ids is in `edge/tag-catalog.csv`, and the twin app serves the live values at `GET /api/v1/tags`.

## Anomalies

The flow injects process anomalies at random: on average every 40 simulated minutes, each lasting 3 to 10 minutes, with a random severity between 45 and 100 percent. The effect ramps in over the first fifth of the window. Anomalies only start while the line is running.

| Type | Station | What changes in the data |
| --- | --- | --- |
| `spindle_bearing` | M1 | Spindle vibration, spindle load and coolant temperature rise; more power per cycle |
| `coolant_pump` | M2 | Coolant pressure falls, coolant temperature rises, cycles slow down, more drilling defects |
| `nozzle_clog` | M4 | Spray pressure rises, rinse conductivity drifts up |
| `heater_drift` | M5 | Cure and flash-off temperatures fall, coating gets thinner, more coating defects |
| `probe_drift` | M6 | Measured runout drifts up although the discs are good (a sensor fault) |
| `vacuum_leak` | M7 | Gripper vacuum weakens, palletising slows down |
| `air_leak` | Plant | Compressed air pressure drops, auxiliary power rises |

The `KBW.Anomaly.*` tags in `Plant_0` are the ground truth: `Active`, `Type`, `Name`, `Station`, `Severity`, `Level`, `StartUtc`, `EndUtc`, `SecondsRemaining`, `Count`, `IntegratedSeconds` and `Manual`. Use them to label data and to score a detector, never as detector inputs. Their role in the tag catalogue is `ground_truth`.

### Monitoring anomalies on Industrial Edge

- **With AI Inference Server or another detector.** Feed it the process tags (role `process`) of the stations, for example `KBW.Machines.M1.Process.Vibration`. Map its outputs to the `AI_0` data point: `KBW.AI.AnomalyScore` (0 to 1000), `KBW.AI.Status` (0 normal, 1 warning, 2 alarm), `KBW.AI.Station` (1 to 7 for M1 to M7, 8 for the air system) and `KBW.AI.HealthIndex` (0 to 100). AI Inference Server writes SIMATIC v1 outputs as integers, which is why these tags are `DInt`. The flow echoes them on the read topic, and the twin app shows them next to the ground truth on its **Anomalies** dashboard.
- **With Data Service or Performance Insight.** Collect the station process tags and the `KBW.Anomaly.*` tags from connector `kestreltwin1`, and compare signal changes against the injection windows.
- **In Flow Creator.** Subscribe to `ie/d/j/simatic/v1/kestreltwin1/dp/r/factory/#` and build rules or dashboards on the values.

Anomalies can also be started on request: from the twin app (**Anomalies** dashboard), from the flow's **Inject a random anomaly** button, or by writing `KBW.Control.AnomalyRequest`.

## Commands

Write to `ie/d/j/simatic/v1/kestreltwin1/dp/w/factory/Control_0` with the tag ids from the metadata or the catalogue:

| Tag | Values |
| --- | --- |
| `KBW.Control.Command` | `start`, `pause`, `resume`, `stop`, `reset` |
| `KBW.Control.Speed` | 0.1 to 120 |
| `KBW.Control.FaultStation` | `M1` to `M7` |
| `KBW.Control.TruckRequest` | `inbound`, `outbound` |
| `KBW.Control.AnomalyRequest` | `random`, `clear`, or an anomaly type from the table above |
| `KBW.Control.Sequence` | any increasing number; lets a client send the same request twice |

```json
{"seq":1,"vals":[{"id":"1452","qc":3,"ts":"2026-10-15T10:00:00Z","val":"heater_drift"}]}
```

Each write is applied once, echoed on `dp/r/factory/Control_0`, and the result is published in `KBW.Status.LastCommand`, for example `AnomalyRequest=heater_drift: accepted`. The twin app's Start, Pause, Stop, Reset, speed, fault, truck and anomaly controls all use this topic.

## Install

### 1. Databus

In the Databus configuration, create a user that may publish and subscribe to `ie/#`, or at least to `ie/m/j/simatic/v1/kestreltwin1/#` and `ie/d/j/simatic/v1/kestreltwin1/#`, and deploy the configuration to the device.

### 2. Flow Creator

1. Import `edge/kestrel-twin-flow.json` into Flow Creator.
2. Open the **IE Databus** broker node and enter the Databus user and password. Node-RED does not export credentials, so this step is always needed after an import.
3. Deploy. The function node status shows the line mode, the speed and the shift clock, and turns red while an anomaly is active.

The simulation runs in real time (`START_SPEED = 1` at the top of the function). Its state lives in the flow context `kestrelWorld`, so a restart of Flow Creator starts a new shift unless your Flow Creator is configured with persistent context. If Flow Creator is stopped for more than 30 seconds, the gap is skipped rather than simulated.

### 3. Twin app

1. Build the image. Industrial Edge Devices are usually x86-64, so on an Apple Silicon or other ARM machine build for that platform:

   ```bash
   docker build --platform linux/amd64 -t kestrel-twin:2.0.0 .
   ```

2. In `docker-compose.yml`, set `DATABUS_USER` and `DATABUS_PASSWORD` to the Databus user from step 1.
3. In the Industrial Edge App Publisher, create a new version of the app and import `docker-compose.yml`. The compose file uses format 2.4, sets a memory limit and joins the `proxy-redirect` network on which `ie-databus` is reachable.
4. Upload the version to Industrial Edge Management and install it on the device.
5. Open `http://<device address>:8080/`. The **Connectivity** dialog shows whether the app is connected to the Databus and how many messages it has received.

## Databus mode settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `SOURCE` | `internal` | `databus` makes the app read from the Databus instead of simulating |
| `DATABUS_URL` | `mqtt://ie-databus:1883` | Databus broker |
| `DATABUS_USER`, `DATABUS_PASSWORD` | empty | Databus credentials |
| `DATABUS_CONNECTOR` | `kestreltwin1` | Connector name in the topics |
| `DATABUS_CONNECTION` | `factory` | Connection name in the topics |

In Databus mode the app's own MQTT broker and OPC UA server are not started; the Databus is the data interface. The REST API offers read-only views of the received data (`/status`, `/kpis`, `/machines`, `/machines/{id}/history`, `/agvs`, `/warehouse`, `/events`, `/anomaly`, `/tags`) and sends the control endpoints on as Control_0 writes.

## Try it without an Edge Device

Run any MQTT broker on your machine, import the flow into a local Node-RED with the broker node pointed at it, and start the app against the same broker:

```bash
SOURCE=databus DATABUS_URL=mqtt://localhost:1883 npm start
```

## Things to know

- **No authentication in the app.** Anyone who can reach port 8080 can stop the simulated line. Keep the device on a trusted network.
- **Viewer details that need the full model.** A few details, such as the individual discs listed in a buffer or the age of a pallet, are not published on the Databus and are left out in Databus mode.
- **One flow per connector name.** Two copies of the flow on the same device need different connector names and different MQTT client ids.
