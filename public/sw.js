self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() || "لديك تذكير للحضور" }; }
  event.waitUntil(self.registration.showNotification(payload.title || "تذكير الدوام", {
    body: payload.body || "راجع حالة الحضور والانصراف.",
    icon: "/icons/self-attendance-192.svg",
    data: { url: payload.url || "/self-attendance" },
    tag: payload.tag || "attendance-reminder",
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || "/self-attendance"));
});
