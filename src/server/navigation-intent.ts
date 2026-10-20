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
  if (/^(?:ask for help|help|help page)$/.test(target)) return 'ask_for_help';
  if (/^(?:ways to use nancy|nancy faq|faq)$/.test(target)) return 'ways_to_use';
  if (/^(?:suggestions for nancy|nancy suggestions|suggestions)$/.test(target)) return 'suggestions';
  if (/^(?:(?:my|the) )?(?:tasks?|task list|tasks list|tasks? (?:page|screen))$/.test(target)) return 'tasks';
  if (/^(?:(?:my|the) )?(?:meals?|meal choices|meals? (?:page|screen))$/.test(target)) return 'meals';
  if (/^(?:(?:my|the) )?(?:groceries|grocery list|groceries (?:page|screen))$/.test(target)) return 'groceries';
  if (/^(?:(?:my|the) )?(?:activity|activity list|activity history|ledger|tracker|daily ledger)$/.test(target)) return 'activity';
  if (/^(?:(?:my|the) )?(?:requests|task requests|requests? (?:page|screen|inbox))$/.test(target)) return 'requests';
  if (/^(?:(?:my|the) )?(?:day review|unfinished tasks|reminders|repeat choices)$/.test(target)) return 'day_review';
  if (/^(?:(?:my|the|shared) )?(?:routines|programs|rehab program)$/.test(target)) return 'routines';
  if (/^(?:(?:my|the) )?(?:support team|sharing)$/.test(target)) return 'support_team';
  if (/^(?:(?:my|the) )?(?:progress|achievements)$/.test(target)) return 'progress';
  if (/^(?:(?:my|the) )?(?:operations|administrator operations|admin dashboard|access settings)$/.test(target)) return 'operations';
  if (/^(?:(?:my|the) )?(?:outlook|outlook connection|outlook settings)$/.test(target)) return 'outlook';
  if (/^(?:my day|home|(?:the )?home page|my day (?:page|screen))$/.test(target)) return 'my_day';
  return undefined;
}

const fixedReplies: Record<ClientView, string> = {
  ask_for_help:'What would you like a hand with?',
  ways_to_use:'Here are some ways to use Nancy.',
  suggestions:'What would you like to improve about Nancy?',
  my_day: 'Here is My Day.',
  tasks: 'Here are your tasks.',
  meals: 'Here are your meals.',
  groceries: 'Here is your grocery list.',
  activity: 'Here is your activity.',
  requests: 'Here are your requests.',
  day_review: 'Here is your day review.',
  routines: 'Here are your routines.',
  support_team: 'Here is your Support Team.',
  progress: 'Here is your progress.',
  operations: 'Here are your operations and access settings.',
  outlook: 'Here is your Outlook connection.',
};
export function navigationReply(view: ClientView): string { return fixedReplies[view]; }
export const navigationAcknowledgement = navigationReply;
