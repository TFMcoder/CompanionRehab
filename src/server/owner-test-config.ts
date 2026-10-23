import {resolve} from 'node:path';
import {z} from 'zod';
import {reasoningCandidates} from './chatgpt-plan/inference.js';

export const ownerTestDirectory=resolve('.local/owner-test');
export const ownerTestSchema=z.object({
 schema_version:z.literal(1),database_name:z.literal('nancy_owner_test'),database_role:z.literal('nancy_owner_test'),
 database_url:z.string(),origin:z.url(),port:z.literal(8788),owner_actor_id:z.uuid(),participant_id:z.uuid(),
 excluded_live_participant_id:z.uuid(),session_key:z.string(),email:z.literal('tester@nancy.local'),
}).strict().superRefine((value,ctx)=>{
 let url:URL|undefined;try{url=new URL(value.database_url);}catch{}
 if(!url||!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='55432'||url.pathname!=='/nancy_owner_test'||decodeURIComponent(url.username)!==value.database_role||url.search||url.hash)
  ctx.addIssue({code:'custom',message:'Test database must use its dedicated loopback database and restricted role.'});
 let origin:URL|undefined;try{origin=new URL(value.origin);}catch{}
 if(!origin||origin.protocol!=='https:'||origin.port!=='10000'||origin.origin!==value.origin||origin.username||origin.password)
  ctx.addIssue({code:'custom',message:'Use a separate HTTPS test origin on port 10000.'});
 if(value.participant_id===value.excluded_live_participant_id||value.participant_id===value.owner_actor_id)
  ctx.addIssue({code:'custom',message:'The synthetic test profile must be distinct from live identities.'});
 if(Buffer.from(value.session_key,'base64').length!==32||Buffer.from(value.session_key,'base64').toString('base64')!==value.session_key)
  ctx.addIssue({code:'custom',message:'Test sessions require an independent 32-byte key.'});
});
export type OwnerTestSettings=z.infer<typeof ownerTestSchema>;

