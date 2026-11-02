import type {MicrosoftService} from './service.js';
import type {PreparedMicrosoftContext} from './preparation.js';

/** A missing source is represented explicitly rather than as an empty snapshot. */
export type OutlookContext={source:string;state:string;fetched_at?:string|null;requested_range?:PreparedMicrosoftContext['range'];
 calendar_coverage?:Array<{source_key:string;label:string;state:string;available:boolean}>;coverage_complete?:boolean}
 & Partial<Omit<PreparedMicrosoftContext,'source'|'state'|'fetched_at'>>;

/** The conversation can read/prepare only these bounded operations. */
export type OutlookConversation=Pick<MicrosoftService,'authorityRevision'|'status'|'conversationMessage'|'prepareAction'|'confirmAction'|'actionReceipt'> & Partial<Pick<MicrosoftService,'conversationMailSearch'>> & {
 preparedContext(...args:Parameters<MicrosoftService['preparedContext']>):Promise<OutlookContext>;
 conversationContext(...args:Parameters<MicrosoftService['conversationContext']>):Promise<OutlookContext>;
 readonly sourceMode?:'owner_fixture';
};

export const ownerOutlookFixturePolicy='Outlook sources in this owner test runtime are synthetic practice fixtures, not a connected real Microsoft account. Call them the practice calendar or practice Inbox whenever reporting their facts. Never imply a real appointment, real email or actual mailbox check. These fixtures are read-only; they cannot send, create invitations or write provider records. A practice appointment is not a saved care task or proof of activity. Ordinary Nancy care commands still require their normal exact client review.';
