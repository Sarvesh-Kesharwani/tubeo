// Google Drive App Data folder helpers - stores channels.json privately in user's Drive.
// App Data is invisible to the user in Drive UI and only accessible by this app.
import { normalizeSpaceName } from './spaces';
import {
  DEFAULT_CHANNEL_SPACE,
  normalizeVocabWord,
  vocabIdFromWord,
  type DailyQuotaUsageHistory,
  type DailyQuotaUsage,
  type ApiUsageOperation,
  type ChannelPreference,
  type ChannelPreferenceStore,
  type DiscoverSearchFilters,
  type DiscoverSearchRecord,
  type DiscoveredChannel,
  type NewsYouLearnState,
  type NewsYouLearnVideo,
  type NewsYouLearnVideoSummary,
  type ViewPreferences,
  type VocabItem,
  type VocabMeaningStatus,
} from './types';
import { DEFAULT_VIEW_PREFERENCES, normalizeViewPreferences } from './view-preferences';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FILE_NAME = 'tubeo-channels.json';
const BACKUP_FOLDER_NAME = 'tubeo-backups';
const SNAPSHOT_FILE_PREFIX = 'tubeo-snapshot-';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const SPACE = 'appDataFolder';
const EPOCH = new Date(0).toISOString();

export interface DriveChannelData {
  channelIds?: string[];
  channels?: ChannelPreference[];
  spaces?: string[];
  view?: Partial<ViewPreferences>;
  viewUpdatedAt?: string;
  updatesChannelIds?: string[];
  vocabs?: VocabItem[];
  ignoredChannels?: DiscoveredChannel[];
  discoverSearches?: DiscoverSearchRecord[];
  activeDiscoverSearchId?: string;
  discoverDraft?: Partial<DiscoverSearchFilters>;
  lastPagePath?: string;
  newsYouLearn?: Partial<NewsYouLearnState>;
  quota?: DailyQuotaUsage;
  deepseekQuota?: DailyQuotaUsage;
  quotaHistory?: DailyQuotaUsageHistory;
  deepseekQuotaHistory?: DailyQuotaUsageHistory;
  updatedAt: string; // ISO
}

export interface DriveSyncState extends ChannelPreferenceStore {
  quota: DailyQuotaUsage;
  deepseekQuota: DailyQuotaUsage;
  quotaHistory: DailyQuotaUsageHistory;
  deepseekQuotaHistory: DailyQuotaUsageHistory;
  updatedAt: string;
}

export interface DriveWriteState extends ChannelPreferenceStore {
  quota?: DailyQuotaUsage | null;
  deepseekQuota?: DailyQuotaUsage | null;
  quotaHistory?: DailyQuotaUsageHistory | null;
  deepseekQuotaHistory?: DailyQuotaUsageHistory | null;
}

export interface DriveBackupSummary {
  id: string;
  name: string;
  createdTime?: string;
  date: string | null;
  type: 'daily' | 'snapshot';
}

const DEFAULT_QUOTA_RESET_TIMEZONE = process.env.YOUTUBE_QUOTA_RESET_TIMEZONE?.trim() || 'Asia/Kolkata';

function dedupeSpaces(spaces: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const space of spaces) {
    const normalized = normalizeSpaceName(space);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function dedupeChannels(channels: ChannelPreference[]): ChannelPreference[] {
  const seen = new Set<string>();
  const out: ChannelPreference[] = [];

  for (const channel of channels) {
    const id = channel.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, space: normalizeSpaceName(channel.space) });
  }

  return out;
}

function normalizeUpdatesChannelIds(value: string[] | undefined, channelIds: string[]): string[] {
  const valid = new Set(channelIds);
  return [...new Set((value ?? []).map((id) => id.trim()).filter((id) => valid.has(id)))];
}

function normalizeVocabStatus(status: unknown): VocabMeaningStatus {
  return status === 'ready' || status === 'failed' ? status : 'pending';
}

function normalizeVocabs(value: VocabItem[] | undefined): VocabItem[] {
  const seen = new Set<string>();
  const out: VocabItem[] = [];

  for (const item of value ?? []) {
    const word = normalizeVocabWord(item?.word ?? '');
    if (!word) continue;
    const id = (item?.id ?? '').trim() || vocabIdFromWord(word);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      word,
      meaning: typeof item.meaning === 'string' ? item.meaning : '',
      status: normalizeVocabStatus(item.status),
      addedAt: item.addedAt || new Date().toISOString(),
      meaningUpdatedAt: item.meaningUpdatedAt || item.addedAt || new Date().toISOString(),
    });
  }

  return out;
}

