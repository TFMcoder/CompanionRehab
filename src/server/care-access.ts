import type { Session } from './session.js';
import type { CareCommand, SetupInput, Today, Receipt } from '../shared/contracts.js';
import type { ActivityCommand, ActivityLedger, ActivityReceipt } from '../shared/activity-contracts.js';

export type LocalRole = 'administrator' | 'client' | 'family_friend' | 'clinician';
export interface GroceryInput { name: string; quantity?: string; idempotency_key: string }
export interface GroceryItem { id: string; name: string; quantity?: string }
export interface AppointmentInput { title: string; starts_at: string; idempotency_key: string }
export interface CareAccess {
  login(email: string, password: string): Promise<Session>;
  authorize(session: Session): Promise<Session>;
  logout(session: Session): Promise<void>;
  today(session: Session): Promise<Today>;
  setup(session: Session, input: SetupInput): Promise<Today>;
  command(session: Session, command: CareCommand): Promise<Receipt>;
  receipt(session: Session, key: string): Promise<Receipt | null>;
  ledger?(session: Session, date?: string): Promise<ActivityLedger>;
  activityCommand?(session: Session, command: ActivityCommand): Promise<ActivityReceipt>;
  activityReceipt?(session: Session, key: string): Promise<ActivityReceipt | null>;
  role?(session: Session): Promise<LocalRole>;
  groceries?(session: Session): Promise<{ items: GroceryItem[] }>;
  addGrocery?(session: Session, input: GroceryInput): Promise<{ item: GroceryItem }>;
  appointments?(session: Session): Promise<{ appointments: Array<{ id: string; title: string; starts_at: string }> }>;
  setAppointment?(session: Session, input: AppointmentInput): Promise<{ appointment: { id: string; title: string; starts_at: string } }>;
  close?(): Promise<void>;
}
export type CareService = CareAccess;
