#!/usr/bin/env python3
"""Durable ZKTeco LAN agent. Device attendance records are never deleted."""
from __future__ import annotations

import configparser
import argparse
import getpass
import hashlib
import hmac
import json
import logging
import sqlite3
import sys
import time
from urllib.parse import urlsplit
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

LOG = logging.getLogger("zkt-agent")

def timestamp(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=ZoneInfo("Asia/Baghdad"))
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def record_payload(record) -> dict | None:
    pin = str(getattr(record, "user_id", "") or "").strip()
    when = getattr(record, "timestamp", None)
    if not pin or not isinstance(when, datetime):
        return None
    return {
        "user_pin": pin,
        "verify_time": timestamp(when),
        "verify_type": int(getattr(record, "verify_mode", 0) or 0),
        "status": int(getattr(record, "status", 0) or 0),
        "external_id": getattr(record, "uid", None),
    }

def load_config(path: Path):
    parser = configparser.ConfigParser()
    if not parser.read(path, encoding="utf-8") or "agent" not in parser:
        raise RuntimeError(f"Missing [agent] in {path}")
    cfg = parser["agent"]
    for name in ("device_ip", "serial", "sync_url", "device_key"):
        if not cfg.get(name, "").strip():
            raise RuntimeError(f"Missing {name} in {path}")
    return cfg

def prompt(label: str, current: str = "") -> str:
    suffix = f" [{current}]" if current else ""
    value = input(f"{label}{suffix}: ").strip()
    return value or current

