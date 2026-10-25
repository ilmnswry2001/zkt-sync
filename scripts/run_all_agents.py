#!/usr/bin/env python3
"""Run one isolated ZKTeco agent for every configured device folder."""
from __future__ import annotations

import logging
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
AGENT = ROOT / "agent.py"
CONFIG_NAME = "agent_config.ini"
POLL_SECONDS = 5
RESTART_DELAY_SECONDS = 10

LOG = logging.getLogger("zkt-multi-agent")


def configured_devices() -> list[tuple[Path, Path]]:
    devices_dir = ROOT / "agents"
    return sorted(
        ((config.parent, config) for config in devices_dir.glob(f"*/{CONFIG_NAME}") if config.is_file()),
        key=lambda item: item[0].name.casefold(),
    )


def main() -> int:
    devices = configured_devices()
    if not devices:
        LOG.error("No device configs found. Add each downloaded config as scripts/agents/<device>/agent_config.ini")
        return 2

    processes: dict[Path, subprocess.Popen] = {}
    stopping = False

    def stop(_signum=None, _frame=None):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, stop)

    LOG.info("Starting %d configured device agent(s)", len(devices))
    for folder, config in devices:
        LOG.info("Starting %s", folder.name)
        processes[folder] = subprocess.Popen(
            [sys.executable, str(AGENT), str(config)],
            cwd=folder,
        )

    try:
        while not stopping:
            for folder, config in devices:
                process = processes[folder]
                if process.poll() is None:
                    continue
                if stopping:
                    break
                LOG.warning("Agent %s exited with code %s; restarting in %ss", folder.name, process.returncode, RESTART_DELAY_SECONDS)
                for _ in range(RESTART_DELAY_SECONDS):
                    if stopping:
                        break
                    time.sleep(1)
                if not stopping:
                    processes[folder] = subprocess.Popen(
                        [sys.executable, str(AGENT), str(config)],
                        cwd=folder,
                    )
            time.sleep(POLL_SECONDS)
    finally:
        LOG.info("Stopping device agents")
        for process in processes.values():
            if process.poll() is None:
                process.terminate()
        deadline = time.monotonic() + 10
        for process in processes.values():
            if process.poll() is None:
                try:
                    process.wait(timeout=max(0, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    process.kill()
        for process in processes.values():
            if process.poll() is None:
                process.wait()
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    raise SystemExit(main())
