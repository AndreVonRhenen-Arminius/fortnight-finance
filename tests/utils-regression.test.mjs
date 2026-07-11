import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, parseDateFlexible, occurrencesBetween } from '../js/utils.js';

test('ASB amount parsing retains Version 3.3.2 Unicode and CR/DR support', () => {
  assert.equal(parseMoney('–$94.00'), -94);
  assert.equal(parseMoney('−$12.50'), -12.5);
  assert.equal(parseMoney('($45.10)'), -45.1);
  assert.equal(parseMoney('$250.00 CR'), 250);
  assert.equal(parseMoney('$250.00 DR'), -250);
});

test('New Zealand date parsing and fortnight recurrence remain compatible', () => {
  assert.equal(parseDateFlexible('11/07/2026'), '2026-07-11');
  const schedule = { frequency: 'fortnightly', nextDate: '2026-07-03', active: true };
  assert.deepEqual(occurrencesBetween(schedule, '2026-07-01', '2026-07-31'), ['2026-07-03', '2026-07-17', '2026-07-31']);
});