function normalizeNewsYouLearnVideo(value: unknown): NewsYouLearnVideo | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<NewsYouLearnVideo>;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const url = typeof item.url === 'string' ? item.url.trim() : '';
  if (!id || !url) return null;

  return {
    id,
    title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : 'YouLearn video',
    url,
    thumbnail: typeof item.thumbnail === 'string' && item.thumbnail.trim() ? item.thumbnail.trim() : undefined,
    durationSec:
      typeof item.durationSec === 'number' && Number.isFinite(item.durationSec) && item.durationSec > 0
        ? Math.round(item.durationSec)
        : 0,
    contentId: typeof item.contentId === 'string' && item.contentId.trim() ? item.contentId.trim() : undefined,
    importedAt: typeof item.importedAt === 'string' && item.importedAt.trim() ? item.importedAt : new Date().toISOString(),
    completedAt:
      typeof item.completedAt === 'string' && item.completedAt.trim()
        ? item.completedAt
        : undefined,
  };
}

function normalizeNewsYouLearnSummary(value: unknown): NewsYouLearnVideoSummary | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<NewsYouLearnVideoSummary>;
  const date = typeof item.date === 'string' ? item.date.trim() : '';
  const videoId = typeof item.videoId === 'string' ? item.videoId.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !videoId) return null;

  return {
    date,
    videoId,
    videoTitle: typeof item.videoTitle === 'string' && item.videoTitle.trim() ? item.videoTitle.trim() : 'YouLearn video',
    videoUrl: typeof item.videoUrl === 'string' ? item.videoUrl.trim() : '',
    thumbnail: typeof item.thumbnail === 'string' && item.thumbnail.trim() ? item.thumbnail.trim() : undefined,
    data: item.data ?? null,
    raw: typeof item.raw === 'string' ? item.raw : '',
    promptHash: typeof item.promptHash === 'string' ? item.promptHash : '',
    generatedAt: typeof item.generatedAt === 'string' && item.generatedAt.trim() ? item.generatedAt : new Date().toISOString(),
  };
}

export function emptyNewsYouLearnState(): NewsYouLearnState {
  return {
    sourceUrl: '',
    importedAt: new Date(0).toISOString(),
    prompt: '',
    videos: [],
    summaries: {},
  };
}

function normalizeNewsYouLearnState(value: Partial<NewsYouLearnState> | undefined): NewsYouLearnState {
  if (!value || typeof value !== 'object') return emptyNewsYouLearnState();
  const seen = new Set<string>();
  const videos: NewsYouLearnVideo[] = [];
  for (const raw of Array.isArray(value.videos) ? value.videos : []) {
    const video = normalizeNewsYouLearnVideo(raw);
    if (!video || seen.has(video.id)) continue;
    seen.add(video.id);
    videos.push(video);
  }

  const summaries: Record<string, NewsYouLearnVideoSummary> = {};
  if (value.summaries && typeof value.summaries === 'object') {
    for (const raw of Object.values(value.summaries)) {
      const summary = normalizeNewsYouLearnSummary(raw);
      if (summary) summaries[summary.date] = summary;
    }
  }

  const trimmedSummaries: Record<string, NewsYouLearnVideoSummary> = {};
  for (const key of Object.keys(summaries).sort().reverse().slice(0, 90)) {
    trimmedSummaries[key] = summaries[key];
  }

  return {
    sourceUrl: typeof value.sourceUrl === 'string' ? value.sourceUrl.trim() : '',
    importedAt: typeof value.importedAt === 'string' && value.importedAt.trim() ? value.importedAt : new Date(0).toISOString(),
    prompt: typeof value.prompt === 'string' ? value.prompt.slice(0, 8000) : '',
    videos,
    summaries: trimmedSummaries,
  };
}

function normalizeIgnoredChannels(value: DiscoveredChannel[] | undefined): DiscoveredChannel[] {
  const seen = new Set<string>();
  const out: DiscoveredChannel[] = [];

  for (const item of value ?? []) {
    const id = item?.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: item.title?.trim() || id,
      thumbnail: item.thumbnail || '',
      description: item.description || '',
      ignoredAt: item.ignoredAt || new Date().toISOString(),
      subscriberCount: typeof item.subscriberCount === 'number' ? item.subscriberCount : undefined,
      viewCount: typeof item.viewCount === 'number' ? item.viewCount : undefined,
      videoCount: typeof item.videoCount === 'number' ? item.videoCount : undefined,
      country: item.country || undefined,
    });
  }

  return out;
}

