#!/usr/bin/env python3
"""
LteCar Video-Stack Diagnose-Tool

Läuft auf dem Onboard-Client (Raspberry Pi / lte-truck) und prüft Schritt für
Schritt, ob der Video-Stream vom Kamera-Sensor bis zum Janus-Server funktioniert.

Ausführung:
    python3 Onboard/Tools/video_stack_check.py
    # oder aus dem Onboard-Verzeichnis:
    python3 Tools/video_stack_check.py

Exit-Codes:
    0 - alle Checks bestanden
    1 - mindestens ein kritischer Check fehlgeschlagen
"""

import argparse
import json
import os
import re
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError


class Colors:
    OK = "\033[92m"
    WARN = "\033[93m"
    FAIL = "\033[91m"
    INFO = "\033[94m"
    RESET = "\033[0m"
    BOLD = "\033[1m"


# Globaler Zustand für JSON-Output
_checks: list[dict] = []
_current_step: str = ""
_json_mode: bool = False


def set_json_mode(enabled: bool):
    global _json_mode
    _json_mode = enabled


def color(text: str, color_code: str) -> str:
    if _json_mode:
        return text
    return f"{color_code}{text}{Colors.RESET}"


def _status_name(status: str) -> str:
    return {"ok": "Ok", "warn": "Warning", "fail": "Error", "info": "Info"}.get(status, "Info")


def _add_check(status: str, message: str):
    if _current_step:
        _checks.append({
            "step": _current_step,
            "title": _current_step.split(": ", 1)[1] if ": " in _current_step else _current_step,
            "status": _status_name(status),
            "message": message,
        })


def print_step(number: int, title: str):
    global _current_step
    _current_step = f"Schritt {number}: {title}"
    if _json_mode:
        return
    print()
    print(color(f"=== Schritt {number}: {title} ===", Colors.BOLD + Colors.INFO))


def ok(msg: str):
    _add_check("ok", msg)
    if not _json_mode:
        print(color(f"  ✅ {msg}", Colors.OK))


def warn(msg: str):
    _add_check("warn", msg)
    if not _json_mode:
        print(color(f"  ⚠️  {msg}", Colors.WARN))


def fail(msg: str):
    _add_check("fail", msg)
    if not _json_mode:
        print(color(f"  ❌ {msg}", Colors.FAIL))


def info(msg: str):
    _add_check("info", msg)
    if not _json_mode:
        print(color(f"  ℹ️  {msg}", Colors.INFO))


def run(cmd: list[str], timeout: int = 10) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            errors="replace",
        )
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        return -1, "", f"Timeout nach {timeout}s"
    except FileNotFoundError as e:
        return -1, "", f"Kommando nicht gefunden: {e}"


def find_onboard_dir() -> Path:
    """Versucht das Onboard-Verzeichnis zu finden."""
    candidates = [
        Path.cwd(),
        Path.cwd() / "Onboard",
        Path(__file__).resolve().parent.parent,
        Path("/home/greg-e/SignalRC/Onboard"),
        Path("/opt/ltecar/onboard"),
    ]
    for candidate in candidates:
        if (candidate / "appSettings.json").exists() or (
            candidate / "LteCar.Onboard"
        ).exists():
            return candidate
    return Path.cwd()


def load_appsettings(onboard_dir: Path) -> dict:
    path = onboard_dir / "appSettings.json"
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        warn(f"Konnte appSettings.json nicht lesen: {e}")
        return {}


