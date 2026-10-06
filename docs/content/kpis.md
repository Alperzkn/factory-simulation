# KPIs and formulas

These are the formulas implemented in `machKpi`, `lineKpi`, `rateNow` and the `pub*` functions of `shared/engine.js`. They are simple on purpose and differ from textbook OEE in a few places; the caveats are listed with each formula.

All KPIs are cumulative since the start of the shift (the last start-up or `reset`), except throughput, which uses a rolling window. All times are simulated seconds.

## Station OEE

Each station accumulates the time it spends in each state: `RUN`, `IDLE`, `BLOCKED`, `DOWN` and `OFF` (reported as `timeS`).

```text
planned       = RUN + IDLE + BLOCKED + DOWN          (everything except OFF)
up            = RUN + IDLE + BLOCKED                 (planned minus DOWN)

availability  = up / planned                         1 when planned is 0
performance   = min(1, idealCycle x parts / up)      0 when up is 0
quality       = (parts - scrap) / parts              1 when parts is 0
OEE           = availability x performance x quality
```

`parts` and `scrap` are the station's `counters.parts` and `counters.scrap`; `idealCycle` is `cycle.idealS`. Results are reported as percentages with two decimals.

Caveats:

- **Waiting and blocked time count against performance.** `up` includes `IDLE` and `BLOCKED`, so a station that is starved or blocked by its neighbours shows a low performance although it runs at full speed when it has work. Downstream stations with short cycles (M6, M7) have low performance and OEE for this reason. It is normal to see M7 around 25 %.
- **Performance cannot reach 100 % under load.** Actual cycles are 0 to 12 % longer than ideal, so a station that never waits averages about 94 %.
- **Scrap is charged to the station that caused the defect**, when the disc is scrapped at M3 or M6. M3, M4, M6 and M7 create no defects, so their quality is always 100 %. A scrap can be booked on M1 several minutes after M1 processed the part.
- **`parts` counts every completed cycle**, including the cycle on M3 or M6 that ends with the part being scrapped.
- Time while the line is stopped is `OFF` and is excluded. Time in `DOWN` continues to accumulate while the line is stopped if a repair is still open.

## Line OEE

```text
availability  = mean of the seven station availabilities
quality       = good / (good + scrap)                           1 when both are 0
raw           = good x 46 / plannedProductionTime
performance   = min(1, raw / (availability x quality))          0 when availability x quality is 0
OEE           = availability x performance x quality
```

- `good` is the number of discs M7 has placed on a pallet.
- `scrap` is the number of discs scrapped at M3 and M6.
- `46` is the ideal cycle time of the constraint station M1, in seconds.
- `plannedProductionTime` (`plannedProductionTimeS`) accumulates while the line mode is `running` or `stopping`, not while it is `stopped`.

Caveats:

- **Line availability is the unweighted mean of the station availabilities**, not the availability of the constraint and not the share of time the whole line was able to produce. A stop on M7 moves it as much as a stop on M1, and seven healthy-but-starved stations still count as available.
- **Performance is measured against the 46 s constraint cycle and is a balancing figure.** Substituting the formulas gives `OEE = min(availability x quality, good x 46 / plannedProductionTime)`. In other words, line OEE is good output divided by what the lathe could ideally have produced in the planned time, capped at availability x quality. Performance is whatever makes the three factors multiply to that.
- **Early in a shift the figures are optimistic.** The shift starts with work in progress on the line, so the first good discs arrive without the lathe having made them. Throughput can exceed the 78 per hour that the constraint allows, and plan attainment can exceed 100 %.
- The line quality figure is also reported as `firstPassYield`; there is no rework in the model, so the two are the same number.

## Throughput

```text
throughputPerHour = (good discs palletised in the last 300 s) x 12
```

A five-minute rolling window in simulated time. The value moves in steps of 12 discs per hour, and it is 0 for the first seconds of a shift and after a long stop.

## Plan attainment

```text
planned         = 66 x plannedProductionTime / 3600
planAttainment  = good / planned x 100
```

- `66` is the planned rate in discs per hour (`targetPerHour`).
- `production.planned` is this value rounded to a whole disc; `planAttainment` is calculated from the unrounded value and reported with one decimal.
- `planAttainment` is `null` until the plan amounts to more than half a disc, which is the first 27 s or so of a shift. Over OPC UA, where a number is required, it reads 0 in that period.

## Energy

```text
energyKwh        = integral of total load over the shift
kwhPerGoodPart   = energyKwh / good                 null when good is 0
kwhPerPart       = station energyKwh / station parts    null when parts is 0
peakKw           = highest total load seen in any simulation step
```

- **`kwhPerGoodPart` uses the total energy**: the seven stations plus lighting and compressed air, AGV charging and the warehouse. It also includes energy spent while the line was stopped.
- The station figure `kwhPerPart` divides by all parts the station processed, good or not.
- `powerKw` values are instantaneous. The `powerKw` in history samples is the mean load over the 20 s sample interval.

How load is derived from station state is described in [Energy model](#/simulation-model/energy-model).

## MTBF and MTTR

Per station, observed during the shift:

```text
mtbfS = RUN time / stops
mttrS = DOWN time / stops
```

Both are `null` until the station has had its first stop.

- `mttrS` is the mean time the station was down, including the wait for the technician and the walk, not just the hands-on repair. It will normally be higher than the configured repair time in the [stations table](#/simulation-model/stations). It includes the current stop while it is still open.
- `stops` includes faults injected by command.
- With zero or one stop these are poor estimates of the configured values; the configured MTBF values are 3000 to 9000 s of running time.

## Warehouse KPIs

| Field | Formula | Notes |
|---|---|---|
| `rawCoverHours` | raw castings in stock / current throughput | Stock is rack plus stands; castings on a truck or already at the line are not included. Throughput is `throughputPerHour`; when that is 0 the planned rate of 66 per hour is used instead. Because the throughput moves in steps of 12, cover hours jump accordingly. |
| `rackOccupancy` | occupied rack slots / 36 x 100 | Pallets on the stands do not count. |
| `dockToStockAvgS` | mean of (time put in a rack slot - time the truck docked) | Over pallets unloaded from an inbound truck into the rack. Pallets taken from the truck straight to a raw stand are not included. `null` until the first pallet. |
| `stockoutS` | time during which the line was `running`, A-in held 4 castings or fewer, the raw stands held fewer than 6 and no raw transport was under way | Time in which the line could not be resupplied because the warehouse had no castings ready. |
| forklift `utilisation` | time on a task / simulated time x 100 | Driving back to the parking position does not count as busy. |

The receipt and shipment counters (`receivedPallets`, `shippedDiscs`, `trucksIn` and so on) increase when the truck leaves the dock, not while it is being handled.

## Utilisation of AGVs and the technician

```text
AGV utilisation         = time not idle / simulated time x 100
technician utilisation  = time away from the workshop / simulated time x 100
```

The denominator is the simulated time since the start of the shift, including time in which the line was stopped. Technician time includes walking to the station and back.

## History samples

`GET /api/v1/history` returns the line KPIs sampled every 20 simulated seconds, and `GET /api/v1/machines/{id}/history` returns station state, load and tags every 10 simulated seconds. Both keep the most recent 360 samples: two hours for the line, one hour per station. The KPI values in a line sample are the cumulative values at that moment, not values for the interval.
