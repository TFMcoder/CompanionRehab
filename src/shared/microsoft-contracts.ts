import {z} from 'zod';
import type {GraphCollection,GraphCalendar,GraphMailFolder,GraphCalendarEvent,GraphMessage} from '../server/microsoft/graph.js';

const resourceId=z.string().min(1).max(2048).refine(value=>!/[\u0000-\u001f\u007f]/.test(value));
export const microsoftSelectionSchema=z.object({
 expected_revision:z.number().int().positive(),calendar_ids:z.array(resourceId).max(5),mail_folder_ids:z.array(resourceId).max(5),
}).strict().refine(value=>new Set(value.calendar_ids).size===value.calendar_ids.length&&new Set(value.mail_folder_ids).size===value.mail_folder_ids.length);
export type MicrosoftSelection=z.infer<typeof microsoftSelectionSchema>;
export const microsoftReadRangeSchema=z.object({start:z.iso.datetime({offset:true}),end:z.iso.datetime({offset:true})}).strict()
 .refine(value=>Date.parse(value.end)>Date.parse(value.start)&&Date.parse(value.end)-Date.parse(value.start)<=7*86400000);
export type MicrosoftReadRange=z.infer<typeof microsoftReadRangeSchema>;
export interface MicrosoftStatus {
 available:boolean;eligible:boolean;state:'not_configured'|'disconnected'|'connected'|'reconnect_required';revision:number;
 selected_calendar_ids:string[];selected_mail_folder_ids:string[];last_read_at:string|null;last_error:string|null;
 model_disclosure_enabled:boolean;reviewed_writes_enabled?:boolean;
}
export const microsoftUnavailable:MicrosoftStatus={available:false,eligible:false,state:'not_configured',revision:0,
 selected_calendar_ids:[],selected_mail_folder_ids:[],last_read_at:null,last_error:null,model_disclosure_enabled:false};
export interface MicrosoftResources {calendars:GraphCollection<GraphCalendar>;mail_folders:GraphCollection<GraphMailFolder>}
export interface MicrosoftContext {source:'microsoft';fetched_at:string;calendars:Array<{id:string;result:GraphCollection<GraphCalendarEvent>}>;mail_folders:Array<{id:string;result:GraphCollection<GraphMessage>}>;model_disclosure_enabled:boolean}

const addresses=z.array(z.email().max(320)).min(1).max(10).refine(items=>new Set(items.map(x=>x.toLowerCase())).size===items.length);
const subject=z.string().trim().min(1).max(200).refine(value=>!/[\r\n\u0000]/.test(value));
export const microsoftActionSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('send_mail'),to:addresses,subject,body:z.string().min(1).max(5000).refine(value=>!value.includes('\u0000'))}).strict(),
 z.object({kind:z.literal('create_event'),calendar_id:resourceId.optional(),subject,start:z.iso.datetime({offset:true}),end:z.iso.datetime({offset:true}),attendees:addresses}).strict()
]).refine(value=>value.kind!=='create_event'||Date.parse(value.end)>Date.parse(value.start)&&Date.parse(value.end)-Date.parse(value.start)<=86400000);
export type MicrosoftAction=z.infer<typeof microsoftActionSchema>;
export const microsoftPrepareSchema=z.object({idempotency_key:z.uuid(),action:microsoftActionSchema}).strict();
export const microsoftConfirmSchema=z.object({action_id:z.uuid(),review_token:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type MicrosoftActionState='prepared'|'submitting'|'accepted'|'verified'|'unknown'|'failed';
export interface MicrosoftActionReview {action_id:string;action:MicrosoftAction;review_token:string;expires_at:string;time_zone:string;account:string;calendar_name:string|null}
export interface MicrosoftActionReceipt {action_id:string;kind:MicrosoftAction['kind'];state:MicrosoftActionState;updated_at:string;message:string;replayed?:boolean}
