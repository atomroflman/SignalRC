# cantrack-harness

Checks for the CAN track drive and the lidar. Not in `SignalRC.sln`, so it
never slows a normal build; run it by hand.

```sh
cd Tools/cantrack-harness
dotnet run -c Release                 # protocol, mixing, kinematics, recorder, lidar replay
dotnet run -c Release vcan0           # also the CAN manager against a live bus
dotnet run -c Release /dev/ttyACM0    # also the lidar manager against real hardware
```

Everything in the first form runs with no hardware and no network, which is
the point - most of this code was written before any of it was available.

## Virtual CAN bus

```sh
sudo modprobe vcan
sudo ip link add dev vcan0 type vcan
sudo ip link set up vcan0
```

The bus form simulates two drive nodes on a second socket and drives the
manager through presence detection, fault latching, a node going silent, the
control-input watchdog, tank mixing, rotation on the spot and per-track
inversion.

The simulated nodes report **continuously**, from a thread at 40 Hz. An
earlier version sent a burst and went quiet, and every check after the burst
then failed because the drive had inhibited itself for a missing node - three
failures with nothing wrong except the test. Real nodes talk all the time; a
simulator that does not is worse than none.

## Lidar

The replay checks run against `Onboard/Hardware/Lidar/testdata/`, ten real
revolutions captured from the Pico bridge. Synthetic frames only ever prove a
decoder agrees with its own test; these prove it agrees with the hardware,
which matters here because the first decoder written for this sensor was
decoding a format nothing on the vehicle produces.

The live form needs the sensor spinning. If it is not, the manager escalates
through START and then a power cycle, which takes a few seconds - the harness
waits for it.

## What it does not cover

Anything needing the drive boards. `vcan0` proves the protocol, not the
wiring, not the bitrate and not the termination.
