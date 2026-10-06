# Introduction

Kestrel digital twin is a Node.js server that simulates one machining line and its warehouse, and publishes the simulated plant data over the protocols an integration engineer normally meets on a shop floor: REST, Server-Sent Events, WebSocket, MQTT and OPC UA.

The plant is fictional. It is "Line 2" of Kestrel Brake Works, which machines, coats and palletises a 300 mm vented brake disc. Nothing is connected to real equipment; every value is produced by the simulation in `shared/engine.js`.

Use it to develop and test dashboards, historians, MES connectors, alarm handling or analytics against data that behaves like a production line: stations start and stop, buffers fill and starve, faults occur and get repaired, pallets move through a warehouse.

## What is simulated

**The production line**

- Seven stations, M1 to M7: CNC lathe, drilling centre, balancer, washer, coating oven, inspection cell and palletising robot. Each has a cycle time, a power draw, a random failure rate, a repair time and a set of process tags (spindle speed, temperatures, pressures, per-part measurements, tool wear).
- Seven accumulating conveyors, three buffer tables and the pallet at the end of the line.
- Two AGVs on a one-way 100 m loop that carry raw castings, work in progress and finished pallets.
- An operator who hand-loads the lathe, and a maintenance technician who walks to a station when it faults and repairs it.
- Quality: defects are created at M1, M2 and M5 and detected at the balancer (M3) or the inspection cell (M6).
- Energy: per-station electrical load, auxiliary load, AGV charging and compressed-air pressure.

**The warehouse**

- A pallet rack with 36 slots in two zones (raw castings, finished goods).
- Two raw-casting stands and two finished-goods stands where material is handed over between the forklift and the AGVs.
- One forklift with a prioritised task list.
- Inbound trucks that deliver raw castings when stock falls to the reorder point, and outbound trucks that collect finished pallets.

See [Simulation model](#/simulation-model) for the rules and numbers, and [KPIs and formulas](#/kpis) for how OEE and the other indicators are calculated.

## Architecture

One process owns one simulation instance. Every protocol reads the same in-memory state and every command, whatever protocol it arrives on, goes through the same function.

```text
                      +---------------------------------------------+
                      |  Node.js process (server/index.js)          |
                      |                                             |
                      |   Simulation engine (shared/engine.js)      |
                      |   stepped 30 times a second, simulated      |
                      |   time = real time x speed multiplier       |
                      |                     |                       |
                      |      one data model (pub* functions)        |
                      |      one command entry point                |
                      +-----+----------+-----------+-----------+----+
                            |          |           |           |
                    HTTP :8080     WebSocket    MQTT :1883   OPC UA :4840
                            |       :8080/ws    and WebSocket     |
                            |          |        :8080/mqtt        |
          +-----------------+--+   +---+-----+   +-----+------+  ++-------------+
          | REST  /api/v1      |   | 3D      |   | MQTT       |  | OPC UA       |
          | SSE   /api/v1/     |   | viewer  |   | clients,   |  | clients,     |
          |       stream       |   | at /    |   | Node-RED,  |  | SCADA,       |
          | Docs  /docs/       |   |         |   | brokers    |  | UaExpert     |
          +--------------------+   +---------+   +------------+  +--------------+
```

- **REST** returns snapshots of the full data model and accepts commands. See [REST API](#/rest-api).
- **Server-Sent Events** push line status and KPIs once a second. See [Streaming](#/streaming).
- **WebSocket** `/ws` carries the compact frames the 3D viewer renders from. It is not intended as an integration contract.
- **MQTT**: the server embeds a broker and publishes telemetry, state changes, KPIs and events into it. Commands are accepted on `cmd/` topics. See [MQTT](#/mqtt).
- **OPC UA**: a browsable address space with live variables and methods. See [OPC UA](#/opc-ua).

The same numbers appear on every interface, because they all come from the functions described in [Data model](#/data-model).

## Default ports

| Service | Default address | Change with |
|---|---|---|
| 3D viewer | `http://127.0.0.1:8080/` | `HTTP_PORT`, `HOST` |
| Documentation | `http://127.0.0.1:8080/docs/` | `HTTP_PORT`, `HOST` |
| REST API and SSE | `http://127.0.0.1:8080/api/v1` | `HTTP_PORT`, `HOST` |
| WebSocket (viewer stream) | `ws://127.0.0.1:8080/ws` | `HTTP_PORT`, `HOST` |
| MQTT over TCP | `mqtt://127.0.0.1:1883` | `MQTT_PORT`, `HOST` |
| MQTT over WebSocket | `ws://127.0.0.1:8080/mqtt` | `HTTP_PORT`, `HOST` |
| OPC UA | `opc.tcp://127.0.0.1:4840/UA/Kestrel` | `OPCUA_PORT` |

All settings are listed in [Configuration](#/configuration).

> **Warning**
> None of the interfaces has authentication, and all of them accept control commands (stop, reset, speed, fault injection). The server binds HTTP and MQTT to `127.0.0.1` by default for that reason. Read [Configuration](#/configuration/network-exposure) before exposing it to a network.

## Conventions used in these pages

- Durations and periods are in **simulated seconds** unless a field or text says "real time".
- Lengths and coordinates are in metres. The plant floor is the X/Z plane.
- Percentages are numbers from 0 to 100, not fractions.
- Station ids are `M1` to `M7`, AGV ids are `AGV-1` and `AGV-2`.
- Examples assume the default host, ports and MQTT base topic.