const reasoningSelection=z.object({schema_version:z.literal(1),owner_actor_id:z.uuid(),participant_id:z.uuid(),origin:z.url(),
 profile:z.enum(['sol-high','sol-low','sol-none','luna-low','sol61-low']),context_mode:z.literal('prepared-v1').optional(),speech_mode:z.literal('heart-latency-v1').optional(),read_mode:z.literal('quick-v1').optional(),reply_mode:z.literal('spoken-v1').optional(),meal_mode:z.literal('ahead-v1').optional(),continuation_mode:z.literal('dialogue-v1').optional(),chat_mode:z.literal('ahead-v1').optional(),reference_mode:z.literal('verified-v1').optional(),connection_mode:z.enum(['warm-v1','warm-v2','warm-v3']).optional()}).strict().superRefine((value,ctx)=>{
 if(value.speech_mode&&(value.profile!=='sol-low'||value.context_mode!=='prepared-v1'))ctx.addIssue({code:'custom',message:'Speech trial requires the existing prepared Sol-low owner copy.'});
 if(value.read_mode&&(!value.speech_mode||value.profile!=='sol-low'||value.context_mode!=='prepared-v1'))ctx.addIssue({code:'custom',message:'Quick reads require the existing prepared Sol-low/Heart owner trial.'});
 if(value.reply_mode&&value.read_mode!=='quick-v1')ctx.addIssue({code:'custom',message:'Spoken replies require the existing prepared Sol-low/Heart/quick-read owner trial.'});
 if(value.meal_mode&&value.reply_mode!=='spoken-v1')ctx.addIssue({code:'custom',message:'Ahead-of-conversation meals require the existing spoken owner trial.'});
 if(value.continuation_mode&&value.meal_mode!=='ahead-v1')ctx.addIssue({code:'custom',message:'Dialogue continuation requires the exact existing prepared-meal owner trial.'});
 if(value.chat_mode&&value.continuation_mode!=='dialogue-v1')ctx.addIssue({code:'custom',message:'Conversation preparation requires the exact existing dialogue owner trial.'});
 if(value.connection_mode&&value.reference_mode!=='verified-v1')ctx.addIssue({code:'custom',message:'Warm connections require the exact existing reference owner trial.'});
 if(value.reference_mode&&value.chat_mode!=='ahead-v1')ctx.addIssue({code:'custom',message:'Verified references require the exact existing owner conversation trial.'});
});
/** Private startup-only selection. Main, browser input and caregiver routing never read it. */
export function ownerTestReasoning(settings:OwnerTestSettings,selection?:unknown){
 if(selection===undefined)return reasoningCandidates['sol-high'];
 const chosen=reasoningSelection.parse(selection);
 if(chosen.owner_actor_id!==settings.owner_actor_id||chosen.participant_id!==settings.participant_id||chosen.origin!==settings.origin)throw Error('Reasoning selection must match this exact owner test copy.');
 return reasoningCandidates[chosen.profile];
}
export function ownerTestPreparation(settings:OwnerTestSettings,selection?:unknown){
 ownerTestReasoning(settings,selection);
 return selection!==undefined&&reasoningSelection.parse(selection).context_mode==='prepared-v1';
}
export function ownerTestSpeech(settings:OwnerTestSettings,selection?:unknown){
 ownerTestReasoning(settings,selection);
 return selection!==undefined&&reasoningSelection.parse(selection).speech_mode==='heart-latency-v1';
}
export function ownerTestQuickReads(settings:OwnerTestSettings,selection?:unknown){
 ownerTestReasoning(settings,selection);
 return selection!==undefined&&reasoningSelection.parse(selection).read_mode==='quick-v1';
}
export function ownerTestSpokenReplies(settings:OwnerTestSettings,selection?:unknown){
 ownerTestReasoning(settings,selection);
 return selection!==undefined&&reasoningSelection.parse(selection).reply_mode==='spoken-v1';
}
export function ownerTestMealsAhead(settings:OwnerTestSettings,selection?:unknown){
 ownerTestReasoning(settings,selection);
 return selection!==undefined&&reasoningSelection.parse(selection).meal_mode==='ahead-v1';
}
export function ownerTestDialogue(settings:OwnerTestSettings,selection?:unknown){
 ownerTestReasoning(settings,selection);
 return selection!==undefined&&reasoningSelection.parse(selection).continuation_mode==='dialogue-v1';
}
export function ownerTestChatPreparation(settings:OwnerTestSettings,selection?:unknown){
 ownerTestReasoning(settings,selection);
 return selection!==undefined&&reasoningSelection.parse(selection).chat_mode==='ahead-v1';
}
export function ownerTestVerifiedReferences(settings:OwnerTestSettings,selection?:unknown){
 ownerTestReasoning(settings,selection);
 return selection!==undefined&&reasoningSelection.parse(selection).reference_mode==='verified-v1';
}
export function ownerTestWarmConnection(settings:OwnerTestSettings,selection?:unknown){
 ownerTestReasoning(settings,selection);
 return selection!==undefined&&['warm-v1','warm-v2','warm-v3'].includes(reasoningSelection.parse(selection).connection_mode??'');
}
export function ownerTestQuickConversation(settings:OwnerTestSettings,selection?:unknown){
 ownerTestReasoning(settings,selection);
 return selection!==undefined&&['warm-v2','warm-v3'].includes(reasoningSelection.parse(selection).connection_mode??'');
}
export function ownerTestIncrementalConversation(settings:OwnerTestSettings,selection?:unknown){
 ownerTestReasoning(settings,selection);
 return selection!==undefined&&reasoningSelection.parse(selection).connection_mode==='warm-v3';
}
/** Bounded diagnostic label. Keep it within telemetry's existing 64-character whitelist. */
export function ownerTestTelemetryPolicy(base:string,settings:OwnerTestSettings,selection?:unknown){
 const profile=ownerTestReasoning(settings,selection);
 const tag=ownerTestWarmConnection(settings,selection)?`${base}-test-sol-low-h1-a1-d1-c1-r1-${ownerTestIncrementalConversation(settings,selection)?'w3':ownerTestQuickConversation(settings,selection)?'w2':'w1'}`:ownerTestMealsAhead(settings,selection)?`${base}-test-sol-low-heart1-ahead1${ownerTestDialogue(settings,selection)?'-dialog1':''}${ownerTestChatPreparation(settings,selection)?'-chat1':''}${ownerTestVerifiedReferences(settings,selection)?'-r1':''}`:`${base}-test-${profile.model}-${profile.effort}${ownerTestPreparation(settings,selection)?'-prep1':''}${ownerTestSpeech(settings,selection)?'-heart1':''}${ownerTestQuickReads(settings,selection)?'-read1':''}${ownerTestSpokenReplies(settings,selection)?'-talk1':''}`;
 if(!/^[a-z][a-z0-9_.-]{0,63}$/i.test(tag))throw Error('Owner test diagnostic policy exceeds its safe bound.');
 return tag;
}

export function ownerTestIndex(html:string){
 if(!html.includes('name="nancy-focus-review" content="disabled"')||!html.includes('<body>')||!html.includes('</head>'))throw Error('Build must retain the locked Current design.');
 return html.replace(/<title>[^<]*<\/title>/,'<title>Nancy Test · Practice only</title>')
  .replace('</head>','<link rel="stylesheet" href="/owner-test.css"></head>')
  .replace('<body>','<body><aside class="owner-test-notice" role="note">Nancy Test — practice data only. Changes here do not affect the live account.</aside>');
}
