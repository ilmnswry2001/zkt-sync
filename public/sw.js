self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("zkt-face-models-v1").then((cache) => cache.addAll([
    "/models/face/tiny_face_detector_model-weights_manifest.json",
    "/models/face/tiny_face_detector_model.bin",
    "/models/face/face_landmark_68_tiny_model-weights_manifest.json",
    "/models/face/face_landmark_68_tiny_model.bin",
    "/models/face/face_recognition_model-weights_manifest.json",
    "/models/face/face_recognition_model.bin",
  ])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/models/face/")) return;
  event.respondWith(caches.open("zkt-face-models-v1").then(async (cache) => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  }));
});
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
