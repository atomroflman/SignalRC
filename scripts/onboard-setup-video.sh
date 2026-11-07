#!/bin/bash
# Video prerequisites of the onboard (Docs/CONFIGURATION.md, USB webcams), as root, from
# install.sh and update.sh. Idempotent; nothing here stops an install or update.
#
# - GStreamer for "pipeline": "gstreamer" (gst-launch-1.0, V4L2 JPEG decoder and H.264 encoder
#   from plugins-good) installed if missing
# - Raspberry Pi 1-4: GPU memory (gpu_mem) of at least 128 MB, so the Pi camera, the H.264
#   encoder and the JPEG decoder fit together. With the default 76 MB the decoder fails with
#   "Not enough GPU mem?" and can leave the GPU interface hung until a reboot. Changing
#   config.txt needs a power cycle, so it is only done after an explicit OK on the terminal;
#   without a terminal it is only reported. A "no" is remembered and not asked again
#   (delete $DECLINED to be asked again).
#
# Exit code 3: config.txt was changed, the Pi needs a power cycle (reboot). Otherwise 0.
set -u

MIN_GPU_MEM=128
DECLINED=/var/lib/signalrc/gpu-mem-declined
REBOOT_NEEDED=0

# ── GStreamer ────────────────────────────────────────────────────────
if ! command -v gst-launch-1.0 >/dev/null 2>&1 || ! gst-inspect-1.0 v4l2jpegdec >/dev/null 2>&1; then
    echo "Video: installing GStreamer (gst-launch-1.0, plugins-good) ..."
    if command -v apt-get >/dev/null 2>&1; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y gstreamer1.0-tools gstreamer1.0-plugins-good >/dev/null \
            || echo "Warning: GStreamer could not be installed; USB webcams stay on ffmpeg."
    elif command -v pacman >/dev/null 2>&1; then
        pacman -S --noconfirm --needed gstreamer gst-plugins-good >/dev/null \
            || echo "Warning: GStreamer could not be installed; USB webcams stay on ffmpeg."
    else
        echo "Warning: no apt-get/pacman; install gstreamer1.0-tools and gstreamer1.0-plugins-good by hand."
    fi
fi

# ── GPU memory (Raspberry Pi 1-4 only; a Pi 5 has no fixed GPU split) ──
MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)"
CONFIG_TXT=""
for candidate in /boot/firmware/config.txt /boot/config.txt; do
    if [ -f "$candidate" ]; then CONFIG_TXT="$candidate"; break; fi
done

if [[ "$MODEL" == Raspberry\ Pi* && "$MODEL" != Raspberry\ Pi\ 5* ]] && [ -n "$CONFIG_TXT" ] && command -v vcgencmd >/dev/null 2>&1; then
    GPU_MEM="$(vcgencmd get_mem gpu 2>/dev/null | grep -oE '[0-9]+' | head -1)"
    CONFIGURED="$(grep -E '^[[:space:]]*gpu_mem=' "$CONFIG_TXT" | tail -1 | grep -oE '[0-9]+' | head -1 || true)"
    if [ -n "$GPU_MEM" ] && [ "$GPU_MEM" -lt "$MIN_GPU_MEM" ] && [ "${CONFIGURED:-0}" -lt "$MIN_GPU_MEM" ] && [ ! -f "$DECLINED" ]; then
        echo ""
        echo "Video: the GPU has ${GPU_MEM} MB (gpu_mem). A Pi camera together with a USB webcam on"
        echo "       GStreamer needs at least ${MIN_GPU_MEM} MB; otherwise the JPEG decoder fails and can hang"
        echo "       the GPU until the next reboot. Linux then has $((MIN_GPU_MEM - GPU_MEM)) MB less RAM."
        echo "       This changes $CONFIG_TXT (gpu_mem=${MIN_GPU_MEM})."
        echo "       NOTE: takes effect only after a POWER CYCLE (sudo reboot)."
        ANSWER=""
        if [ -t 0 ]; then
            read -rp "       Set gpu_mem=${MIN_GPU_MEM} now? [y/N]: " ANSWER
        elif [ -r /dev/tty ]; then
            read -rp "       Set gpu_mem=${MIN_GPU_MEM} now? [y/N]: " ANSWER < /dev/tty
        else
            echo "       No terminal: not changed. Run update.sh or install.sh interactively to set it."
        fi
        case "${ANSWER,,}" in
            y|yes|j|ja)
                cp "$CONFIG_TXT" "$CONFIG_TXT.signalrc.bak"
                if [ -n "$CONFIGURED" ]; then
                    sed -i -E "s/^([[:space:]]*)gpu_mem=[0-9]+/\1gpu_mem=${MIN_GPU_MEM}/" "$CONFIG_TXT"
                else
                    printf '\n[all]\n# SignalRC (scripts/onboard-setup-video.sh): Pi camera + H.264 encoder + JPEG decoder\ngpu_mem=%s\n' "$MIN_GPU_MEM" >> "$CONFIG_TXT"
                fi
                echo "Video: gpu_mem=${MIN_GPU_MEM} set in $CONFIG_TXT (backup: $CONFIG_TXT.signalrc.bak)."
                REBOOT_NEEDED=1
                ;;
            *)
                if [ -n "$ANSWER" ] || [ -t 0 ] || [ -r /dev/tty ]; then
                    mkdir -p "$(dirname "$DECLINED")" && date -Iseconds > "$DECLINED"
                    echo "Video: gpu_mem left unchanged; not asked again (delete $DECLINED to be asked again)."
                fi
                ;;
        esac
    fi
fi

[ "$REBOOT_NEEDED" -eq 1 ] && exit 3
exit 0