function normalizeDiscoverFilters(value: Partial<DiscoverSearchFilters> | undefined): DiscoverSearchFilters {
  return {
    q: value?.q?.trim() ?? '',
    order: value?.order?.trim() || 'rating',
    regionCode: value?.regionCode?.trim() ?? '',
    relevanceLanguage: value?.relevanceLanguage?.trim() ?? 'en',
    safeSearch: value?.safeSearch?.trim() || 'moderate',
    channelType: value?.channelType?.trim() || 'any',
    topicId: value?.topicId?.trim() ?? '',
    publishedAfter: value?.publishedAfter?.trim() ?? '',
    publishedBefore: value?.publishedBefore?.trim() ?? '',
  };
}

function normalizeDiscoverSearches(value: DiscoverSearchRecord[] | undefined): DiscoverSearchRecord[] {
  const seen = new Set<string>();
  const out: DiscoverSearchRecord[] = [];

  for (const item of value ?? []) {
    const id = item?.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      filters: normalizeDiscoverFilters(item.filters),
      pages: (item.pages ?? [])
        .map((page) => ({
          pageNumber: Math.max(1, Math.floor(Number(page.pageNumber) || 1)),
          pageToken: page.pageToken || undefined,
          nextPageToken: page.nextPageToken || undefined,
          channels: normalizeIgnoredChannels(page.channels),
          hiddenIgnored: Math.max(0, Math.floor(Number(page.hiddenIgnored) || 0)),
          quotaUnits: Math.max(0, Math.floor(Number(page.quotaUnits) || 0)),
          searchedAt: page.searchedAt || item.updatedAt || new Date().toISOString(),
        }))
        .sort((a, b) => a.pageNumber - b.pageNumber),
      activePage: Math.max(1, Math.floor(Number(item.activePage) || 1)),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
    });
  }

  return out
    .filter((item) => item.filters.q || item.pages.length > 0)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 50);
}

function safeQuotaDate(now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_QUOTA_RESET_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }
}

export function getQuotaResetTimezone(): string {
  return DEFAULT_QUOTA_RESET_TIMEZONE;
}

export function getQuotaUsageDate(now = new Date()): string {
  return safeQuotaDate(now);
}

export function normalizeQuotaUsage(quota?: DailyQuotaUsage | null, now = new Date()): DailyQuotaUsage {
  const today = safeQuotaDate(now);
  if (!quota || quota.date !== today) {
    return {
      date: today,
      used: 0,
      operations: [],
      updatedAt: now.toISOString(),
    };
  }

  const operations = normalizeUsageOperations(quota.operations);
  const used = Math.max(
    Math.max(0, Math.floor(quota.used || 0)),
    operations.reduce((sum, operation) => sum + operation.units, 0),
  );

  return {
    date: today,
    used,
    operations,
    updatedAt: quota.updatedAt || now.toISOString(),
  };
}

function normalizeUsageOperations(value: ApiUsageOperation[] | undefined): ApiUsageOperation[] {
  return (value ?? [])
    .map((item) => ({
      id: String(item?.id ?? '').trim(),
      label: String(item?.label ?? '').trim(),
      units: Math.max(0, Math.ceil(Number(item?.units ?? 0))),
      at: item?.at || new Date().toISOString(),
    }))
    .filter((item) => item.id && item.label && item.units > 0)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-200);
}

function normalizeStoredQuotaUsage(quota?: DailyQuotaUsage | null, fallbackDate?: string): DailyQuotaUsage | null {
  if (!quota) return null;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(quota.date ?? '')
    ? quota.date
    : fallbackDate ?? safeQuotaDate(new Date(Date.parse(quota.updatedAt || '') || Date.now()));
  const operations = normalizeUsageOperations(quota.operations);
  const used = Math.max(
    Math.max(0, Math.floor(Number(quota.used) || 0)),
    operations.reduce((sum, operation) => sum + operation.units, 0),
  );
  if (used <= 0 && operations.length === 0) return null;

  return {
    date,
    used,
    operations,
    updatedAt: quota.updatedAt || operations.at(-1)?.at || new Date().toISOString(),
  };
}

