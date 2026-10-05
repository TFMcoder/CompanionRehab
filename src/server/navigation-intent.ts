import type { ClientView } from '../shared/contracts.js';

// Only a complete request to open one known view qualifies for local routing.
// Questions about the contents of a view and compound instructions go to Nancy.
export function navigationIntent(input: string): ClientView | undefined {
  let words = input.toLowerCase().replace(/[’‘]/g, "'").trim().replace(/\s+/g, ' ');
  words = words.replace(/^[,.!?\s]+|[,.!?\s]+$/g, '').trim();
  words = words.replace(/^please[,\s]+/, '');
  words = words.replace(/^(?:(?:hey|hi|okay|ok)\s+)?nancy[,\s]+/, '');
  words = words.replace(/^please[,\s]+/, '').replace(/[,\s]+please$/, '').trim();

  const verb = '(?:show(?: me)?|open|go to|take me to|bring up|pull up|switch to|navigate to|display|view|let me see)';
  const politeVerb = '(?:show(?: me)?|open|go to|take me to|bring up|pull up|switch to|navigate to|display|view)';
  const patterns = [
    new RegExp(`^${verb} (.+)$`),
    new RegExp(`^(?:can|could|would|will) you (?:please )?${politeVerb} (.+)$`),
    /^(?:can|could) we (?:please )?(?:look at|open|go to|view) (.+)$/,
    /^(?:i'd like to|i would like to|i want to|i'd love to) (?:see|open|view|look at) (.+)$/,
    /^let's (?:look at|open|go to|view) (.+)$/,
  ];
  const target = patterns.map(pattern => words.match(pattern)?.[1]).find(Boolean);
  if (!target) return undefined;
  if (/^(?:(?:my|the) )?(?:tasks?|task list|tasks list|tasks? (?:page|screen))$/.test(target)) return 'tasks';
  if (/^(?:(?:my|the) )?(?:meals?|meal choices|meals? (?:page|screen))$/.test(target)) return 'meals';
  if (/^(?:(?:my|the) )?(?:groceries|grocery list|groceries (?:page|screen))$/.test(target)) return 'groceries';
  if (/^(?:my day|home|(?:the )?home page|my day (?:page|screen))$/.test(target)) return 'my_day';
  return undefined;
}

const fixedReplies: Record<ClientView, string> = {
  my_day: 'Here is My Day.',
  tasks: 'Here are your tasks.',
  meals: 'Here are your meals.',
  groceries: 'Here is your grocery list.',
};
export function navigationReply(view: ClientView): string { return fixedReplies[view]; }
export const navigationAcknowledgement = navigationReply;
