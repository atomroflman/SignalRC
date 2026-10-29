#!/usr/bin/env python3
"""Check a raw FM1828 capture against the format the C# decoder expects.

Standard library only. The point is to find out on the spot whether the
assumed format is right, rather than discovering it later inside the vehicle
software.

    ./lidar-check.py lidar.bin
"""
import sys
from collections import Counter

PACKET = 22
START = 0xFA
IDX_FIRST, IDX_LAST = 0xA0, 0xF9


def main(path):
    data = open(path, 'rb').read()
    print(f"{path}: {len(data)} bytes\n")

    packets = bad_csum = bad_index = discarded = 0
    indices = Counter()
    speeds = []
    distances = []
    no_return = weak = 0

    i = 0
    while i + PACKET <= len(data):
        if data[i] != START:
            i += 1
            discarded += 1
            continue
        pkt = data[i:i + PACKET]
        # Plain sum of the first 20 bytes. NOT the XV-11 word algorithm - that
        # is the first thing to suspect if everything below reads as garbage.
        csum = sum(pkt[:20]) & 0xFFFF
        if csum != (pkt[20] | (pkt[21] << 8)):
            bad_csum += 1
            i += 1          # one byte: 0xFA occurs inside payload all the time
            discarded += 1
            continue
        idx = pkt[1]
        if not (IDX_FIRST <= idx <= IDX_LAST):
            bad_index += 1
            i += PACKET
            continue

        packets += 1
        indices[idx] += 1
        speeds.append(pkt[2] | (pkt[3] << 8))
        for s in range(4):
            o = 4 + s * 4
            word = pkt[o] | (pkt[o + 1] << 8)
            if word & 0x8000:
                no_return += 1
            else:
                if word & 0x4000:
                    weak += 1
                distances.append(word & 0x3FFF)
        i += PACKET

    print(f"packets accepted   {packets}")
    print(f"checksum failures  {bad_csum}")
    print(f"impossible index   {bad_index}")
    print(f"bytes discarded    {discarded}")

    if packets == 0:
        print("\nNothing decoded. The format assumption is wrong, or this is not")
        print("the stream. First bytes:", data[:32].hex(' '))
        return 1

    revolutions = indices[IDX_FIRST]
    print(f"\ndistinct indices   {len(indices)} of 90")
    print(f"revolutions        {revolutions}")

    raw = sum(speeds) / len(speeds)
    print(f"\nspeed field        {raw:.0f} raw")
    print(f"  /100             {raw / 100:.1f} RPM   <- expected scaling")
    print(f"  /64              {raw / 64:.1f} RPM   (the XV-11 scaling, wrong here)")
    # 9900 bytes a second at 5 rev/s; revolutions per second times 60.
    seconds = len(data) / 9900.0
    measured = revolutions / seconds * 60.0 if seconds > 0 else 0.0
    print(f"  measured         {measured:.0f} RPM, roughly")
    print("  Whichever of the three agrees with the other two is the right one.")
    print("  The measured figure assumes ~9900 bytes/s, so it is only a sanity")
    print("  check - but it is off by a factor of 1.6 if /64 were correct.")

    print(f"\nvalid returns      {len(distances)}")
    print(f"no return          {no_return}")
    print(f"weak signal        {weak}")
    if distances:
        d = sorted(distances)
        print(f"distance mm        min {d[0]}  median {d[len(d) // 2]}  max {d[-1]}")
        if d[-1] > 12000:
            print("  Over 12 m from an 8 m indoor unit - suspect the mask or the flags.")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else 'lidar.bin'))
