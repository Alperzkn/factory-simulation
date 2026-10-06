# Simulation model

This page describes what the engine in `shared/engine.js` does, using the constants in `shared/plant.js`. All durations are simulated seconds.

## Time stepping

The server runs a loop 30 times a second. On each pass it measures the real time since the previous pass, multiplies it by the speed multiplier and advances the simulation by that amount in steps of at most 0.25 simulated seconds.

If the process is stalled for more than 0.25 s of real time, the excess is dropped rather than caught up, so the simulated clock can fall slightly behind `real time x speed` on a busy machine.

Random events use a seeded generator, but the step size depends on wall-clock timing and measurement noise uses an unseeded generator, so two runs do not produce identical data.

## The production line

### Stations

| Id | Station | Operation | Ideal cycle | Power running / idle | MTBF | MTTR | Defect rate | Crewed |
|---|---|---|--:|--:|--:|--:|--:|---|
| M1 | CNC lathe | OP10, turns both braking faces and the hat | 46 s | 24 / 4.5 kW | 3000 s | 150 s | 2 % | yes |
| M2 | Drilling centre | OP20, drills the bolt circle and vent holes | 38 s | 16 / 3 kW | 3600 s | 140 s | 1.2 % | no |
| M3 | Balancer | OP30, measures imbalance and mills a correction | 30 s | 6 / 1.2 kW | 6000 s | 110 s | 0 | yes |
| M4 | Washer | OP40, spray wash, rinse and hot-air dry | 24 s | 19 / 7 kW | 5000 s | 120 s | 0 | no |
| M5 | Coating oven | OP50, zinc-flake spray coat and cure | 40 s | 36 / 15 kW | 4200 s | 160 s | 2 % | no |
| M6 | Inspection cell | OP60, checks runout, thickness variation and surface | 22 s | 3.5 / 1 kW | 9000 s | 90 s | 0 | yes |
| M7 | Palletising robot | OP70, stacks eight discs per pallet | 14 s | 5 / 1 kW | 7000 s | 100 s | 0 | no |

How these numbers are used:

- **Cycle time.** Each part gets an actual cycle time of the ideal value multiplied by a random factor between 1.00 and 1.12. A station never runs faster than ideal.
- **MTBF** is the mean in-cycle time between random faults, not calendar time. A station can only fail randomly while it is processing a part.
- **MTTR** is the mean hands-on repair time. Each repair takes between 0.6 and 1.4 times this value, and the clock only runs while the technician is at the station.
- **Defect rate** is the probability that a part which is still good becomes defective when the station starts working on it.
- **Crewed** is descriptive. Only the M1 operator is simulated as a moving person who affects the flow; the people at M3 and M6 are reported with a fixed position and an activity derived from the station state.

M1 is the constraint: its 46 s cycle caps the line at about 78 discs per hour before any loss. The planned rate is 66 discs per hour.

### Station states

| State | Code | Label | Meaning |
|---|--:|---|---|
| `OFF` | 0 | Off | The line is stopped, or it is stopping and the station has nothing in it. |
| `IDLE` | 1 | Waiting for parts | Line running, station healthy and empty. |
| `RUN` | 2 | Running | Processing a part. |
| `BLOCKED` | 3 | Blocked | Cycle finished but the part cannot leave: the outfeed conveyor has no space at its entry, or (M7) the pallet is full. |
| `DOWN` | 4 | Down | Faulted, waiting for or under repair. |

### Material flow

```text
raw castings (warehouse stand)
   | AGV, tote of 6
   v
A-in buffer --operator--> M1 --C1--> M2 --C2--> M3 --C3--> A-out buffer
                                                              | AGV, tote of 4
                                                              v
pallet <-- M7 <--C7-- M6 <--C6-- M5 <--C5-- M4 <--C4-- B-in buffer
   | AGV, pallet of 8
   v
finished-goods stand (warehouse)
```

- The **operator** at M1 walks to the A-in table, takes one casting, carries it back and loads the lathe as soon as it is empty and healthy. Walking speed is 1.45 m/s.
- **M2 to M7** pull the next part from their infeed conveyor when it has reached the end of the belt.
- **M7** places discs on the pallet. A disc is counted as good production at that moment. When the pallet holds 8 discs M7 is blocked until an AGV takes the pallet away.

