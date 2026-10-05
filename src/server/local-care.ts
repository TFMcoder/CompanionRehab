import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { z, ZodError } from 'zod';
import { commandSchema, setupSchema, type CareCommand, type SetupInput, type Today, type Receipt, type Task, type MealOption } from '../shared/contracts.js';
import { ApiError, unavailable } from './errors.js';
import type { Session } from './session.js';
import type { AppointmentInput, CareAccess, GroceryInput, GroceryItem, LocalRole } from './care-access.js';

const scrypt = (password: string, salt: Buffer, length: number, options: object) => new Promise<Buffer>((resolve, reject) => {
  scryptCallback(password, salt, length, options, (error, key) => error ? reject(error) : resolve(Buffer.from(key)));
});
const ttlSeconds = 8 * 60 * 60;
const refreshSeconds = 7 * 24 * 60 * 60;
const passwordBytes = 64;
const roles = ['administrator', 'client', 'family_friend', 'clinician'] as const;
const accountSchema = z.object({ email: z.email().max(254), password: z.string().min(12).max(256) });
const uuidSchema = z.string().uuid();

export interface LocalCareOptions {
  connectionString?: string;
  pool?: Pool;
  poolConfig?: Omit<PoolConfig, 'connectionString'>;
  clock?: () => Date;
}
export interface BootstrapLocalUserInput {
  email: string;
  password: string;
  role: LocalRole;
  participant_id?: string;
  display_name?: string;
  time_zone?: string;
  preferences?: string;
}
export interface BootstrappedLocalUser { user_id: string; participant_id: string; role: LocalRole }

