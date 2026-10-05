import { describe, expect, it } from 'vitest';
import { localDateTimeWithOffset } from '../src/shared/local-time';

describe('participant local appointment time', () => {
  it('uses the participant zone rather than the browser zone and includes the correct offset', () => {
    expect(localDateTimeWithOffset('2026-01-05T14:00', 'America/Toronto')).toEqual({ ok: true, value: '2026-01-05T14:00:00-05:00' });
    expect(localDateTimeWithOffset('2026-10-05T14:00', 'America/Toronto')).toEqual({ ok: true, value: '2026-10-05T14:00:00-04:00' });
    expect(localDateTimeWithOffset('2026-10-05T14:00', 'Europe/London')).toEqual({ ok: true, value: '2026-10-05T14:00:00+01:00' });
  });

  it('rejects daylight-saving gaps and repeated times rather than silently choosing one instant', () => {
    expect(localDateTimeWithOffset('2026-03-08T02:30', 'America/Toronto')).toEqual({ ok: false, reason: 'nonexistent' });
    expect(localDateTimeWithOffset('2026-11-01T01:30', 'America/Toronto')).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('rejects invalid dates and zones', () => {
    expect(localDateTimeWithOffset('2026-02-30T10:00', 'America/Toronto')).toEqual({ ok: false, reason: 'invalid' });
    expect(localDateTimeWithOffset('2026-10-05T14:00', 'Not/AZone')).toEqual({ ok: false, reason: 'zone' });
  });
});
