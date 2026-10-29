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

### Turning on the spot

Full steering with no throttle gives `+1` and `-1`: the tracks counter-rotate
at full speed and the vehicle turns about its own centre. The sum never exceeds
full scale, so nothing is scaled back. Lowering `steeringGain` keeps it a
rotation on the spot, just a slower one - throttle is zero either way, so it
cannot degenerate into a curve.

Worth knowing before the first attempt: rotating on the spot is the **worst
case** for this drive. It scrubs both tracks sideways, so it is the highest
load the vehicle will ever see - which is where the peak current limit and the
I2t model earn their keep. It also happens at low speed, and low speed is
exactly where the hall error rate is highest: about 14 % at 8 rad/s against 4 %
at 30. The firmware's `problem.md` calls manoeuvring the critical regime, and
turning on the spot is manoeuvring.

### Mirrored motors

The two hub motors are mounted one per side, so they face opposite ways, and
both run the same firmware calibration. The same commanded sign therefore turns
them the same way in MOTOR coordinates - which drives the vehicle in a circle
instead of straight, with steering and throttle effectively swapped.

`invertLeft` / `invertRight` fix that. **Exactly one of them normally has to be
set.** Which one is a question for the first drive test rather than for the
schematic: a board whose phase leads happen to be swapped already turns the
other way. Both default to false so nothing is assumed.

Everything above the manager stays in VEHICLE coordinates - positive means that
track pushes the vehicle forward. The flip is applied when the command is
encoded and undone when telemetry is decoded, so a track driving the vehicle
forward reports a positive speed on either side.

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

### The network link

The control path runs over a network, and it can fail in two ways of which only
one is obvious.

**A dropped connection** eventually reaches `ControlService.OnClosed`, which
releases every channel. But SignalR's `ServerTimeout` defaults to 30 seconds and
nothing in this repository lowers it, so on a silently dropped link that is how
long the vehicle would hold its last commanded speed.

**A merely slow link** never raises anything at all. The commands arrive, just
late. Arguably the worse case, because nothing anywhere reports a fault.

From the manager both look identical - input stops being fresh - so one age
check covers both. If nothing has arrived within `controlTimeoutMs`, the drive
is inhibited and the frame goes out as mode `Stop` with a zero target. The
`controlAge` telemetry field shows the age, which is the fastest way to tell a
bad link from a drive problem.

This is deliberately **not** built on `ResendRequiredContolDecorator`. That is
opt-in per channel, and with mixing a half-configured set is actively
dangerous: throttle released while steering is still held is not "stopped", it
is "turning on the spot". The manager check is always on and covers every drive
input at once. For the same reason, releasing **any** drive input zeroes them
all.

Two things still have to be configured for it to work:

- **`maxResendInterval` on the drive channels.** Without it the browser only
  sends on change, so holding the stick steady produces no traffic and the
  watchdog would fire on a perfectly good link. With it the browser repeats the
  last value at half that period. Keep `controlTimeoutMs` comfortably above it.