export function normalizeQuotaHistory(
  history?: DailyQuotaUsageHistory | null,
  rolloverCandidate?: DailyQuotaUsage | null,
  now = new Date(),
): DailyQuotaUsageHistory {
  const today = safeQuotaDate(now);
  const byDate = new Map<string, DailyQuotaUsage>();

  function merge(entry: DailyQuotaUsage | null) {
    if (!entry || entry.date === today) return;
    const existing = byDate.get(entry.date);
    if (!existing) {
      byDate.set(entry.date, entry);
      return;
    }

    const operationsById = new Map<string, ApiUsageOperation>();
    for (const operation of [...(existing.operations ?? []), ...(entry.operations ?? [])]) {
      operationsById.set(operation.id, operation);
    }
    const operations = [...operationsById.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-200);
    const used = Math.max(
      existing.used,
      entry.used,
      operations.reduce((sum, operation) => sum + operation.units, 0),
    );
    byDate.set(entry.date, {
      date: entry.date,
      used,
      operations,
      updatedAt:
        Date.parse(entry.updatedAt) >= Date.parse(existing.updatedAt)
          ? entry.updatedAt
          : existing.updatedAt,
    });
  }

  for (const item of history ?? []) merge(normalizeStoredQuotaUsage(item));
  merge(normalizeStoredQuotaUsage(rolloverCandidate));

  return [...byDate.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 730);
}

export function normalizeDriveChannelData(data: DriveChannelData | null): DriveSyncState | null {
  if (!data) return null;

  const channels = Array.isArray(data.channels)
    ? data.channels
    : (data.channelIds ?? []).map((id) => ({ id, space: DEFAULT_CHANNEL_SPACE }));
  const normalizedChannels = dedupeChannels(channels);
  const spaces = dedupeSpaces([
    DEFAULT_CHANNEL_SPACE,
    ...(data.spaces ?? []),
    ...normalizedChannels.map((channel) => channel.space),
  ]);
  const lastPagePath =
    typeof data.lastPagePath === 'string' && data.lastPagePath.startsWith('/')
      ? data.lastPagePath
      : undefined;
  const quotaHistory = normalizeQuotaHistory(data.quotaHistory, data.quota);
  const deepseekQuotaHistory = normalizeQuotaHistory(data.deepseekQuotaHistory, data.deepseekQuota);

  return {
    channels: normalizedChannels,
    spaces,
    view: normalizeViewPreferences(data.view),
    viewUpdatedAt: data.viewUpdatedAt ?? data.updatedAt ?? EPOCH,
    updatesChannelIds: normalizeUpdatesChannelIds(data.updatesChannelIds, normalizedChannels.map((channel) => channel.id)),
    vocabs: normalizeVocabs(data.vocabs),
    ignoredChannels: normalizeIgnoredChannels(data.ignoredChannels),
    discoverSearches: normalizeDiscoverSearches(data.discoverSearches),
    activeDiscoverSearchId: data.activeDiscoverSearchId,
    discoverDraft: normalizeDiscoverFilters(data.discoverDraft),
    lastPagePath,
    newsYouLearn: normalizeNewsYouLearnState(data.newsYouLearn),
    quota: normalizeQuotaUsage(data.quota),
    deepseekQuota: normalizeQuotaUsage(data.deepseekQuota),
    quotaHistory,
    deepseekQuotaHistory,
    updatedAt: data.updatedAt ?? new Date(0).toISOString(),
  };
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function listFiles(
  accessToken: string,
  query: string,
  fields = 'files(id,name,mimeType,createdTime)',
): Promise<Array<{ id: string; name?: string; mimeType?: string; createdTime?: string }>> {
  const qs = new URLSearchParams({ spaces: SPACE, fields, q: query });
  const res = await fetch(`${DRIVE_API}/files?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.files ?? [];
}

async function findFile(
  accessToken: string,
  name = FILE_NAME,
  parent: string = SPACE,
  mimeType?: string,
): Promise<string | null> {
  const queryParts = [`name='${escapeDriveQueryValue(name)}'`, `'${escapeDriveQueryValue(parent)}' in parents`];
  if (mimeType) queryParts.push(`mimeType='${escapeDriveQueryValue(mimeType)}'`);
  const files = await listFiles(accessToken, queryParts.join(' and '), 'files(id)');
  return files[0]?.id ?? null;
}

async function readFileJson<T>(accessToken: string, fileId: string): Promise<T | null> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json() as Promise<T>;
}

async function readPrimaryDriveData(accessToken: string): Promise<{ id: string; data: DriveChannelData | null } | null> {
  const fileId = await findFile(accessToken);
  if (!fileId) return null;

  return {
    id: fileId,
    data: await readFileJson<DriveChannelData>(accessToken, fileId),
  };
}

function snapshotFileName(now = new Date()): string {
  return `${SNAPSHOT_FILE_PREFIX}${now.toISOString().replace(/[:]/g, '-')}.json`;
}

function backupDateFromName(name: string | undefined): string | null {
  if (!name) return null;
  const daily = /^tubeo-channels-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
  if (daily) return daily[1];
  const snapshot = /^tubeo-snapshot-(\d{4}-\d{2}-\d{2})T/.exec(name);
  return snapshot?.[1] ?? null;
}

function backupTypeFromName(name: string | undefined): DriveBackupSummary['type'] {
  return name?.startsWith(SNAPSHOT_FILE_PREFIX) ? 'snapshot' : 'daily';
}

export function getPreviousBackupDate(now = new Date()): string {
  return safeQuotaDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

async function uploadJsonFile(
  accessToken: string,
  name: string,
  body: string,
  options?: { fileId?: string; parents?: string[] },
): Promise<void> {
  if (options?.fileId) {
    const res = await fetch(`${UPLOAD_API}/files/${options.fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Drive upload (PATCH ${name}) failed: ${res.status} ${detail.slice(0, 200)}`);
    }
    return;
  }

  const metadata = JSON.stringify({ name, parents: options?.parents ?? [SPACE] });
  const boundary = 'tubeo_boundary';
  const multipart = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    body,
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Drive upload (POST ${name}) failed: ${res.status} ${detail.slice(0, 200)}`);
  }
}

async function ensureBackupFolder(accessToken: string): Promise<string> {
  const existingId = await findFile(accessToken, BACKUP_FOLDER_NAME, SPACE, FOLDER_MIME_TYPE);
  if (existingId) return existingId;

  const metadata = JSON.stringify({
    name: BACKUP_FOLDER_NAME,
    mimeType: FOLDER_MIME_TYPE,
    parents: [SPACE],
  });
  const res = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: metadata,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to create backup folder: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.id) throw new Error('Drive backup folder ID missing');
  return data.id as string;
}

