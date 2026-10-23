/** Match the existing bounded conversation loop and preparation limits, rather
 * than assuming every factual-sounding question takes zero model calls. */
export function conversationRequestReservation(turns: number, modelRounds = 5, preparationAttempts = 6, connectionWarmups = 1): number {
  if (![turns, modelRounds, preparationAttempts, connectionWarmups].every(value => Number.isSafeInteger(value) && value >= 0)
    || turns > 60 || modelRounds > 5 || preparationAttempts > 6 || connectionWarmups > 1) throw new Error('Unbounded synthetic test reservation.');
  return turns * modelRounds + preparationAttempts + connectionWarmups;
}
export interface ProviderRequestAccounting { known_attempts: number; unknown_events: number; attempted: number | null }
/** Count inference stages once. Final turn summaries are not extra calls;
 * missing observations remain unknown and cannot be silently counted as zero. */
export function providerRequestAccounting(events: readonly { measurements: Record<string, unknown> }[]): ProviderRequestAccounting {
  let known = 0, unknown = 0;
  for (const { measurements: metric } of events) {
    const count = metric.stage === 'model' ? 1
      : metric.stage === 'connection_preparation' ? metric.connection_warmup_requests
      : ['conversation_preparation','meal_preparation'].includes(String(metric.stage)) ? metric.model_calls : 0;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) unknown++;
    else known += count;
  }
  return { known_attempts: known, unknown_events: unknown, attempted: unknown ? null : known };
}
