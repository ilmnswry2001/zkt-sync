# تشغيل وكيل ZKTeco كخدمة

ثبّت Python 3.10 أو أحدث ثم `python -m pip install -r requirements.txt`. احفظ `agent.py` و`agent_config.ini` في مجلد محمي؛ يحتوي الإعداد على مفتاح الجهاز.

## Windows

أنشئ مهمة في Task Scheduler عند بدء التشغيل، واختر `python.exe` كبرنامج و`agent.py` كوسيط، وحدد مجلد السكريبت كـ Start in. فعّل إعادة التشغيل بعد الفشل. يمكن استخدام NSSM بالطريقة نفسها.

## Linux

أنشئ `/etc/systemd/system/zkteco-agent.service`:

```ini
[Unit]
Description=ZKTeco attendance sync agent
After=network-online.target

[Service]
WorkingDirectory=/opt/zkteco-agent
ExecStart=/usr/bin/python3 /opt/zkteco-agent/agent.py /opt/zkteco-agent/agent_config.ini
Restart=always
RestartSec=30
User=zkteco

[Install]
WantedBy=multi-user.target
```

ثم نفّذ `sudo systemctl enable --now zkteco-agent`. الوكيل يقرأ سجلات الجهاز فقط ولا يحذفها.

## إعداد تذكيرات الحضور عبر Web Push

أنشئ مفاتيح VAPID مرة واحدة باستخدام `npx web-push generate-vapid-keys`. خزّن `VAPID_PUBLIC_KEY` و`VAPID_PRIVATE_KEY` و`VAPID_SUBJECT` (مثل `mailto:admin@example.com`) كأسرار في بيئة استضافة التطبيق، وأنشئ قيمة عشوائية طويلة لـ `ATTENDANCE_CRON_SECRET`. لا تضع المفتاح الخاص في ملفات المشروع. بعد ذلك جدْول طلب `POST /api/public/attendance-reminders` كل خمس دقائق مع رأس `X-Cron-Secret` بالقيمة نفسها. يحتاج الموظف إلى اختيار «تفعيل التذكيرات» مرة واحدة على جهازه.
