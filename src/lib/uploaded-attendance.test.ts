import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePunchTime, processUploadedAttendance, resolveUploadPunchTimeZone } from './uploaded-attendance.ts';

const punch = { user_pin: '6358', verify_time: '2026-11-01T08:00:00', external_id: 1, verify_type: 1, status: 0 };

test('preserves duplicate movements for audit and aggregates classifications', async () => {
  const result = await processUploadedAttendance([punch, { ...punch, external_id: 2 }], async (offset, rows) => {
    assert.equal(offset, 0);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].verify_time, '2026-11-01T08:00:00+03:00');
    return { inserted: 1, duplicates: 1, unmatched: 0 };
  });
  assert.deepEqual(result, { inserted: 1, duplicates: 1, unmatched: 0 });
});

test('uses Baghdad wall time by default and honors raw UTC when selected', async () => {
  const raw = '2026-11-04 07:15:00';
  const baghdad = parsePunchTime(raw);
  assert.equal(baghdad, '2026-11-04T07:15:00+03:00');
  assert.equal(new Date(baghdad).toISOString(), '2026-11-04T04:15:00.000Z');
  await processUploadedAttendance([{ ...punch, verify_time: raw }], async (_, rows) => {
    assert.equal(rows[0].verify_time, '2026-11-04T07:15:00Z');
    return { inserted: 1, duplicates: 0, unmatched: 0 };
  }, 'UTC');
});

test('preserves explicit offsets and rejects invalid timestamps', () => {
  for (const value of ['2026-11-04T07:15:00Z', '2026-11-04T07:15:00+03:00']) {
    assert.equal(parsePunchTime(value, 'UTC'), value);
    assert.equal(parsePunchTime(value, 'Asia/Baghdad'), value);
  }
  assert.throws(() => parsePunchTime('invalid'));
});

test('keeps legacy interrupted uploads on UTC while fresh uploads default to Baghdad', () => {
  assert.equal(resolveUploadPunchTimeZone(null, 'pending'), 'Asia/Baghdad');
  assert.equal(resolveUploadPunchTimeZone(null, 'failed'), 'UTC');
  assert.equal(resolveUploadPunchTimeZone('Asia/Baghdad', 'failed'), 'Asia/Baghdad');
  assert.equal(resolveUploadPunchTimeZone('UTC', 'pending'), 'UTC');
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
