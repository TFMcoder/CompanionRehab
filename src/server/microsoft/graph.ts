import { z } from 'zod';
import {microsoftActionSchema,type MicrosoftAction} from '../../shared/microsoft-contracts.js';

// Deliberately not a generic Graph client. Care authorization, reviewed intent,
// durable receipts and refresh/revocation belong to the calling care service.
const GRAPH = 'https://graph.microsoft.com/v1.0';
const PREFER = 'IdType="ImmutableId", outlook.timezone="UTC", outlook.body-content-type="text"';
const CALENDAR_FIELDS = 'id,name,owner,canEdit,isDefaultCalendar,changeKey';
const FOLDER_FIELDS = 'id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount';
const EVENT_FIELDS = 'id,subject,start,end,isAllDay,isCancelled,type,seriesMasterId,iCalUId,changeKey,lastModifiedDateTime,location,organizer,attendees,isOrganizer,transactionId';
// calendarView does not support selecting lastModifiedDateTime. Keep fields
// minimized and preserve unknown modification time instead of fetching bodies.
// https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview
const CALENDAR_VIEW_FIELDS = EVENT_FIELDS.split(',').filter(field => field !== 'lastModifiedDateTime').join(',');
const MESSAGE_FIELDS = 'id,parentFolderId,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,lastModifiedDateTime,isDraft,isRead,hasAttachments,bodyPreview,changeKey,internetMessageId';

export interface GraphLimits {
  maxPages: number;
  maxItems: number;
  pageSize: number;
  maxResponseBytes: number;
  maxTotalBytes: number;
  requestTimeoutMs: number;
  operationTimeoutMs: number;
}
const DEFAULT_LIMITS: GraphLimits = {
  maxPages: 4, maxItems: 200, pageSize: 50, maxResponseBytes: 512_000,
  maxTotalBytes: 1_024_000, requestTimeoutMs: 10_000, operationTimeoutMs: 30_000,
};
export interface GraphCollection<T> {
  items: T[];
  fetchedAt: string;
  complete: boolean;
  truncation: null | 'items' | 'pages' | 'time' | 'bytes';
}
export interface GraphIdentity {
  id: string; displayName: string | null; mail: string | null; userPrincipalName: string | null; fetchedAt: string;
}
export interface GraphAddress { address: string; name: string | null }
export interface GraphCalendar {
  id: string; name: string; owner: GraphAddress | null; canEdit: boolean | null;
  isDefault: boolean | null; changeKey: string | null; etag: string | null; fetchedAt: string;
}
export interface GraphMailFolder {
  id: string; displayName: string; parentFolderId: string | null;
  childFolderCount: number | null; totalItemCount: number | null; unreadItemCount: number | null; fetchedAt: string;
}
export interface GraphCalendarEvent {
  id: string; calendarId: string; subject: string; start: string; end: string;
  isAllDay: boolean; isCancelled: boolean; isOrganizer: boolean | null;
  type: 'singleInstance' | 'occurrence' | 'exception' | 'seriesMaster';
  seriesMasterId: string | null; iCalUId: string | null; changeKey: string | null; etag: string | null;
  lastModifiedAt: string | null; location: string | null; organizer: GraphAddress | null;
  attendees: Array<GraphAddress & { type: string | null }>;
  transactionId: string | null; fetchedAt: string;
}
export interface GraphMessage {
  id: string; folderId: string; subject: string; from: GraphAddress | null;
  to: GraphAddress[]; cc: GraphAddress[]; bcc: GraphAddress[];
  receivedAt: string | null; sentAt: string | null; lastModifiedAt: string | null;
  isDraft: boolean; isRead: boolean; hasAttachments: boolean; preview: string;
  changeKey: string | null; etag: string | null; internetMessageId: string | null; fetchedAt: string;
}
export interface GraphMessageDetail extends GraphMessage { bodyText: string }
export type GraphErrorCode = 'invalid_input' | 'invalid_response' | 'account_mismatch' | 'resource_denied'
  | 'unsafe_pagination' | 'provider_error' | 'network_error' | 'timeout' | 'response_too_large';