Parts carry a stage that describes how far they have been processed:

| Stage | Name | Reached after |
|--:|---|---|
| 0 | Raw casting | delivery |
| 1 | Turned | M1 |
| 2 | Drilled and balanced | M2 (and unchanged by M3) |
| 3 | Washed | M4 |
| 4 | Coated | M5 (and unchanged by M6 and M7) |

### Conveyors and buffers

Conveyors run at 0.3 m/s and accumulate: parts queue at the end with a minimum pitch of 0.72 m. A station can push a finished part onto its outfeed only when the previous part has moved at least one pitch from the entry.

| Conveyor | From | To | Length | Capacity |
|---|---|---|--:|--:|
| C1 | M1 | M2 | 3.3 m | 5 |
| C2 | M2 | M3 | 3.7 m | 6 |
| C3 | M3 | A-out buffer | 2.9 m | 5 |
| C4 | B-in buffer | M4 | 2.3 m | 4 |
| C5 | M4 | M5 | 2.5 m | 4 |
| C6 | M5 | M6 | 3.1 m | 5 |
| C7 | M6 | M7 | 2.4 m | 4 |

| Buffer | Name | Filled by | Emptied by |
|---|---|---|---|
| A-in | Raw casting buffer | AGV, 6 castings per trip | M1 operator |
| A-out | Machined disc buffer | conveyor C3 | AGV, 4 discs per trip |
| B-in | Finishing infeed buffer | AGV | conveyor C4 |

All three buffers report a capacity of 12. The limit is enforced directly only on A-out, where C3 stops delivering when 12 discs are waiting; A-in and B-in stay within it because of the AGV dispatch rules below.

At the start of a shift the line is not empty: 8 castings on A-in, 1 disc on A-out, 2 on B-in, one part on each of C1 to C6 and 3 discs on the pallet.

### AGV loop and jobs

Two AGVs travel one way around a rectangular 100 m loop at 1.4 m/s. Position on the loop is given in metres from the corner at X -17.5, Z -10.

| Loop position | Stop |
|--:|---|
| 35 m | Machined disc pick-up (A-out) |
| 45 m | Finishing drop-off (B-in) |
| 81.5 m | Raw casting pick-up (warehouse raw stands) |
| 85 m | Pallet pick-up (palletiser) |
| 95 m | Raw casting drop-off (A-in) |
| 98.5 m | Finished goods drop-off (warehouse finished-goods stands) |

Three kinds of transport job exist, with at most one of each kind open at a time:

| Job type | Created when | Moves |
|---|---|---|
| `raw` | A-in holds 4 castings or fewer and the raw stands hold at least 6 | 6 castings from the raw stands to A-in |
| `wip` | A-out holds at least 4 discs and B-in holds 8 or fewer | 4 discs from A-out to B-in |
| `fg` | the pallet holds 8 discs and a finished-goods stand is free | the pallet to a finished-goods stand |

Jobs are created only while the line mode is `running`. Each job goes to the idle AGV with the shortest forward distance to the pick-up point. Loading and unloading take 8 s each.

Other AGV rules:

- AGVs keep a 3.2 m gap. An AGV that catches up with an idle one pushes it forward along the loop.
- The battery drains 0.08 % per metre travelled and charges at 0.12 % per second while the AGV stands idle. An AGV that finishes a job below 20 % takes no new job until it has charged above 50 % (`lowBattery` is true in that period).
- An AGV on a `raw` job waits at the pick-up if the stands hold fewer than 6 castings. An AGV on an `fg` job waits at the drop-off if both finished-goods stands are occupied.

AGV states are `idle`, `toPick`, `loading`, `toDrop` and `unloading`.

### Faults and the technician

A fault is either random (see MTBF above) or injected with the `fault` command. An injected fault works in any state except when the station is already down.

When a station faults:

1. It goes `DOWN`, its stop counter increases and an `alarm` event is logged with a reason. Random faults pick a reason from a list per station type (for example "drill breakage" or "spray nozzle blocked"); injected faults have the reason "fault triggered manually".
2. The call joins the technician's queue. There is one technician, so simultaneous faults are handled first come, first served.
3. The technician walks from the workshop (or from the previous job) to the station at 1.45 m/s.
4. The repair time counts down only while the technician is on site. When it reaches zero the station recovers and an `info` event "repaired after m:ss" is logged with the total downtime.

