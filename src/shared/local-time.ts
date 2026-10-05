export type ZonedDateTimeResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'invalid' | 'nonexistent' | 'ambiguous' | 'zone' };

// Convert a wall-clock value from <input type="datetime-local"> using the
// participant's zone. The browser's own zone is never used for this conversion.
export function localDateTimeWithOffset(local: string, timeZone: string): ZonedDateTimeResult {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return { ok: false, reason: 'invalid' };
  const wallEpoch = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(wallEpoch) || new Date(wallEpoch).toISOString().slice(0, 16) !== local) return { ok: false, reason: 'invalid' };

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  } catch { return { ok: false, reason: 'zone' }; }

  const fieldsAt = (epoch: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(epoch).map(part => [part.type, part.value]));
    return {
      year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
      hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    };
  };
  const offsetAt = (epoch: number) => {
    const fields = fieldsAt(epoch);
    return Math.round((Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second) - epoch) / 60_000);
  };

  // Sample both sides of nearby offset changes. All valid offsets are tested
  // against the exact wall time, so gaps produce zero matches and folds two.
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours++) offsets.add(offsetAt(wallEpoch + hours * 3_600_000));
  const matches: number[] = [];
  for (const offset of offsets) {
    const candidate = wallEpoch - offset * 60_000;
    const fields = fieldsAt(candidate);
    const actual = `${String(fields.year).padStart(4, '0')}-${String(fields.month).padStart(2, '0')}-${String(fields.day).padStart(2, '0')}T${String(fields.hour).padStart(2, '0')}:${String(fields.minute).padStart(2, '0')}`;
    if (actual === local && fields.second === 0) matches.push(offset);
  }
  if (matches.length === 0) return { ok: false, reason: 'nonexistent' };
  if (matches.length > 1) return { ok: false, reason: 'ambiguous' };
  const offset = matches[0];
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  return { ok: true, value: `${local}:00${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}` };
}
