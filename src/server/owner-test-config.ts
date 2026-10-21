import {resolve} from 'node:path';
import {z} from 'zod';

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

export function ownerTestIndex(html:string){
 if(!html.includes('name="nancy-focus-review" content="disabled"')||!html.includes('<body>')||!html.includes('</head>'))throw Error('Build must retain the locked Current design.');
 return html.replace(/<title>[^<]*<\/title>/,'<title>Nancy Test · Practice only</title>')
  .replace('</head>','<link rel="stylesheet" href="/owner-test.css"></head>')
  .replace('<body>','<body><aside class="owner-test-notice" role="note">Nancy Test — practice data only. Changes here do not affect the live account.</aside>');
}