def load_channelmap_from_sqlite(sqlite_path: Path) -> dict:
    """Lädt die ChannelMap aus dem OnboardChannelStore-Schema."""
    try:
        conn = sqlite3.connect(str(sqlite_path))
        cur = conn.cursor()

        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0] for row in cur.fetchall()}

        # OnboardChannelStore speichert Kanäle in einzelnen Tabellen.
        if "video_streams" in tables:
            result = {"videoStreams": {}, "pinManagers": {}, "controlChannels": {}, "telemetryChannels": {}}

            cur.execute(
                "SELECT dict_key, stream_id, name, location, type, enabled, server_id, "
                "camera_device, rpi_cam_id, width, height, framerate, bitrate, options_json "
                "FROM video_streams"
            )
            for row in cur.fetchall():
                key, stream_id, name, location, typ, enabled, server_id, cam_device, rpi_cam_id, width, height, framerate, bitrate, options_json = row
                options = {}
                if options_json:
                    try:
                        options = json.loads(options_json)
                    except Exception:
                        pass
                result["videoStreams"][key] = {
                    "streamId": stream_id,
                    "name": name,
                    "location": location,
                    "type": typ,
                    "enabled": bool(enabled),
                    "serverId": server_id,
                    "cameraDevice": cam_device,
                    "rpiCamId": rpi_cam_id,
                    "width": width,
                    "height": height,
                    "framerate": framerate,
                    "bitrate": bitrate,
                    "options": options,
                }

            if "pin_managers" in tables:
                cur.execute("SELECT dict_key, type, options_json FROM pin_managers")
                for row in cur.fetchall():
                    key, typ, options_json = row
                    options = {}
                    if options_json:
                        try:
                            options = json.loads(options_json)
                        except Exception:
                            pass
                    result["pinManagers"][key] = {"type": typ, "options": options}

            conn.close()
            return result

        # Legacy-Fallback: altes Schema mit einer ChannelMap-Tabelle.
        if "ChannelMap" in tables:
            cur.execute("SELECT Value FROM ChannelMap LIMIT 1")
            row = cur.fetchone()
            if row and row[0]:
                data = json.loads(row[0])
                conn.close()
                return data.get("channelMap", data)

        conn.close()
    except Exception as e:
        warn(f"Konnte channels.sqlite nicht lesen: {e}")
    return {}


def load_channelmap(onboard_dir: Path) -> dict:
    """Lädt die ChannelMap aus channels.sqlite oder channelMap.json."""
    sqlite_path = onboard_dir / "channels.sqlite"
    if sqlite_path.exists():
        data = load_channelmap_from_sqlite(sqlite_path)
        if data:
            return data

    json_path = onboard_dir / "channelMap.json"
    if json_path.exists():
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            warn(f"Konnte channelMap.json nicht lesen: {e}")

    return {}


def get_video_streams(channel_map: dict) -> dict[str, dict]:
    return channel_map.get("videoStreams", {}) or {}


def get_enabled_rpi_streams(streams: dict) -> list[tuple[str, dict]]:
    result = []
    for name, cfg in streams.items():
        if cfg.get("enabled") and cfg.get("type", "").lower() == "rpicamera":
            result.append((name, cfg))
    return result


def resolve_server_host(appsettings: dict) -> str:
    host = appsettings.get("ServerName", "")
    if not host:
        host = "lte-rc.northeurope.cloudapp.azure.com"
    return host


def check_process(name: str, pattern: str) -> tuple[bool, list[dict]]:
    rc, stdout, _ = run(["ps", "aux"])
    if rc != 0:
        return False, []
    matches = []
    for line in stdout.splitlines():
        if re.search(pattern, line) and "grep" not in line.lower():
            parts = line.split(None, 10)
            if len(parts) >= 11:
                matches.append({
                    "pid": parts[1],
                    "cpu": parts[2],
                    "mem": parts[3],
                    "cmd": parts[10],
                })
    return len(matches) > 0, matches


def check_camera_locks() -> tuple[bool, list[str]]:
    # Versuche zuerst mit sudo; falls nicht verfügbar, ohne sudo prüfen.
    rc, stdout, _ = run(["sudo", "lsof", "/dev/media0", "/dev/media3"])
    if rc != 0 or not stdout.strip():
        rc, stdout, _ = run(["lsof", "/dev/media0", "/dev/media3"])
    if rc != 0 or not stdout.strip():
        return False, []
    lines = [l for l in stdout.splitlines() if l.strip() and not l.startswith("COMMAND")]
    return len(lines) > 0, lines


