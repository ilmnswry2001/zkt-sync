#!/usr/bin/env python3
"""Generated multi-device ZKTeco agent bundle template."""
from __future__ import annotations

import base64
import configparser
import concurrent.futures
import importlib.util
import json
import logging
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

DEVICES = json.loads(base64.b64decode("__DEVICE_CONFIGS_B64__").decode("utf-8"))
AGENT_SOURCE = base64.b64decode("__AGENT_SOURCE_B64__").decode("utf-8")
PORT = 4370
PROBE_TIMEOUT = 2
RETRY_SECONDS = 30
LOG = logging.getLogger("zkteco-multi-agent")


def data_root() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    return Path(local_app_data) / "ZKTeco Attendance Agent" if local_app_data else Path.home() / ".zkteco-attendance-agent"


def device_folder(device: dict) -> Path:
    return data_root() / str(device["id"])


def prepare_device(device: dict) -> tuple[Path, Path]:
    folder = device_folder(device)
    folder.mkdir(parents=True, exist_ok=True)
    agent_path = data_root() / "agent.py"
    agent_path.parent.mkdir(parents=True, exist_ok=True)
    agent_path.write_text(AGENT_SOURCE, encoding="utf-8")

    config = configparser.ConfigParser()
    config["agent"] = {
        "device_ip": str(device["device_ip"]),
        "device_port": str(device.get("device_port", PORT)),
        "device_password": str(device.get("device_password", 0)),
        "timeout_seconds": "10",
        "serial": str(device["serial"]),
        "sync_url": str(device["sync_url"]),
        "device_key": str(device["device_key"]),
        "interval_seconds": "300",
        "queue_db": str(folder / "agent_queue.sqlite3"),
        "state_file": str(folder / "state.json"),
    }
    config_path = folder / "agent_config.ini"
    with config_path.open("w", encoding="utf-8") as stream:
        config.write(stream)
    return agent_path, config_path


def probe(device: dict) -> bool:
    try:
        with socket.create_connection((str(device["device_ip"]), int(device.get("device_port", PORT))), timeout=PROBE_TIMEOUT):
            return True
    except OSError:
        return False


def ensure_dependencies() -> bool:
    missing = [name for name in ("zk", "requests") if importlib.util.find_spec(name) is None]
    if not missing:
        return True
    LOG.info("Installing required Python packages: %s", ", ".join(missing))
    result = subprocess.run([
        sys.executable, "-m", "pip", "install", "pyzk>=0.9.0", "requests>=2.31.0", "tzdata>=2024.1",
    ], check=False)
    return result.returncode == 0 and all(importlib.util.find_spec(name) is not None for name in ("zk", "requests"))


def main() -> int:
    if not DEVICES:
        LOG.error("No devices are configured in this bundle.")
        return 2
    if not ensure_dependencies():
        LOG.error("Could not install dependencies. Run: python -m pip install pyzk requests tzdata")
        return 2

    stopping = False

    def stop(_signum=None, _frame=None):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, stop)

    LOG.info("Starting agents for %d configured device(s). Unavailable devices will be skipped and retried.", len(DEVICES))
    agent_path = data_root() / "agent.py"
    processes: dict[str, subprocess.Popen] = {}
    next_probe: dict[str, float] = {str(device["id"]): 0 for device in DEVICES}
    last_unavailable_log: dict[str, float] = {}

    try:
        while not stopping:
            now = time.monotonic()
            candidates = [device for device in DEVICES
                          if (str(device["id"]) not in processes or processes[str(device["id"])].poll() is not None)
                          and now >= next_probe[str(device["id"])]]
            with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(16, len(candidates)))) as pool:
                checks = list(pool.map(probe, candidates)) if candidates else []

            for device, available in zip(candidates, checks):
                device_id = str(device["id"])
                old_process = processes.get(device_id)
                if old_process and old_process.poll() is not None:
                    LOG.warning("Agent for %s stopped with exit code %s; retrying.", device["name"], old_process.returncode)
                    processes.pop(device_id, None)
                if not available:
                    if now - last_unavailable_log.get(device_id, 0) >= RETRY_SECONDS:
                        LOG.info("Skipping unavailable device %s (%s); retrying in %s seconds.", device["name"], device["device_ip"], RETRY_SECONDS)
                        last_unavailable_log[device_id] = now
                    next_probe[device_id] = now + RETRY_SECONDS
                    continue
                agent_path, config_path = prepare_device(device)
                processes[device_id] = subprocess.Popen([sys.executable, str(agent_path), str(config_path)], cwd=device_folder(device))
                LOG.info("Connected to %s (%s); agent is running.", device["name"], device["device_ip"])
                next_probe[device_id] = now + RETRY_SECONDS

            time.sleep(5)
    finally:
        LOG.info("Stopping all device agents.")
        active = [process for process in processes.values() if process.poll() is None]
        for process in active:
            process.terminate()
        deadline = time.monotonic() + 10
        for process in active:
            try:
                process.wait(timeout=max(0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                process.kill()
        for process in active:
            if process.poll() is None:
                process.wait()
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    raise SystemExit(main())
