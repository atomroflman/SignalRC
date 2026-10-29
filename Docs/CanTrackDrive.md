# CAN Track Drive

Driver for a two-track vehicle whose drives are MKS XDrive Mini boards running
SimpleFOC firmware, talking to the Pi over CAN.

Status: **implemented, not verified on hardware.** Protocol encoding, decoding
and the tank mix are covered by a test harness; nothing has run against a real
bus or a real motor yet. See [Verification](#verification).

## What the vehicle looks like

Two hoverboard hub motors, each its own sprocket - no gearbox, no free shaft.
One MKS XDrive Mini per motor, because the board has a single motor output. A
Raspberry Pi is the master. The tracks have to run synchronously, so the drives
run closed-loop velocity control; torque or open loop is not an option.

Each board runs its own firmware build. The node id is baked in at build time
(`pio run -e left` / `-e right`) rather than read from a strap pin, because the
pins are unreachable once a board is mounted.

## Where it plugs in

Three extension points, all existing ones - nothing in the framework was
changed.

| Piece | Type | Configured as |
|---|---|---|
| Bus, command loop, mixing, telemetry collection | `CanTrackDriveManager : IModuleManager` | `pinManagers` entry, `"type": "CanTrackDriveManager"` |
| Control channels | `TrackDriveControlBase : ControlTypeBase` | `controlChannels`, `controlType` |
| Telemetry | `CanTrackDriveTelemetryReader : TelemetryReaderBase` | `telemetryChannels`, `telemetryType` |

Control types are found through their `[ControlType("...")]` attribute,
telemetry readers through `AddAllTransient(typeof(TelemetryReaderBase))` in
`Program.cs`. Both are picked up by `AvailableChannelTypesService`, so the
channel configuration UI offers them without any further registration.

## Two things that differ from a PWM manager

Both come from the protocol, not from preference.

**The command has to be periodic.** SignalR control is event driven -
`OnControlRecived` fires on change, one channel at a time. The drive command
must go out at 50 Hz because the nodes' failsafe timer hangs on it, and if it
stops for 150 ms the drives stop. So the manager runs its own send thread and
the control channels only deposit values into shared state.

**Both tracks travel in one frame.** `0x100` carries the left and right targets
together so the two nodes read the same bus instant rather than being skewed by
two separate transmissions.

## Mixing happens here

Throttle and steering are mixed into two track speeds inside the manager, not
in the browser's gamepad mapping. The mix has to stay consistent when only one
of the two inputs changes, and the manager is the only place that always holds
both - it needs them anyway for the periodic frame.

```
left  = throttle + steering * gain
right = throttle - steering * gain
if max(|left|, |right|) > 1: scale both down by that factor
```

Scaled rather than clipped: clipping only the inside track would change the
turn radius exactly when the stick is pushed hardest, which is the worst moment
for the vehicle to behave differently than it did a moment earlier.

`TrackLeft` and `TrackRight` bypass the mix for bench work, or for anyone who
would rather mix in the gamepad mapping. Using either one makes the manager
ignore throttle and steering, so do not configure both on one vehicle.

## Safety

### The drive is inhibited unless everything is in order

Every pass of the send loop checks, and anything short sends mode `Stop` with
a target of zero instead of the commanded speed:

- the CAN interface is open
- `ExpectedNodes` nodes have reported within `NodeTimeoutMs`
- no node reports a latched fault

### Why the missing-node check lives here and nowhere else

The firmware only arms its peer watchdog **after it has seen the peer at least
once**. Without that, a single board on the bench would latch a fault 200 ms
after boot and no serial test would be possible.

The consequence is deliberate and has to be understood: **a node that never
appears is invisible to the other node.** Only the master knows how many nodes
there are supposed to be, and only the master sees both status frames. So
checking for a node that never showed up is this driver's job. The firmware
detects a peer that was there and went away; the driver detects one that never
arrived.

Set `ExpectedNodes` to 1 for single-board bench work.

### Emergency stop

Any node broadcasts `0x010` when it latches a fault, and every node obeys it: a
track that keeps pulling while the other one is dead slews the vehicle. The
driver listens and logs it, and `TrackEmergencyStop` lets a button in the UI
send one.

The master uses sender id `0xFF`. That matters - a node discards a broadcast
carrying its own id, so a master posing as node 0 would be ignored by node 0.

### Unlatching

Nothing on a node re-enables itself. `TrackFaultReset` sets bit 0 of the
command frame's flag byte for `FaultResetHoldMs`, long enough for several
command frames to carry it.

## Options

All on the `pinManagers` entry.

| Option | Default | Meaning |
|---|---|---|
| `interface` | `can0` | SocketCAN interface. `vcan0` exercises the protocol without hardware. |
| `maxSpeedRadPerSecond` | `20` | Speed a full-scale input asks for. |
| `steeringGain` | `1.0` | 1.0 lets the vehicle turn on the spot at full stick. |
| `commandIntervalMs` | `20` | 50 Hz. The firmware's master timeout is 150 ms, i.e. three missed frames. |
| `nodeTimeoutMs` | `250` | Status arrives at 20 Hz, so this is five missed frames. |
| `expectedNodes` | `2` | Set to 1 for bench work with one board. |
| `faultResetHoldMs` | `250` | How long the unlatch flag stays set. |

## Control types

| `controlType` | Purpose |
|---|---|
| `TrackThrottle` | forward and reverse, mixed |
| `TrackSteering` | left and right, mixed; positive speeds the left track up |
| `TrackLeft` / `TrackRight` | direct, bypasses the mix |
| `TrackFaultReset` | momentary, asks the nodes to unlatch |
| `TrackEmergencyStop` | momentary, broadcasts a stop; never part of the channel test |

`TrackThrottle` and `TrackSteering` have a deliberately gentle channel test -
20 % for a second each way. It still spins both tracks, so jack the vehicle up
or set `testDisabled`.

## Telemetry

One reader instance serves every drive channel that shares a `groupKey`, so the
state is taken once per tick rather than once per displayed value. It binds to
the same manager the control channels use by asking the factory for the
pinManager by name - the factory caches by name, so no second socket is opened.

Per node, prefixed `left` or `right`: `Present`, `Speed`, `Target`, `State`,
`Current`, `BusVolts`, `BusAmps`, `Power`, `Temperature`, `Thermal`, `Fault`,
`FaultCode`, `Derating`, `CurrentLimited`, `UnderVoltageWarning`.

Bus-wide: `busUp`, `nodesPresent`, `driveEnabled`, `inhibit`, `mode`,
`commandLeft`, `commandRight`, `framesSent`, `framesReceived`, `sendFailures`.

`Temperature` comes back **empty**, not as a number, when the node reports no
valid reading. The board's thermistor node can read open or shorted and the
firmware then sends -128; showing that as a temperature would be worse than
showing nothing.

`inhibit` is the single most useful field when the vehicle will not move: it
says in words why the drive is held.

## Example configuration

```json
{
  "pinManagers": {
    "trackDrive": {
      "type": "CanTrackDriveManager",
      "options": {
        "interface": "can0",
        "maxSpeedRadPerSecond": 20,
        "steeringGain": 1.0,
        "expectedNodes": 2
      }
    }
  },
  "controlChannels": {
    "throttle":   { "pinManager": "trackDrive", "controlType": "TrackThrottle" },
    "steer":      { "pinManager": "trackDrive", "controlType": "TrackSteering" },
    "faultReset": { "pinManager": "trackDrive", "controlType": "TrackFaultReset", "testDisabled": true },
    "estop":      { "pinManager": "trackDrive", "controlType": "TrackEmergencyStop", "testDisabled": true }
  },
  "telemetryChannels": {
    "drive": {
      "pinManager": "trackDrive",
      "telemetryType": "SignalRC.Onboard.Telemetry.CanTrackDriveTelemetryReader",
      "readIntervalTicks": 1,
      "options": { "groupKey": "drive", "pinManager": "trackDrive" }
    }
  }
}
```

`telemetryType` is a fully qualified type name - `TelemetryService` resolves it
with `Type.GetType`, unlike `controlType`, which goes through the attribute.

## Bringing the bus up

```bash
sudo ip link set can0 up type can bitrate 500000
candump -tz can0
```

Virtual bus, no hardware:

```bash
sudo modprobe vcan
sudo ip link add dev vcan0 type vcan
sudo ip link set up vcan0
```

## Verification

A harness exercises the parts most likely to be wrong - byte order, scaling,
sign, mixing - and optionally the whole manager against a live interface with a
simulated pair of nodes:

```bash
cd cantrack-harness
dotnet run -c Release          # protocol and mixing, no interface needed
dotnet run -c Release vcan0    # also the manager, presence, faults, timeouts
```

Everything the first form covers passes. The second form has **not** been run;
it needs root to create the virtual interface.

Still unverified, in rough order of risk:

1. Anything touching real hardware: bitrate, termination, the USB-CAN adapter.
2. The 50 Hz send loop under load. Janus and ffmpeg share the Pi, and an encode
   burst could delay a command frame. Three missed frames stop the drive. That
   is arguably the correct response to a stalled master, but the margin should
   be measured rather than assumed.
3. The firmware side of the protocol. It was written against the same spec and
   also compiled but never run.

## Dependency

`SocketCANSharp` 0.13.0, MIT, netstandard2.0. The alternative was shelling out
to `cansend`, which at 50 Hz means a process spawn per frame.

## Keeping the two sides in step

`CanTrackProtocol.cs` mirrors the firmware byte for byte. The firmware's CAN
section in `problem.md` is the other half of the same specification. **Change
them together** - there is no generated header and nothing checks that they
agree.