def check_rtsp_stream(stream_name: str, timeout: int = 10) -> tuple[bool, str]:
    """Prüft, ob der lokale RTSP-Stream existiert und Daten liefert."""
    url = f"rtsp://localhost:8554/{stream_name}"

    # Bevorzugt ffprobe verwenden (schneller, sauberer Exit).
    ffprobe_exists = run(["which", "ffprobe"], timeout=2)[0] == 0
    if ffprobe_exists:
        cmd = [
            "ffprobe",
            "-v", "error",
            "-rtsp_transport", "tcp",
            "-show_entries", "stream=codec_name",
            "-of", "default=noprint_wrappers=1",
            "-timeout", str(timeout * 1000000),  # Mikrosekunden
            url,
        ]
        rc, stdout, stderr = run(cmd, timeout=timeout + 2)
        combined = (stdout + stderr).lower()
        if "404 not found" in combined:
            return False, f"RTSP-Path '{stream_name}' existiert nicht (404)"
        if rc == 0 and stdout.strip():
            return True, f"ffprobe empfängt Stream ({stdout.strip()})"

    # Fallback: ffmpeg liest maximal 2 Sekunden / 60 Frames.
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-rtsp_transport", "tcp",
        "-i", url,
        "-c", "copy",
        "-frames:v", "60",
        "-f", "null",
        "-",
    ]
    rc, stdout, stderr = run(cmd, timeout=min(timeout, 10))
    combined = (stdout + stderr).lower()
    if "404 not found" in combined:
        return False, f"RTSP-Path '{stream_name}' existiert nicht (404)"
    if "error" in combined and rc != 0:
        return False, f"ffmpeg-Fehler: {(stderr or stdout)[:200]}"
    if rc == 0 or "frame=" in combined:
        return True, "RTSP-Stream empfängt Frames"
    return False, f"Unbekannter Fehler: {(stderr or stdout)[:200]}"


def check_ffmpeg_sending(stream_name: str) -> tuple[bool, str]:
    rc, stdout, _ = run(["ps", "aux"])
    if rc != 0:
        return False, "ps aux fehlgeschlagen"
    for line in stdout.splitlines():
        if "ffmpeg" in line and f"rtsp://localhost:8554/{stream_name}" in line:
            return True, line.split(None, 10)[10]
    return False, f"Kein ffmpeg-Prozess für Stream '{stream_name}'"


def check_camera_conflicts(streams: dict) -> tuple[bool, list[str]]:
    """Prüft, ob mehrere aktivierte RPI-Kamera-Streams dieselbe CamID nutzen."""
    by_cam_id: dict[int, list[str]] = {}
    for name, cfg in streams.items():
        if not cfg.get("enabled"):
            continue
        if cfg.get("type", "").lower() != "rpicamera":
            continue
        cam_id = cfg.get("rpiCamId", 0)
        by_cam_id.setdefault(cam_id, []).append(name)

    conflicts = []
    for cam_id, names in by_cam_id.items():
        if len(names) > 1:
            conflicts.append(f"CamID {cam_id} wird von {', '.join(names)} gemeinsam genutzt")
    return len(conflicts) == 0, conflicts


def check_leftover_processes() -> tuple[bool, list[str]]:
    """Sucht nach verwaisten mediamtx/mtxrpicam/ffmpeg/libcamera-Prozessen."""
    rc, stdout, _ = run(["ps", "aux"])
    if rc != 0:
        return False, ["ps aux fehlgeschlagen"]

    patterns = [
        (r"Extern/mediamtx", "mediamtx"),
        (r"mtxrpicam$", "mtxrpicam"),
        (r"ffmpeg.*rtsp://localhost:8554", "ffmpeg (RTSP)"),
        (r"rpicam-vid|libcamera-vid", "rpicam-vid/libcamera-vid"),
    ]
    leftover = []
    for line in stdout.splitlines():
        if "grep" in line.lower():
            continue
        if "LteCar.Onboard" in line:
            continue
        for pattern, label in patterns:
            if re.search(pattern, line):
                parts = line.split(None, 10)
                cmd = parts[10] if len(parts) >= 11 else line
                leftover.append(f"{label} (PID {parts[1]}): {cmd[:80]}")
                break
    return len(leftover) == 0, leftover


