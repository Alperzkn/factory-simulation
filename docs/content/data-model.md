# Data model

Every interface serves the same objects, built by the `pub*` functions in `shared/engine.js`. REST returns them as they are, MQTT publishes them (or parts of them) with a timestamp added, and OPC UA exposes selected fields as variables. This page is the field reference.

Conventions:

- Field names ending in `S` are simulated seconds, `Kw` kilowatts, `Kwh` kilowatt-hours, `Pct` percent, `M` metres.
- OEE components, yields, occupancy and utilisation are percentages from 0 to 100 with two decimals.
- `null` means "not applicable right now" or "not enough data yet". A few fields exist only on some kinds of object (for example `lengthM` on conveyors); the tables say so.
- Positions are plant coordinates in metres on the X/Z floor plane.

## Simulated time object

Used wherever a point in time is given as an object (`simTime`, `time`).

| Field | Type | Description |
|---|---|---|
| `seconds` | number | Simulated seconds since the start of the shift, two decimals. |
| `clock` | string | Shift clock `HH:MM:SS`, starting at `06:00:00`. |
| `iso` | string | ISO 8601 timestamp in UTC: 06:00 local time on the day the server started, plus `seconds`. |

Where a timestamp is given as a plain string (`ts`, `time` in history, `from` in timelines) it is the `iso` form.

## Status

`pubStatus`. REST `GET /status`, MQTT `status`, SSE event `status`.

