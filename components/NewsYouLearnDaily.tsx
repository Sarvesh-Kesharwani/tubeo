'use client';

import { useMemo, useState } from 'react';
import type { NewsYouLearnNoteKind, NewsYouLearnState, NewsYouLearnVideo, NewsYouLearnVideoSummary } from '@/lib/types';

const NOTE_KIND_LABELS: Record<NewsYouLearnNoteKind, string> = {
  analogy: 'Analogy',
  layered: 'Layered',
};

const DEFAULT_PROMPT_TEXT: Record<NewsYouLearnNoteKind, string> = {
  analogy:
    'Convert this YouLearn transcript into strict JSON for analogy-based UPSC notes. Shape: {"title":"...","core_analogy":"...","analogy_map":[{"source":"...","target":"...","explanation":"..."}],"key_points":["..."],"exam_takeaways":["..."],"revision_notes":["..."]}. Use Hinglish. Make abstract ideas simple through real-life analogies. Return JSON only.',
  layered:
    'Convert this YouLearn transcript into strict JSON for layered UPSC notes. Shape: {"layer0":{"goal":"...","roadmap":["..."]},"layer1":{"terms":[{"term":"...","definition":"..."}],"events":[{"event":"...","description":"..."}]},"layer2":{"concepts":[{"concept":"...","explanation":"..."}]},"layer3":{"geopolitical_landscape":["..."]},"layer4":{"stakeholders":["..."]},"layer5":{"timeline":["..."]},"layer6":{"outcomes":["..."]},"layer7":{"connections":["..."]}}. Use Hinglish. Return JSON only.',
};

function pickDaily(videos: NewsYouLearnVideo[], date: string): NewsYouLearnVideo | null {
  if (videos.length === 0) return null;
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  const days = Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : 0;
  return videos[Math.abs(days) % videos.length] ?? null;
}

function formatDuration(seconds: number): string {
  if (!seconds) return '';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}:${String(secs).padStart(2, '0')}`;
  const hours = Math.floor(mins / 60);
  return `${hours}:${String(mins % 60).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function summaryKey(date: string, videoId: string, noteKind: NewsYouLearnNoteKind): string {
  return `${noteKind}:${date}:${videoId}`;
}

function fileSafe(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function getSummaryForVideo(
  summaries: NewsYouLearnState['summaries'],
  date: string,
  videoId: string,
  noteKind: NewsYouLearnNoteKind,
): NewsYouLearnVideoSummary | null {
  return (
    summaries[summaryKey(date, videoId, noteKind)] ??
    (noteKind === 'layered' && summaries[`${date}:${videoId}`]?.videoId === videoId ? summaries[`${date}:${videoId}`] : null) ??
    (noteKind === 'layered' && summaries[date]?.videoId === videoId ? summaries[date] : null)
  );
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 40);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseRawJson(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  function parseCandidate(value: string): unknown {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'string') {
      const nested = parsed.trim();
      if (nested.startsWith('{') || nested.startsWith('[')) {
        return parseCandidate(nested);
      }
    }
    return parsed;
  }

  const candidates = [
    cleaned,
    cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1),
    cleaned.slice(cleaned.indexOf('['), cleaned.lastIndexOf(']') + 1),
  ].filter((candidate) => candidate.trim().length > 1);

  for (const candidate of candidates) {
    try {
      return parseCandidate(candidate.trim());
    } catch {
      // Try the next candidate.
    }
  }

  try {
    return parseCandidate(cleaned);
  } catch {
    const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) return null;
    try {
      return parseCandidate(match[0]);
    } catch {
      return null;
    }
  }
}

function titleFromKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/layer(\d+)/i, 'Layer $1')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function primitiveText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function hasLayerShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).some((key) => /^layer\d+$/i.test(key) || /^group[A-Z]$/i.test(key))
  );
}

function parseJsonLikeString(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/[{[]/.test(trimmed)) return null;
  return parseRawJson(trimmed);
}

function normalizeJsonLike(value: unknown): unknown {
  if (typeof value === 'string') {
    const parsed = parseJsonLikeString(value);
    return parsed ? normalizeJsonLike(parsed) : value;
  }

  if (Array.isArray(value)) return value.map(normalizeJsonLike);

  if (isRecord(value)) {
    const unwrapped = ['data', 'raw', 'content', 'summary', 'notes', 'text']
      .map((key) => value[key])
      .find((item) => typeof item === 'string' && parseJsonLikeString(item));

    if (typeof unwrapped === 'string') {
      const parsed = parseJsonLikeString(unwrapped);
      if (parsed) return normalizeJsonLike(parsed);
    }

    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeJsonLike(child)]));
  }

  return value;
}

function unwrapChunkedSummary(value: unknown): unknown {
  const normalized = normalizeJsonLike(value);
  if (!isRecord(normalized)) return normalized;

  const mode = primitiveText(normalized.mode).toLowerCase();
  const merged = normalized.merged;
  if (mode !== 'chunked' || merged === undefined || merged === null) return normalized;

  if (typeof merged === 'string') {
    const parsed = parseJsonLikeString(merged);
    return parsed ? normalizeJsonLike(parsed) : normalized;
  }

  return normalizeJsonLike(merged);
}

