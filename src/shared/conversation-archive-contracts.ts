import {z} from 'zod';
export const archivePolicyVersion='conversation-text-v1' as const;
export const archiveChoiceSchema=z.object({enabled:z.boolean(),expected_revision:z.number().int().nonnegative(),confirmed:z.literal(true),policy_version:z.literal(archivePolicyVersion),request_id:z.uuid()}).strict();
export const archiveDeleteSchema=z.object({expected_revision:z.number().int().nonnegative(),confirmed:z.literal(true),request_id:z.uuid()}).strict();
export interface ArchiveSettings {available:boolean;enabled:boolean;revision:number;role:string;retention:'until_deleted';policy_version:typeof archivePolicyVersion;sharing:'client_and_current_administrators';}
export interface ArchiveSummary {id:string;started_at:string;turns:number;ended_at:string|null;}
export interface ArchiveTurn {id:string;input:string;input_mode:'speech_transcription'|'typed';recorded_at:string;outcome:'received'|'completed'|'failed'|'interrupted';reply?:{id:string;text:string;changed:boolean;playback_completed_at:string|null;nutrition_refs?:Array<{document_id:string;sha256:string;items:string[]}>};}
export interface ArchivedConversation extends ArchiveSummary {actor_id:string;participant_id:string;login_session_id:string;consent_revision:number;epoch:string;greeting:{id:string;text:string;playback_completed_at:string|null};entries:ArchiveTurn[];}
