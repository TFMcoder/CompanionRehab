// Public, synthetic audition fixtures. Never substitute participant data in this catalogue.
export const kokoroVoices = [
  { id: 'af_heart', label: 'Heart', accent: 'American English' },
  { id: 'af_bella', label: 'Bella', accent: 'American English' },
  { id: 'bf_emma', label: 'Emma', accent: 'British English' },
] as const;

export const kokoroSamples = [
  { id: 'morning', label: 'Plan the day', text: "Good morning. How are you feeling today? We have a few things to plan, but there is no rush. Would you like to start with breakfast, or look at what is coming up?" },
  { id: 'meals', label: 'Choose a meal', text: "We could make an omelette, or have some soup with toast. Do either of those sound good? If not, tell me what you feel like, and we can find another idea together." },
  { id: 'carryover', label: 'Revisit a task', text: "We left organizing the room for another day. Does that still feel important to you? We could start with one small part, change the plan, or ask someone to help." },
] as const;

export function kokoroSampleUrl(voiceId: typeof kokoroVoices[number]['id'], sampleId: typeof kokoroSamples[number]['id']) {
  return `/preview/kokoro/${voiceId}/${sampleId}.wav`;
}