function parseSummaryData(summary: NewsYouLearnVideoSummary): unknown {
  const normalizedData = unwrapChunkedSummary(summary.data);
  if (isRecord(normalizedData) && Object.keys(normalizedData).length > 0) return normalizedData;
  if (typeof normalizedData === 'string') {
    const parsed = parseJsonLikeString(normalizedData);
    if (parsed) return unwrapChunkedSummary(parsed);
  }
  return unwrapChunkedSummary(parseRawJson(summary.raw));
}

function parseChunkedSummaryChunks(raw: string): Array<{ index: number; data: unknown }> {
  const parsed = normalizeJsonLike(parseRawJson(raw));
  if (!isRecord(parsed) || primitiveText(parsed.mode).toLowerCase() !== 'chunked' || !Array.isArray(parsed.chunks)) {
    return [];
  }

  return parsed.chunks
    .map((chunk, fallbackIndex) => {
      if (!isRecord(chunk)) return null;
      const rawIndex = typeof chunk.index === 'number' ? chunk.index : Number(primitiveText(chunk.index));
      const index = Number.isFinite(rawIndex) && rawIndex > 0 ? rawIndex : fallbackIndex + 1;
      const rawData = typeof chunk.raw === 'string' ? (parseJsonLikeString(chunk.raw) ?? chunk.raw) : (chunk.data ?? chunk);
      return { index, data: normalizeJsonLike(rawData) };
    })
    .filter((chunk): chunk is { index: number; data: unknown } => Boolean(chunk));
}

