# OPC UA

The server runs an OPC UA server (node-opcua) that exposes the twin as a browsable address space with live variables and control methods.

## Endpoint

| | |
|---|---|
| Endpoint URL | `opc.tcp://127.0.0.1:4840/UA/Kestrel` |
| Transport | OPC UA binary over TCP |
| Port | 4840, set with `OPCUA_PORT` |
| Application name | Kestrel Digital Twin |
| Application URI | `urn:kestrel:digital-twin` |
| Namespace URI | `urn:kestrel:digital-twin` |
| Namespace index | 1 |

The host part of the advertised endpoint URL is the value of `HOST` (default `127.0.0.1`), or the machine's host name when `HOST=0.0.0.0`. The listening socket itself is opened with node-opcua's defaults and accepts connections on all network interfaces whatever `HOST` is. See [Network exposure](#/configuration/network-exposure).

`GET /api/v1/connectivity` reports the endpoint URL, the namespace URI and index, and the number of open sessions.

## Security

The server is created with `allowAnonymous: true` and no user database. Connect with:

- **Security mode None, security policy None**
- **Anonymous** user identity

That is the intended way to use the twin, and what the examples below do.

node-opcua additionally advertises its default secured endpoints. A discovery request to a running server returns seven endpoints on the same URL:

| Security mode | Security policy |
|---|---|
| None | None |
| Sign | Basic256Sha256 |
| Sign | Aes128_Sha256_RsaOaep |
| Sign | Aes256_Sha256_RsaPss |
| SignAndEncrypt | Basic256Sha256 |
| SignAndEncrypt | Aes128_Sha256_RsaOaep |
| SignAndEncrypt | Aes256_Sha256_RsaPss |

Each endpoint lists anonymous, user name and X.509 certificate identity tokens, but no users are configured, so use anonymous. The server generates a self-signed application certificate the first time it starts and stores it in node-opcua's default certificate folder in the user's configuration directory (on macOS `~/Library/Preferences/node-opcua-default-nodejs/PKI`). Using a secured endpoint requires the usual certificate exchange between client and server and has not been tested for this documentation.

> **Warning**
> Anonymous clients can call every method and write `Speed`. There is no read-only mode.

## Address space

All nodes of the twin are in namespace 1 and have string node ids that mirror the browse path:

```text
Objects
└─ KestrelBrakeWorks                 ns=1;s=Kestrel
   └─ Line2                          ns=1;s=Line2
      ├─ Mode, Paused, Speed, SimTime, SimSeconds
      ├─ Start(), Pause(), Resume(), Stop(), Reset(), SetSpeed()
      ├─ KPI                         ns=1;s=Line2.KPI
      ├─ Energy                      ns=1;s=Line2.Energy
      ├─ Machines                    ns=1;s=Line2.Machines
      │  ├─ M1                       ns=1;s=Line2.Machines.M1
      │  │  ├─ Name, State, StateCode, ...
      │  │  ├─ Tags                  ns=1;s=Line2.Machines.M1.Tags
      │  │  └─ TriggerFault()
      │  └─ M2 ... M7
      ├─ AGVs                        ns=1;s=Line2.AGVs
      │  ├─ AGV1                     ns=1;s=Line2.AGVs.AGV1
      │  └─ AGV2                     ns=1;s=Line2.AGVs.AGV2
      └─ Warehouse                   ns=1;s=Line2.Warehouse
```

Rules that hold for every node:

- **Node id** = `ns=1;s=` followed by the browse names from `Line2` downwards joined with dots. The only exception is the top folder, whose browse name is `KestrelBrakeWorks` and whose node id is `ns=1;s=Kestrel`.
- **Browse path** from the Objects folder: `/1:KestrelBrakeWorks/1:Line2/...`, every browse name in namespace 1.
- All variables are **read-only except `Line2.Speed`**.
- Variable values are taken from one snapshot of the [full state](#/data-model/full-state) that is refreshed at most every 200 ms. The minimum sampling interval of every variable is 250 ms; a monitored item that asks for a faster rate is revised to 250 ms.
- Values that are `null` in the JSON data model read as `0` (numbers) or an empty string.
- The AGV folders are called `AGV1` and `AGV2`, without the hyphen used in the REST and MQTT ids.

The server also contains the standard OPC UA nodes in namespace 0 (Server object, types). Historical access, alarms and events are not implemented; plant events are available over [MQTT](#/mqtt/events) and [REST](#/rest-api/get-events).

## Node reference

In the tables below the node id is `ns=1;s=` plus the value in the first column, and the browse path is the same names separated by `/`.

### Line

| Node id (`ns=1;s=...`) | Data type | Access | Description |
|---|---|---|---|
| `Line2.Mode` | String | read | `running`, `paused`, `stopping` or `stopped` |
| `Line2.Paused` | Boolean | read | True while the simulation clock is frozen |
| `Line2.Speed` | Double | read, write | Speed multiplier, 0.1 to 120 |
| `Line2.SimTime` | DateTime | read | Simulated date and time |
| `Line2.SimSeconds` | Double | read | Simulated seconds since the start of the shift |

### KPI

| Node id (`ns=1;s=...`) | Data type | Access | Description |
|---|---|---|---|
| `Line2.KPI.OEE` | Double | read | Line OEE, % |
| `Line2.KPI.Availability` | Double | read | % |
| `Line2.KPI.Performance` | Double | read | % |
| `Line2.KPI.Quality` | Double | read | % |
| `Line2.KPI.GoodCount` | UInt32 | read | Good discs palletised this shift |
| `Line2.KPI.ScrapCount` | UInt32 | read | Discs scrapped this shift |
| `Line2.KPI.ThroughputPerHour` | Double | read | Good discs per hour, 5 minute rolling window |
| `Line2.KPI.PlanAttainment` | Double | read | Good discs against plan, %; 0 in the first seconds of a shift |
| `Line2.KPI.WIP` | UInt32 | read | Discs in process on the line |

### Energy

| Node id (`ns=1;s=...`) | Data type | Access | Description |
|---|---|---|---|
| `Line2.Energy.PowerKw` | Double | read | Total electrical load, kW |
| `Line2.Energy.EnergyKwh` | Double | read | Energy consumed this shift, kWh |
| `Line2.Energy.PeakKw` | Double | read | Peak load this shift, kW |
| `Line2.Energy.KwhPerGoodPart` | Double | read | kWh per good disc; 0 while no disc has been completed |
| `Line2.Energy.CompressedAirBar` | Double | read | Compressed air header pressure, bar |

### Machines

The same set of nodes exists for each station. Replace `M1` with `M2` to `M7`.

| Node id (`ns=1;s=...`) | Data type | Access | Description |
|---|---|---|---|
| `Line2.Machines.M1.Name` | String | read | Station name, for example `CNC lathe` |
| `Line2.Machines.M1.State` | String | read | `RUN`, `IDLE`, `BLOCKED`, `DOWN` or `OFF` |
| `Line2.Machines.M1.StateCode` | Int32 | read | 0 off, 1 idle, 2 run, 3 blocked, 4 down |
| `Line2.Machines.M1.FaultReason` | String | read | Fault text; empty when the station is healthy |
| `Line2.Machines.M1.CycleProgress` | Double | read | Progress of the current cycle, % |
| `Line2.Machines.M1.LastCycleTime` | Double | read | Last cycle time, s |
| `Line2.Machines.M1.PartCount` | UInt32 | read | Parts processed this shift |
| `Line2.Machines.M1.ScrapCount` | UInt32 | read | Scrap attributed to this station |
| `Line2.Machines.M1.StopCount` | UInt32 | read | Unplanned stops this shift |
| `Line2.Machines.M1.OEE` | Double | read | Station OEE, % |
| `Line2.Machines.M1.Availability` | Double | read | % |
| `Line2.Machines.M1.Performance` | Double | read | % |
| `Line2.Machines.M1.Quality` | Double | read | % |
| `Line2.Machines.M1.PowerKw` | Double | read | Electrical load, kW |
| `Line2.Machines.M1.EnergyKwh` | Double | read | Energy consumed this shift, kWh |
| `Line2.Machines.M1.Tags.<Tag>` | Double | read | One variable per process tag, see below |

### Machine tags

Each process tag is a Double variable under the station's `Tags` folder. The variable name is the tag key with a capital first letter, and its description holds the tag name and unit.

| Station | Tag variables, node id `ns=1;s=Line2.Machines.<id>.Tags.<name>` |
|---|---|
| M1 | `SpindleSpeed`, `SpindleLoad`, `CoolantTemp`, `Vibration`, `ChuckPressure`, `ToolLife` |
| M2 | `SpindleSpeed`, `SpindleLoad`, `CoolantPressure`, `CoolantTemp`, `ToolLife` |
| M3 | `SpinSpeed`, `Vibration`, `Imbalance` |
| M4 | `BathTemp`, `SprayPressure`, `DryerTemp`, `Conductivity` |
| M5 | `Zone1Temp`, `Zone2Temp`, `ExhaustFlow`, `PaintPressure`, `CoatThickness` |
| M6 | `Runout`, `ThicknessVar`, `CameraConfidence` |
| M7 | `Vacuum`, `AxisTemp`, `TcpSpeed` |

For example the cure zone temperature of the oven is `ns=1;s=Line2.Machines.M5.Tags.Zone2Temp`. Units and typical values are listed in [Process tags](#/data-model/process-tags).

### AGVs

Replace `AGV1` with `AGV2` for the second vehicle.

| Node id (`ns=1;s=...`) | Data type | Access | Description |
|---|---|---|---|
| `Line2.AGVs.AGV1.State` | String | read | `idle`, `toPick`, `loading`, `toDrop` or `unloading` |
| `Line2.AGVs.AGV1.BatteryPct` | Double | read | Battery charge, % |
| `Line2.AGVs.AGV1.PositionX` | Double | read | Plant X coordinate, m |
| `Line2.AGVs.AGV1.PositionZ` | Double | read | Plant Z coordinate, m |
| `Line2.AGVs.AGV1.LoadQuantity` | UInt32 | read | Discs on board |
| `Line2.AGVs.AGV1.Trips` | UInt32 | read | Transport jobs completed |

### Warehouse

| Node id (`ns=1;s=...`) | Data type | Access | Description |
|---|---|---|---|
| `Line2.Warehouse.RawPallets` | UInt32 | read | Pallets of raw castings in stock |
| `Line2.Warehouse.RawDiscs` | UInt32 | read | Raw castings in stock |
| `Line2.Warehouse.RawCoverHours` | Double | read | Hours of production covered by raw stock |
| `Line2.Warehouse.FinishedPallets` | UInt32 | read | Pallets of finished discs in stock |
| `Line2.Warehouse.FinishedDiscs` | UInt32 | read | Finished discs in stock |
| `Line2.Warehouse.RackOccupancy` | Double | read | Occupied rack slots, % |
| `Line2.Warehouse.ShippedDiscs` | UInt32 | read | Discs shipped this shift |
| `Line2.Warehouse.ForkliftState` | String | read | `idle`, `toPick`, `picking`, `toDrop`, `dropping` or `toHome` |
| `Line2.Warehouse.ForkliftX` | Double | read | Plant X coordinate, m |
| `Line2.Warehouse.ForkliftZ` | Double | read | Plant Z coordinate, m |
| `Line2.Warehouse.InboundTruckState` | String | read | `none`, `due`, `arriving`, `docked` or `departing` |
| `Line2.Warehouse.OutboundTruckState` | String | read | `none`, `due`, `arriving`, `docked` or `departing` |

## Methods

| Method node id (`ns=1;s=...`) | Object node id | Input | Effect |
|---|---|---|---|
| `Line2.Start` | `Line2` | none | Set the line mode to `running`, clear a pause |
| `Line2.Stop` | `Line2` | none | Controlled stop |
| `Line2.Pause` | `Line2` | none | Freeze the simulation clock |
| `Line2.Resume` | `Line2` | none | Unfreeze the simulation clock |
| `Line2.Reset` | `Line2` | none | Replace the simulation with a fresh one, in mode `stopped` |
| `Line2.SetSpeed` | `Line2` | `Speed` (Double), 0.1 to 120 | Set the speed multiplier |
| `Line2.Machines.M1.TriggerFault` (also `M2` to `M7`) | `Line2.Machines.M1` | none | Inject a fault into the station |
| `Line2.Warehouse.CallInboundTruck` | `Line2.Warehouse` | none | Order a truck of raw castings |
| `Line2.Warehouse.CallOutboundTruck` | `Line2.Warehouse` | none | Book a collection of finished pallets |

The effects are the same as the REST commands; see [Commands](#/rest-api/commands) and [Line modes and pause](#/simulation-model/line-modes-and-pause).

Every method returns the same two output arguments:

| Output | Data type | Description |
|---|---|---|
| `Accepted` | Boolean | True when the command was accepted |
| `Message` | String | Reason when the command was rejected, otherwise empty |

> **Note**
> The method call status code is `Good` even when the command is rejected. Check `Accepted`. For example `SetSpeed(500)` returns `Good` with `Accepted = false` and `Message = "speed must be a number between 0.1 and 120"`.

### Writing Speed

`Line2.Speed` can be written instead of calling `SetSpeed`. The value must be a Double.

| Write | Status code |
|---|---|
| Double between 0.1 and 120 | `Good` |
| Double outside that range | `BadOutOfRange` |
| Another data type, for example Int32 | `BadTypeMismatch` |
| Any other variable | `BadNotWritable` |

## Examples

### Node.js

`node-opcua` is a dependency of the server, so this runs from the project folder as it is. Save as `client.mjs` and run `node client.mjs`. In a project of your own, `npm install node-opcua`.

```js
import { OPCUAClient, AttributeIds, DataType, TimestampsToReturn } from 'node-opcua';

const client = OPCUAClient.create({ endpointMustExist: false });
await client.connect('opc.tcp://127.0.0.1:4840/UA/Kestrel');
const session = await client.createSession();        // anonymous

// 1. read
const oee = await session.read({ nodeId: 'ns=1;s=Line2.KPI.OEE', attributeId: AttributeIds.Value });
const state = await session.read({ nodeId: 'ns=1;s=Line2.Machines.M1.State', attributeId: AttributeIds.Value });
console.log('line OEE', oee.value.value, '%, M1 is', state.value.value);

// 2. subscribe to a process tag
const subscription = await session.createSubscription2({
  requestedPublishingInterval: 500, requestedLifetimeCount: 60, requestedMaxKeepAliveCount: 20, publishingEnabled: true,
});
const item = await subscription.monitor(
  { nodeId: 'ns=1;s=Line2.Machines.M1.Tags.SpindleLoad', attributeId: AttributeIds.Value },
  { samplingInterval: 250, queueSize: 10, discardOldest: true },
  TimestampsToReturn.Both,
);
item.on('changed', dv => console.log('spindle load', dv.value.value, '%'));

// 3. call a method: the result is in the output arguments, the status code is always Good
const call = await session.call({
  objectId: 'ns=1;s=Line2',
  methodId: 'ns=1;s=Line2.SetSpeed',
  inputArguments: [{ dataType: DataType.Double, value: 20 }],
});
const [accepted, message] = call.outputArguments.map(a => a.value);
console.log('SetSpeed', call.statusCode.name, { accepted, message });

// 4. write the Speed variable (must be a Double)
const status = await session.write({
  nodeId: 'ns=1;s=Line2.Speed',
  attributeId: AttributeIds.Value,
  value: { value: { dataType: DataType.Double, value: 10 } },
});
console.log('write Speed', status.name);

await new Promise(resolve => setTimeout(resolve, 5000));
await subscription.terminate();
await session.close();
await client.disconnect();
```

```text
line OEE 86.68 %, M1 is RUN
SetSpeed Good { accepted: true, message: '' }
write Speed Good
spindle load 62.7 %
spindle load 60.3 %
spindle load 60.7 %
...
```

`endpointMustExist: false` lets the client connect when the host name in the URL you typed differs from the one the server advertises, for example when you connect by IP address to a server started with `HOST=0.0.0.0`.

To call a method without input arguments, pass an empty list:

```js
const result = await session.call({
  objectId: 'ns=1;s=Line2.Machines.M4',
  methodId: 'ns=1;s=Line2.Machines.M4.TriggerFault',
  inputArguments: [],
});
```

### Python

Uses `asyncua` (`pip install asyncua`).

```python
import asyncio
from asyncua import Client, ua

URL = "opc.tcp://127.0.0.1:4840/UA/Kestrel"


class Printer:
    def datachange_notification(self, node, val, data):
        print(node.nodeid.Identifier, "=", val)


async def main():
    async with Client(url=URL) as client:
        ns = await client.get_namespace_index("urn:kestrel:digital-twin")

        # read
        oee = await client.get_node(f"ns={ns};s=Line2.KPI.OEE").read_value()
        mode = await client.get_node(f"ns={ns};s=Line2.Mode").read_value()
        print("line OEE", oee, "% mode", mode)

        # subscribe
        sub = await client.create_subscription(500, Printer())
        await sub.subscribe_data_change([
            client.get_node(f"ns={ns};s=Line2.Machines.M1.State"),
            client.get_node(f"ns={ns};s=Line2.Machines.M1.Tags.SpindleLoad"),
        ])

        # call a method: returns [Accepted, Message]
        line = client.get_node(f"ns={ns};s=Line2")
        accepted, message = await line.call_method(f"{ns}:SetSpeed", ua.Variant(20.0, ua.VariantType.Double))
        print("SetSpeed", accepted, repr(message))

        # write the Speed variable (must be a Double)
        speed = client.get_node(f"ns={ns};s=Line2.Speed")
        await speed.write_value(ua.DataValue(ua.Variant(10.0, ua.VariantType.Double)))
        print("speed is now", await speed.read_value())

        await asyncio.sleep(5)
        await sub.delete()


asyncio.run(main())
```

```text
line OEE 87.8 % mode running
Line2.Machines.M1.State = RUN
Line2.Machines.M1.Tags.SpindleLoad = 62.5
SetSpeed True ''
speed is now 10.0
Line2.Machines.M1.Tags.SpindleLoad = 61.6
Line2.Machines.M1.Tags.SpindleLoad = 63.3
...
```

`asyncua` also logs two warnings about revised session timeout and subscription parameters; they are harmless.

### Browsing with UaExpert

1. Start the twin and UaExpert.
2. Choose **Server > Add**. Under **Custom Discovery**, double-click **Double click to Add Server** and enter `opc.tcp://127.0.0.1:4840/UA/Kestrel`.
3. Expand the new entry and select the endpoint **None - None**. Leave the authentication setting on **Anonymous** and confirm.
4. Choose **Server > Connect**. If UaExpert warns that the host name of the endpoint differs from the one you entered, accept the URL you entered.
5. In the **Address Space** pane, open **Root > Objects > KestrelBrakeWorks > Line2**.
6. Drag variables, for example **KPI > OEE** or **Machines > M1 > Tags**, into the **Data Access View** to watch them update. The node id column shows ids such as `NS1|String|Line2.KPI.OEE`.
7. To send a command, right-click a method such as **Line2 > SetSpeed** or **Machines > M4 > TriggerFault**, choose **Call**, enter the argument if there is one, and press **Call**. The dialog shows `Accepted` and `Message`.
8. To change the speed by writing, double-click the value of **Line2 > Speed** in the Data Access View and enter a number between 0.1 and 120.

If you select one of the Sign or SignAndEncrypt endpoints instead, UaExpert asks you to trust the server's self-signed certificate and the server must in turn accept UaExpert's certificate. The None endpoint avoids both steps.
