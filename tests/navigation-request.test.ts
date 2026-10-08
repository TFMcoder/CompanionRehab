import { describe, expect, it } from 'vitest';
import { navigationIntent, navigationReply } from '../src/server/navigation-intent';

describe('request navigation', () => {
  it.each(['Open requests', 'Nancy, show me my task requests.', 'Can you open my request inbox?', 'Take me to the requests page'])('routes only a complete view request: %s', text => {
    expect(navigationIntent(text)).toBe('requests');
    expect(navigationReply('requests')).toBe('Here are your requests.');
  });
  it.each(['Open requests and accept the first one', 'Do not open requests', 'Request a task', 'Accept my request', 'What requests do I have?'])('preserves substantive or negated intent: %s', text => {
    expect(navigationIntent(text)).toBeUndefined();
  });
});
