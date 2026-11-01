import assert from 'node:assert/strict';
import test from 'node:test';
import { processUploadedAttendance } from './uploaded-attendance.ts';

const punch = { user_pin: '6358', verify_time: '2026-11-01T08:00:00', external_id: 1, verify_type: 1, status: 0 };

test('preserves duplicate movements for audit and aggregates classifications', async () => {
  const result = await processUploadedAttendance([punch, { ...punch, external_id: 2 }], async (offset, rows) => {
    assert.equal(offset, 0);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].verify_time, '2026-11-01T08:00:00.000Z');
    return { inserted: 1, duplicates: 1, unmatched: 0 };
  });
  assert.deepEqual(result, { inserted: 1, duplicates: 1, unmatched: 0 });
});

test('retains blank and unmatched pins in verification input', async () => {
  await processUploadedAttendance([{ ...punch, user_pin: ' ' }, { ...punch, user_pin: 'unknown' }], async (_, rows) => {
    assert.deepEqual(rows.map((row) => row.user_pin), ['', 'unknown']);
    return { inserted: 0, duplicates: 0, unmatched: 2 };
  });
});

test('uses stable file row offsets across batches and retries', async () => {
  const offsets: number[] = [];
  const logs = Array.from({ length: 1001 }, () => punch);
  const run = () => processUploadedAttendance(logs, async (offset, rows) => {
    offsets.push(offset);
    assert.ok(rows.length <= 1000);
    return { inserted: 0, duplicates: rows.length, unmatched: 0 };
  });
  assert.equal((await run()).duplicates, 1001);
  assert.equal((await run()).duplicates, 1001);
  assert.deepEqual(offsets, [0, 1000, 0, 1000]);
});