export class MicrosoftGraphError extends Error {
  constructor(readonly code: GraphErrorCode, readonly status: number | null = null) {
    // Never copy provider messages, URLs, body text or credentials into errors/logs.
    super(`Microsoft request: ${code}`);
    this.name = 'MicrosoftGraphError';
  }
}
export interface MicrosoftGraphOptions {
  accessToken: string;
  expectedAccountId: string;
  allowedCalendarIds?: readonly string[];
  allowedMailFolderIds?: readonly string[];
  fetch?: typeof fetch;
  clock?: () => Date;
  signal?: AbortSignal;
  /** Recheck current local care authority immediately before each provider call. */
  beforeRequest?: () => Promise<void>;
  limits?: Partial<GraphLimits>;
}
export interface GraphDateRange { start: string; end: string }

const opaqueId = z.string().min(1).max(2048).refine(v => !/[\u0000-\u0020\u007f]/.test(v) && v !== '.' && v !== '..');
const shortText = z.string().max(2000);
const nullableText = shortText.nullish();
const etag = z.string().max(4096).regex(/^(?:W\/)?"[^"\r\n]+"$/);
const providerRevision = z.object({ changeKey: nullableText, '@odata.etag': etag.nullish() });
const addressSchema = z.object({ address: z.string().min(1).max(320), name: z.string().max(500).nullish() });
const recipientSchema = z.object({ emailAddress: addressSchema });
const recipientsSchema = z.array(recipientSchema).max(500);
const identitySchema = z.object({ id: opaqueId, displayName: nullableText, mail: nullableText, userPrincipalName: nullableText });
const calendarSchema = providerRevision.extend({
  id: opaqueId, name: shortText, owner: addressSchema.nullish(), canEdit: z.boolean().nullish(), isDefaultCalendar: z.boolean().nullish(),
});
const folderSchema = z.object({
  id: opaqueId, displayName: shortText, parentFolderId: opaqueId.nullish(),
  childFolderCount: z.number().int().nonnegative().nullish(), totalItemCount: z.number().int().nonnegative().nullish(), unreadItemCount: z.number().int().nonnegative().nullish(),
});
const dateTimeSchema = z.object({ dateTime: z.string().max(50), timeZone: z.string().max(100) });
const eventSchema = providerRevision.extend({
  id: opaqueId, subject: shortText, start: dateTimeSchema, end: dateTimeSchema,
  isAllDay: z.boolean(), isCancelled: z.boolean(), isOrganizer: z.boolean().nullish(),
  type: z.enum(['singleInstance', 'occurrence', 'exception', 'seriesMaster']),
  seriesMasterId: opaqueId.nullish(), iCalUId: nullableText, lastModifiedDateTime: nullableText,
  location: z.object({ displayName: nullableText }).nullish(), organizer: recipientSchema.nullish(),
  attendees: z.array(recipientSchema.extend({ type: z.string().max(50).nullish() })).max(500).optional(), transactionId: nullableText,
});
const messageSchema = providerRevision.extend({
  id: opaqueId, parentFolderId: opaqueId, subject: shortText,
  from: recipientSchema.nullish(), toRecipients: recipientsSchema.optional(), ccRecipients: recipientsSchema.optional(), bccRecipients: recipientsSchema.optional(),
  receivedDateTime: nullableText, sentDateTime: nullableText, lastModifiedDateTime: nullableText,
  isDraft: z.boolean(), isRead: z.boolean(), hasAttachments: z.boolean(), bodyPreview: z.string().max(2000), internetMessageId: nullableText,
});
const detailSchema = messageSchema.extend({ body: z.object({ contentType: z.enum(['text', 'Text']), content: z.string().max(100_000) }) });
const collectionSchema = z.object({ value: z.array(z.unknown()).max(1000), '@odata.nextLink': z.string().max(16_384).nullish() });
function parse<T>(schema: z.ZodType<T>, value: unknown, code: GraphErrorCode = 'invalid_response'): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new MicrosoftGraphError(code);
  return result.data;
}
function segment(value: string): string { return encodeURIComponent(parse(opaqueId, value, 'invalid_input')); }
function dateInstant(value: string, code: GraphErrorCode = 'invalid_response'): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) throw new MicrosoftGraphError(code);
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) throw new MicrosoftGraphError(code);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new MicrosoftGraphError(code);
  return new Date(ms).toISOString();
}
function optionalInstant(value: string | undefined | null): string | null { return value ? dateInstant(value) : null; }
function graphInstant(value: z.infer<typeof dateTimeSchema>): string {
  // Reject ambiguous local wall times instead of guessing across DST.
  if (!['UTC', 'Etc/UTC'].includes(value.timeZone)) throw new MicrosoftGraphError('invalid_response');
  return dateInstant(value.dateTime.endsWith('Z') ? value.dateTime : `${value.dateTime}Z`);
}
function range(input: GraphDateRange): GraphDateRange {
  const start = dateInstant(input.start, 'invalid_input'), end = dateInstant(input.end, 'invalid_input');
  const duration = Date.parse(end) - Date.parse(start);
  if (duration <= 0 || duration > 31 * 86_400_000) throw new MicrosoftGraphError('invalid_input');
  return { start, end };
}
function address(input: z.infer<typeof addressSchema>): GraphAddress { return { address: input.address, name: input.name ?? null }; }
function recipient(input: z.infer<typeof recipientSchema>): GraphAddress { return address(input.emailAddress); }
function makeUrl(path: string, query: Record<string, string> = {}): URL {
  const url = new URL(`${GRAPH}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new MicrosoftGraphError('timeout'));
    if (signal.aborted) { pending.catch(() => undefined); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Continuations may change the cursor, never mailbox, selected resource, fields or time range. */
function nextUrl(raw: string, initial: URL): URL {
  let next: URL;
  try { next = new URL(raw); } catch { throw new MicrosoftGraphError('unsafe_pagination'); }
  if (next.origin !== 'https://graph.microsoft.com' || next.username || next.password || next.hash || next.pathname !== initial.pathname) throw new MicrosoftGraphError('unsafe_pagination');
  for (const [key, value] of initial.searchParams) {
    if (next.searchParams.getAll(key).length !== 1 || next.searchParams.get(key) !== value) throw new MicrosoftGraphError('unsafe_pagination');
  }
  for (const [key, value] of next.searchParams) {
    if (next.searchParams.getAll(key).length !== 1) throw new MicrosoftGraphError('unsafe_pagination');
    if (initial.searchParams.has(key)) continue;
    if (key !== '$skip' && key !== '$skiptoken') throw new MicrosoftGraphError('unsafe_pagination');
    if ((key === '$skip' && !/^\d{1,10}$/.test(value)) || !value || value.length > 12_000) throw new MicrosoftGraphError('unsafe_pagination');
  }
  if (!next.searchParams.has('$skip') && !next.searchParams.has('$skiptoken')) throw new MicrosoftGraphError('unsafe_pagination');
  return next;
}

type RawResponse = { value: unknown; status: number; bytes: number; etag: string | null };
export class MicrosoftGraphClient {
  readonly #token: string;
  readonly #accountId: string;
  readonly #calendars: ReadonlySet<string>;
  readonly #folders: ReadonlySet<string>;
  readonly #fetch: typeof fetch;
  readonly #clock: () => Date;
  readonly #signal?: AbortSignal;
  readonly #beforeRequest?: () => Promise<void>;
  readonly #limits: GraphLimits;
  #identity?: Promise<GraphIdentity>;

  constructor(options: MicrosoftGraphOptions) {
    if (!options.accessToken || /[\r\n]/.test(options.accessToken) || options.accessToken.length > 32_000) throw new MicrosoftGraphError('invalid_input');
    this.#token = options.accessToken;
    this.#accountId = parse(opaqueId, options.expectedAccountId, 'invalid_input');
    this.#calendars = new Set((options.allowedCalendarIds ?? []).map(id => parse(opaqueId, id, 'invalid_input')));
    this.#folders = new Set((options.allowedMailFolderIds ?? []).map(id => parse(opaqueId, id, 'invalid_input')));
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#clock = options.clock ?? (() => new Date());
    this.#signal = options.signal;
    this.#beforeRequest = options.beforeRequest;
    this.#limits = { ...DEFAULT_LIMITS, ...options.limits };
    for (const key of Object.keys(DEFAULT_LIMITS) as Array<keyof GraphLimits>) {
      const value = this.#limits[key];
      if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key]) throw new MicrosoftGraphError('invalid_input');
    }
  }

  async verifyIdentity(): Promise<GraphIdentity> {
    // One client owns one immutable token. A refresh must construct a new client,
    // and therefore cannot inherit another token's successful /me proof.
    this.#identity ??= (async () => {
      const response = await this.#request(makeUrl('/me', { $select: 'id,displayName,mail,userPrincipalName' }));
      const item = parse(identitySchema, response.value);
      if (item.id !== this.#accountId) throw new MicrosoftGraphError('account_mismatch');
      return Object.freeze({ id: item.id, displayName: item.displayName ?? null, mail: item.mail ?? null, userPrincipalName: item.userPrincipalName ?? null, fetchedAt: this.#now() });
    })();
    return this.#identity;
  }

  async listCalendars(): Promise<GraphCollection<GraphCalendar>> {
    const identity = await this.verifyIdentity();
    const result = await this.#collection(makeUrl('/me/calendars', { $select: CALENDAR_FIELDS, $top: String(this.#limits.pageSize) }), value => this.#calendar(value));
    // /me can include shared calendars. An allowlist alone is not ownership proof.
    return { ...result, items: result.items.filter(item => this.#isOwnCalendar(item, identity)) };
  }

  async listMailFolders(parentFolderId?: string): Promise<GraphCollection<GraphMailFolder>> {
    await this.verifyIdentity();
    const path = parentFolderId ? `/me/mailFolders/${segment(parentFolderId)}/childFolders` : '/me/mailFolders';
    return this.#collection(makeUrl(path, { $select: FOLDER_FIELDS, $top: String(this.#limits.pageSize) }), value => {
      const item = parse(folderSchema, value);
      return { id: item.id, displayName: item.displayName, parentFolderId: item.parentFolderId ?? null, childFolderCount: item.childFolderCount ?? null, totalItemCount: item.totalItemCount ?? null, unreadItemCount: item.unreadItemCount ?? null, fetchedAt: this.#now() };
    });
  }

  async calendarView(calendarId: string, dates: GraphDateRange): Promise<GraphCollection<GraphCalendarEvent>> {
    this.#allow(this.#calendars, calendarId);
    const bounded = range(dates);
    await this.#verifyCalendar(calendarId);
    return this.#collection(makeUrl(`/me/calendars/${segment(calendarId)}/calendarView`, {
      startDateTime: bounded.start, endDateTime: bounded.end, $select: CALENDAR_VIEW_FIELDS, $top: String(this.#limits.pageSize),
    }), value => {
      const item = this.#event(value, calendarId);
      if (item.type === 'seriesMaster' || item.start >= bounded.end || item.end <= bounded.start) throw new MicrosoftGraphError('invalid_response');
      return item;
    });
  }

  async getCalendarEvent(calendarId: string, eventId: string): Promise<GraphCalendarEvent> {
    this.#allow(this.#calendars, calendarId);
    segment(eventId);
    await this.#verifyCalendar(calendarId);
    const response = await this.#request(makeUrl(`/me/calendars/${segment(calendarId)}/events/${segment(eventId)}`, { $select: EVENT_FIELDS }));
    const item = this.#event(response.value, calendarId, response.etag);
    if (item.id !== eventId) throw new MicrosoftGraphError('invalid_response');
    return item;
  }

  async listMessages(folderId: string, dates: GraphDateRange): Promise<GraphCollection<GraphMessage>> {
    this.#allow(this.#folders, folderId);
    const bounded = range(dates);
    await this.verifyIdentity();
    return this.#collection(makeUrl(`/me/mailFolders/${segment(folderId)}/messages`, {
      $select: MESSAGE_FIELDS, $filter: `receivedDateTime ge ${bounded.start} and receivedDateTime lt ${bounded.end}`,
      $orderby: 'receivedDateTime desc', $top: String(this.#limits.pageSize),
    }), value => {
      const item = this.#message(value, folderId);
      if (!item.receivedAt || item.receivedAt < bounded.start || item.receivedAt >= bounded.end) throw new MicrosoftGraphError('invalid_response');
      return item;
    });
  }

  async getMessage(folderId: string, messageId: string): Promise<GraphMessageDetail> {
    this.#allow(this.#folders, folderId);
    segment(messageId);
    await this.verifyIdentity();
    const response = await this.#request(makeUrl(`/me/mailFolders/${segment(folderId)}/messages/${segment(messageId)}`, { $select: `${MESSAGE_FIELDS},body` }));
    const raw = parse(detailSchema, response.value);
    const item = this.#message(raw, folderId, response.etag);
    if (item.id !== messageId) throw new MicrosoftGraphError('invalid_response');
    return { ...item, bodyText: raw.body.content };
  }

  /** Only reviewed care-service actions call these fixed /me endpoints. No model-supplied URL or sender. */
  async createMailDraft(action:Extract<MicrosoftAction,{kind:'send_mail'}>):Promise<{id:string}> {
    const input=parse(microsoftActionSchema,action,'invalid_input');
    if(input.kind!=='send_mail')throw new MicrosoftGraphError('invalid_input');
    await this.verifyIdentity();
    const response=await this.#request(makeUrl('/me/messages'),{method:'POST',expectedStatus:201,body:{subject:input.subject,body:{contentType:'Text',content:input.body},toRecipients:input.to.map(address=>({emailAddress:{address}}))}});
    return parse(z.object({id:opaqueId,isDraft:z.literal(true)}),response.value);
  }
  async sendCreatedDraft(id:string):Promise<void> {
    await this.verifyIdentity();
    await this.#request(makeUrl(`/me/messages/${segment(id)}/send`),{method:'POST',expectedStatus:202,body:{},empty:true});
  }
  /** ID comes exclusively from an encrypted receipt for a draft this service created. */
  async inspectCreatedMessage(id:string):Promise<{id:string;subject:string;to:string[];sent_at:string|null;is_draft:boolean}> {
    await this.verifyIdentity();
    const response=await this.#request(makeUrl(`/me/messages/${segment(id)}`,{$select:'id,subject,toRecipients,sentDateTime,isDraft'}));
    const item=parse(z.object({id:opaqueId,subject:shortText,toRecipients:recipientsSchema,sentDateTime:nullableText,isDraft:z.boolean()}),response.value);
    if(item.id!==id)throw new MicrosoftGraphError('invalid_response');
    return {id:item.id,subject:item.subject,to:item.toRecipients.map(r=>r.emailAddress.address),sent_at:optionalInstant(item.sentDateTime),is_draft:item.isDraft};
  }
  async createCalendarEvent(action:Extract<MicrosoftAction,{kind:'create_event'}>,transactionId:string):Promise<{id:string}> {
    const input=parse(microsoftActionSchema,action,'invalid_input');
    if(input.kind!=='create_event'||!input.calendar_id)throw new MicrosoftGraphError('invalid_input');
    parse(z.uuid(),transactionId,'invalid_input');this.#allow(this.#calendars,input.calendar_id);
    if((await this.#verifyCalendar(input.calendar_id)).canEdit!==true)throw new MicrosoftGraphError('resource_denied');
    const response=await this.#request(makeUrl(`/me/calendars/${segment(input.calendar_id)}/events`),{method:'POST',expectedStatus:201,body:{subject:input.subject,start:{dateTime:dateInstant(input.start).replace(/Z$/,''),timeZone:'UTC'},end:{dateTime:dateInstant(input.end).replace(/Z$/,''),timeZone:'UTC'},attendees:input.attendees.map(address=>({emailAddress:{address},type:'required'})),transactionId}});
    return parse(z.object({id:opaqueId}),response.value);
  }

  #now(): string { return this.#clock().toISOString(); }
  #allow(allowed: ReadonlySet<string>, id: string): void {
    parse(opaqueId, id, 'invalid_input');
    if (!allowed.has(id)) throw new MicrosoftGraphError('resource_denied');
  }
  #isOwnCalendar(calendar: GraphCalendar, identity: GraphIdentity): boolean {
    return !!calendar.owner && [identity.mail, identity.userPrincipalName].some(value => value && value.toLowerCase() === calendar.owner!.address.toLowerCase());
  }
  async #verifyCalendar(id: string): Promise<GraphCalendar> {
    const identity = await this.verifyIdentity();
    const response = await this.#request(makeUrl(`/me/calendars/${segment(id)}`, { $select: CALENDAR_FIELDS }));
    const calendar = this.#calendar(response.value, response.etag);
    if (calendar.id !== id || !this.#isOwnCalendar(calendar, identity)) throw new MicrosoftGraphError('resource_denied');
    return calendar;
  }
  #calendar(value: unknown, responseEtag: string | null = null): GraphCalendar {
    const item = parse(calendarSchema, value);
    return { id: item.id, name: item.name, owner: item.owner ? address(item.owner) : null, canEdit: item.canEdit ?? null, isDefault: item.isDefaultCalendar ?? null, changeKey: item.changeKey ?? null, etag: item['@odata.etag'] ?? responseEtag, fetchedAt: this.#now() };
  }
  #event(value: unknown, calendarId: string, responseEtag: string | null = null): GraphCalendarEvent {
    const item = parse(eventSchema, value), start = graphInstant(item.start), end = graphInstant(item.end);
    if (Date.parse(end) < Date.parse(start)) throw new MicrosoftGraphError('invalid_response');
    return { id: item.id, calendarId, subject: item.subject, start, end, isAllDay: item.isAllDay, isCancelled: item.isCancelled, isOrganizer: item.isOrganizer ?? null,
      type: item.type, seriesMasterId: item.seriesMasterId ?? null, iCalUId: item.iCalUId ?? null, changeKey: item.changeKey ?? null, etag: item['@odata.etag'] ?? responseEtag,
      lastModifiedAt: optionalInstant(item.lastModifiedDateTime), location: item.location?.displayName ?? null, organizer: item.organizer ? recipient(item.organizer) : null,
      attendees: (item.attendees ?? []).map(value => ({ ...recipient(value), type: value.type ?? null })), transactionId: item.transactionId ?? null, fetchedAt: this.#now() };
  }
  #message(value: unknown, folderId: string, responseEtag: string | null = null): GraphMessage {
    const item = parse(messageSchema, value);
    if (item.parentFolderId !== folderId) throw new MicrosoftGraphError('resource_denied');
    return { id: item.id, folderId: item.parentFolderId, subject: item.subject, from: item.from ? recipient(item.from) : null,
      to: (item.toRecipients ?? []).map(recipient), cc: (item.ccRecipients ?? []).map(recipient), bcc: (item.bccRecipients ?? []).map(recipient),
      receivedAt: optionalInstant(item.receivedDateTime), sentAt: optionalInstant(item.sentDateTime), lastModifiedAt: optionalInstant(item.lastModifiedDateTime),
      isDraft: item.isDraft, isRead: item.isRead, hasAttachments: item.hasAttachments, preview: item.bodyPreview,
      changeKey: item.changeKey ?? null, etag: item['@odata.etag'] ?? responseEtag, internetMessageId: item.internetMessageId ?? null, fetchedAt: this.#now() };
  }

  async #collection<T>(initial: URL, decode: (value: unknown) => T): Promise<GraphCollection<T>> {
    const items: T[] = [], visited = new Set<string>();
    const deadline = performance.now() + this.#limits.operationTimeoutMs;
    let url = initial, bytes = 0, pages = 0;
    const result = (truncation: GraphCollection<T>['truncation']): GraphCollection<T> => ({ items, fetchedAt: this.#now(), complete: truncation === null, truncation });
    for (;;) {
      if (performance.now() >= deadline) return result('time');
      if (visited.has(url.href)) throw new MicrosoftGraphError('unsafe_pagination');
      visited.add(url.href);
      const response = await this.#request(url, { timeoutMs: Math.min(this.#limits.requestTimeoutMs, deadline - performance.now()), maxBytes: this.#limits.maxTotalBytes - bytes });
      bytes += response.bytes; pages++;
      const collection = parse(collectionSchema, response.value);
      const remaining = this.#limits.maxItems - items.length;
      for (const value of collection.value.slice(0, remaining)) items.push(decode(value));
      // Validate the continuation even when a local cap prevents following it.
      const next = collection['@odata.nextLink'] ? nextUrl(collection['@odata.nextLink'], initial) : null;
      if (collection.value.length > remaining || (next && items.length >= this.#limits.maxItems)) return result('items');
      if (!next) return result(null);
      if (pages >= this.#limits.maxPages) return result('pages');
      if (bytes >= this.#limits.maxTotalBytes) return result('bytes');
      url = next;
    }
  }

  async #request(url: URL, options: { timeoutMs?: number; maxBytes?: number;method?:'POST';body?:unknown;expectedStatus?:number;empty?:boolean } = {}): Promise<RawResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs ?? this.#limits.requestTimeoutMs));
    const signal = this.#signal ? AbortSignal.any([controller.signal, this.#signal]) : controller.signal;
    const headers: Record<string, string> = { Authorization: `Bearer ${this.#token}`, Accept: 'application/json', Prefer: PREFER };
    if(options.method)headers['Content-Type']='application/json';
    let response: Response | undefined;
    let authorizationChecked = false;
    try {
      if (signal.aborted) throw new MicrosoftGraphError('timeout');
      if (this.#beforeRequest) await abortable(this.#beforeRequest(), signal);
      authorizationChecked = true;
      if (signal.aborted) throw new MicrosoftGraphError('timeout');
      response = await abortable(this.#fetch(url, { method: options.method??'GET', ...(options.body===undefined?{}:{body:JSON.stringify(options.body)}), headers, redirect: 'error', credentials: 'omit', cache: 'no-store', signal }), signal);
      if (response.redirected || response.status !== (options.expectedStatus??200)) throw new MicrosoftGraphError('provider_error', response.status);
      if(options.empty)return {value:null,status:response.status,bytes:0,etag:null};
      const responseTag = response.headers.get('etag');
      if (responseTag) parse(etag, responseTag);
      if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new MicrosoftGraphError('invalid_response', response.status);
      const maximum = Math.min(this.#limits.maxResponseBytes, options.maxBytes ?? this.#limits.maxResponseBytes);
      const declared = response.headers.get('content-length');
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new MicrosoftGraphError('response_too_large', response.status);
      if (!response.body) throw new MicrosoftGraphError('invalid_response', response.status);
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const chunk = await abortable(reader.read(), signal);
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > maximum) throw new MicrosoftGraphError('response_too_large', response.status);
          chunks.push(chunk.value);
        }
      } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
      try { return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')), status: response.status, bytes, etag: responseTag }; }
      catch { throw new MicrosoftGraphError('invalid_response', response.status); }
    } catch (error) {
      if (!authorizationChecked) throw error;
      if (error instanceof MicrosoftGraphError) throw error;
      throw new MicrosoftGraphError(signal.aborted ? 'timeout' : 'network_error', response?.status ?? null);
    } finally {
      clearTimeout(timeout);
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
    }
  }
}
