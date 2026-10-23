#!/usr/bin/env python3
"""Arabic terminal dashboard for the ZKTeco attendance sync agent."""
from __future__ import annotations

import configparser
import csv
import getpass
import ipaddress
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
AGENT = ROOT / "agent.py"
CONFIG = ROOT / "agent_config.ini"
LOG = ROOT / "agent.log"
DEFAULT_DEVICE_IP = "192.168.1.111"


def read_config() -> configparser.SectionProxy | None:
    parser = configparser.ConfigParser()
    if parser.read(CONFIG, encoding="utf-8") and parser.has_section("agent"):
        return parser["agent"]
    return None


def show_header() -> None:
    cfg = read_config()
    print("\n" + "=" * 64)
    print("        وكيل مزامنة الحضور | أجهزة ZKTeco")
    print("=" * 64)
    if cfg:
        destination = urlsplit(cfg.get("sync_url", "")).netloc or "غير محدد"
        print(f"الجهاز: {cfg.get('device_ip', '—')}  |  الرقم التسلسلي: {cfg.get('serial', '—')}")
        print(f"وجهة النظام: {destination}  |  منفذ الجهاز: {cfg.get('device_port', '4370')}")
        queue_path = Path(cfg.get("queue_db", str(ROOT / "agent_queue.sqlite3"))).expanduser()
        pending = 0
        if queue_path.exists():
            try:
                with sqlite3.connect(f"file:{queue_path.as_posix()}?mode=ro", uri=True) as db:
                    pending = db.execute("SELECT COUNT(*) FROM queue").fetchone()[0]
            except sqlite3.Error:
                pending = -1
        print(f"حركات بانتظار الإقرار: {pending if pending >= 0 else 'تعذر قراءة الطابور'}")
    else:
        print("حالة الربط: غير مُعدّ — ابدأ بخيار إعداد الاتصال")
    print("-" * 64)


def pause() -> None:
    try:
        input("\nاضغط Enter للعودة إلى القائمة...")
    except (EOFError, KeyboardInterrupt):
        pass


def run_agent(*args: str) -> int:
    return subprocess.call([sys.executable, str(AGENT), str(CONFIG), *args], cwd=ROOT)


def pull_from_ip() -> None:
    """Connect directly by LAN IP, identify the device, and optionally export its logs."""
    cfg = read_config()
    default_ip = cfg.get("device_ip", DEFAULT_DEVICE_IP) if cfg else DEFAULT_DEVICE_IP
    default_port = cfg.get("device_port", "4370") if cfg else "4370"
    try:
        ip = input(f"عنوان IP للجهاز [{default_ip}]: ").strip() or default_ip
        ipaddress.ip_address(ip)
        port = int(input(f"منفذ الجهاز [{default_port}]: ").strip() or default_port)
        if not 1 <= port <= 65535:
            raise ValueError("رقم المنفذ يجب أن يكون بين 1 و65535")
        password_text = getpass.getpass("كلمة مرور الجهاز الرقمية [0]: ").strip() or "0"
        password = int(password_text)
        if password < 0:
            raise ValueError("كلمة مرور الجهاز يجب أن تكون رقماً غير سالب")
    except (ValueError, EOFError) as error:
        raise ValueError(f"تحقق من بيانات الاتصال: {error}") from error

    from zk import ZK

    connection = None
    try:
        print(f"\nجارٍ الاتصال بـ {ip}:{port} ...")
        device = ZK(
            ip,
            port=port,
            timeout=cfg.getint("timeout_seconds", 10) if cfg else 10,
            password=password,
            force_udp=False,
            ommit_ping=True,
        )
        connection = device.connect()
        records = connection.get_attendance() or []
        times = [
            r.timestamp for r in records
            if isinstance(getattr(r, "timestamp", None), datetime)
        ]
        serial = str(connection.get_serialnumber() or "").strip()
        device_name = str(connection.get_device_name() or "غير متاح")
        print("\nتم التعرف على جهاز البصمة:")
        print(f"اسم الجهاز: {device_name}")
        print(f"الرقم التسلسلي: {serial or 'غير متاح'}")
        print(f"إصدار البرنامج: {connection.get_firmware_version() or 'غير متاح'}")
        print(f"عدد سجلات البصمة على الجهاز: {len(records)}")
        if times:
            print(f"أقدم سجل: {min(times).strftime('%Y-%m-%d %H:%M:%S')}")
            print(f"أحدث سجل: {max(times).strftime('%Y-%m-%d %H:%M:%S')}")
        print("لم تُعرض أرقام البصمات ولم تُعدّل أو تُحذف سجلات الجهاز.")
        if records:
            save = input("حفظ نسخة CSV في مجلد المستندات؟ [نعم/لا، الافتراضي نعم]: ").strip()
            if save not in ("لا", "ل", "n", "no", "N"):
                export_dir = Path.home() / "Documents" / "ZKTecoAttendance"
                export_dir.mkdir(parents=True, exist_ok=True)
                safe_serial = "".join(c for c in serial if c.isalnum() or c in "-_")[:40] or "device"
                stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                export_path = export_dir / f"attendance_{safe_serial}_{stamp}.csv"
                fields = ["رقم الجهاز", "رقم البصمة", "وقت الجهاز", "طريقة التحقق", "الحالة", "المعرف الخارجي"]
                with export_path.open("w", encoding="utf-8-sig", newline="") as stream:
                    writer = csv.DictWriter(stream, fieldnames=fields)
                    writer.writeheader()
                    for record in records:
                        when = getattr(record, "timestamp", None)
                        writer.writerow({
                            "رقم الجهاز": serial,
                            "رقم البصمة": str(getattr(record, "user_id", "") or ""),
                            "وقت الجهاز": when.isoformat(sep=" ") if isinstance(when, datetime) else "",
                            "طريقة التحقق": getattr(record, "verify_mode", ""),
                            "الحالة": getattr(record, "status", ""),
                            "المعرف الخارجي": getattr(record, "uid", ""),
                        })
                print(f"\nتم حفظ {len(records)} سجلاً محلياً في:\n{export_path}")
        else:
            print("لا توجد سجلات حضور لحفظها.")
    finally:
        if connection is not None:
            connection.disconnect()