A part that was in the station when it failed stays there and the cycle continues after the repair. Repairs continue while the line is stopped.

### Quality and scrap

- A defect is created when M1, M2 or M5 starts a part, with the station's defect rate. A part has at most one defect and remembers which station caused it.
- **M3 (balancer)** tests each defective part once and scraps it with a probability of 55 %. Defects from M1 and M2 can be caught here.
- **M6 (inspection)** scraps every defective part that reaches it, including all coating defects from M5.
- No defective disc reaches the pallet.

Each scrap logs a `quality` event naming the disc, the station that scrapped it and the station that caused the defect. The scrap counter of the **causing** station is increased, not that of the detecting station.

Per-part measurement tags reflect defects in two cases: the M6 measurements (`runout`, `thicknessVar`) of any defective disc, and the M5 `coatThickness` of a disc that M5 itself made defective, are shifted upward by 3.4 standard deviations. The M3 `imbalance` reading is not affected by defects.

### Process tags

Each station has process tags of three kinds:

- **Continuous** signals move towards a target value for the current state with a first-order lag (time constants from 0.8 s for vacuum to 900 s for the cure zone temperature). There is one target for `RUN`, one for `IDLE` and `BLOCKED`, one for `OFF`, and `DOWN` uses the midpoint of the idle and off values. Measurement noise is added each time a value is read, so two reads at the same instant differ slightly.
- **Per-part** measurements are taken once at the end of each cycle and hold their value until the next part.
- **Wear** counters (tool life on M1 and M2) start between 55 and 95 %, drop a little with every part, and jump back to 100 % when they reach 3 %, with an `info` event "tool changed automatically". A tool change costs no time.