function tokenHash(value: string) { return createHash('sha256').update(value).digest(); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
function seconds(date: Date) { return Math.floor(date.getTime() / 1000); }
function fail(code: string, message: string, status = 409): never { throw new ApiError(status, code, message); }
function mapError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof ZodError) throw new ApiError(400, 'invalid_input', 'The request could not be used. Check the choices and try again.');
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code === '23505' || code === '23503' || code === '40001' || code === 'P0001')
    throw new ApiError(409, 'conflict', 'The saved care information changed. Refresh and review it before continuing.');
  if (code === '22P02' || code === '22023' || code === '23514')
    throw new ApiError(400, 'invalid_input', 'The request could not be used. Check the choices and try again.');
  if (code === '28P01' || code === '3D000' || code.startsWith('08')) throw unavailable();
  throw unavailable();
}
async function transaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const value = await fn(client);
    await client.query('commit');
    return value;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return mapError(error);
  } finally { client.release(); }
}
async function passwordDigest(password: string, salt: Buffer) {
  return scrypt(password, salt, passwordBytes, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
type QueryClient = Pick<PoolClient, 'query'>;

/** Create the first locally authenticated user and its explicit care grant. Never expose this as a public route. */
export async function bootstrapLocalUser(pool: Pool, input: BootstrapLocalUserInput): Promise<BootstrappedLocalUser> {
  const parsed = accountSchema.parse(input);
  if (!roles.includes(input.role)) throw new Error('Unsupported local role.');
  const userId = randomUUID();
  const participantId = input.participant_id || userId;
  uuidSchema.parse(participantId);
  const salt = randomBytes(16);
  const digest = await passwordDigest(parsed.password, salt);
  const zone = input.time_zone || 'America/Toronto';
  try {
    await transaction(pool, async client => {
      await client.query('insert into companion_local.accounts(id,email,password_salt,password_hash) values($1,lower($2),$3,$4)', [userId, parsed.email, salt, digest]);
      if (input.role === 'client' && !input.participant_id) {
        await client.query(`insert into companion_local.participant_profiles(id,display_name,time_zone,preferences)
          values($1,$2,$3,$4)`, [participantId, (input.display_name || 'Local test participant').trim(), zone, input.preferences || '']);
      } else if (input.role === 'administrator' && !input.participant_id) {
        // Administrators receive a private empty scope; they are not implicitly granted access to another participant.
        await client.query('insert into companion_local.participant_profiles(id,display_name,time_zone) values($1,$2,$3)', [participantId, 'Administrator scope', zone]);
      }
      await client.query('insert into companion_local.role_grants(participant_id,actor_id,role) values($1,$2,$3)', [participantId, userId, input.role]);
    });
    return { user_id: userId, participant_id: participantId, role: input.role };
  } catch (error) { return mapError(error); }
}

export class LocalCare implements CareAccess {
  readonly pool: Pool;
  private readonly ownsPool: boolean;
  private readonly clock: () => Date;
  private renewing = new Map<string, Promise<Session>>();
  constructor(options: LocalCareOptions) {
    if (!options.pool && !options.connectionString && !options.poolConfig) throw new Error('LocalCare requires a PostgreSQL pool or connection settings.');
    this.ownsPool = !options.pool;
    this.pool = options.pool || new Pool({ ...(options.poolConfig || {}), connectionString: options.connectionString });
    this.clock = options.clock || (() => new Date());
  }
  async close() { if (this.ownsPool) await this.pool.end(); }

  async login(email: string, password: string): Promise<Session> {
    const parsed = accountSchema.extend({ password: z.string().min(1).max(256) }).parse({ email, password });
    try {
      const { rows } = await this.pool.query(`select a.id,a.password_salt,a.password_hash,g.participant_id,g.role
        from companion_local.accounts a join companion_local.role_grants g on g.actor_id=a.id and g.revoked_at is null
        where a.email=lower($1) and a.disabled_at is null order by case g.role when 'client' then 1 when 'family_friend' then 2 when 'clinician' then 3 else 4 end,g.granted_at limit 1`, [parsed.email]);
      const row = rows[0];
      if (!row) throw new ApiError(401, 'unauthorized', 'Email or password is incorrect.');
      const candidate = await passwordDigest(parsed.password, row.password_salt as Buffer);
      const stored = row.password_hash as Buffer;
      if (stored.length !== candidate.length || !timingSafeEqual(stored, candidate)) throw new ApiError(401, 'unauthorized', 'Email or password is incorrect.');
      const now = this.clock();
      const sessionId = randomUUID();
      const access = randomBytes(32).toString('base64url');
      const refresh = randomBytes(32).toString('base64url');
      await this.pool.query(`insert into companion_local.sessions(id,actor_id,participant_id,role,access_hash,refresh_hash,issued_at,expires_at)
        values($1,$2,$3,$4,$5,$6,$7,$8)`, [sessionId, row.id, row.participant_id, row.role, tokenHash(access), tokenHash(refresh), now, new Date(now.getTime() + ttlSeconds * 1000)]);
      return { access_token: access, refresh_token: refresh, user_id: row.id, expires_at: seconds(new Date(now.getTime() + ttlSeconds * 1000)), issued_at: seconds(now), session_id: sessionId };
    } catch (error) { return mapError(error); }
  }

  async authorize(session: Session): Promise<Session> {
    let pending = this.renewing.get(session.session_id);
    if (!pending) {
      pending = this.authorizeOnce(session);
      this.renewing.set(session.session_id, pending);
    }
    try { return await pending; }
    finally { if (this.renewing.get(session.session_id) === pending) this.renewing.delete(session.session_id); }
  }
  private async authorizeOnce(session: Session): Promise<Session> {
    try {
      const { rows } = await this.pool.query(`select s.actor_id,s.participant_id,s.role,s.access_hash,s.refresh_hash,s.issued_at,s.expires_at,s.revoked_at,
          a.disabled_at, g.revoked_at as grant_revoked
        from companion_local.sessions s join companion_local.accounts a on a.id=s.actor_id
        join companion_local.role_grants g on g.actor_id=s.actor_id and g.participant_id=s.participant_id and g.role=s.role
        where s.id=$1`, [session.session_id]);
      const row = rows[0];
      const now = this.clock();
      if (!row || row.actor_id !== session.user_id || row.revoked_at || row.disabled_at || row.grant_revoked) throw new ApiError(401, 'unauthorized', 'Please sign in again.');
      if (row.expires_at.getTime() > now.getTime() && timingSafeEqual(row.access_hash as Buffer, tokenHash(session.access_token))) return session;
      if (row.issued_at.getTime() + refreshSeconds * 1000 <= now.getTime() || !timingSafeEqual(row.refresh_hash as Buffer, tokenHash(session.refresh_token)))
        throw new ApiError(401, 'unauthorized', 'Please sign in again.');
      const access = randomBytes(32).toString('base64url');
      const refresh = randomBytes(32).toString('base64url');
      const expires = new Date(now.getTime() + ttlSeconds * 1000);
      await this.pool.query('update companion_local.sessions set access_hash=$2,refresh_hash=$3,expires_at=$4 where id=$1 and revoked_at is null', [session.session_id, tokenHash(access), tokenHash(refresh), expires]);
      return { ...session, access_token: access, refresh_token: refresh, issued_at: seconds(now), expires_at: seconds(expires) };
    } catch (error) { return mapError(error); }
  }

  async logout(session: Session): Promise<void> {
    try {
      await this.pool.query('update companion_local.sessions set revoked_at=coalesce(revoked_at,$2) where id=$1 and access_hash=$3', [session.session_id, this.clock(), tokenHash(session.access_token)]);
    } catch (error) { mapError(error); }
  }

  private async context(session: Session, client?: PoolClient) {
    const query = client ? client.query.bind(client) : this.pool.query.bind(this.pool);
    const { rows } = await query(`select s.actor_id,s.participant_id,s.role
      from companion_local.sessions s join companion_local.accounts a on a.id=s.actor_id
      join companion_local.role_grants g on g.actor_id=s.actor_id and g.participant_id=s.participant_id and g.role=s.role
      where s.id=$1 and s.access_hash=$2 and s.expires_at>$3 and s.revoked_at is null and a.disabled_at is null and g.revoked_at is null`, [session.session_id, tokenHash(session.access_token), this.clock()]);
    const row = rows[0];
    if (!row || row.actor_id !== session.user_id) throw new ApiError(401, 'unauthorized', 'Please sign in again.');
    return { actorId: row.actor_id as string, participantId: row.participant_id as string, role: row.role as LocalRole };
  }
  async role(session: Session): Promise<LocalRole> {
    try { return (await this.context(session)).role; } catch (error) { return mapError(error); }
  }
  private async clientContext(session: Session, client?: PoolClient) {
    const value = await this.context(session, client);
    if (value.role !== 'client') throw new ApiError(403, 'forbidden', 'This action requires the participant role.');
    return value;
  }
  private async localDate(client: QueryClient, participantId: string) {
    const { rows } = await client.query(`select (now() at time zone time_zone)::date::text as local_date from companion_local.participant_profiles where id=$1`, [participantId]);
    if (!rows[0]) throw new ApiError(409, 'setup_required', 'Complete participant setup before planning the day.');
    return rows[0].local_date as string;
  }
  private async todayFor(client: QueryClient, participantId: string): Promise<Today> {
    const profileResult = await client.query(`select id,display_name,time_zone,preferences,revision from companion_local.participant_profiles where id=$1`, [participantId]);
    const p = profileResult.rows[0];
    if (!p) throw new ApiError(409, 'setup_required', 'Complete participant setup before planning the day.');
    const day = await this.localDate(client, participantId);
    const [taskResult, mealResult, checkResult, appointmentResult, groceryResult] = await Promise.all([
      client.query(`select id,title,time_hint,urgency,scheduled_date::text as scheduled_date,to_char(scheduled_time,'HH24:MI') as scheduled_time,category,duration_minutes
        from companion_local.task_definitions where participant_id=$1 and active order by scheduled_date nulls last,scheduled_time nulls last,created_at,id`, [participantId]),
      client.query(`select id,name,slots from companion_local.meal_options where participant_id=$1 and active order by created_at,id`, [participantId]),
      client.query(`select c.id,c.local_date::text,c.revision,p.plan as proposal,a.plan as accepted
        from companion_local.daily_checkins c left join companion_local.day_plan_proposals p on p.id=c.current_proposal_id
        left join companion_local.accepted_day_plan_versions a on a.checkin_id=c.id and a.version=c.accepted_version
        where c.participant_id=$1 and c.local_date=$2`, [participantId, day]),
      client.query(`select id,title,starts_at from companion_local.appointments where participant_id=$1 and starts_at>=now() order by starts_at limit 20`, [participantId]),
      client.query(`select id,name,quantity from companion_local.grocery_items where participant_id=$1 order by created_at,id`, [participantId]),
    ]);
    const tasks = taskResult.rows.map((t: any) => ({ id: t.id, title: t.title, time_hint: t.time_hint, urgency: t.urgency, scheduled_date: t.scheduled_date, scheduled_time: t.scheduled_time, category: t.category, duration_minutes: t.duration_minutes })) as Task[];
    const meal_options = mealResult.rows.map((m: any) => ({ id: m.id, name: m.name, slots: m.slots })) as MealOption[];
    const check = checkResult.rows[0];
    const appointments = appointmentResult.rows.map((a: any) => ({ id: a.id, title: a.title, starts_at: (a.starts_at as Date).toISOString() }));
    const groceries = groceryResult.rows.map((g: any) => ({ id: g.id, name: g.name, ...(g.quantity ? { quantity: g.quantity } : {}) }));
    return { profile: { id: p.id, display_name: p.display_name, time_zone: p.time_zone, preferences: p.preferences, revision: p.revision }, local_date: day, tasks, meal_options,
      checkin: check ? { id: check.id, local_date: check.local_date, revision: check.revision, proposal: check.proposal, accepted: check.accepted } : null,
      groceries, appointments } as Today;
  }
  async today(session: Session): Promise<Today> {
    try { const { participantId, role } = await this.clientContext(session); return { ...await this.todayFor(this.pool, participantId), role }; } catch (error) { return mapError(error); }
  }

  async setup(session: Session, input: SetupInput): Promise<Today> {
    try {
      input = setupSchema.parse(input);
      return await transaction(this.pool, async client => {
        const { actorId, participantId } = await this.clientContext(session, client);
        const p = await client.query('select id,revision from companion_local.participant_profiles where id=$1 for update', [participantId]);
        if (!p.rows[0]) throw new ApiError(409, 'setup_required', 'Complete participant setup before planning the day.');
        if (p.rows[0].revision !== input.expected_revision) throw new ApiError(409, 'conflict', 'The saved care information changed. Refresh and review it before continuing.');
        const next = input.expected_revision + 1;
        for (const task of input.tasks) if (task.id) {
          const exists = await client.query('select 1 from companion_local.task_definitions where participant_id=$1 and id=$2', [participantId, task.id]);
          if (!exists.rows.length) throw new ApiError(400, 'invalid_input', 'A task in this setup is unknown or belongs to another participant.');
        }
        for (const meal of input.meal_options) if (meal.id) {
          const exists = await client.query('select 1 from companion_local.meal_options where participant_id=$1 and id=$2', [participantId, meal.id]);
          if (!exists.rows.length) throw new ApiError(400, 'invalid_input', 'A meal in this setup is unknown or belongs to another participant.');
        }
        await client.query(`update companion_local.participant_profiles set display_name=$2,time_zone=$3,preferences=$4,revision=$5,updated_at=now() where id=$1`,
          [participantId, input.display_name, input.time_zone, input.preferences, next]);
        await client.query('update companion_local.task_definitions set active=false,updated_at=now() where participant_id=$1', [participantId]);
        await client.query('update companion_local.meal_options set active=false,updated_at=now() where participant_id=$1', [participantId]);
        for (const task of input.tasks as Array<any>) {
          const values = [participantId, task.title, task.time_hint ?? null, task.urgency || 'medium', task.scheduled_date || null, task.scheduled_time || null, task.category || 'task', task.duration_minutes ?? null, next];
          if (task.id) await client.query(`update companion_local.task_definitions set title=$3,time_hint=$4,urgency=$5,scheduled_date=$6,scheduled_time=$7,category=$8,duration_minutes=$9,active=true,setup_revision=$10,updated_at=now()
            where participant_id=$1 and id=$2`, [participantId, task.id, ...values.slice(1)]);
          else await client.query(`insert into companion_local.task_definitions(participant_id,title,time_hint,urgency,scheduled_date,scheduled_time,category,duration_minutes,setup_revision)
            values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, values);
        }
        for (const meal of input.meal_options as Array<any>) {
          if (meal.id) await client.query(`update companion_local.meal_options set name=$3,slots=$4,active=true,setup_revision=$5,updated_at=now() where participant_id=$1 and id=$2`, [participantId, meal.id, meal.name, meal.slots, next]);
          else await client.query('insert into companion_local.meal_options(participant_id,name,slots,setup_revision) values($1,$2,$3,$4)', [participantId, meal.name, meal.slots, next]);
        }
        await client.query(`insert into companion_local.domain_events(participant_id,actor_id,event_type,data) values($1,$2,'ParticipantSetupVersioned',$3)`, [participantId, actorId, JSON.stringify({ revision: next })]);
        return { ...await this.todayFor(client, participantId), role: 'client' };
      });
    } catch (error) { return mapError(error); }
  }

  async command(session: Session, input: CareCommand): Promise<Receipt> {
    try {
      input = commandSchema.parse(input);
      return await transaction(this.pool, async client => {
        const { actorId, participantId } = await this.clientContext(session, client);
        const { rows: profiles } = await client.query('select id,time_zone,revision from companion_local.participant_profiles where id=$1 for update', [participantId]);
        const profile = profiles[0];
        if (!profile) throw new ApiError(409, 'setup_required', 'Complete participant setup before planning the day.');
        const { rows: receiptRows } = await client.query('select command,result from companion_local.command_receipts where participant_id=$1 and command_id=$2', [participantId, input.idempotency_key]);
        if (receiptRows[0]) {
          if (canonical(receiptRows[0].command) !== canonical(input)) throw new ApiError(409, 'conflict', 'This request key was already used for another change.');
          return { ...receiptRows[0].result, replayed: true };
        }
        const day = await this.localDate(client, participantId);
        if (input.local_date !== day) throw new ApiError(409, 'conflict', 'The local day changed. Refresh and review before continuing.');
        let check = (await client.query('select * from companion_local.daily_checkins where participant_id=$1 and local_date=$2 for update', [participantId, day])).rows[0];
        if (input.type === 'start_or_resume_checkin') {
          if (input.expected_revision !== 0) throw new ApiError(409, 'conflict', 'Starting a check-in expects revision zero.');
          let eventType: string;
          if (!check) {
            const result = await client.query('insert into companion_local.daily_checkins(participant_id,local_date) values($1,$2) returning id,revision', [participantId, day]);
            check = { ...result.rows[0], local_date: day };
            eventType = 'DailyCheckInStarted';
          } else eventType = 'DailyCheckInResumed';
          const result: Receipt = { command_id: input.idempotency_key, checkin_id: check.id, revision: check.revision, result: 'resumed', plan: null, replayed: false };
          await this.saveCommand(client, participantId, actorId, check.id, day, input, result, eventType, { revision: check.revision });
          return result;
        }
        if (!check) throw new ApiError(409, 'conflict', 'Start today’s check-in before changing its plan.');
        if (check.revision !== input.expected_revision) throw new ApiError(409, 'conflict', 'The plan changed. Refresh and review it before continuing.');
        if (input.type === 'accept_day_plan') {
          const proposal = (await client.query('select id,setup_revision,plan from companion_local.day_plan_proposals where id=$1 and participant_id=$2 and checkin_id=$3', [input.payload.proposal_id, participantId, check.id])).rows[0];
          if (!proposal || proposal.id !== check.current_proposal_id || proposal.setup_revision !== profile.revision) throw new ApiError(409, 'conflict', 'This proposal is no longer current. Review the latest plan.');
          if ((await client.query('select 1 from companion_local.accepted_day_plan_versions where proposal_id=$1', [proposal.id])).rowCount) throw new ApiError(409, 'conflict', 'This proposal has already been accepted.');
          const version = (await client.query('select coalesce(max(version),0)+1 as version from companion_local.accepted_day_plan_versions where checkin_id=$1', [check.id])).rows[0].version as number;
          const acceptedAt = this.clock().toISOString();
          const plan = { ...proposal.plan, version, accepted_at: acceptedAt };
          await client.query('insert into companion_local.accepted_day_plan_versions(checkin_id,participant_id,version,proposal_id,plan,accepted_at) values($1,$2,$3,$4,$5,$6)', [check.id, participantId, version, proposal.id, JSON.stringify(plan), acceptedAt]);
          const revision = check.revision + 1;
          await client.query('update companion_local.daily_checkins set revision=$2,accepted_version=$3,updated_at=now() where id=$1', [check.id, revision, version]);
          const result: Receipt = { command_id: input.idempotency_key, checkin_id: check.id, revision, result: 'accepted', plan, replayed: false };
          await this.saveCommand(client, participantId, actorId, check.id, day, input, result, 'DayPlanAccepted', { proposal_id: proposal.id, version, revision });
          return result;
        }
        const payload = input.payload as { task_ids: string[]; meals: Array<{ slot: string; option_id: string }>; task_overrides?: Array<{ id: string; urgency?: 'high' | 'medium' | 'low'; scheduled_time?: string | null; duration_minutes?: number | null }> };
        const selectedIds = payload.task_ids;
        const selectedSet = new Set(selectedIds);
        if ((payload.task_overrides || []).some(override => !selectedSet.has(override.id))) throw new ApiError(400, 'invalid_input', 'Task changes must refer to selected tasks.');
        const selected = selectedIds.length ? (await client.query(`select id,title,time_hint,urgency,scheduled_date::text as scheduled_date,to_char(scheduled_time,'HH24:MI') as scheduled_time,category,duration_minutes
          from companion_local.task_definitions where participant_id=$1 and active and id=any($2::uuid[])`, [participantId, selectedIds])).rows : [];
        if (selected.length !== selectedIds.length) throw new ApiError(400, 'invalid_input', 'One or more selected tasks are unavailable.');
        const taskById = new Map(selected.map((t: any) => [t.id, t]));
        const overrides = new Map((payload.task_overrides || []).map(override => [override.id, override]));
        const tasks = selectedIds.map(id => {
          const task = taskById.get(id)!;
          const override = overrides.get(id);
          return { ...task, ...(override?.urgency !== undefined ? { urgency: override.urgency } : {}),
            ...(override && Object.hasOwn(override, 'scheduled_time') ? { scheduled_time: override.scheduled_time } : {}),
            ...(override && Object.hasOwn(override, 'duration_minutes') ? { duration_minutes: override.duration_minutes } : {}) };
        });
        const meals: Array<{ slot: string; option_id: string; name: string }> = [];
        for (const choice of payload.meals) {
          const option = (await client.query('select id,name from companion_local.meal_options where participant_id=$1 and id=$2 and active and $3=any(slots)', [participantId, choice.option_id, choice.slot])).rows[0];
          if (!option) throw new ApiError(400, 'invalid_input', 'One or more selected meals are unavailable.');
          meals.push({ slot: choice.slot, option_id: option.id, name: option.name });
        }
        const proposalId = randomUUID();
        const plan = { id: proposalId, task_ids: selectedIds, tasks, meals, created_at: this.clock().toISOString() };
        const revision = check.revision + 1;
        await client.query('insert into companion_local.day_plan_proposals(id,checkin_id,participant_id,setup_revision,checkin_revision,plan) values($1,$2,$3,$4,$5,$6)', [proposalId, check.id, participantId, profile.revision, revision, JSON.stringify(plan)]);
        await client.query('update companion_local.daily_checkins set revision=$2,current_proposal_id=$3,updated_at=now() where id=$1', [check.id, revision, proposalId]);
        const result: Receipt = { command_id: input.idempotency_key, checkin_id: check.id, revision, result: 'proposed', plan: plan as any, replayed: false };
        await this.saveCommand(client, participantId, actorId, check.id, day, input, result, input.type === 'revise_day_plan' ? 'DayPlanRevised' : 'DayPlanProposed', { proposal_id: proposalId, revision, setup_revision: profile.revision });
        return result;
      });
    } catch (error) { return mapError(error); }
  }
  private async saveCommand(client: PoolClient, participantId: string, actorId: string, checkinId: string | null, day: string, command: unknown, result: Receipt, eventType: string, data: unknown) {
    await client.query('insert into companion_local.command_receipts(participant_id,command_id,command,result) values($1,$2,$3,$4)', [participantId, result.command_id, JSON.stringify(command), JSON.stringify(result)]);
    await client.query(`insert into companion_local.domain_events(participant_id,checkin_id,actor_id,command_id,event_type,local_date,data) values($1,$2,$3,$4,$5,$6,$7)`,
      [participantId, checkinId, actorId, result.command_id, eventType, day, JSON.stringify(data)]);
  }
  async receipt(session: Session, key: string): Promise<Receipt | null> {
    try {
      const { participantId } = await this.clientContext(session);
      const { rows } = await this.pool.query('select result from companion_local.command_receipts where participant_id=$1 and command_id=$2', [participantId, uuidSchema.parse(key)]);
      return rows[0]?.result ?? null;
    } catch (error) { return mapError(error); }
  }

  async groceries(session: Session): Promise<{ items: GroceryItem[] }> {
    try {
      const { participantId } = await this.clientContext(session);
      const { rows } = await this.pool.query('select id,name,quantity from companion_local.grocery_items where participant_id=$1 order by created_at,id', [participantId]);
      return { items: rows.map((r: any) => ({ id: r.id, name: r.name, ...(r.quantity ? { quantity: r.quantity } : {}) })) };
    } catch (error) { return mapError(error); }
  }
  async addGrocery(session: Session, input: GroceryInput): Promise<{ item: GroceryItem }> {
    try {
      const parsed = z.object({ name: z.string().trim().min(1).max(120), quantity: z.string().trim().max(80).optional(), idempotency_key: uuidSchema }).strict().parse(input);
      return await transaction(this.pool, async client => {
        const { actorId, participantId } = await this.clientContext(session, client);
        await client.query('select id from companion_local.participant_profiles where id=$1 for update', [participantId]);
        const command = { type: 'add_grocery_item', ...parsed };
        const old = (await client.query('select command,result from companion_local.append_only_mutations where participant_id=$1 and command_id=$2', [participantId, parsed.idempotency_key])).rows[0];
        if (old) {
          if (canonical(old.command) !== canonical(command)) throw new ApiError(409, 'conflict', 'This request key was already used for another change.');
          return old.result;
        }
        const item = (await client.query('insert into companion_local.grocery_items(participant_id,name,quantity,created_by) values($1,$2,$3,$4) returning id,name,quantity', [participantId, parsed.name, parsed.quantity || null, actorId])).rows[0];
        const response = { item: { id: item.id, name: item.name, ...(item.quantity ? { quantity: item.quantity } : {}) } };
        await client.query(`insert into companion_local.append_only_mutations(participant_id,command_id,command,result,event_type,actor_id) values($1,$2,$3,$4,'GroceryItemAdded',$5)`, [participantId, parsed.idempotency_key, JSON.stringify(command), JSON.stringify(response), actorId]);
        await client.query(`insert into companion_local.domain_events(participant_id,actor_id,command_id,event_type,data) values($1,$2,$3,'GroceryItemAdded',$4)`, [participantId, actorId, parsed.idempotency_key, JSON.stringify(response.item)]);
        return response;
      });
    } catch (error) { return mapError(error); }
  }

  async appointments(session: Session): Promise<{ appointments: Array<{ id: string; title: string; starts_at: string }> }> {
    try {
      const { participantId } = await this.clientContext(session);
      const { rows } = await this.pool.query('select id,title,starts_at from companion_local.appointments where participant_id=$1 and starts_at>=now() order by starts_at limit 20', [participantId]);
      return { appointments: rows.map((a: any) => ({ id: a.id, title: a.title, starts_at: (a.starts_at as Date).toISOString() })) };
    } catch (error) { return mapError(error); }
  }
  async setAppointment(session: Session, input: AppointmentInput): Promise<{ appointment: { id: string; title: string; starts_at: string } }> {
    try {
      const parsed = z.object({ title: z.string().trim().min(1).max(160), starts_at: z.string().datetime({ offset: true }), idempotency_key: uuidSchema }).strict().parse(input);
      return await transaction(this.pool, async client => {
        const { actorId, participantId } = await this.clientContext(session, client);
        await client.query('select id from companion_local.participant_profiles where id=$1 for update', [participantId]);
        const command = { type: 'set_local_appointment', ...parsed };
        const old = (await client.query('select command,result from companion_local.append_only_mutations where participant_id=$1 and command_id=$2', [participantId, parsed.idempotency_key])).rows[0];
        if (old) {
          if (canonical(old.command) !== canonical(command)) throw new ApiError(409, 'conflict', 'This request key was already used for another change.');
          return old.result;
        }
        const row = (await client.query('insert into companion_local.appointments(participant_id,title,starts_at,created_by) values($1,$2,$3,$4) returning id,title,starts_at', [participantId, parsed.title, parsed.starts_at, actorId])).rows[0];
        const response = { appointment: { id: row.id, title: row.title, starts_at: (row.starts_at as Date).toISOString() } };
        await client.query(`insert into companion_local.append_only_mutations(participant_id,command_id,command,result,event_type,actor_id) values($1,$2,$3,$4,'LocalAppointmentScheduled',$5)`, [participantId, parsed.idempotency_key, JSON.stringify(command), JSON.stringify(response), actorId]);
        await client.query(`insert into companion_local.domain_events(participant_id,actor_id,command_id,event_type,data) values($1,$2,$3,'LocalAppointmentScheduled',$4)`, [participantId, actorId, parsed.idempotency_key, JSON.stringify(response.appointment)]);
        return response;
      });
    } catch (error) { return mapError(error); }
  }
}