function downloadProcessedTranscript(summary: NewsYouLearnVideoSummary) {
  const processed = parseSummaryData(summary);
  const payload = {
    date: summary.date,
    video: {
      id: summary.videoId,
      title: summary.videoTitle,
      url: summary.videoUrl,
      thumbnail: summary.thumbnail,
    },
    noteKind: summary.noteKind ?? 'layered',
    generatedAt: summary.generatedAt,
    promptHash: summary.promptHash,
    processedTranscript: processed ?? summary.raw,
    raw: summary.raw,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `youlearn-${summary.noteKind ?? 'layered'}-${summary.date}-${fileSafe(summary.videoTitle) || summary.videoId}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sourceLabel(sourceUrl: string): string {
  if (!sourceUrl.trim()) return 'Imported videos';
  try {
    const url = new URL(sourceUrl);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return sourceUrl.trim().slice(0, 36);
  }
}

function recordList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => primitiveText(item)).filter(Boolean).slice(0, 40);
}

function GenericValue({ value }: { value: unknown }) {
  const normalized = normalizeJsonLike(value);
  if (isRecord(normalized) && hasLayerShape(normalized)) {
    return <LayeredSummary data={normalized} fallbackTitle="Processed notes" />;
  }

  if (typeof value === 'string' && normalized !== value) return <GenericValue value={normalized} />;

  const text = primitiveText(normalized);
  if (text) {
    return <p className="text-sm font-semibold leading-relaxed text-duo-ink">{text}</p>;
  }

  if (Array.isArray(normalized)) {
    if (normalized.length === 0) return null;
    return (
      <ul className="space-y-2">
        {normalized.slice(0, 60).map((item, index) => {
          const itemText = primitiveText(item);
          return (
            <li key={index} className="rounded-2xl bg-white px-3 py-2 text-sm font-semibold leading-relaxed text-duo-ink shadow-sm">
              {itemText || <GenericValue value={item} />}
            </li>
          );
        })}
      </ul>
    );
  }

  if (isRecord(normalized)) {
    const name = primitiveText(normalized.name);
    const wants = primitiveText(normalized.wants) || primitiveText(normalized.desire);
    if (name && wants) {
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border-2 border-duo-border bg-white/80 p-3">
            <h5 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-duo-blueDark">Name</h5>
            <p className="text-sm font-semibold leading-relaxed text-duo-ink">{name}</p>
          </div>
          <div className="rounded-2xl border-2 border-duo-border bg-white/80 p-3">
            <h5 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-duo-blueDark">
              {normalized.wants ? 'Wants' : 'Desire'}
            </h5>
            <p className="text-sm font-semibold leading-relaxed text-duo-ink">{wants}</p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {Object.entries(normalized).map(([key, child]) => (
          <div key={key} className="rounded-2xl border-2 border-duo-border bg-white/80 p-3">
            <h5 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-duo-blueDark">
              {titleFromKey(key)}
            </h5>
            <GenericValue value={child} />
          </div>
        ))}
      </div>
    );
  }

  return null;
}

function LayerHeader({ label, title, description }: { label: string; title: string; description: string }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-duo-blueDark shadow-sm">
        {label}
      </span>
      <div>
        <h4 className="text-base font-extrabold text-duo-ink">{title}</h4>
        <p className="text-sm font-semibold leading-relaxed text-duo-mute">{description}</p>
      </div>
    </div>
  );
}

function LayerPlaceholder() {
  return (
    <p className="rounded-2xl bg-white/70 px-3 py-2 text-sm font-bold text-duo-mute">
      No structured points found for this layer.
    </p>
  );
}

const LAYER_KEYS = ['layer0', 'layer1', 'layer2', 'layer3', 'layer4', 'layer5', 'layer6', 'layer7'];

function normalizedSummaryKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isGroupWrapperKey(key: string): boolean {
  return /^group[a-z0-9]*$/i.test(normalizedSummaryKey(key)) || normalizedSummaryKey(key) === 'groups';
}

function nestedLayer(data: Record<string, unknown>, layerKey: string): Record<string, unknown> {
  if (isRecord(data[layerKey])) return data[layerKey] as Record<string, unknown>;

  for (const [key, value] of Object.entries(data)) {
    if (!isGroupWrapperKey(key) || !isRecord(value)) continue;
    const exact = value[layerKey];
    if (isRecord(exact)) return exact;
  }

  return {};
}

function isRedundantLayerGroup(key: string, value: unknown): boolean {
  if (!isGroupWrapperKey(key) || !isRecord(value)) return false;
  return LAYER_KEYS.some((layerKey) => isRecord(value[layerKey]));
}

function LayeredSummary({ data, fallbackTitle }: { data: Record<string, unknown>; fallbackTitle: string }) {
  const layer0 = nestedLayer(data, 'layer0');
  const layer1 = nestedLayer(data, 'layer1');
  const layer2 = nestedLayer(data, 'layer2');
  const layer3 = nestedLayer(data, 'layer3');
  const layer4 = nestedLayer(data, 'layer4');
  const layer5 = nestedLayer(data, 'layer5');
  const layer6 = nestedLayer(data, 'layer6');
  const layer7 = nestedLayer(data, 'layer7');
  const known = new Set(LAYER_KEYS);
  const roadmap = textList(layer0.roadmap);
  const terms = recordList(layer1.terms);
  const events = recordList(layer1.events);
  const concepts = recordList(layer2.concepts);
  const layerBlocks = [
    { key: 'layer3', data: layer3, label: 'Layer 3', title: 'Geopolitical landscape', tone: 'blue' },
    { key: 'layer4', data: layer4, label: 'Layer 4', title: 'Stakeholder analysis', tone: 'yellow' },
    { key: 'layer5', data: layer5, label: 'Layer 5', title: 'Event timeline & dynamics', tone: 'green' },
    { key: 'layer6', data: layer6, label: 'Layer 6', title: 'Outcomes & consequences', tone: 'blue' },
    { key: 'layer7', data: layer7, label: 'Layer 7', title: 'Layer connections', tone: 'yellow' },
  ];
  const extras = Object.fromEntries(
    Object.entries(data).filter(([key, value]) => !known.has(key) && !isRedundantLayerGroup(key, value)),
  );

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border-2 border-duo-green/30 bg-gradient-to-br from-duo-green/15 to-white p-4 shadow-card">
        <p className="text-xs font-extrabold uppercase tracking-wide text-duo-greenDark">Processed notes</p>
        <div className="mt-3 rounded-2xl bg-duo-green px-4 py-3 text-white shadow-duoGreen">
          <p className="text-xs font-extrabold uppercase tracking-wide">Layer 0</p>
          <h4 className="text-lg font-extrabold">Video ka goal aur learning roadmap</h4>
        </div>
        <h3 className="mt-1 text-xl font-extrabold leading-tight text-duo-ink">
          {primitiveText(layer0.goal) || primitiveText(data.title) || fallbackTitle}
        </h3>
        {roadmap.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {roadmap.map((step, index) => (
              <span
                key={`${step}-${index}`}
                className="rounded-full border-2 border-duo-green/25 bg-white px-3 py-1.5 text-xs font-extrabold text-duo-greenDark shadow-sm"
              >
                {index + 1}. {step}
              </span>
            ))}
          </div>
        )}
      </div>

      <section className="rounded-3xl border-2 border-duo-blue/25 bg-duo-blue/10 p-4">
        <LayerHeader
          label="Layer 1"
          title="Terms & events"
          description="Important names, ideas, and sequence from the video."
        />
        <div className="mt-4 space-y-3">
          {terms.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {terms.map((term, index) => (
                <article key={index} className="rounded-2xl border-2 border-duo-border bg-white p-3 shadow-sm">
                  <h5 className="text-sm font-extrabold text-duo-blueDark">
                  {primitiveText(term.term) || `Term ${index + 1}`}
                </h5>
                <p className="mt-1 text-sm font-semibold leading-relaxed text-duo-ink">
                  {primitiveText(term.definition) || primitiveText(term.meaning) || primitiveText(term.explanation)}
                </p>
                </article>
              ))}
            </div>
          )}
          {events.length > 0 && events.map((event, index) => (
              <article key={index} className="rounded-2xl bg-white p-3 shadow-sm">
                <h5 className="text-sm font-extrabold text-duo-ink">
                  {primitiveText(event.event) || primitiveText(event.title) || `Event ${index + 1}`}
                </h5>
                <p className="mt-1 text-sm font-semibold leading-relaxed text-duo-mute">
                  {primitiveText(event.description) || primitiveText(event.detail) || primitiveText(event.explanation)}
                </p>
              </article>
            ))}
          {terms.length === 0 && events.length === 0 && <LayerPlaceholder />}
        </div>
      </section>

      <section className="rounded-3xl border-2 border-duo-green/25 bg-white p-4 shadow-card">
        <LayerHeader
          label="Layer 2"
          title="Concepts"
          description="Bigger takeaways and connections."
        />
        {concepts.length > 0 ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {concepts.map((concept, index) => (
              <article key={index} className="rounded-2xl border-2 border-duo-border bg-duo-soft/60 p-3">
                <h5 className="text-sm font-extrabold text-duo-greenDark">
                  {primitiveText(concept.concept) || primitiveText(concept.title) || `Concept ${index + 1}`}
                </h5>
                <p className="mt-1 text-sm font-semibold leading-relaxed text-duo-ink">
                  {primitiveText(concept.explanation) || primitiveText(concept.definition) || primitiveText(concept.detail)}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-4">
            <LayerPlaceholder />
          </div>
        )}
      </section>

      {layerBlocks.map((block) => (
        <section
          key={block.key}
          className={`rounded-3xl border-2 p-4 ${
            block.tone === 'blue'
              ? 'border-duo-blue/25 bg-duo-blue/10'
              : block.tone === 'yellow'
                ? 'border-duo-yellow/60 bg-duo-yellow/20'
                : 'border-duo-green/25 bg-duo-green/10'
          }`}
        >
          <LayerHeader
            label={block.label}
            title={block.title}
            description="Formatted from saved processed notes."
          />
          <div className="mt-4">
            {Object.keys(block.data).length > 0 ? <GenericValue value={block.data} /> : <LayerPlaceholder />}
          </div>
        </section>
      ))}

      {Object.keys(extras).length > 0 && <GenericSummary data={extras} />}
    </div>
  );
}

function GenericSummary({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, value]) => value !== null && value !== undefined);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-3">
      {entries.slice(0, 40).map(([key, value], index) => (
        <section
          key={key}
          className={`rounded-3xl border-2 border-duo-border p-4 shadow-card ${
            index % 3 === 0 ? 'bg-duo-green/10' : index % 3 === 1 ? 'bg-duo-yellow/20' : 'bg-white'
          }`}
        >
          <h4 className="mb-3 text-sm font-extrabold text-duo-ink">{titleFromKey(key)}</h4>
          <GenericValue value={value} />
        </section>
      ))}
    </div>
  );
}

const ANALOGY_TOPIC_LIST_KEYS = [
  'topics',
  'analogy_topics',
  'analogyTopics',
  'sections',
  'items',
  'analogy_map',
  'analogyMap',
];

const ANALOGY_TOPIC_KEYS = [
  'topic_index',
  'index',
  'topic',
  'title',
  'lecture_context',
  'context',
  'summary',
  'analogy_explanation',
  'analogy',
  'explanation',
  'exam_takeaway',
  'takeaway',
  'revision_note',
  'source',
  'target',
  'chunk_index',
  'chunkIndex',
];

function isAnalogyTopicRecord(value: Record<string, unknown>): boolean {
  const hasTopicText =
    primitiveText(value.topic) ||
    primitiveText(value.lecture_context) ||
    primitiveText(value.analogy_explanation) ||
    primitiveText(value.exam_takeaway);
  const hasAnalogyMapText = primitiveText(value.source) && primitiveText(value.target) && primitiveText(value.explanation);
  return Boolean(hasTopicText || hasAnalogyMapText);
}

function extractAnalogyTopics(value: unknown, chunkIndex?: number): Array<Record<string, unknown>> {
  const normalized = normalizeJsonLike(value);
  if (!isRecord(normalized)) return [];

  const direct: Array<Record<string, unknown>> = [];
  for (const key of ANALOGY_TOPIC_LIST_KEYS) {
    const list = normalized[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isRecord(item)) continue;
      direct.push(chunkIndex ? { chunk_index: chunkIndex, ...item } : item);
    }
  }

  if (direct.length > 0) return direct;
  if (isAnalogyTopicRecord(normalized)) {
    return [chunkIndex ? { chunk_index: chunkIndex, ...normalized } : normalized];
  }

  return [];
}

function analogyTopicIdentity(topic: Record<string, unknown>, fallbackIndex: number): string {
  const explicitIndex = primitiveText(topic.topic_index) || primitiveText(topic.index);
  if (explicitIndex) return `index:${explicitIndex}`;

  const title =
    primitiveText(topic.topic) ||
    primitiveText(topic.title) ||
    [primitiveText(topic.source), primitiveText(topic.target)].filter(Boolean).join(' -> ');
  const analogy = primitiveText(topic.analogy_explanation) || primitiveText(topic.analogy) || primitiveText(topic.explanation);
  return `${title}|${analogy}`.trim().toLowerCase() || `fallback:${fallbackIndex}`;
}

function mergeAnalogyTopics(
  primary: Array<Record<string, unknown>>,
  fallback: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const merged: Array<Record<string, unknown>> = [];

  for (const topic of [...primary, ...fallback]) {
    const key = analogyTopicIdentity(topic, merged.length);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(topic);
  }

  return merged;
}

function AnalogySummary({
  data,
  fallbackTitle,
  chunkFallbacks = [],
}: {
  data: Record<string, unknown>;
  fallbackTitle: string;
  chunkFallbacks?: Array<{ index: number; data: unknown }>;
}) {
  const title = primitiveText(data.title) || fallbackTitle;
  const mainAnalogy = primitiveText(data.main_analogy) || primitiveText(data.mainAnalogy) || primitiveText(data.core_analogy);
  const topics = mergeAnalogyTopics(
    extractAnalogyTopics(data),
    chunkFallbacks.flatMap((chunk) => extractAnalogyTopics(chunk.data, chunk.index)),
  );
  const revisionNotes = normalizeList(data.revision_notes ?? data.revisionNotes ?? data.notes);
  const knownKeys = new Set([
    'title',
    'main_analogy',
    'mainAnalogy',
    'core_analogy',
    'topics',
    'revision_notes',
    'revisionNotes',
    'notes',
    'index',
    'chunk_index',
    'chunkIndex',
    'chunkCount',
    'chunkTokenBudget',
    'mode',
    'merged',
    'chunks',
  ]);
  const extras = Object.fromEntries(Object.entries(data).filter(([key]) => !knownKeys.has(key)));

  return (
    <div className="space-y-3">
      <section className="rounded-3xl border-2 border-duo-blue/25 bg-duo-blue/10 p-4 shadow-card">
        <p className="text-xs font-extrabold uppercase tracking-wide text-duo-blueDark">Analogy notes</p>
        <h3 className="mt-1 text-lg font-extrabold leading-tight text-duo-ink">{title}</h3>
        {mainAnalogy && (
          <p className="mt-3 rounded-2xl bg-white px-3 py-2 text-sm font-semibold leading-relaxed text-duo-ink">
            {mainAnalogy}
          </p>
        )}
      </section>

      {topics.length > 0 && (
        <section className="space-y-3">
          {topics.map((topic, index) => {
            const topicIndex = primitiveText(topic.topic_index) || primitiveText(topic.index) || String(index + 1);
            const mappedTitle = [primitiveText(topic.source), primitiveText(topic.target)].filter(Boolean).join(' -> ');
            const topicTitle = primitiveText(topic.topic) || primitiveText(topic.title) || mappedTitle || `Topic ${topicIndex}`;
            const lectureContext =
              primitiveText(topic.lecture_context) || primitiveText(topic.context) || primitiveText(topic.summary);
            const analogy =
              primitiveText(topic.analogy_explanation) || primitiveText(topic.analogy) || primitiveText(topic.explanation);
            const takeaway =
              primitiveText(topic.exam_takeaway) || primitiveText(topic.takeaway) || primitiveText(topic.revision_note);
            const chunkLabel = primitiveText(topic.chunk_index) || primitiveText(topic.chunkIndex);
            const topicExtras = Object.fromEntries(
              Object.entries(topic).filter(
                ([key]) => !ANALOGY_TOPIC_KEYS.includes(key),
              ),
            );

            return (
              <article key={`${topicIndex}-${topicTitle}-${index}`} className="rounded-3xl border-2 border-duo-border bg-white p-4 shadow-card">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="rounded-full bg-duo-blue px-3 py-1 text-xs font-extrabold text-white shadow-duoBlue">
                    {topicIndex}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-base font-extrabold text-duo-ink">{topicTitle}</h4>
                    {lectureContext && <p className="mt-2 text-sm font-semibold leading-relaxed text-duo-mute">{lectureContext}</p>}
                    {chunkLabel && (
                      <p className="mt-1 text-xs font-extrabold uppercase tracking-wide text-duo-blueDark">
                        Chunk {chunkLabel}
                      </p>
                    )}
                  </div>
                </div>
                {analogy && (
                  <div className="mt-3 rounded-2xl bg-duo-soft/70 px-3 py-2 text-sm font-semibold leading-relaxed text-duo-ink">
                    {analogy}
                  </div>
                )}
                {takeaway && (
                  <div className="mt-2 rounded-2xl border-2 border-duo-green/20 bg-duo-green/10 px-3 py-2 text-sm font-semibold leading-relaxed text-duo-greenDark">
                    {takeaway}
                  </div>
                )}
                {Object.keys(topicExtras).length > 0 && (
                  <div className="mt-3">
                    <GenericValue value={topicExtras} />
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      {revisionNotes.length > 0 && (
        <section className="rounded-3xl border-2 border-duo-border bg-duo-yellow/20 p-4">
          <h4 className="mb-2 text-sm font-extrabold text-duo-blueDark">Revision notes</h4>
          <ol className="list-decimal space-y-1 pl-5 text-sm font-semibold leading-relaxed text-duo-ink">
            {revisionNotes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ol>
        </section>
      )}

      {Object.keys(extras).length > 0 && <GenericSummary data={extras} />}
    </div>
  );
}

function TextSummary({ raw }: { raw: string }) {
  const blocks = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .split(/\n{2,}|(?<=\.)\s+(?=[A-Z0-9])/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 60);

  return (
    <section className="rounded-3xl border-2 border-duo-border bg-white p-4 shadow-card">
      <p className="text-xs font-extrabold uppercase tracking-wide text-duo-blueDark">Processed notes</p>
      <div className="mt-3 space-y-2">
        {(blocks.length > 0 ? blocks : ['No formatted notes available.']).map((block, index) => (
          <p key={index} className="rounded-2xl bg-duo-soft/60 px-3 py-2 text-sm font-semibold leading-relaxed text-duo-ink">
            {block}
          </p>
        ))}
      </div>
    </section>
  );
}

function SummaryBlock({ summary }: { summary: NewsYouLearnVideoSummary }) {
  const data = parseSummaryData(summary);
  if (!isRecord(data)) {
    return <TextSummary raw={summary.raw} />;
  }

  const obj = data;
  if (hasLayerShape(obj)) {
    return <LayeredSummary data={obj} fallbackTitle={summary.videoTitle} />;
  }

  if ((summary.noteKind ?? 'layered') === 'analogy') {
    return <AnalogySummary data={obj} fallbackTitle={summary.videoTitle} chunkFallbacks={parseChunkedSummaryChunks(summary.raw)} />;
  }

  const title = typeof obj.title === 'string' ? obj.title : summary.videoTitle;
  const keyPoints = normalizeList(obj.key_points ?? obj.keyPoints ?? obj.summary);
  const impacts = normalizeList(obj.why_it_matters ?? obj.whyItMatters ?? obj.impact);
  const notes = normalizeList(obj.revision_notes ?? obj.revisionNotes ?? obj.notes);
  const terms = Array.isArray(obj.terms) ? obj.terms.slice(0, 40) : [];
  const knownKeys = new Set([
    'title',
    'key_points',
    'keyPoints',
    'summary',
    'why_it_matters',
    'whyItMatters',
    'impact',
    'revision_notes',
    'revisionNotes',
    'notes',
    'terms',
  ]);
  const extraData = Object.fromEntries(Object.entries(obj).filter(([key]) => !knownKeys.has(key)));

  return (
    <div className="space-y-3">
      <div className="rounded-3xl border-2 border-duo-border bg-white p-4 shadow-card">
        <p className="text-xs font-extrabold uppercase tracking-wide text-duo-greenDark">Processed notes</p>
        <h3 className="mt-1 text-lg font-extrabold leading-tight text-duo-ink">{title}</h3>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {keyPoints.length > 0 && (
          <section className="rounded-3xl border-2 border-duo-border bg-duo-green/10 p-4">
            <h4 className="mb-2 text-sm font-extrabold text-duo-greenDark">Key points</h4>
            <ul className="space-y-2">
              {keyPoints.map((point, i) => (
                <li key={i} className="rounded-2xl bg-white px-3 py-2 text-sm font-semibold leading-relaxed text-duo-ink">
                  {point}
                </li>
              ))}
            </ul>
          </section>
        )}

        {impacts.length > 0 && (
          <section className="rounded-3xl border-2 border-duo-border bg-duo-yellow/20 p-4">
            <h4 className="mb-2 text-sm font-extrabold text-duo-blueDark">Why it matters</h4>
            <ul className="space-y-2">
              {impacts.map((point, i) => (
                <li key={i} className="rounded-2xl bg-white px-3 py-2 text-sm font-semibold leading-relaxed text-duo-ink">
                  {point}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {terms.length > 0 && (
        <section className="rounded-3xl border-2 border-duo-border bg-duo-soft/60 p-4">
          <h4 className="mb-2 text-sm font-extrabold text-duo-blueDark">Terms</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {terms.map((term, i) => {
              const item = term && typeof term === 'object' ? (term as Record<string, unknown>) : {};
              return (
                <div key={i} className="rounded-2xl bg-white px-3 py-2">
                  <div className="text-xs font-extrabold text-duo-blueDark">{String(item.term ?? `Term ${i + 1}`)}</div>
                  <div className="mt-1 text-sm leading-relaxed text-duo-ink">{String(item.meaning ?? term)}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {notes.length > 0 && (
        <section className="rounded-3xl border-2 border-duo-border bg-white p-4 shadow-card">
          <h4 className="mb-2 text-sm font-extrabold text-duo-blueDark">Revision notes</h4>
          <ol className="list-decimal space-y-1 pl-5 text-sm font-semibold leading-relaxed text-duo-ink">
            {notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ol>
        </section>
      )}

      {Object.keys(extraData).length > 0 && <GenericSummary data={extraData} />}
    </div>
  );
}

export function NewsYouLearnDaily({
  initialState,
  date,
}: {
  initialState: NewsYouLearnState;
  date: string;
}) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState<'analogy' | 'layered' | 'complete' | 'import' | 'prompt-analogy' | 'prompt-layered' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [promptEditor, setPromptEditor] = useState<NewsYouLearnNoteKind | null>(null);
  const [sourceUrl, setSourceUrl] = useState(initialState.sourceUrl);
  const [prompts, setPrompts] = useState<Record<NewsYouLearnNoteKind, string>>({
    analogy: initialState.analogyPrompt ?? '',
    layered: initialState.layeredPrompt || initialState.prompt,
  });
  const [activeNoteKind, setActiveNoteKind] = useState<NewsYouLearnNoteKind>('layered');
  const dailyVideo = useMemo(() => pickDaily(state.videos, date), [state.videos, date]);
  const [selectedVideoId, setSelectedVideoId] = useState(
    initialState.selectedVideoIds?.[date] || initialState.summaries[date]?.videoId || dailyVideo?.id || '',
  );
  const selectedVideo = useMemo(
    () => state.videos.find((video) => video.id === selectedVideoId) ?? dailyVideo,
    [dailyVideo, selectedVideoId, state.videos],
  );
  const summary = selectedVideo ? getSummaryForVideo(state.summaries, date, selectedVideo.id, activeNoteKind) : null;

  async function importSource() {
    setBusy('import');
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/news/youlearn/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrl, target: 'youlearn' }),
      });
      const data = (await res.json()) as { ok?: boolean; state?: NewsYouLearnState; error?: string };
      if (!res.ok || !data.ok || !data.state) throw new Error(data.error || 'Import failed.');
      setState(data.state);
      setSourceUrl(data.state.sourceUrl);
      setSelectedVideoId(data.state.selectedVideoIds?.[date] || pickDaily(data.state.videos, date)?.id || data.state.videos[0]?.id || '');
      setMessage(`Imported ${data.state.videos.length} videos.`);
      setShowImport(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function savePrompt(kind: NewsYouLearnNoteKind) {
    const nextPrompt = prompts[kind];
    setBusy(kind === 'analogy' ? 'prompt-analogy' : 'prompt-layered');
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/news/youlearn/prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: nextPrompt, kind }),
      });
      const data = (await res.json()) as { ok?: boolean; state?: NewsYouLearnState; prompt?: string; updatedAt?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not save prompt.');
      if (data.state) setState(data.state);
      setPrompts((current) => ({
        ...current,
        [kind]: data.prompt ?? nextPrompt,
      }));
      setMessage(`${NOTE_KIND_LABELS[kind]} prompt saved.`);
      setPromptEditor(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function processVideo(kind: NewsYouLearnNoteKind) {
    if (!selectedVideo) return;
    const existingSummary = getSummaryForVideo(state.summaries, date, selectedVideo.id, kind);
    setBusy(kind);
    setActiveNoteKind(kind);
    setError(null);
    try {
      const res = await fetch('/api/news/youlearn/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, force: Boolean(existingSummary), noteKind: kind, videoId: selectedVideo.id, videos: state.videos }),
      });
      const data = (await res.json()) as { ok?: boolean; state?: NewsYouLearnState; error?: string };
      if (!res.ok || !data.ok || !data.state) throw new Error(data.error || 'Processing failed.');
      setState(data.state);
      setSelectedVideoId(data.state.selectedVideoIds?.[date] || selectedVideo.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function markCompleted(videoId: string) {
    setBusy('complete');
    setError(null);
    try {
      const res = await fetch('/api/news/youlearn/videos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, completed: true }),
      });
      const data = (await res.json()) as { ok?: boolean; state?: NewsYouLearnState; error?: string };
      if (!res.ok || !data.ok || !data.state) throw new Error(data.error || 'Could not mark completed.');
      setState(data.state);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const analogySummary = selectedVideo ? getSummaryForVideo(state.summaries, date, selectedVideo.id, 'analogy') : null;
  const layeredSummary = selectedVideo ? getSummaryForVideo(state.summaries, date, selectedVideo.id, 'layered') : null;
  const activePrompt = promptEditor ? prompts[promptEditor] : '';
  const savedPrompt =
    promptEditor === 'analogy'
      ? state.analogyPrompt ?? ''
      : promptEditor === 'layered'
        ? state.layeredPrompt || state.prompt
        : '';

  return (
    <section className="space-y-3 rounded-[2rem] border-2 border-duo-border bg-white/70 p-3 shadow-card sm:p-4">
      <div className="rounded-3xl border-2 border-duo-blue/30 bg-white p-3">
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <select
              value={selectedVideo?.id ?? ''}
              onChange={(event) => {
                setSelectedVideoId(event.target.value);
                setError(null);
                setMessage(null);
              }}
              className="min-w-0 flex-1 rounded-2xl border-2 border-duo-border bg-white px-4 py-3 text-sm font-extrabold text-duo-ink outline-none focus:border-duo-blue"
              disabled={state.videos.length === 0}
            >
              {state.videos.length === 0 ? (
                <option>No videos imported</option>
              ) : (
                state.videos.map((video) => (
                  <option key={video.id} value={video.id}>
                    {video.title}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              className="btn-duo bg-white text-duo-blueDark shadow-card"
              onClick={() => setShowImport((value) => !value)}
            >
              Import
            </button>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <span className="chip cursor-default">{state.videos.length} videos</span>
            <span className="chip cursor-default">{sourceLabel(state.sourceUrl)}</span>
            {!state.analogyPrompt?.trim() && <span className="chip cursor-default text-duo-blueDark">Default analogy</span>}
            {!(state.layeredPrompt || state.prompt).trim() && <span className="chip cursor-default text-duo-blueDark">Default layered</span>}
          </div>
        </div>

        {showImport && (
          <div className="mt-3 flex flex-col gap-2 lg:flex-row">
            <input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="Paste public YouLearn space, folder, or playlist link"
              className="min-w-0 flex-1 rounded-2xl border-2 border-duo-border px-4 py-3 text-sm font-semibold text-duo-ink outline-none focus:border-duo-blue"
            />
            <button
              type="button"
              className="btn-duo bg-duo-green text-white shadow-duoGreen disabled:cursor-not-allowed disabled:opacity-60"
              onClick={importSource}
              disabled={busy !== null || !sourceUrl.trim()}
            >
              {busy === 'import' ? 'Importing...' : 'Import videos'}
            </button>
          </div>
        )}

        {promptEditor && (
          <div className="mt-3 space-y-2 rounded-2xl border-2 border-duo-border bg-duo-soft/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-extrabold text-duo-ink">Set {NOTE_KIND_LABELS[promptEditor]} Prompt</h3>
              <button
                type="button"
                className="chip"
                onClick={() => setPrompts((current) => ({ ...current, [promptEditor]: DEFAULT_PROMPT_TEXT[promptEditor] }))}
              >
                Use default
              </button>
            </div>
            <textarea
              value={activePrompt}
              onChange={(event) => setPrompts((current) => ({ ...current, [promptEditor]: event.target.value }))}
              rows={5}
              spellCheck={false}
              className="w-full resize-y rounded-2xl border-2 border-duo-border bg-white p-3 font-mono text-[13px] leading-relaxed text-duo-ink focus:border-duo-blue focus:outline-none"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`text-xs font-extrabold ${activePrompt.length > 8000 ? 'text-duo-red' : 'text-duo-mute'}`}>
                {(8000 - activePrompt.length).toLocaleString()} left
              </span>
              <button
                type="button"
                className="btn-duo bg-duo-blue text-white shadow-duoBlue disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => savePrompt(promptEditor)}
                disabled={busy !== null || activePrompt.length > 8000 || activePrompt === savedPrompt}
              >
                {busy === `prompt-${promptEditor}` ? 'Saving...' : 'Save prompt'}
              </button>
            </div>
          </div>
        )}

        {(error || message) && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-extrabold">
            {message && <span className="chip cursor-default text-duo-greenDark">{message}</span>}
            {error && <span className="chip cursor-default border-duo-red text-duo-red">{error}</span>}
          </div>
        )}
      </div>

      {selectedVideo ? (
        <main className="min-w-0 space-y-3 rounded-3xl border-2 border-duo-blue/20 bg-white/70 p-3">
          <div className="rounded-3xl border-2 border-duo-border bg-white p-4 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap gap-2">
                  <span className="chip cursor-default">{selectedVideo.id === dailyVideo?.id ? 'Today' : 'Selected'}</span>
                  {selectedVideo.durationSec > 0 && <span className="chip cursor-default">{formatDuration(selectedVideo.durationSec)}</span>}
                  {analogySummary && <span className="chip cursor-default text-duo-greenDark">Analogy saved</span>}
                  {layeredSummary && <span className="chip cursor-default text-duo-greenDark">Layered saved</span>}
                  {selectedVideo.completedAt && (
                    <span className="chip cursor-default text-duo-greenDark">
                      Done {new Date(selectedVideo.completedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <h3 className="mt-2 text-lg font-extrabold leading-tight text-duo-ink">{selectedVideo.title}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-duo bg-duo-blue text-white shadow-duoBlue disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => processVideo('analogy')}
                  disabled={busy !== null}
                >
                  {busy === 'analogy' ? 'Generating...' : 'Generate Analogy Notes'}
                </button>
                <button
                  type="button"
                  className="btn-duo bg-duo-green text-white shadow-duoGreen disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => processVideo('layered')}
                  disabled={busy !== null}
                >
                  {busy === 'layered' ? 'Generating...' : 'Generate Layered Notes'}
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-duo bg-white text-duo-blueDark shadow-card"
                onClick={() => setPromptEditor((current) => (current === 'analogy' ? null : 'analogy'))}
              >
                Set Analogy Prompt
              </button>
              <button
                type="button"
                className="btn-duo bg-white text-duo-greenDark shadow-card"
                onClick={() => setPromptEditor((current) => (current === 'layered' ? null : 'layered'))}
              >
                Set Layered Prompt
              </button>
              {summary && (
                <button
                  type="button"
                  className="btn-duo bg-white text-duo-greenDark shadow-card"
                  onClick={() => downloadProcessedTranscript(summary)}
                  disabled={busy !== null}
                >
                  Download JSON
                </button>
              )}
              <button
                type="button"
                className="btn-duo bg-white text-duo-blueDark shadow-card disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => markCompleted(selectedVideo.id)}
                disabled={busy !== null}
              >
                {busy === 'complete' ? 'Saving...' : selectedVideo.completedAt ? 'Update completed' : 'Mark completed'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(['analogy', 'layered'] as const).map((kind) => {
              const saved = kind === 'analogy' ? analogySummary : layeredSummary;
              const active = activeNoteKind === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  className={`rounded-full border-2 px-4 py-2 text-sm font-extrabold transition-colors ${
                    active
                      ? 'border-duo-blue bg-duo-blue text-white shadow-duoBlue'
                      : 'border-duo-border bg-white text-duo-ink hover:bg-duo-soft'
                  }`}
                  onClick={() => setActiveNoteKind(kind)}
                >
                  {NOTE_KIND_LABELS[kind]} Notes {saved ? 'saved' : 'empty'}
                </button>
              );
            })}
          </div>

          {summary ? (
            <SummaryBlock summary={summary} />
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-duo-border bg-duo-soft/60 p-5 text-center">
              <h3 className="text-lg font-extrabold text-duo-ink">No {NOTE_KIND_LABELS[activeNoteKind].toLowerCase()} notes yet</h3>
              <p className="max-w-xl text-sm font-semibold leading-relaxed text-duo-mute">
                Generate this note type once. Tubeo fetches the transcript, sends it to DeepSeek, then syncs the result for this video and date.
              </p>
              <button
                type="button"
                className="btn-duo bg-duo-blue text-white shadow-duoBlue disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => processVideo(activeNoteKind)}
                disabled={busy !== null}
              >
                {busy === activeNoteKind ? 'Generating...' : `Generate ${NOTE_KIND_LABELS[activeNoteKind]} Notes`}
              </button>
            </div>
          )}
        </main>
      ) : (
        <div className="rounded-chonk border-2 border-dashed border-duo-border bg-duo-soft/60 px-4 py-6 text-sm font-bold text-duo-mute">
          No videos imported yet. Use Import to add a public YouLearn space, folder, or playlist.
        </div>
      )}
    </section>
  );
}
