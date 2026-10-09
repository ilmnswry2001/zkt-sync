#!/usr/bin/env python3
"""Durable ZKTeco LAN agent. Device attendance records are never deleted."""
from __future__ import annotations

import configparser
import hashlib
import hmac
import json
import logging
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from zk import ZK

LOG = logging.getLogger("zkt-agent")
BAGHDAD = ZoneInfo("Asia/Baghdad")

def timestamp(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=BAGHDAD)
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

def main() -> int:
    root = Path(__file__).resolve().parent
    config_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / "agent_config.ini"
    cfg = load_config(config_path)
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
    delay = interval
    LOG.info("Starting ZKTeco sync for serial %s", cfg["serial"])
    while True:
        connection = None
        try:
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
            if rows:
                body = json.dumps({"serial": cfg["serial"].strip(), "logs": [json.loads(r[1]) for r in rows]}, ensure_ascii=False, separators=(",", ":"))
                stamp = str(int(time.time()))
                signature = hmac.new(cfg["device_key"].strip().encode(), f"{stamp}.{body}".encode(), hashlib.sha256).hexdigest()
                response = session.post(cfg["sync_url"].strip(), data=body.encode(), headers={
                    "Content-Type": "application/json", "X-Device-Key": cfg["device_key"].strip(),
                    "X-Timestamp": stamp, "X-Signature": signature,
                }, timeout=30)
                response.raise_for_status()
                ack = response.json()
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
            delay = interval
        except Exception:
            LOG.exception("Sync attempt failed; local queue is retained")
            delay = min(max(interval, delay * 2), 3600)
        finally:
            if connection is not None:
                try:
                    connection.disconnect()
                except Exception:
                    pass
        time.sleep(delay)

if __name__ == "__main__":
    logging.basicConfig(filename=Path(__file__).with_name("agent.log"), level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        LOG.info("Agent stopped")