def setup_config(path: Path) -> None:
    print("\nZKTeco Attendance Sync Agent Setup")
    print("Run this program on a computer that can reach the device over the local network.\n")
    host = prompt("Device IP address", "192.168.1.111")
    port = prompt("Device port", "4370")
    serial = prompt("Device serial number registered in the system")
    base_url = prompt("Published system base URL (for example https://example.com)").rstrip("/")
    device_key = getpass.getpass("Device sync key generated on the system Devices page: ").strip()
    password = prompt("Numeric device password (enter 0 if none)", "0")
    interval = prompt("Sync interval in seconds", "300")
    parsed_url = urlsplit(base_url)
    if parsed_url.scheme != "https" or not parsed_url.netloc:
        raise ValueError("Enter a valid system URL starting with https://")
    if not serial or not device_key:
        raise ValueError("The device serial number and sync key are required")
    try:
        port_number, password_number, interval_number = int(port), int(password), int(interval)
    except ValueError as error:
        raise ValueError("Port, device password, and sync interval must be numbers") from error
    if not 1 <= port_number <= 65535 or password_number < 0 or interval_number < 30:
        raise ValueError("Check the port and password; the minimum sync interval is 30 seconds")

    parser = configparser.ConfigParser()
    parser["agent"] = {
        "device_ip": host,
        "device_port": str(port_number),
        "device_password": str(password_number),
        "timeout_seconds": "10",
        "serial": serial,
        "sync_url": f"{base_url}/api/public/zk-sync",
        "device_key": device_key,
        "interval_seconds": str(interval_number),
        "queue_db": str(path.parent / "agent_queue.sqlite3"),
        "state_file": str(path.parent / "state.json"),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as stream:
        parser.write(stream)
    try:
        path.chmod(0o600)
    except OSError:
        pass
    print(f"\nSettings saved to: {path}")
    print("Keep this file private; it contains the device sync key.\n")

def check_connections(cfg) -> None:
    import requests
    from zk import ZK

    connection = None
    try:
        print(f"اختبار جهاز البصمة {cfg['device_ip']}:{cfg.getint('device_port', 4370)} ...")
        device = ZK(cfg["device_ip"].strip(), port=cfg.getint("device_port", 4370),
                    timeout=cfg.getint("timeout_seconds", 10), password=cfg.getint("device_password", 0),
                    force_udp=False, ommit_ping=True)
        connection = device.connect()
        actual_serial = str(connection.get_serialnumber() or "").strip()
        if actual_serial and actual_serial != cfg["serial"].strip():
            raise RuntimeError(f"الرقم التسلسلي لا يطابق الإعداد: {actual_serial}")
        print(f"نجح الاتصال بالجهاز{f' ({actual_serial})' if actual_serial else ''}.")
    finally:
        if connection is not None:
            connection.disconnect()

    print("اختبار الوصول إلى خادم النظام ...")
    response = requests.get(cfg["sync_url"].strip(), timeout=15)
    if response.status_code not in (404, 405):
        response.raise_for_status()
    print("الخادم متاح عبر HTTPS. سيجري التحقق من المفتاح عند أول رفع فعلي.")

def signed_post(session, url: str, cfg, payload: dict):
    import requests

    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    stamp = str(int(time.time()))
    signature = hmac.new(cfg["device_key"].strip().encode(), f"{stamp}.{body}".encode(), hashlib.sha256).hexdigest()
    response = session.post(url, data=body.encode(), headers={
        "Content-Type": "application/json", "X-Device-Key": cfg["device_key"].strip(),
        "X-Timestamp": stamp, "X-Signature": signature,
    }, timeout=30)
    response.raise_for_status()
    return response.json()

def log_http_failure(error: Exception) -> None:
    response = getattr(error, "response", None)
    if response is not None:
        detail = (response.text or "").strip().replace("\n", " ")[:500]
        LOG.error("Cloud request returned HTTP %s: %s", response.status_code, detail or "No response details")
    LOG.exception("Sync attempt failed; local queue is retained")

def main() -> int:
    root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="وكيل ربط جهاز ZKTeco بنظام الحضور السحابي")
    parser.add_argument("config", nargs="?", type=Path, default=root / "agent_config.ini", help="مسار ملف الإعدادات")
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--setup", action="store_true", help="فتح معالج إعداد الجهاز والخادم")
    actions.add_argument("--check", action="store_true", help="اختبار الاتصال بالجهاز وخادم النظام")
    actions.add_argument("--once", action="store_true", help="تنفيذ مزامنة واحدة ثم الإنهاء")
    args = parser.parse_args()
    config_path = args.config.resolve()
    if args.setup:
        setup_config(config_path)
        return 0
    cfg = load_config(config_path)
    if args.check:
        check_connections(cfg)
        return 0
    import requests
    from zk import ZK

    interval = max(30, cfg.getint("interval_seconds", 300))
    db_path = Path(cfg.get("queue_db", str(root / "agent_queue.sqlite3"))).expanduser()
    state_path = Path(cfg.get("state_file", str(root / "state.json"))).expanduser()
    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {"cursor": "", "cursor_signatures": []}
    state.setdefault("cursor_signatures", [])
    state_path.parent.mkdir(parents=True, exist_ok=True)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(db_path)
    db.execute("CREATE TABLE IF NOT EXISTS queue (fingerprint TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL)")
    db.commit()
    session = requests.Session()
    next_sync_at = 0.0
    command_url = cfg["sync_url"].strip().rsplit("/zk-sync", 1)[0] + "/zk-sync-command"
    LOG.info("Starting ZKTeco sync for serial %s", cfg["serial"])
    while True:
        connection = None
        sync_ok = False
        command = None
        try:
            if not args.once:
                poll_result = signed_post(session, command_url, cfg, {"action": "poll", "serial": cfg["serial"].strip()})
                command = poll_result.get("command")
            if not command and time.monotonic() < next_sync_at:
                time.sleep(min(10, max(1, next_sync_at - time.monotonic())))
                continue

            zkt = ZK(cfg["device_ip"].strip(), port=cfg.getint("device_port", 4370),
                     timeout=cfg.getint("timeout_seconds", 10), password=cfg.getint("device_password", 0),
                     force_udp=False, ommit_ping=True)
            connection = zkt.connect()
            actual_serial = str(connection.get_serialnumber() or "").strip()
            if actual_serial and actual_serial != cfg["serial"].strip():
                raise RuntimeError(f"Serial mismatch: expected {cfg['serial']}, found {actual_serial}")
            for record in connection.get_attendance() or []:
                item = record_payload(record)
                if not item:
                    continue
                canonical = json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
                cursor = state.get("cursor", "")
                if item["verify_time"] < cursor or (item["verify_time"] == cursor and fingerprint in state["cursor_signatures"]):
                    continue
                db.execute("INSERT OR IGNORE INTO queue VALUES (?, ?, ?)", (fingerprint, canonical, datetime.now(timezone.utc).isoformat()))
            db.commit()
            rows = db.execute("SELECT fingerprint, payload FROM queue ORDER BY created_at LIMIT 5000").fetchall()
            ack = {"inserted": 0, "duplicates": 0, "unmatched": 0}
            if rows:
                ack = signed_post(session, cfg["sync_url"].strip(), cfg, {"serial": cfg["serial"].strip(), "logs": [json.loads(r[1]) for r in rows]})
                if not all(k in ack for k in ("inserted", "duplicates", "unmatched")):
                    raise RuntimeError("Cloud acknowledgement is incomplete")
                newest = max(json.loads(r[1])["verify_time"] for r in rows)
                if newest >= state.get("cursor", ""):
                    state["cursor"] = newest
                    state["cursor_signatures"] = [r[0] for r in rows if json.loads(r[1])["verify_time"] == newest]
                tmp = state_path.with_suffix(state_path.suffix + ".tmp")
                tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
                tmp.replace(state_path)
                db.executemany("DELETE FROM queue WHERE fingerprint = ?", [(r[0],) for r in rows])
                db.commit()
                LOG.info("Sync acknowledged: %s inserted, %s duplicate, %s unmatched; queue=%s",
                         ack["inserted"], ack["duplicates"], ack["unmatched"], db.execute("SELECT count(*) FROM queue").fetchone()[0])
            else:
                LOG.info("No new attendance records; device and cloud connection are healthy")
            if command:
                signed_post(session, command_url, cfg, {
                    "action": "complete", "serial": cfg["serial"].strip(), "command_id": command["id"],
                    "status": "succeeded", "result": {k: ack[k] for k in ("inserted", "duplicates", "unmatched")},
                })
            sync_ok = True
            next_sync_at = time.monotonic() + interval
        except Exception as error:
            log_http_failure(error)
            if command:
                try:
                    signed_post(session, command_url, cfg, {
                        "action": "complete", "serial": cfg["serial"].strip(), "command_id": command["id"],
                        "status": "failed", "error": str(error)[:300],
                    })
                except Exception as completion_error:
                    log_http_failure(completion_error)
            next_sync_at = time.monotonic() + min(interval, 60)
        finally:
            if connection is not None:
                try:
                    connection.disconnect()
                except Exception:
                    pass
        if args.once:
            return 0 if sync_ok else 1
        time.sleep(1)

if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    log_file = logging.FileHandler(Path(__file__).with_name("agent.log"), encoding="utf-8")
    logging.basicConfig(level=logging.INFO, handlers=[log_file, logging.StreamHandler(sys.stdout)],
                        format="%(asctime)s %(levelname)s %(message)s")
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        LOG.info("Agent stopped")
    except Exception as error:
        LOG.exception("Agent failed")
        print(f"تعذر تشغيل الوكيل: {error}", file=sys.stderr)
        raise SystemExit(1)