async function ensureDailyBackup(
  accessToken: string,
  existing: { id: string; data: DriveChannelData | null } | null,
): Promise<void> {
  const previousDate = existing?.data?.quota?.date?.trim();
  const today = safeQuotaDate();
  if (!existing?.data || !previousDate || previousDate === today) return;

  const backupFolderId = await ensureBackupFolder(accessToken);
  const backupFileName = `tubeo-channels-${previousDate}.json`;
  const backupExists = await findFile(accessToken, backupFileName, backupFolderId);
  if (backupExists) return;

  await uploadJsonFile(
    accessToken,
    backupFileName,
    JSON.stringify(existing.data),
    { parents: [backupFolderId] },
  );
}

async function createSnapshotBackup(
  accessToken: string,
  payload: DriveChannelData,
): Promise<void> {
  const backupFolderId = await ensureBackupFolder(accessToken);
  await uploadJsonFile(
    accessToken,
    snapshotFileName(),
    JSON.stringify(payload),
    { parents: [backupFolderId] },
  );
}

async function readLatestBackupData(accessToken: string): Promise<DriveSyncState | null> {
  const backupFolderId = await findFile(accessToken, BACKUP_FOLDER_NAME, SPACE, FOLDER_MIME_TYPE);
  if (!backupFolderId) return null;

  const files = await listFiles(
    accessToken,
    [
      `'${escapeDriveQueryValue(backupFolderId)}' in parents`,
      `name contains '${escapeDriveQueryValue('tubeo-')}'`,
    ].join(' and '),
    'files(id,name,createdTime)',
  );
  const latest = [...files].sort((a, b) => {
    const byName = (b.name ?? '').localeCompare(a.name ?? '');
    if (byName !== 0) return byName;
    return Date.parse(b.createdTime ?? '') - Date.parse(a.createdTime ?? '');
  })[0];
  if (!latest?.id) return null;

  const data = await readFileJson<DriveChannelData>(accessToken, latest.id);
  return normalizeDriveChannelData(data);
}