The full list is in [Data model](#/data-model/process-tags).

### Energy model

Station load depends on state:

| State | Load |
|---|---|
| `RUN` | running power x (0.72 + 0.4 x sin(pi x cycle progress)), so it swings between 72 % and 112 % of the running power within each cycle |
| `IDLE`, `BLOCKED` | idle power |
| `DOWN` | 60 % of idle power |
| `OFF` | 25 % of idle power |

Added to the seven stations:

| Consumer | Load |
|---|---|
| Lighting and compressed air (`AUX`) | 14 kW, or 5 kW while the line is stopped |
| AGV charging (`AGV`) | 0.9 kW for each AGV that is idle, stationary and below 100 % |
| Warehouse (`WH`) | 3.5 kW, plus 1.2 kW while the forklift is idle (on its charger) |

Energy is the integral of load over simulated time. Compressed-air header pressure settles at 6.4 bar while the line is live and 6.9 bar when it is stopped, with a 30 s time constant.

## The warehouse

### Racks, stands and pallets

- The **rack** has 36 slots: two zones of 6 bays by 3 levels. Raw slots are `R-01-1` to `R-06-3`, finished-goods slots `F-01-1` to `F-06-3` (`zone-bay-level`).
- Two **raw stands** hold pallets of castings for the AGVs to pick from. Two **finished-goods stands** receive pallets from the AGVs.
- A raw pallet holds 12 castings (`RP-0001`...), a finished pallet 8 discs (`FP-0016`...). Pallet numbers come from one shared counter.
- Initial stock: 9 raw pallets in the rack, 2 raw pallets on the stands, 4 finished pallets in the rack.

AGVs take castings from the stands 6 at a time, emptying one pallet before the next. Castings become individual parts with an id at that moment.

### Forklift task priorities

When the forklift is free it picks the first task that applies:

1. **Replenish** a raw stand, when a stand is empty and the stands together hold 6 castings or fewer. The source is the oldest raw pallet in the rack or, if the rack has none, a docked inbound truck.
2. **Clear a finished-goods stand.** If an outbound truck is docked and not yet full the pallet goes straight onto the truck (`load`); otherwise it is put away in the lowest free finished-goods slot (`putaway`).
3. **Unload** the docked inbound truck into the lowest free raw slot.
4. **Load** the docked outbound truck with the oldest finished pallet from the rack.

With nothing to do it drives back to its parking position. It drives at 2.2 m/s, turns on the spot at 2.6 rad/s, and each pick or drop takes 10 s plus the time to raise or lower the forks.

Forklift states are `idle`, `toPick`, `picking`, `toDrop`, `dropping` and `toHome`. Task kinds are `replenish`, `putaway`, `unload` and `load`.

### Reorder point and trucks

| Truck | Ordered automatically when | Arrives after | Carries |
|---|---|---|---|
| Inbound | raw pallets in rack and on stands are 7 or fewer | 420 to 780 s | 8 pallets, 96 castings |
| Outbound | finished pallets in the rack are 8 or more | 300 to 600 s | collects 8 pallets |

A truck can also be called with the `truck` command, in which case it arrives after 20 s. Only one truck per direction exists at a time; a call is rejected while one is due, on its way, docked or leaving.

Truck states:

| State | Meaning |
|---|---|
| `none` | No truck scheduled. |
| `due` | Ordered, `etaS` counts down. |
| `arriving` | Driving up to the dock, 30 s. |
| `docked` | At the dock. The inbound truck leaves when it is empty; the outbound truck leaves when 8 pallets are loaded. |
| `departing` | Driving away, 30 s. |

The outbound truck is booked at 8 pallets but waits for 10. If the rack runs out before that, it stays docked and takes pallets directly from the finished-goods stands as the line produces them.

Receipt and shipment statistics are updated when the truck leaves the dock.

The warehouse, the forklift and the trucks keep working when the line is stopped. Only a pause freezes them.

## Line modes and pause

Two independent things control whether anything happens.

**Line mode** belongs to the simulation:

| Mode | Behaviour |
|---|---|
| `running` | Normal production. |
| `stopping` | Entered by the `stop` command. Stations finish the part they hold but take no new one, the operator loads nothing new, and no new AGV jobs are created. Conveyors still move. |
| `stopped` | Reached automatically when every station is empty, finished or down, every AGV is idle (or waiting at a stand) and the operator is not walking. Stations report `OFF` and draw standby power, conveyors stand still. The simulated clock keeps running. |

`start` returns the line to `running` from either of the other modes.

**Pause** belongs to the server: while paused the simulation is not advanced at all. The clock stops, nothing moves, and the time-based MQTT publications stop. `pause` sets it, `resume` clears it. `start` and `stop` also clear it.

The `mode` field in the status combines both: it is `paused` whenever the pause flag is set, otherwise the line mode. `lineMode` and `paused` give the two separately.

`reset` replaces the simulation with a fresh one: clock back to 06:00, counters and event log cleared, initial stock restored, speed unchanged. The new simulation starts in mode `stopped`, so send `start` afterwards.

| Command | Effect on line mode | Effect on pause |
|---|---|---|
| `start` | to `running` | cleared |
| `stop` | `running` to `stopping`, then `stopped` | cleared |
| `pause` | none | set |
| `resume` | none | cleared |
| `reset` | new simulation in `stopped` | cleared |

## Speed multiplier and simulated time

The speed multiplier is the number of simulated seconds per real second, from 0.1 to 120. The default is 10: one simulated hour takes six minutes.

Everything in the data is in simulated time:

- `simTime.seconds` counts simulated seconds since the start of the shift. `simTime.clock` is the shift clock starting at `06:00:00`. `simTime.iso` is a full timestamp: 06:00 local time on the day the server was started, plus the simulated seconds, written in UTC.
- Timestamps in MQTT payloads (`ts`), events, history samples and the OPC UA `SimTime` variable are simulated time. At speed 10 they advance ten times faster than a wall clock and will run ahead of the real date. The real time is available as `wallTime` in the status.
- Durations and counters ending in `S` are simulated seconds. Rates per hour are per simulated hour.
- MQTT publish periods and the history sample intervals are defined in simulated seconds. Raising the speed therefore raises the real-time message rate, up to a real-time floor per topic. See [MQTT cadence](#/mqtt/publish-cadence).

Three things are in real time: `wallTime` and `uptimeS` in the status, the 1 s period of the SSE stream, and the 30 Hz / 0.5 s periods of the WebSocket viewer stream.

Changing the speed does not change the behaviour of the plant, only how quickly it plays out.
