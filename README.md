# Smart Attendance Hub

أنت مهندس برمجيات Senior Full Stack وخبير في أنظمة الحضور والانصراف وأجهزة البصمة ZKTeco.

أريد بناء نظام ويب متكامل لإدارة الحضور والانصراف يعتمد على ملفات النسخ الاحتياطي الصادرة من أجهزة البصمة ZKTeco.

الهدف

إنشاء منصة ويب احترافية تستقبل ملفات النسخ الاحتياطي الخاصة بأجهزة البصمة (backupdata.dat) وتقوم تلقائياً باستخراج البيانات وتحليلها وإنتاج تقارير حضور وانصراف دقيقة للموظفين.

يجب أن يدعم النظام عدة أجهزة بصمة في الوقت نفسه مع دمج السجلات الصادرة من جميع الأجهزة للحصول على سجل موحد لكل موظف.

نوع الملفات

الملفات المرفوعة تكون من نوع:

backupdata.dat

ويحتوي الملف على:

ZK format 1.0.0.0

GZIP Archive

TAR Archive

SQLite Database (ZKDB.db)

الجداول المهمة داخل قاعدة البيانات:

USER_INFO
ATT_LOG
FACE_TEMPLATE_7
fptemplate10

يجب استخراج البيانات من ATT_LOG و USER_INFO.

المتطلبات الأساسية

إدارة الأجهزة

إنشاء صفحة لإدارة أجهزة البصمة تحتوي على:

اسم الجهاز

الرقم التسلسلي

عنوان IP

الموقع

وصف الجهاز

حالة الجهاز

العمليات:

إضافة جهاز

تعديل جهاز

حذف جهاز

تعطيل جهاز

إدارة الموظفين

حقول الموظف:

الرقم الوظيفي

الاسم الكامل

القسم

المنصب

الحالة

العمليات:

إضافة

تعديل

حذف

استيراد من Excel

إدارة الأقسام

إضافة قسم

تعديل قسم

حذف قسم

إدارة الدوامات

لكل دوام:

اسم الدوام

وقت الحضور

وقت الانصراف

دقائق السماح

رفع الملفات

صفحة مخصصة لرفع الملفات.

يجب أن تسمح بما يلي:

اختيار الجهاز

اختيار الملف

رفع الملف

حفظ الملف

التحقق من صحة الملف

استخراج البيانات

عند رفع الملف:

فك ضغط GZIP

استخراج TAR

استخراج SQLite

قراءة ATT_LOG

قراءة USER_INFO

تخزين البيانات في قاعدة النظام

دمج الحضور

إذا استخدم الموظف أكثر من جهاز:

مثال:

08:00 جهاز الإدارة
12:30 جهاز المخزن
16:00 جهاز البوابة

يجب دمج جميع السجلات وإنتاج:

أول دخول = 08:00

آخر خروج = 16:00

ساعات العمل = 8

محرك الحضور والانصراف

إنشاء Attendance Engine يقوم بحساب:

أول دخول

آخر خروج

ساعات العمل

التأخير

الغياب

الخروج المبكر

العمل الإضافي

التقارير

تقارير يومية:

الحاضرون

الغائبون

المتأخرون

تقارير شهرية:

عدد أيام الحضور

عدد أيام الغياب

ساعات العمل

ساعات التأخير

تقارير حسب:

القسم

الجهاز

الموظف

التصدير

دعم:

Excel

PDF

لوحة التحكم Dashboard

تحتوي على:

عدد الموظفين

عدد الحاضرين اليوم

عدد الغائبين

عدد المتأخرين

عدد الأجهزة

مع رسوم بيانية تفاعلية.

نظام الصلاحيات

الأدوار:

Admin

HR

Supervisor

Data Entry

مع صلاحيات منفصلة لكل دور.

قاعدة البيانات

استخدم PostgreSQL.

الجداول الأساسية:

users
roles
permissions
devices
departments
employees
shifts
employee_shifts
uploaded_files
attendance_logs
attendance_daily
attendance_monthly

Backend

استخدم:

Python FastAPI

SQLAlchemy

Alembic

JWT Authentication

Pydantic

OpenPyXL

ReportLab

Frontend

استخدم:

React

TypeScript

Vite

Material UI

React Query

React Router

Axios

بنية المشروع

backend/
frontend/
database/
docker/

مع فصل واضح بين:

Controllers
Services
Repositories
Models

API المطلوبة

Auth API

Devices API

Employees API

Departments API

Shifts API

Files API

Attendance API

Reports API

Dashboard API

مخرجات المشروع المطلوبة

قاعدة بيانات كاملة.

مخطط ERD.

جميع REST APIs.

هيكل Backend كامل.

هيكل Frontend كامل.

Docker Compose.

صفحات React كاملة.

تصميم واجهات احترافية.

نظام قراءة ملفات ZKTeco.

كود جاهز للإنتاج Production Ready.

قم ببناء المشروع وفق أفضل ممارسات البرمجة والـ Clean Architecture وقابل للتوسع مستقبلاً لدعم الاتصال المباشر بأجهزة ZKTeco عبر TCP/IP دون الحاجة لرفع الملفات.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://zkt-sync.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e54d00b3-e0cf-45b6-a006-58eb4d3fd072).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