def check_onboard_error_log() -> str:
    """Prüft /var/log/ltecar/onboard.err auf bekannte Fehlermuster.

    Berücksichtigt nur Einträge, die nach dem letzten Start des
    ltecar-onboard.service geschrieben wurden, damit alte Crashes
    nicht den aktuellen Zustand verschleiern.
    """
    log_path = Path("/var/log/ltecar/onboard.err")
    if not log_path.exists():
        return ""

    try:
        log_mtime = log_path.stat().st_mtime
    except Exception:
        log_mtime = 0

    svc = check_systemd_service()
    active_since = 0
    if svc.get("active"):
        # systemctl liefert z. B. "Active: active (running) since Mon 2026-08-10 16:09:19 CEST; ..."
        line = svc.get("active_line", "")
        m = re.search(r"since\s+(.+?);", line)
        if m:
            try:
                active_since = time.mktime(time.strptime(m.group(1).strip(), "%a %Y-%m-%d %H:%M:%S %Z"))
            except Exception:
                pass

    # Wenn der Service läuft und das Error-Log älter ist als der Start,
    # stammen die Fehler von einem früheren Lauf.
    if svc.get("active") and log_mtime and log_mtime < active_since:
        return ""

    try:
        text = log_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""

    # Nur den seit dem letzten Service-Start geschriebenen Teil betrachten.
    # Da wir keinen Zeitstempel pro Zeile haben, beschränken wir uns auf die
    # letzten Zeilen und ignorieren sie, wenn das Log älter als der Start ist.
    lines = text.splitlines()[-100:]
    recent = "\n".join(lines).lower()

    if "no pinmanager named" in recent:
        return "No pinManager named '...' in ChannelMap (Deserialisierungs-/Sync-Fehler)"
    if "cannot show selection prompt" in recent:
        return "Interaktiver Config-Prompt in nicht-interaktiver Umgebung (systemd)"
    if "pipeline handler in use by another process" in recent:
        return "Kamera-Pipeline war belegt (anderer Prozess hält sie)"
    return ""


def check_systemd_service() -> dict:
    """Liest den Status des ltecar-onboard.service aus."""
    rc, stdout, _ = run(["systemctl", "status", "ltecar-onboard.service", "--no-pager", "-l"])
    result = {
        "exit_code": rc,
        "active": False,
        "failed": False,
        "lines": stdout.splitlines()[:20],
    }
    for line in stdout.splitlines():
        if "Active:" in line:
            result["active"] = "active (running)" in line
            result["failed"] = "failed" in line.lower()
            result["active_line"] = line.strip()
        if "ExecStart=" in line:
            result["exec_start"] = line.strip()
    return result


