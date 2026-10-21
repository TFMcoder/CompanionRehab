import type { Session } from './session.js';
import type { CareCommand, SetupInput, Today, Receipt } from '../shared/contracts.js';
import type { ActivityCommand, ActivityLedger, ActivityReceipt } from '../shared/activity-contracts.js';
import type {PreferenceCommand,PreferenceReceipt,PreferenceWorkspace} from '../shared/preference-contracts.js';

export type LocalRole = 'administrator' | 'client' | 'family_friend' | 'clinician';
export interface CareAuthority {
  actor_id: string; login_session_id: string; active_role: LocalRole;
  client_id: string; grant_revision: string;
}
export interface GroceryInput { name: string; quantity?: string; idempotency_key: string }
export interface GroceryItem { id: string; name: string; quantity?: string }
export interface AppointmentInput { title: string; starts_at: string; idempotency_key: string }
export interface CareAccess {
  login(email: string, password: string, rememberDevice?: boolean): Promise<Session>;
  authorize(session: Session): Promise<Session>;
  logout(session: Session): Promise<void>;
  today(session: Session): Promise<Today>;
  setup(session: Session, input: SetupInput): Promise<Today>;
  command(session: Session, command: CareCommand): Promise<Receipt>;
  receipt(session: Session, key: string): Promise<Receipt | null>;
  ledger?(session: Session, date?: string): Promise<ActivityLedger>;
  activityCommand?(session: Session, command: ActivityCommand): Promise<ActivityReceipt>;
  commitPendingActivityCommand?(session: Session, command: ActivityCommand): Promise<ActivityReceipt>;
  activityReceipt?(session: Session, key: string): Promise<ActivityReceipt | null>;
  holdActivityCommand?(session: Session, command: ActivityCommand): Promise<void>;
  pendingActivityCommand?(session: Session): Promise<{command:ActivityCommand;scope_matches:boolean}|null>;
  clearPendingActivityCommand?(session: Session, key: string): Promise<void>;
  acknowledgeActivityCommand?(session: Session, key: string): Promise<void>;
  discardPendingActivityCommand?(session: Session, key: string): Promise<boolean>;
  preferences?(session:Session):Promise<PreferenceWorkspace>;
  preferenceCommand?(session:Session,command:PreferenceCommand):Promise<PreferenceReceipt>;
  preferenceReceipt?(session:Session,key:string):Promise<PreferenceReceipt|null>;
  retryPreferenceCommand?(session:Session,key:string):Promise<PreferenceReceipt>;
  acknowledgePreferenceCommand?(session:Session,key:string):Promise<void>;
  discardPreferenceCommand?(session:Session,key:string):Promise<boolean>;
  role?(session: Session): Promise<LocalRole>;
  authority?(session: Session): Promise<CareAuthority>;
  groceries?(session: Session): Promise<{ items: GroceryItem[] }>;
  addGrocery?(session: Session, input: GroceryInput): Promise<{ item: GroceryItem }>;
  appointments?(session: Session): Promise<{ appointments: Array<{ id: string; title: string; starts_at: string }> }>;
  setAppointment?(session: Session, input: AppointmentInput): Promise<{ appointment: { id: string; title: string; starts_at: string } }>;
  close?(): Promise<void>;
}
export type CareService = CareAccess;