export async function listDriveBackups(accessToken: string): Promise<DriveBackupSummary[]> {
  const backupFolderId = await findFile(accessToken, BACKUP_FOLDER_NAME, SPACE, FOLDER_MIME_TYPE);
  if (!backupFolderId) return [];

  const files = await listFiles(
    accessToken,
    [
      `'${escapeDriveQueryValue(backupFolderId)}' in parents`,
      `name contains '${escapeDriveQueryValue('tubeo-')}'`,
    ].join(' and '),
    'files(id,name,createdTime)',
  );

  return files
    .map((file) => ({
      id: file.id,
      name: file.name ?? '',
      createdTime: file.createdTime,
      date: backupDateFromName(file.name),
      type: backupTypeFromName(file.name),
    }))
    .filter((file) => file.id && file.name)
    .sort((a, b) => {
      const dateDelta = Date.parse(b.createdTime ?? '') - Date.parse(a.createdTime ?? '');
      if (dateDelta !== 0 && Number.isFinite(dateDelta)) return dateDelta;
      return b.name.localeCompare(a.name);
    });
}

export async function readDriveBackupForDate(
  accessToken: string,
  date = getPreviousBackupDate(),
): Promise<(DriveSyncState & { backup: DriveBackupSummary }) | null> {
  const backups = await listDriveBackups(accessToken);
  const candidates = backups.filter((backup) => backup.date === date);
  const selected =
    candidates.find((backup) => backup.name === `tubeo-channels-${date}.json`) ??
    candidates[0] ??
    null;
  if (!selected) return null;

  const data = await readFileJson<DriveChannelData>(accessToken, selected.id);
  const normalized = normalizeDriveChannelData(data);
  return normalized ? { ...normalized, backup: selected } : null;
}

export async function restoreDriveBackup(
  accessToken: string,
  date = getPreviousBackupDate(),
): Promise<(DriveSyncState & { backup: DriveBackupSummary }) | null> {
  const backup = await readDriveBackupForDate(accessToken, date);
  if (!backup) return null;

  await writeDriveChannels(accessToken, {
    channels: backup.channels,
    spaces: backup.spaces,
    view: backup.view,
    viewUpdatedAt: backup.viewUpdatedAt,
    updatesChannelIds: backup.updatesChannelIds,
    vocabs: backup.vocabs,
    ignoredChannels: backup.ignoredChannels,
    discoverSearches: backup.discoverSearches,
    activeDiscoverSearchId: backup.activeDiscoverSearchId,
    discoverDraft: backup.discoverDraft,
    lastPagePath: backup.lastPagePath,
    newsYouLearn: backup.newsYouLearn,
    quota: backup.quota,
    deepseekQuota: backup.deepseekQuota,
    quotaHistory: backup.quotaHistory,
    deepseekQuotaHistory: backup.deepseekQuotaHistory,
  });

  return backup;
}

export async function readDriveChannels(
  accessToken: string,
): Promise<DriveSyncState | null> {
  const existing = await readPrimaryDriveData(accessToken);
  const normalized = normalizeDriveChannelData(existing?.data ?? null);
  if (normalized) return normalized;

  return readLatestBackupData(accessToken);
}