def confirm_upload() -> bool:
    cfg = read_config()
    destination = urlsplit(cfg.get("sync_url", "")).netloc if cfg else "النظام"
    print("\nسيقرأ الوكيل سجلات الجهاز ويرفع الحركات الجديدة إلى:")
    print(f"  {destination}")
    print("لن يحذف الوكيل سجلات البصمة من الجهاز.")
    try:
        return input("للمتابعة اكتب نعم: ").strip() == "نعم"
    except (EOFError, KeyboardInterrupt):
        return False


def show_recent_logs() -> None:
    if not LOG.exists():
        print("لا يوجد سجل تشغيل بعد.")
        return
    lines = LOG.read_text(encoding="utf-8", errors="replace").splitlines()
    print("\nآخر رسائل الوكيل:")
    print("\n".join(lines[-15:]) if lines else "لا توجد رسائل.")


def main() -> int:
    while True:
        show_header()
        print("1) الاتصال بعنوان IP والتعرف على الجهاز وسحب الحضور")
        print("2) إعداد الربط السحابي مع النظام")
        print("3) اختبار اتصال الجهاز والخادم")
        print("4) مزامنة واحدة الآن")
        print("5) تشغيل المزامنة المستمرة")
        print("6) عرض سجل التشغيل الأخير")
        print("0) خروج")
        try:
            choice = input("\nاختر رقماً ثم اضغط Enter: ").strip()
            if choice == "0":
                return 0
            if choice == "1":
                pull_from_ip()
            elif choice == "2":
                result = run_agent("--setup")
                if result:
                    print(f"فشل الإعداد (رمز الخروج {result}).")
            elif choice == "3":
                result = run_agent("--check")
                if result:
                    print(f"تعذر إكمال الاختبار (رمز الخروج {result}). راجع سجل التشغيل.")
            elif choice == "4":
                if confirm_upload():
                    result = run_agent("--once")
                    if result:
                        print(f"لم تكتمل المزامنة (رمز الخروج {result}). بقيت الحركات في الطابور المحلي.")
                else:
                    print("أُلغيت المزامنة؛ لم تُرسل بيانات.")
            elif choice == "5":
                if confirm_upload():
                    print("بدأت المزامنة المستمرة. اضغط Ctrl+C لإيقافها والعودة للقائمة.")
                    try:
                        run_agent()
                    except KeyboardInterrupt:
                        print("\nتم إيقاف الوكيل. سجلات الجهاز باقية كما هي.")
                else:
                    print("أُلغي التشغيل؛ لم تُرسل بيانات.")
            elif choice == "6":
                show_recent_logs()
            else:
                print("اختيار غير صحيح؛ اختر رقماً من القائمة.")
        except KeyboardInterrupt:
            print("\nتم إلغاء العملية الحالية.")
        except Exception as error:
            print(f"\nتعذر تنفيذ العملية: {error}")
        pause()


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
