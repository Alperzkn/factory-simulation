# Using the 3D viewer

The viewer at `http://localhost:8080/` is a full-screen 3D model of the plant. It is a client of the twin like any other: it receives frames over the WebSocket stream and sends commands the same way an integration would. Nothing is simulated in the browser, so several people can open the viewer at once and they all see, and control, the same plant.

## Screen layout

| Area | What it holds |
| --- | --- |
| Top bar | Line state, shift clock, line controls and the speed multiplier |
| Left rail | One button per dashboard, plus links to connectivity details and this documentation |
| Bottom strip | Eight key figures that are always visible. Each one opens the dashboard it belongs to |
| Bottom left | Camera presets and the label switch |
| Top right | One card per open fault. Click a card to open the station |

The page never scrolls. Dashboards and details open in dialogs over the 3D view and the plant keeps running behind them. Close a dialog with the cross, the Escape key, or a click outside it.

## Moving around the plant

| Action | Mouse or keyboard |
| --- | --- |
| Rotate | Drag |
| Pan | Right-drag, or Shift and drag |
| Zoom | Scroll |
| Jump to a preset | **Plant**, **Line** or **Warehouse** in the bottom-left panel |
| Hide or show the floating labels | **Labels** |
| Pause or resume | Space |
| Close a dialog | Escape |

The building is drawn as a cutaway: only the back wall and the dock wall are standing, and truck trailers have no roof, so nothing hides the floor.

## Controlling the line

| Button | Effect |
| --- | --- |
| **Start** | Starts production. After a pause it resumes instead |
| **Pause** | Freezes the simulation clock. Machines, AGVs, people and the warehouse all hold their position, and no data is generated |
| **Stop** | Controlled stop. Each station finishes the part it is working on, AGVs finish their current job, then the line goes to standby. The clock keeps running and the warehouse keeps working |
| **Reset** | Clears all counters and history and returns to the start of the shift with the line stopped. Press **Start** to begin again |

> **Note** Pause and Stop are different things. Pause stops time. Stop is an operating decision made inside the simulation, so standby power is still consumed and a truck that is already at the dock is still unloaded.

## Simulation speed

The speed multiplier runs from 0.1× to 120×. Drag the slider, type an exact value, or use a preset. At 60× one simulated hour passes every real minute.

Speed changes the rate at which data is produced, not the data itself. Sample intervals, telemetry periods and timestamps are all expressed in simulated time, so a faster simulation publishes more messages per real second. See [Simulation model](#/simulation-model) for the details and [Configuration](#/configuration) for the limits that protect subscribers from very high rates.

## Dashboards

| Dashboard | Use it to answer |
| --- | --- |
| Overview | How is the plant doing right now? OEE with its three factors, key figures, station states and the latest events |
| Production | Are we on plan? Throughput, good discs against plan, parts per station and where the work in progress is sitting |
| Quality | What are we scrapping and why? Yield, scrap by originating station, and trends of the in-process measurements |
| Energy | What are we drawing? Load, consumption, energy per disc and the split by consumer |
| Maintenance | What is broken and how reliable is each station? Open faults, downtime, time between failures, time to repair and the technician's workload |
| Stations | A table of every station with a 30 minute state timeline |
| Logistics | AGV jobs and battery levels, buffer and conveyor fill levels, and what each person is doing |
| Warehouse | Stock, rack maps, docks and the forklift |
| Events | The event log, filtered by kind |
| Connectivity | The address and status of every interface, with copy buttons |

Charts show the last simulated hour. Move the pointer over a chart to read a value.

## Clicking things in the plant

Anything you can point at opens a dialog with its live data. Moving the pointer over an object outlines it and names it.

| Object | Dialog shows |
| --- | --- |
| Station (M1 to M7) | State and reason, OEE, counters, a state timeline, electrical load and a trend for every process tag. **Trigger a fault** forces an unplanned stop so you can watch the response |
| Conveyor, buffer table, palletiser pallet | Fill level and the individual parts that are there |
| AGV | Job, pick-up and drop-off, battery, distance and utilisation |
| Operator, inspector, technician | Role and current activity |
| Rack | A slot-by-slot map and the pallets in stock, oldest first |
| Handover stands | The pallets waiting between the warehouse and the line |
| Forklift | Current job, load and utilisation |
| Truck or dock | Truck state and load. You can order raw castings or book a collection without waiting for the automatic trigger |
| Andon board, supervisor office | Opens the overview |
| Utilities | Opens the energy dashboard |
| Maintenance workshop | Opens the maintenance dashboard |
| Scrap bins | Opens the quality dashboard |

## Reading the plant at a glance

Each station has a signal tower. Green means running. Steady amber means waiting for parts, flashing amber means blocked by a full outfeed, and flashing red means down. All lamps off means the line is stopped.

The floating labels use the same states: a coloured dot next to the station code, with a red outline when the station is down. AGV labels show the battery level.

The AGV light strip is green when idle and charging, blue when driving, amber when loading or unloading, and red when the battery is low.

The andon board on the back wall shows the same figures an operator would see on the shop floor: good discs, plan, scrap and OEE.
