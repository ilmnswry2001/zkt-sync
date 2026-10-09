#!/usr/bin/env python3
"""Continuously sync ZKTeco attendance logs to the ZKT Sync cloud API."""
from __future__ import annotations

import configparser
import hashlib
import json
import logging
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from zk import ZK

LOG = logging.getLogger("zkteco-sync")
BAGHDAD = ZoneInfo("Asia/Baghdad")

def iso_utc(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=BAGHDAD)
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def signature(log: dict) -> str:
    raw = "|".join((log["employee_no"], log["timestamp"], log["punch_type"], log["verify_mode"]))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def read_state(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(value, dict):
            return {
                "last_synced_timestamp": value.get("last_synced_timestamp"),
                "last_synced_signatures": value.get("last_synced_signatures", []),
                "pending_logs": value.get("pending_logs", []),
            }
    except (OSError, json.JSONDecodeError):
        pass
    return {"last_synced_timestamp": None, "last_synced_signatures": [], "pending_logs": []}

def write_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name, dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(state, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def load_config(path: Path) -> configparser.SectionProxy:
    parser = configparser.ConfigParser()
    if not parser.read(path, encoding="utf-8") or "agent" not in parser:
        raise RuntimeError(f"Missing [agent] section in config: {path}")
    config = parser["agent"]
    for field in ("device_ip", "device_sn", "sync_url", "sync_key"):
        if not config.get(field, "").strip():
            raise RuntimeError(f"Missing {field} in {path}")
    return config

def attendance_payload(record, configured_serial: str) -> dict | None:
    employee_no = str(getattr(record, "user_id", "") or "").strip()
    timestamp = getattr(record, "timestamp", None)
    if not employee_no or not isinstance(timestamp, datetime):
        return None
    punch = int(getattr(record, "punch", 0) or 0)
    punch_type = "check_in" if punch == 0 else "check_out"
    mode = str(getattr(record, "verify_mode", "") or "unknown").lower()
    if mode not in {"fingerprint", "face", "card", "pin", "password", "unknown"}:
        mode = "unknown"
    return {
        "employee_no": employee_no,
        "timestamp": iso_utc(timestamp),
        "punch_type": punch_type,
        "verify_mode": mode,
        "status": int(getattr(record, "status", 0) or 0),
    }

def main() -> int:
    script_dir = Path(__file__).resolve().parent
    config_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else script_dir / "agent_config.ini"
    config = load_config(config_path)
    state_path = Path(config.get("state_file", str(script_dir / "sync_state.json"))).expanduser()
    interval = max(15, config.getint("interval_seconds", 60))
    port = config.getint("device_port", 4370)
    password = config.getint("device_password", 0)
    timeout = max(3, config.getint("device_timeout_seconds", 10))
    state = read_state(state_path)
    session = requests.Session()
    session.headers.update({"X-ZKT-SYNC-KEY": config["sync_key"].strip(), "Content-Type": "application/json"})

    LOG.info("ZKTeco sync agent started for device %s", config["device_sn"])
    while True:
        connection = None
        try:
            device = ZK(config["device_ip"].strip(), port=port, timeout=timeout, password=password, force_udp=False, ommit_ping=True)
            connection = device.connect()
            try:
                actual_serial = str(connection.get_serialnumber()).strip()
                if actual_serial and actual_serial != config["device_sn"].strip():
                    raise RuntimeError(f"Configured serial does not match connected device ({actual_serial})")
            except AttributeError:
                pass
            records = connection.get_attendance() or []
            cursor = state.get("last_synced_timestamp") or ""
            known_at_cursor = set(state.get("last_synced_signatures") or [])
            pending = {item["fingerprint"]: item for item in state.get("pending_logs", []) if isinstance(item, dict) and item.get("fingerprint") and item.get("log")}
            for record in records:
                log = attendance_payload(record, config["device_sn"])
                if not log:
                    continue
                fingerprint = signature(log)
                if log["timestamp"] < cursor or (log["timestamp"] == cursor and fingerprint in known_at_cursor):
                    continue
                pending.setdefault(fingerprint, {"fingerprint": fingerprint, "log": log})
            state["pending_logs"] = list(pending.values())
            write_state(state_path, state)

            batch = state["pending_logs"][:5000]
            response = session.post(
                config["sync_url"].strip(),
                json={"device_sn": config["device_sn"].strip(), "site_id": config.get("site_id", "").strip() or None, "logs": [item["log"] for item in batch]},
                timeout=20,
            )
            if response.status_code == 200:
                body = response.json()
                sent_ids = {item["fingerprint"] for item in batch}
                remaining = [item for item in state["pending_logs"] if item["fingerprint"] not in sent_ids]
                if batch:
                    newest = max(item["log"]["timestamp"] for item in batch)
                    state["last_synced_timestamp"] = max(cursor, newest)
                    state["last_synced_signatures"] = [
                        item["fingerprint"] for item in batch if item["log"]["timestamp"] == state["last_synced_timestamp"]
                    ]
                state["pending_logs"] = remaining
                write_state(state_path, state)
                LOG.info("Sync OK: received %s, inserted %s, unmatched %s, queued %s", body.get("received", 0), body.get("inserted", 0), body.get("unmatched", 0), len(remaining))
            else:
                LOG.warning("Cloud sync returned HTTP %s; queued logs are retained", response.status_code)
        except Exception as error:
            LOG.warning("Sync attempt failed; queued logs are retained: %s", error)
        finally:
            if connection is not None:
                try:
                    connection.disconnect()
                except Exception:
                    pass
        time.sleep(interval)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        LOG.info("Agent stopped")
        raise SystemExit(0)