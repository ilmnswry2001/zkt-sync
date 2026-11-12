"""Local attendance export and offline test-data console; never writes to a terminal."""
import json
import os
import random
from datetime import datetime, timedelta
from pathlib import Path

from zk import ZK


ROOT = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "ZktDeviceConsole"


def connect(ip):
    # A non-zero communication key can be supplied without storing it in the repo.
    return ZK(ip, port=4370, timeout=10, password=int(os.environ.get("ZKT_COMM_KEY", "0")),
              ommit_ping=True).connect()


def export(ip):
    connection = connect(ip)
    try:
        data = {
            "format": "zkt-console-export-v1",
            "restorable_to_device": False,
            "device_ip": ip,
            "serial": connection.get_serialnumber(),
            "model": connection.get_device_name(),
            "firmware": connection.get_firmware_version(),
            "exported_at": datetime.now().isoformat(timespec="seconds"),
            "attendance": [
                {"user_id": str(row.user_id), "uid": row.uid,
                 "timestamp": row.timestamp.isoformat(), "status": row.status,
                 "punch": row.punch}
                for row in connection.get_attendance()
            ],
        }
    finally:
        connection.disconnect()
    ROOT.mkdir(parents=True, exist_ok=True)
    path = ROOT / ("original-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f") + ".json")
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Original attendance export (not a firmware backup): {path}")
    print(f"Records: {len(data['attendance'])}")
    return path


def test_copy(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    pin = input("Employee ID [6761]: ").strip() or "6761"
    month = input("Month YYYY-MM [2026-11]: ").strip() or "2026-11"
    month_date = datetime.strptime(month, "%Y-%m")
    days = sorted(set(int(day.strip()) for day in
                      (input("Days, comma separated [7,8,9]: ").strip() or "7,8,9").split(",")))
    additions = []
    for day in days:
        date = month_date.replace(day=day)
        for hour, minute, event in ((5, 30, "check_in"), (13, 30, "check_out")):
            when = date.replace(hour=hour, minute=minute) + timedelta(minutes=random.randint(-5, 5))
            additions.append({"user_id": pin, "timestamp": when.isoformat(),
                              "event": event, "synthetic": True})
    # Keep test events separate: device-specific status/punch codes are not guessed.
    data["synthetic_test_events"] = additions
    data["source_export"] = str(path)
    target = path.with_name("test-" + path.name)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OFFLINE ONLY. No records sent to device. Test copy: {target}")
    for row in additions:
        print(row["user_id"], row["timestamp"], row["event"], "SYNTHETIC")


def main():
    print("ZKT device console - read-only device access / offline test data")
    print("JSON exports cannot be restored to the terminal by this tool.")
    ip = input("Device IP [192.168.10.33]: ").strip() or "192.168.10.33"
    last_export = None
    while True:
        print("\n1. Device info\n2. Export original attendance\n3. Create offline test copy\n0. Exit")
        choice = input("> ").strip()
        try:
            if choice == "0":
                return
            if choice == "1":
                connection = connect(ip)
                try:
                    print("Model:", connection.get_device_name())
                    print("Serial:", connection.get_serialnumber())
                    print("Firmware:", connection.get_firmware_version())
                    print("Device clock:", connection.get_time())
                finally:
                    connection.disconnect()
            elif choice == "2":
                last_export = export(ip)
            elif choice == "3":
                if last_export is None:
                    print("Export original attendance first (option 2).")
                else:
                    test_copy(last_export)
        except Exception as exc:
            print(f"Operation failed: {exc}")


if __name__ == "__main__":
    main()
