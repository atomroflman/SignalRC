#!/bin/bash
# Bluetooth for vehicle controllers (Docs/OnboardFlow.md), as root, from install.sh and update.sh.
# Idempotent; nothing here stops an install or update.
#   $1 = user the onboard service runs as
#
# - bluez (bluetoothctl) installed if missing
# - service user in the groups input (/dev/input/event*) and bluetooth (pairing via D-Bus)
# - rfkill soft block of Bluetooth lifted: Raspberry Pi OS blocks it e.g. until a WLAN
#   country is set, and the service user cannot lift it. systemd-rfkill stores the state,
#   so it holds across reboots.
# - bluetooth.service enabled and the adapter powered on
# - udev rule: the light bar LEDs of controllers (/sys/class/leds/inputN:*) writable for the
#   group input, so the flow can set their colour (ControllerLight)
set -u

RUN_USER="${1:?usage: onboard-setup-bluetooth.sh <service-user>}"

if ! command -v bluetoothctl >/dev/null 2>&1; then
    echo "Bluetooth: installing bluez ..."
    if command -v apt-get >/dev/null 2>&1; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y bluez >/dev/null \
            || echo "Warning: bluez could not be installed; vehicle controllers stay unavailable."
    else
        echo "Warning: no apt-get; install bluez by hand."
    fi
fi

for group in input bluetooth; do
    if getent group "$group" >/dev/null && ! id -nG "$RUN_USER" | tr ' ' '\n' | grep -qx "$group"; then
        usermod -aG "$group" "$RUN_USER" && echo "Bluetooth: $RUN_USER added to group $group (takes effect on the next service start)."
    fi
done

for rfkill_dev in /sys/class/rfkill/rfkill*; do
    [ -f "$rfkill_dev/type" ] || continue
    if [ "$(cat "$rfkill_dev/type")" = "bluetooth" ] && [ "$(cat "$rfkill_dev/soft")" = "1" ]; then
        echo 0 > "$rfkill_dev/soft" && echo "Bluetooth: rfkill soft block lifted ($(cat "$rfkill_dev/name"))."
    fi
    if [ "$(cat "$rfkill_dev/type")" = "bluetooth" ] && [ "$(cat "$rfkill_dev/hard" 2>/dev/null || echo 0)" = "1" ]; then
        echo "Warning: Bluetooth is hard-blocked ($(cat "$rfkill_dev/name")); a switch or the firmware blocks it."
    fi
done

LED_RULE=/etc/udev/rules.d/71-signalrc-controller-leds.rules
LED_RULE_CONTENT='# SignalRC (scripts/onboard-setup-bluetooth.sh): controller light bars writable for the group input.
ACTION=="add", SUBSYSTEM=="leds", KERNEL=="input*", RUN+="/bin/sh -c '"'"'cd /sys%p && chgrp input brightness multi_intensity 2>/dev/null; chmod g+w brightness multi_intensity 2>/dev/null; true'"'"'"'
if [ -d /etc/udev/rules.d ] && [ "$(cat "$LED_RULE" 2>/dev/null)" != "$LED_RULE_CONTENT" ]; then
    printf '%s\n' "$LED_RULE_CONTENT" > "$LED_RULE" && echo "Bluetooth: udev rule for the controller LEDs installed."
    if command -v udevadm >/dev/null 2>&1; then
        udevadm control --reload >/dev/null 2>&1 || true
        udevadm trigger --subsystem-match=leds --action=add >/dev/null 2>&1 || true
    fi
fi

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files bluetooth.service >/dev/null 2>&1; then
    systemctl enable --now bluetooth.service >/dev/null 2>&1 || echo "Warning: bluetooth.service could not be started."
fi

if command -v bluetoothctl >/dev/null 2>&1; then
    bluetoothctl power on >/dev/null 2>&1 || true
    if bluetoothctl show 2>/dev/null | grep -q "Powered: yes"; then
        echo "Bluetooth: adapter on."
    else
        echo "Warning: Bluetooth adapter is not on ($(bluetoothctl show 2>/dev/null | grep -oP 'PowerState:\s*\K\S+' || echo 'no adapter'))."
    fi
fi
exit 0