| Field | Type | Description |
|---|---|---|
| `plant` | object | Constant: `id` (`kestrel-line2`), `company`, `line`, `product`. |
| `mode` | string | `paused` when the simulation is paused, otherwise the line mode. |
| `lineMode` | string | `running`, `stopping` or `stopped`. |
| `paused` | boolean | True while the simulation clock is frozen. |
| `speed` | number | Speed multiplier, 0.1 to 120. |
| `simTime` | object | [Simulated time](#/data-model/simulated-time-object). |
| `wallTime` | string | Real time of the server, ISO 8601 UTC. |
| `uptimeS` | integer | Real seconds since the server process created the simulation. Not reset by `reset`. |

## KPIs

`pubKpis`. REST `GET /kpis`, SSE event `kpis`, MQTT `kpi/oee`, `kpi/production` and `kpi/energy` (one topic per sub-object). Formulas are in [KPIs and formulas](#/kpis).

| Field | Type | Description |
|---|---|---|
| `simTime` | object | Simulated time of the snapshot. |
| `plannedProductionTimeS` | number | Time the line has been `running` or `stopping`. |
| `oee.oee` | number | Line OEE, %. |
| `oee.availability` | number | %. |
| `oee.performance` | number | %. |
| `oee.quality` | number | %. |
| `production.good` | integer | Discs placed on a pallet by M7. |
| `production.scrap` | integer | Discs scrapped at M3 and M6. |
| `production.firstPassYield` | number | Same value as `oee.quality`, %. |
| `production.throughputPerHour` | integer | Good discs per hour over the last 300 s; a multiple of 12. |
| `production.targetPerHour` | integer | Planned rate, constant 66. |
| `production.planned` | integer | Discs the plan called for so far, rounded. |
| `production.planAttainment` | number or null | `good` against plan, %, one decimal. Null in the first seconds of a shift. |
| `production.wip` | integer | Discs in process: in stations, on conveyors, in A-out and B-in, on the pallet, carried by the operator or by an AGV (work in progress and finished pallets). Raw castings on A-in or in a raw tote are not counted. |
| `production.palletsCompleted` | integer | Pallets that reached 8 discs. |
| `energy` | object | The [energy](#/data-model/energy) object. |

## Energy

`pubEnergy`. REST `GET /energy`, inside the KPIs, MQTT `kpi/energy`.

| Field | Type | Description |
|---|---|---|
| `powerKw` | number | Total electrical load now. |
| `energyKwh` | number | Total energy this shift. |
| `peakKw` | number | Highest total load this shift. |
| `kwhPerGoodPart` | number or null | `energyKwh / good`. Null while `good` is 0. |
| `compressedAirBar` | number | Compressed-air header pressure, with a little measurement noise. |
| `byConsumer[]` | array | One entry per consumer: `id`, `name`, `powerKw`, `energyKwh`. |

`byConsumer` has ten entries: `M1` to `M7`, then `AUX` (lighting and compressed air), `AGV` (AGV charging) and `WH` (warehouse). `powerKw` is `null` for `AGV` and `WH`; their load is included in the total `powerKw` and their energy is reported.

## Machine

`pubMachine`. REST `GET /machines` and `GET /machines/{id}`. MQTT splits it across `machines/{id}/state`, `/telemetry` and `/kpi`.

| Field | Type | Description |
|---|---|---|
| `id` | string | `M1` to `M7`. |
| `name` | string | For example `CNC lathe`. |
| `operation` | string | `OP10` to `OP70`. |
| `description` | string | What the station does. |
| `type` | string | `lathe`, `mill`, `bal`, `wash`, `oven`, `insp` or `robot`. |
| `crewed` | boolean | Whether a person is assigned to the station. |
| `state` | string | `OFF`, `IDLE`, `RUN`, `BLOCKED` or `DOWN`. |
| `stateCode` | integer | 0 to 4, see below. |
| `stateLabel` | string | Display text, see below. |
| `stateSinceS` | number | Seconds the station has been in this state. |
| `fault` | object or null | Present while the station is `DOWN`. |
| `fault.reason` | string | Fault text. |
| `fault.sinceS` | number | Seconds since the fault occurred. |
| `fault.technicianOnSite` | boolean | True once the technician has arrived. |
| `fault.estimatedRepairS` | number or null | Remaining repair time; null until the technician is on site. |
| `cycle.progress` | number | Progress of the current cycle, 0 to 100 %; 0 when empty. Stays at 100 while a finished part is blocked. |
| `cycle.idealS` | number | Ideal cycle time. |
| `cycle.lastS` | number | Duration of the last completed cycle; 0 before the first. |
| `cycle.partId` | integer or null | Id of the part in the station. |
| `counters.parts` | integer | Cycles completed this shift. |
| `counters.scrap` | integer | Scrapped discs whose defect was caused by this station. |
| `counters.stops` | integer | Faults this shift, random and injected. |
| `oee` | object | `oee`, `availability`, `performance`, `quality`, %. |
| `timeS` | object | Seconds spent in each state: `run`, `idle`, `blocked`, `down`, `off`. |
| `energy.powerKw` | number | Load now. |
| `energy.energyKwh` | number | Energy this shift. |
| `energy.kwhPerPart` | number or null | `energyKwh / parts`. |
| `maintenance.mtbfS` | number or null | Observed: run time / stops. Null with no stops. |
| `maintenance.mttrS` | number or null | Observed: down time / stops. Null with no stops. |
| `maintenance.downtimeS` | number | Total time `DOWN`. |
| `tags` | object | One entry per [process tag](#/data-model/process-tags): `{ "name", "unit", "value" }` keyed by tag key. |

### Machine states

| `state` | `stateCode` | `stateLabel` |
|---|--:|---|
| `OFF` | 0 | Off |
| `IDLE` | 1 | Waiting for parts |
| `RUN` | 2 | Running |
| `BLOCKED` | 3 | Blocked |
| `DOWN` | 4 | Down |

Their meaning is described in [Station states](#/simulation-model/station-states).

### Fault reasons

Random faults use one of these texts, by station type. Injected faults use `fault triggered manually`.

| Station | Reasons |
|---|---|
| M1 | insert wear limit reached, chuck pressure low, chip conveyor jam |
| M2 | drill breakage, coolant level low, tool changer fault |
| M3 | spindle vibration alarm, clamp sensor fault |
| M4 | spray nozzle blocked, bath temperature low |
| M5 | spray gun clogged, cure zone over temperature |
| M6 | camera calibration drift, measuring probe fault |
| M7 | gripper vacuum lost, light curtain tripped |

## Process tags

Tag values appear in the machine object (`tags.{key}.value`), in `GET /machines/{id}/tags`, in MQTT telemetry (flat, by key), in machine history samples and as OPC UA variables under `Machines.{id}.Tags` (the key with a capital first letter).

Kinds:

- **continuous**: a signal that follows the station state with a lag and carries measurement noise.
- **per-part**: measured once at the end of each cycle, constant in between.
- **wear**: remaining tool life in %, decreasing with each part and reset to 100 at an automatic tool change.

"Typical" is the value a continuous tag settles at while running and while idle, or the mean and standard deviation of a per-part measurement on a good disc.

| Station | Key | Name | Unit | Kind | Typical |
|---|---|---|---|---|---|
| M1 | `spindleSpeed` | Spindle speed | rpm | continuous | 1450 running, 0 idle |
| M1 | `spindleLoad` | Spindle load | % | continuous | 62 running, 3 idle |
| M1 | `coolantTemp` | Coolant temperature | °C | continuous | 28.5 running, 23.5 idle |
| M1 | `vibration` | Spindle vibration | mm/s | continuous | 1.8 running, 0.1 idle |
| M1 | `chuckPressure` | Chuck pressure | bar | continuous | 32 running and idle |
| M1 | `toolLife` | Insert life remaining | % | wear | about 0.9 lost per part |
| M2 | `spindleSpeed` | Spindle speed | rpm | continuous | 3200 running, 0 idle |
| M2 | `spindleLoad` | Spindle load | % | continuous | 48 running, 2 idle |
| M2 | `coolantPressure` | Coolant pressure | bar | continuous | 18 running, 2 idle |
| M2 | `coolantTemp` | Coolant temperature | °C | continuous | 27 running, 23 idle |
| M2 | `toolLife` | Drill life remaining | % | wear | about 0.6 lost per part |
| M3 | `spinSpeed` | Spin speed | rpm | continuous | 900 running, 0 idle |
| M3 | `vibration` | Bearing vibration | mm/s | continuous | 0.9 running, 0.05 idle |
| M3 | `imbalance` | Residual imbalance | g·cm | per-part | 34 ± 9 |
| M4 | `bathTemp` | Wash bath temperature | °C | continuous | 62 running, 60 idle |
| M4 | `sprayPressure` | Spray pressure | bar | continuous | 4.5 running, 0.3 idle |
| M4 | `dryerTemp` | Dryer air temperature | °C | continuous | 95 running, 70 idle |
| M4 | `conductivity` | Rinse conductivity | µS/cm | continuous | 860 running, 840 idle |
| M5 | `zone1Temp` | Flash-off zone temperature | °C | continuous | 82 running, 78 idle |
| M5 | `zone2Temp` | Cure zone temperature | °C | continuous | 318 running, 300 idle |
| M5 | `exhaustFlow` | Exhaust air flow | m³/h | continuous | 2400 running, 900 idle |
| M5 | `paintPressure` | Spray gun pressure | bar | continuous | 2.8 running, 0 idle |
| M5 | `coatThickness` | Coating thickness | µm | per-part | 10.2 ± 0.7 |
| M6 | `runout` | Lateral runout | µm | per-part | 18 ± 5 |
| M6 | `thicknessVar` | Disc thickness variation | µm | per-part | 6.2 ± 1.6 |
| M6 | `cameraConfidence` | Vision confidence | % | continuous | 97.5 running and idle |
| M7 | `vacuum` | Gripper vacuum | kPa | continuous | -72 running, -4 idle |
| M7 | `axisTemp` | Axis 2 motor temperature | °C | continuous | 46 running, 34 idle |
| M7 | `tcpSpeed` | Tool speed | mm/s | continuous | 850 running, 0 idle |

Notes:

- Slow signals such as temperatures take minutes to move between their running and idle values, so intermediate values are normal.
- `GET /machines/{id}/tags` reports the kind as `continuous`, `per-part measurement` or `wear counter`.
- On a defective disc, `runout`, `thicknessVar` and (for coating defects) `coatThickness` are 3.4 standard deviations higher. See [Quality and scrap](#/simulation-model/quality-and-scrap).
- Noise is added when a value is read, so the same tag read over two interfaces at the same moment differs in the last digits.

## AGV

`pubAgv`. REST `GET /agvs` and `GET /agvs/{id}`, MQTT `agvs/{id}/telemetry`.

| Field | Type | Description |
|---|---|---|
| `id` | string | `AGV-1` or `AGV-2`. |
| `state` | string | `idle`, `toPick`, `loading`, `toDrop` or `unloading`. |
| `charging` | boolean | True while idle, stationary and below 100 %. |
| `lowBattery` | boolean | True while the AGV is excluded from new jobs to recharge. |
| `batteryPct` | number | Charge, %, one decimal. |
| `task` | object or null | Current job. |
| `task.type` | string | `raw`, `wip` or `fg`. |
| `task.description` | string | `Raw castings to the lathe`, `Machined discs to finishing` or `Finished pallet to the warehouse`. |
| `task.pickUp`, `task.dropOff` | string | Names of the stops. |
| `position.loopM` | number | Position along the loop, 0 to 100 m. |
| `position.x`, `position.z` | number | Plant coordinates. |
| `load.kind` | string or null | `tote`, `pallet` or null when empty. |
| `load.quantity` | integer | Discs on board. |
| `trips` | integer | Jobs completed. |
| `distanceM` | number | Distance travelled. |
| `utilisation` | number | Share of time not idle, %. |

| AGV `state` | Meaning |
|---|---|
| `idle` | No job. Charging if stationary. |
| `toPick` | Driving to the pick-up stop. |
| `loading` | At the pick-up, 8 s, or waiting for material to be available. |
| `toDrop` | Driving to the drop-off stop. |
| `unloading` | At the drop-off, 8 s, or waiting for a free stand. |

## Material

`pubBuffers`. REST `GET /material`. An array of 11 locations: the three buffers, the palletiser pallet and the seven conveyors.

| Field | Type | Description |
|---|---|---|
| `id` | string | `A-in`, `A-out`, `B-in`, `PAL-1`, `C1` to `C7`. |
| `name` | string | Display name. |
| `kind` | string | `buffer`, `pallet` or `conveyor`. |
| `quantity` | integer | Parts present. |
| `capacity` | integer | 12 for buffers, 8 for the pallet, 4 to 6 for conveyors. |
| `lengthM` | number | Conveyors only. |
| `speedMps` | number | Conveyors only: 0.3, or 0 while the line is stopped. |
| `parts[]` | array | `{ "id", "stage" }` per part; conveyors add `positionM` from the infeed end. |

`stage` is one of `Raw casting`, `Turned`, `Drilled and balanced`, `Washed`, `Coated`.

## People

`pubPeople`. REST `GET /people`. An array of five entries.

| Field | Type | Description |
|---|---|---|
| `id` | string | `OP-M1`, `OP-M3`, `OP-M6`, `TECH-1`, `FLT-1`. |
| `role` | string | `Machine operator`, `Quality inspector`, `Maintenance technician` or `Forklift driver`. |
| `station` | string | `M1`, `M3`, `M6`, `Line 2` or `Warehouse`. |
| `activity` | string | Free text describing what the person is doing, for example `Carrying a casting to the lathe` or `Repairing M4`. |
| `position.x`, `position.z` | number | Plant coordinates. Fixed for `OP-M3` and `OP-M6`. |
| `partsLoaded` | integer | `OP-M1` only: castings loaded into the lathe. |
| `repairsCompleted` | integer | `TECH-1` only. |
| `openCalls` | integer | `TECH-1` only: faults queued plus the one being handled. |
| `utilisation` | number | `TECH-1` only: share of time away from the workshop, %. |

The forklift driver's position and activity mirror the forklift.

## Warehouse

`pubWarehouse`. REST `GET /warehouse`; parts of it at `GET /warehouse/inventory` and `GET /warehouse/trucks`; MQTT `warehouse/inventory`, `warehouse/forklift` and `warehouse/trucks`.

### inventory

| Field | Type | Description |
|---|---|---|
| `rawPallets` | integer | Raw pallets in the rack and on the stands. |
| `rawDiscs` | integer | Castings on those pallets. |
| `rawCoverHours` | number | Hours of production covered by `rawDiscs`. |
| `finishedPallets` | integer | Finished pallets in the rack and on the stands. |
| `finishedDiscs` | integer | Discs on those pallets. |
| `rackSlots` | integer | Constant 36. |
| `rackOccupied` | integer | Rack slots holding a pallet. |
| `rackOccupancy` | number | %. |
| `reorderPointPallets` | integer | Constant 7. |

### slots

An array of 36 entries.

| Field | Type | Description |
|---|---|---|
| `id` | string | `R-01-1` to `R-06-3` and `F-01-1` to `F-06-3`. |
| `zone` | string | `raw` or `finished`. |
| `bay` | integer | 1 to 6. |
| `level` | integer | 1 to 3. |
| `pallet` | object or null | A [pallet](#/data-model/pallet) or null when empty. |

### stands

`{ "raw": [pallet or null, pallet or null], "finished": [pallet or null, pallet or null] }`.

### Pallet

| Field | Type | Description |
|---|---|---|
| `id` | string | `RP-nnnn` for raw, `FP-nnnn` for finished. |
| `type` | string | `raw` or `fg`. Note that finished pallets are `fg` here while the slot zone is called `finished`. |
| `quantity` | integer | Discs on the pallet. Raw pallets on a stand count down as AGVs take castings. |
| `ageS` | number | Seconds since the pallet entered the warehouse: since the truck docked for raw pallets, since hand-over by the AGV for finished pallets. Initial stock counts from the start of the shift. |

### forklift

| Field | Type | Description |
|---|---|---|
| `id` | string | `FLT-1`. |
| `state` | string | `idle`, `toPick`, `picking`, `toDrop`, `dropping` or `toHome`. |
| `task` | object or null | `kind` (`replenish`, `putaway`, `unload`, `load`), `from` and `to` as text, for example `rack slot F-01-2`, `raw casting stand`, `finished goods stand`, `inbound truck`, `outbound truck`. |
| `position.x`, `position.z` | number | Plant coordinates. |
| `forkHeightM` | number | Fork height. |
| `load` | object or null | The [pallet](#/data-model/pallet) on the forks. |
| `moves` | integer | Tasks completed. |
| `distanceM` | number | Distance driven. |
| `utilisation` | number | Share of time on a task, %. |

| Forklift `state` | Meaning |
|---|---|
| `idle` | Parked or waiting for a task. |
| `toPick` | Driving to the source of the task. |
| `picking` | Aligning, raising the forks and taking the pallet. |
| `toDrop` | Driving to the destination. |
| `dropping` | Aligning, raising the forks and setting the pallet down. |
| `toHome` | Returning to the parking position; can be interrupted by a new task. |

### trucks

`{ "inbound": {...}, "outbound": {...} }`.

| Field | Type | Description |
|---|---|---|
| `state` | string | `none`, `due`, `arriving`, `docked` or `departing`. |
| `number` | integer | Running number of the truck in this direction; 0 before the first. |
| `etaS` | number or null | Seconds until arrival while `due`. |
| `dockedForS` | number or null | Seconds at the dock while `docked`. |
| `palletsOnBoard` | integer | Inbound only: pallets still on the truck. |
| `palletsLoaded` | integer | Outbound only: pallets loaded so far. |
| `capacity` | integer | 8 for inbound, 10 for outbound. |

Truck states are explained in [Reorder point and trucks](#/simulation-model/reorder-point-and-trucks).

### stats

| Field | Type | Description |
|---|---|---|
| `receivedPallets`, `receivedDiscs` | integer | Raw material received, counted when the inbound truck leaves. |
| `shippedPallets`, `shippedDiscs` | integer | Finished goods shipped, counted when the outbound truck leaves. |
| `trucksIn`, `trucksOut` | integer | Trucks completed. |
| `putaways` | integer | Finished pallets put into the rack. |
| `replenishments` | integer | Pallets moved to a raw stand. |
| `stockoutS` | number | See [Warehouse KPIs](#/kpis/warehouse-kpis). |
| `dockToStockAvgS` | number or null | See [Warehouse KPIs](#/kpis/warehouse-kpis). |

## Events

`pubEvents`. REST `GET /events`, MQTT `events` (one message per event).

| Field | Type | Description |
|---|---|---|
| `id` | integer | Increases by 1 per event. Restarts at 1 after `reset`. |
| `time` | object | [Simulated time](#/data-model/simulated-time-object) of the event. |
| `severity` | string | `info`, `alarm`, `quality` or `logistics`. |
| `source` | string | `line`, a station id, an AGV id or `warehouse`. |
| `message` | string | Human-readable text. |

The server keeps the latest 200 events.

| Severity | Source | Message pattern |
|---|---|---|
| `info` | `line` | `Shift started, line running`, `Line started`, `Stop requested, stations finishing their cycle`, `Line stopped, stations on standby` |
| `alarm` | station | `M4 Washer down: spray nozzle blocked` |
| `info` | station | `M4 Washer repaired after 1:54` (minutes:seconds of downtime) |
| `info` | station | `M2 Drilling centre: tool changed automatically` |
| `quality` | station | `Disc 25 scrapped at M6 inspection cell, defect from M1` (source is the detecting station) |
| `logistics` | AGV | `Pallet FP-0018 handed to the warehouse by AGV 2` |
| `logistics` | `warehouse` | `Raw stock at 7 pallets, replenishment truck ordered` |
| `logistics` | `warehouse` | `Inbound truck 1 docked with 8 pallets of raw castings`, `Inbound truck 1 unloaded in 6:12` |
| `logistics` | `warehouse` | `8 finished pallets in stock, collection booked` |
| `logistics` | `warehouse` | `Outbound truck 1 docked, loading 8 pallets`, `Outbound truck 1 left with 8 pallets, 64 discs` |

Message texts are meant for people. Match on `severity` and `source` rather than parsing the text where you can. Commands such as pause, resume, speed changes and truck calls do not create events.

## History

### Line history

`pubHistory`. REST `GET /history`. One sample every 20 simulated seconds, latest 360 kept.

| Field | Type | Description |
|---|---|---|
| `time` | string | Simulated timestamp, ISO 8601. |
| `t` | number | Simulated seconds since the start of the shift. |
| `oee`, `availability`, `performance`, `quality` | number | Cumulative line OEE figures at that moment, %, one decimal. |
| `throughputPerHour` | integer | Rolling throughput at that moment. |
| `powerKw` | number | Mean total load over the sample interval. |
| `good`, `scrap` | integer | Cumulative counts. |
| `rawDiscs` | integer | Castings in the warehouse. |
| `finishedPallets` | integer | Finished pallets in the warehouse. |

### Machine history

`pubMachineHistory`. REST `GET /machines/{id}/history`. One sample every 10 simulated seconds, latest 360 kept.

| Field | Type | Description |
|---|---|---|
| `time` | string | Simulated timestamp, ISO 8601. |
| `t` | number | Simulated seconds since the start of the shift. |
| `state` | string | Station state at the sample. |
| `kw` | number | Station load at the sample. |
| one field per tag key | number | Tag values at the sample, for example `spindleSpeed`. |

### State timeline

`pubTimeline`. REST `GET /machines/{id}/timeline`. One segment per period a station spent in one state. The server keeps the latest 600 state changes per station.

| Field | Type | Description |
|---|---|---|
| `state` | string | Station state. |
| `from` | string | Simulated timestamp at which the state began. |
| `fromS` | number | The same as simulated seconds. |
| `durationS` | number | Length of the segment; for the last segment, up to now. |

## Full state

`pubState`. REST `GET /state`. Everything above except events and history in one object:

```json
{
  "status": { },
  "kpis": { },
  "machines": [ ],
  "agvs": [ ],
  "material": [ ],
  "people": [ ],
  "warehouse": { }
}
```

OPC UA variables are read from this object, refreshed at most five times a second.
