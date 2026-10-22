export type QueuedSelfAttendance = {
  id: string;
  eventType: "check_in" | "check_out";
  latitude: number;
  longitude: number;
  accuracy: number;
  clientRecordedAt: string;
  selfie: Blob;
  faceScore: number;
  livenessVerified: boolean;
};

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("attendance-offline", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("queue", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function enqueueSelfAttendance(value: QueuedSelfAttendance) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("queue", "readwrite"); tx.objectStore("queue").put(value);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  db.close();
}
export async function readSelfAttendanceQueue() {
  const db = await database();
  const values = await new Promise<QueuedSelfAttendance[]>((resolve, reject) => {
    const request = db.transaction("queue").objectStore("queue").getAll();
    request.onsuccess = () => resolve(request.result as QueuedSelfAttendance[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return values.sort((a, b) => a.clientRecordedAt.localeCompare(b.clientRecordedAt));
}
export async function removeQueuedSelfAttendance(id: string) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("queue", "readwrite"); tx.objectStore("queue").delete(id);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  db.close();
}