def check_server_reachable(host: str, port: int = 443, timeout: int = 5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def _ssl_context():
    import ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def check_janus_info(host: str) -> tuple[bool, dict | str]:
    url = f"https://{host}/janus/info"
    try:
        with urlopen(url, timeout=10, context=_ssl_context()) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return True, data
    except URLError as e:
        return False, str(e)
    except Exception as e:
        return False, str(e)


def _janus_api_call(host: str, path: str, payload: dict, timeout: int = 10) -> dict:
    url = f"https://{host}/janus{path}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(req, timeout=timeout, context=_ssl_context()) as resp:
        return json.loads(resp.read().decode("utf-8"))


def check_janus_mountpoint(host: str, stream_id: int) -> tuple[bool, str]:
    """Prüft über den öffentlichen /janus-Endpunkt, ob ein Mountpoint existiert."""
    try:
        session_data = _janus_api_call(host, "", {"janus": "create", "transaction": "t1"}, timeout=5)
        session_id = session_data["data"]["id"]

        handle_data = _janus_api_call(
            host,
            f"/{session_id}",
            {"janus": "attach", "plugin": "janus.plugin.streaming", "transaction": "t2"},
            timeout=5,
        )
        handle_id = handle_data["data"]["id"]

        list_data = _janus_api_call(
            host,
            f"/{session_id}/{handle_id}",
            {"janus": "message", "body": {"request": "list"}, "transaction": "t3"},
            timeout=5,
        )
        streams = list_data.get("plugindata", {}).get("data", {}).get("list", [])
        for s in streams:
            if s.get("id") == stream_id:
                return True, f"Mountpoint {stream_id} vorhanden"
        return False, f"Mountpoint {stream_id} nicht in Liste ({len(streams)} Einträge)"
    except Exception as e:
        return False, f"Janus-API-Fehler: {e}"


def start_test_mediamtx(onboard_dir: Path, stream_name: str) -> int:
    """Startet MediaMTX temporär und prüft, ob die Kamera erreichbar ist."""
    print_step(99, f"MediaMTX Start-Test für '{stream_name}'")
    info("Dieser Test startet MediaMTX manuell, beobachtet 20 Sekunden und stoppt wieder.")
    info("Falls der Onboard-Prozess gerade läuft, kann er den Test beeinflussen.")

    mediamtx = onboard_dir / "Extern" / "mediamtx"
    config = onboard_dir / "Extern" / "mediamtx.yml"
    if not mediamtx.exists():
        fail(f"mediamtx binary nicht gefunden: {mediamtx}")
        return 1
    if not config.exists():
        fail(f"mediamtx.yml nicht gefunden: {config}")
        return 1

    # Vorhandene Prozesse stoppen, damit die Kamera frei ist.
    run(["pkill", "-9", "-f", "Extern/mediamtx"], timeout=5)
    run(["pkill", "-9", "-f", "mtxrpicam"], timeout=5)
    time.sleep(2)

    info(f"Starte {mediamtx} mit {config}")
    proc = subprocess.Popen(
        [str(mediamtx), str(config)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    observed = []
    camera_acquired = False
    rtsp_ready = False
    pipeline_in_use = False

    def reader():
        try:
            for line in proc.stdout:
                observed.append(line.rstrip())
        except Exception:
            pass

    import threading
    t = threading.Thread(target=reader, daemon=True)
    t.start()

    check_after = 8
    for i in range(20):
        time.sleep(1)
        recent = observed[-30:]
        for line in recent:
            low = line.lower()
            if "pipeline handler in use by another process" in low:
                pipeline_in_use = True
            if ("rpi camera source" in low and "started" in low) or "camera acquired" in low:
                camera_acquired = True
        if i == check_after and not rtsp_ready:
            ok_rtsp, _ = check_rtsp_stream(stream_name, timeout=8)
            if ok_rtsp:
                rtsp_ready = True
        if pipeline_in_use:
            break

    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
    run(["pkill", "-9", "-f", "mtxrpicam"], timeout=5)

    print()
    info("MediaMTX-Output (letzte 30 Zeilen):")
    for line in observed[-30:]:
        print(color(f"    {line}", Colors.INFO))

    print()
    if pipeline_in_use:
        fail("Kamera-Pipeline war beim Start belegt (anderer Prozess hält sie)")
        return 1
    if rtsp_ready:
        ok(f"RTSP-Stream war nach ~{i+1}s erreichbar")
    else:
        fail("RTSP-Stream war nach 20s nicht erreichbar")
    if camera_acquired or rtsp_ready:
        ok("Kamera konnte von MediaMTX genutzt werden")
    else:
        warn("Kamera-Nutzung konnte nicht eindeutig bestätigt werden")

    return 0 if rtsp_ready else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="LteCar Video-Stack Diagnose")
    parser.add_argument(
        "--start-test",
        action="store_true",
        help="MediaMTX manuell starten und Kamera-Start testen (stoppt danach wieder)",
    )
    parser.add_argument(
        "--stream",
        default=None,
        help="Stream-Name für den Start-Test (Default: erster aktiver RPI-Stream)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Ergebnisse als JSON ausgeben (für die UI-Auswertung)",
    )
    args = parser.parse_args()

    set_json_mode(args.json)

    if not _json_mode:
        print(color("LteCar Video-Stack Diagnose", Colors.BOLD + Colors.INFO))
        print(color(f"Gestartet: {time.strftime('%Y-%m-%d %H:%M:%S')}", Colors.INFO))

    onboard_dir = find_onboard_dir()
    info(f"Onboard-Verzeichnis: {onboard_dir}")

    appsettings = load_appsettings(onboard_dir)
    channel_map = load_channelmap(onboard_dir)
    streams = get_video_streams(channel_map)
    enabled_rpi = get_enabled_rpi_streams(streams)
    server_host = resolve_server_host(appsettings)

    if not streams:
        warn("Keine Video-Streams in der ChannelMap konfiguriert.")
        return 1

    info(f"Gefundene Streams: {', '.join(streams.keys())}")
    if enabled_rpi:
        info(f"Aktive RPI-Kamera-Streams: {', '.join(n for n, _ in enabled_rpi)}")
    else:
        warn("Kein aktiver RPI-Kamera-Stream konfiguriert.")

    # Wir testen den ersten aktiven RPI-Stream
    test_stream_name = args.stream or (enabled_rpi[0][0] if enabled_rpi else next(iter(streams.keys()), None))
    test_stream_cfg = streams.get(test_stream_name, {})
    test_stream_db_id = test_stream_cfg.get("serverId")

    info(f"Prüfe Stream: {test_stream_name}")
    errors: list[str] = []

    print_step(0, "Onboard-Prozess läuft")
    running, procs = check_process("LteCar.Onboard", r"LteCar\.Onboard(\.dll)?$")
    if running:
        ok(f"LteCar.Onboard läuft (PID {procs[0]['pid']})")
        # Hinweis, wenn der laufende Build nicht dem systemd-Release entspricht.
        full_cmd = procs[0]["cmd"]
        if "/bin/Debug/" in full_cmd:
            warn(f"Der laufende Onboard ist ein Debug-Build: {full_cmd}")
            warn("Der systemd-Service verwendet normalerweise bin/Release/net10.0/publish/")
        elif "/publish/" not in full_cmd:
            warn("Der laufende Onboard scheint nicht der veröffentlichte Release-Build zu sein.")
    else:
        fail("LteCar.Onboard läuft NICHT")
        errors.append("Onboard-Prozess fehlt")
        fail("Abbruch: Ohne Onboard kann der Rest nicht funktionieren.")
        print_summary(errors)
        return 1

    # Optional: MediaMTX wirklich starten und Kamera-Start beobachten.
    if args.start_test:
        return start_test_mediamtx(onboard_dir, test_stream_name)

    # Schritt 0.5: Kamera-Konflikte in der Konfiguration
    print_step(0.5, "Kamera-Konflikte in der Konfiguration")
    ok_conf, conflicts = check_camera_conflicts(streams)
    if ok_conf:
        ok("Keine aktivierten RPI-Kamera-Streams teilen sich eine CamID")
    else:
        for c in conflicts:
            fail(c)
        errors.extend(conflicts)

    # Schritt 0.6: Verwaiste Kamera-Prozesse
    print_step(0.6, "Verwaiste Kamera-Prozesse")
    ok_left, leftover = check_leftover_processes()
    if ok_left:
        ok("Keine verwaisten mediamtx/mtxrpicam/ffmpeg-Prozesse gefunden")
    else:
        for line in leftover:
            warn(line)
        errors.append("Verwaiste Kamera-Prozesse gefunden")

    # Schritt 0.7: systemd-Service-Status
    print_step(0.7, "systemd-Service 'ltecar-onboard.service'")
    svc = check_systemd_service()
    if svc.get("failed"):
        fail("ltecar-onboard.service ist im Zustand 'failed'")
        errors.append("systemd-Service ltecar-onboard.service failed")
    elif svc.get("active"):
        ok("ltecar-onboard.service ist aktiv")
    else:
        warn("ltecar-onboard.service ist nicht aktiv")
    if "active_line" in svc:
        info(svc["active_line"])

    # Schritt 0.8: Häufiger Crash-Grund im Onboard-Error-Log
    print_step(0.8, "Onboard-Error-Log auf bekannte Crashes")
    crash_reason = check_onboard_error_log()
    if crash_reason:
        fail(f"Onboard-Error-Log zeigt: {crash_reason}")
        errors.append(f"Onboard-Crash: {crash_reason}")
    else:
        ok("Kein bekannter Crash im Onboard-Error-Log gefunden")

    # Vorab: ist ein Stream aktiv? Wir prüfen Janus-Mountpoint und lokalen MediaMTX.
    # - Beides nicht aktiv -> Stream ist im Ruhezustand (kein Fehler, nur Hinweis).
    # - Mountpoint aktiv, MediaMTX nicht -> echter Fehler (Server erwartet Stream).
    stream_active_on_server = False
    if test_stream_db_id:
        print_step(1, "Ist der Stream auf Server-Seite aktiv?")
        ok_mp, mp_msg = check_janus_mountpoint(server_host, test_stream_db_id)
        if ok_mp:
            ok(mp_msg)
            stream_active_on_server = True
        else:
            info(mp_msg)

    print_step(2, "MediaMTX-Prozess läuft")
    running_mediamtx, procs = check_process("mediamtx", r"Extern/mediamtx")
    if running_mediamtx:
        ok(f"MediaMTX läuft (PID {procs[0]['pid']})")
    else:
        if stream_active_on_server:
            fail("MediaMTX läuft NICHT, aber Server hat einen aktiven Mountpoint")
            errors.append("MediaMTX-Prozess fehlt trotz aktivem Server-Mountpoint")
        else:
            warn("MediaMTX läuft nicht – kein Stream aktiv. Wähle einen Stream im Browser, um MediaMTX zu starten.")

    if not running_mediamtx and not stream_active_on_server:
        print_step(3, f"Lokale Kamera-/RTSP-Checks für '{test_stream_name}'")
        info("Stream nicht aktiv – überspringe Kamera-, RTSP- und ffmpeg-Checks")
    else:
        # Schritt 3: mtxrpicam läuft und hält Kamera
        print_step(3, "Kamera wird von mtxrpicam gehalten")
        running_mtx, procs = check_process("mtxrpicam", r"mtxrpicam$")
        if running_mtx:
            ok(f"mtxrpicam läuft (PID {procs[0]['pid']})")
        else:
            fail("mtxrpicam läuft NICHT")
            errors.append("mtxrpicam fehlt")

        locked, lock_lines = check_camera_locks()
        if locked:
            ok(f"Kamera-Geräte gehalten: {len(lock_lines)} Einträge")
            for line in lock_lines[:3]:
                info(f"    {line.strip()}")
        else:
            fail("Kamera-Geräte /dev/media0 oder /dev/media3 werden nicht gehalten")
            errors.append("Kamera nicht geöffnet")

        # Schritt 4: RTSP-Stream verfügbar
        print_step(4, f"RTSP-Stream '{test_stream_name}' lokal verfügbar")
        ok_rtsp, rtsp_msg = check_rtsp_stream(test_stream_name)
        if ok_rtsp:
            ok(rtsp_msg)
        else:
            fail(rtsp_msg)
            errors.append(f"RTSP-Stream '{test_stream_name}' nicht verfügbar")

        # Schritt 5: ffmpeg sendet RTP
        print_step(5, f"ffmpeg sendet RTP für '{test_stream_name}'")
        ok_ffmpeg, ffmpeg_msg = check_ffmpeg_sending(test_stream_name)
        if ok_ffmpeg:
            ok(f"ffmpeg läuft: {ffmpeg_msg}")
        else:
            fail(ffmpeg_msg)
            errors.append(f"ffmpeg für '{test_stream_name}' fehlt")

    # Schritt 6: Server erreichbar
    print_step(6, f"Server '{server_host}' erreichbar")
    if check_server_reachable(server_host, 443):
        ok(f"Server {server_host}:443 erreichbar")
    else:
        fail(f"Server {server_host}:443 NICHT erreichbar")
        errors.append("Server nicht erreichbar")

    # Schritt 7: Janus öffentlich erreichbar
    print_step(7, "Janus öffentlich erreichbar")
    ok_janus, janus_data = check_janus_info(server_host)
    if ok_janus:
        version = janus_data.get("version_string", "unbekannt")
        ok(f"Janus erreichbar (Version {version})")
    else:
        fail(f"Janus NICHT erreichbar: {janus_data}")
        errors.append("Janus nicht erreichbar")

    if _json_mode:
        report = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "streamName": test_stream_name,
            "checks": _checks,
            "hasErrors": len(errors) > 0,
        }
        print(json.dumps(report, ensure_ascii=False))
        return 1 if errors else 0

    print_summary(errors)
    return 1 if errors else 0


def print_summary(errors: list[str]):
    print()
    print(color("=== Zusammenfassung ===", Colors.BOLD + Colors.INFO))
    if not errors:
        print(color("  ✅ Alle Checks bestanden.", Colors.OK))
    else:
        print(color(f"  ❌ {len(errors)} Problem(e) gefunden:", Colors.FAIL))
        for err in errors:
            print(color(f"     • {err}", Colors.FAIL))
        print()
        print(color("  Nächster Schritt:", Colors.BOLD))
        print(color("  Siehe Docs/VideoStackTroubleshooting.md für die passende Schritt-Nummer.", Colors.INFO))


if __name__ == "__main__":
    sys.exit(main())
