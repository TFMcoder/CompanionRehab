import type {MicrosoftService} from './service.js';

/** The conversation can read/prepare only these bounded operations. */
export type OutlookConversation=Pick<MicrosoftService,'authorityRevision'|'status'|'preparedContext'|'conversationContext'|'conversationMessage'|'prepareAction'|'confirmAction'|'actionReceipt'> & Partial<Pick<MicrosoftService,'conversationMailSearch'>> & {
 readonly sourceMode?:'owner_fixture';
};

export const ownerOutlookFixturePolicy='Outlook sources in this owner test runtime are synthetic practice fixtures, not a connected real Microsoft account. Call them the practice calendar or practice Inbox whenever reporting their facts. Never imply a real appointment, real email or actual mailbox check. These fixtures are read-only; they cannot send, create invitations or write provider records. A practice appointment is not a saved care task or proof of activity. Ordinary Nancy care commands still require their normal exact client review.';