export async function deleteDriveChannels(accessToken: string): Promise<void> {
  const fileId = await findFile(accessToken);
  if (!fileId) return;

  await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function writeDriveChannels(accessToken: string, store: DriveWriteState): Promise<void> {
  const existing = await readPrimaryDriveData(accessToken);
  await ensureDailyBackup(accessToken, existing);
  const body = buildDriveChannelData(store);
  const json = JSON.stringify(body);
  const nextNormalized = normalizeDriveChannelData(body);

  if (existing?.data) {
    const existingJson = JSON.stringify(existing.data);
    if (existingJson !== json) {
      await createSnapshotBackup(accessToken, existing.data);
    }
  }

  await uploadJsonFile(accessToken, FILE_NAME, json, { fileId: existing?.id, parents: [SPACE] });

  if (!existing?.data || JSON.stringify(normalizeDriveChannelData(existing.data)) !== JSON.stringify(nextNormalized)) {
    await createSnapshotBackup(accessToken, body);
  }
}

export function buildDriveChannelData(store: DriveWriteState): DriveChannelData {
  const normalizedChannels = dedupeChannels(store.channels);
  const normalizedSpaces = dedupeSpaces([
    DEFAULT_CHANNEL_SPACE,
    ...store.spaces,
    ...normalizedChannels.map((channel) => channel.space),
  ]);
  const normalizedView = normalizeViewPreferences(store.view ?? DEFAULT_VIEW_PREFERENCES);
  const viewUpdatedAt = store.viewUpdatedAt || new Date().toISOString();
  const normalizedQuota = normalizeQuotaUsage(store.quota);
  const normalizedDeepSeekQuota = normalizeQuotaUsage(store.deepseekQuota);
  const normalizedQuotaHistory = normalizeQuotaHistory(store.quotaHistory, store.quota);
  const normalizedDeepSeekQuotaHistory = normalizeQuotaHistory(store.deepseekQuotaHistory, store.deepseekQuota);
  const body: DriveChannelData = {
    channels: normalizedChannels,
    channelIds: normalizedChannels.map((channel) => channel.id),
    spaces: normalizedSpaces,
    view: normalizedView,
    viewUpdatedAt,
    updatesChannelIds: normalizeUpdatesChannelIds(store.updatesChannelIds, normalizedChannels.map((channel) => channel.id)),
    vocabs: normalizeVocabs(store.vocabs),
    ignoredChannels: normalizeIgnoredChannels(store.ignoredChannels),
    discoverSearches: normalizeDiscoverSearches(store.discoverSearches),
    activeDiscoverSearchId: store.activeDiscoverSearchId,
    discoverDraft: normalizeDiscoverFilters(store.discoverDraft),
    lastPagePath: store.lastPagePath,
    newsYouLearn: normalizeNewsYouLearnState(store.newsYouLearn),
    quota: normalizedQuota,
    deepseekQuota: normalizedDeepSeekQuota,
    quotaHistory: normalizedQuotaHistory,
    deepseekQuotaHistory: normalizedDeepSeekQuotaHistory,
    updatedAt: new Date().toISOString(),
  };
  return body;
}

export async function recordDriveQuotaUsage(
  accessToken: string,
  units: number,
  fallbackStore: ChannelPreferenceStore = {
    channels: [],
    spaces: [DEFAULT_CHANNEL_SPACE],
    view: DEFAULT_VIEW_PREFERENCES,
    viewUpdatedAt: EPOCH,
    updatesChannelIds: [],
    vocabs: [],
    ignoredChannels: [],
    discoverSearches: [],
    discoverDraft: normalizeDiscoverFilters(undefined),
    newsYouLearn: emptyNewsYouLearnState(),
  },
): Promise<DailyQuotaUsage> {
  const normalizedUnits = Math.max(0, Math.ceil(units));
  const existing = await readDriveChannels(accessToken);
  const baseStore: ChannelPreferenceStore = existing
    ? {
        channels: existing.channels,
        spaces: existing.spaces,
        view: existing.view,
        viewUpdatedAt: existing.viewUpdatedAt,
        updatesChannelIds: existing.updatesChannelIds,
        vocabs: existing.vocabs,
        ignoredChannels: existing.ignoredChannels,
        discoverSearches: existing.discoverSearches,
        activeDiscoverSearchId: existing.activeDiscoverSearchId,
        discoverDraft: existing.discoverDraft,
        lastPagePath: existing.lastPagePath,
        newsYouLearn: existing.newsYouLearn,
      }
    : fallbackStore;
  const quota = normalizeQuotaUsage(existing?.quota);
  const nextQuota: DailyQuotaUsage = {
    ...quota,
    used: quota.used + normalizedUnits,
    updatedAt: new Date().toISOString(),
  };

  await writeDriveChannels(accessToken, {
    channels: baseStore.channels,
    spaces: baseStore.spaces,
    view: baseStore.view,
    viewUpdatedAt: baseStore.viewUpdatedAt,
    updatesChannelIds: baseStore.updatesChannelIds,
    vocabs: baseStore.vocabs,
    ignoredChannels: baseStore.ignoredChannels,
    discoverSearches: baseStore.discoverSearches,
    activeDiscoverSearchId: baseStore.activeDiscoverSearchId,
    discoverDraft: baseStore.discoverDraft,
    lastPagePath: baseStore.lastPagePath,
    newsYouLearn: baseStore.newsYouLearn,
    quota: nextQuota,
    deepseekQuota: existing?.deepseekQuota,
    quotaHistory: existing?.quotaHistory,
    deepseekQuotaHistory: existing?.deepseekQuotaHistory,
  });

  return nextQuota;
}