- **Consider lowering SignalR's `ServerTimeout`** so a dead connection is
  noticed in seconds rather than in half a minute. Not changed here because it
  affects the whole application - on a flaky LTE link a short timeout buys more
  spurious reconnects. The manager watchdog makes it non-critical either way.

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
| `invertLeft` | `false` | Flips that track's direction. Normally exactly one side needs it, see [Mirrored motors](#mirrored-motors). |
| `invertRight` | `false` | As above. |
| `commandIntervalMs` | `20` | 50 Hz. The firmware's master timeout is 150 ms, i.e. three missed frames. |
| `nodeTimeoutMs` | `250` | Status arrives at 20 Hz, so this is five missed frames. |
| `expectedNodes` | `2` | Set to 1 for bench work with one board. |
| `faultResetHoldMs` | `250` | How long the unlatch flag stays set. |
| `controlTimeoutMs` | `500` | Stop if no control input arrived for this long. See [The network link](#the-network-link). |
| `wheelRadiusM` | `0` | Metres of travel per radian. Zero means the odometry reports only travelled angles. |
| `trackWidthM` | `0` | Effective track spacing. Zero as above. |
| `recorderDirectory` | empty | Where flight recorder dumps go. Empty keeps the ring but writes nothing. |
| `recorderSeconds` | `60` | How much history to keep. |
| `recorderHz` | `20` | Sampling rate. The status frames arrive at 20 Hz, so nothing is gained above that. |

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

Bus-wide: `busUp`, `nodesPresent`, `driveEnabled`, `inhibit`, `controlAge`,
`mode`, `commandLeft`, `commandRight`, `framesSent`, `framesReceived`,
`sendFailures`.

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
        "invertRight": true,
        "expectedNodes": 2,
        "controlTimeoutMs": 500
      }
    }
  },
  "controlChannels": {
    "throttle":   { "pinManager": "trackDrive", "controlType": "TrackThrottle", "maxResendInterval": 300 },
    "steer":      { "pinManager": "trackDrive", "controlType": "TrackSteering", "maxResendInterval": 300 },
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

0. Which side needs inverting. Nothing but a drive test can answer it, and
   getting it wrong turns the first throttle command into a pirouette. Jack the
   vehicle up and watch which way each track runs before putting it on the
   ground.
1. Anything touching real hardware: bitrate, termination, the USB-CAN adapter.
2. The 50 Hz send loop under load. Janus and ffmpeg share the Pi, and an encode
   burst could delay a command frame. Three missed frames stop the drive. That
   is arguably the correct response to a stalled master, but the margin should
   be measured rather than assumed.
3. The firmware side of the protocol. It was written against the same spec and
   also compiled but never run.

## Flight recorder

During a drive there is no serial console, no logic analyser and no
oscilloscope. Without a recording every incident is "it stuttered, no idea
why", and this project has already paid for that lesson twice: four rounds
went into the stall detector before anyone printed its internals, and the
velocity estimate was wrong for half the project because nobody compared the
reported speed against the angle. Both were found the moment the data became
visible, not the moment someone had a better theory.

So the manager keeps the last `recorderSeconds` of drive state in a ring at
`recorderHz` and writes it to `recorderDirectory` as CSV whenever a node
latches a fault. The run-up is already in the buffer by then, which is the
part that explains the fault.

`TrackRecordDump` writes it out on demand - for the other half of the problem,
where the vehicle did something odd and nothing tripped. That is the case that
is impossible to reproduce later, so press it while the memory is fresh.

Dumps closer together than `minDumpIntervalSeconds` are dropped, because one
blocked track produces a burst of faults on both nodes and twenty files of the
same second help nobody. The oldest are pruned beyond `keepFiles`, because the
Pi's card is not large and nobody prunes a log directory by hand.

The file is written from a worker, never from the command or receive loop: a
vehicle must not stutter because a log is being flushed. A failed dump is
logged and otherwise ignored - the vehicle is already in trouble if we got
there.

## Not built: keeping the tracks together

The two tracks regulate independently. When one crosses an obstacle it dips
about 9 percent and takes roughly a second to recover while the other does not,
and over that second the vehicle yaws. Nothing corrects it: the driver sends a
fixed pair of setpoints and never compares the two reported speeds.

Deliberately left out until a drive test says it matters. On a tracked vehicle
with a lot of ground friction a second of skew may simply not show, and a
control loop nobody needs is still a control loop everybody has to maintain.

If it does matter, two things in order:

**Trim travelled distance, not speed.** Speed matching is already done by the
node controllers to within 1.7 percent; there is nothing left there. The
residual is the *integral* of the dip, so integrate the reported speeds and
null the difference in travelled angle. The 1.7 percent is largely common mode
and cancels in the difference.

It has to be slow. The measurement arrives at 20 Hz and is already averaged
over 50 ms on the node, and the inner velocity loop settles in about a second -
so the outer loop belongs at 0.2 to 0.5 Hz, integral only. A proportional term
would amplify the load step it is meant to absorb. Freeze it when not driving,
clamp it, and reset it on every mode change and fault.

**A heading sensor is the better answer.** Track speed is not vehicle heading;
slip is large and asymmetric, especially while turning, so two tracks at
identical speed can still yaw. What is needed is yaw rate over seconds, not an
absolute bearing - which is fortunate, because a magnetometer is useless on
this vehicle: two hub motors are large permanent magnets and the phase leads
carry 10 to 15 A of switched current. Candidates and mounting notes are in the
firmware repo's TODO.md.

Both belong in `CanTrackDriveManager`, not in the firmware. Two nodes trimming
against each other would be two coupled controllers chasing one another.

## Dependency

`SocketCANSharp` 0.13.0, MIT, netstandard2.0. The alternative was shelling out
to `cansend`, which at 50 Hz means a process spawn per frame.

## Keeping the two sides in step

`CanTrackProtocol.cs` mirrors the firmware byte for byte. The firmware's CAN
section in `problem.md` is the other half of the same specification. **Change
them together** - there is no generated header and nothing checks that they
agree.
