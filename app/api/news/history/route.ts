import { getSession } from '@/lib/session';
import { readNewsState } from '@/lib/supabase-news';
import { getTubeoUserIdentity } from '@/lib/supabase-sync';
import type { NewsSummaryEntry } from '@/lib/supabase-news';

export const dynamic = 'force-dynamic';

interface HistoryEntry {
  date: string;
  generatedAt: string;
  headings: string[];
}

function extractHeadings(entry: NewsSummaryEntry): string[] {
  const data = entry.data;
  if (!data || typeof data !== 'object') return [];

  const obj = data as Record<string, unknown>;

  // Default prompt shape: { sections: [{ heading, bullets }] }
  if (Array.isArray(obj.sections)) {
    return obj.sections
      .map((s: unknown) => (s && typeof s === 'object' ? (s as Record<string, unknown>).heading : null))
      .filter((h: unknown): h is string => typeof h === 'string' && h.length > 0)
      .slice(0, 8);
  }

  // Example placeholder shape: { topics: [{ title, ... }] }
  if (Array.isArray(obj.topics)) {
    return obj.topics
      .map((t: unknown) => (t && typeof t === 'object' ? (t as Record<string, unknown>).title : null))
      .filter((h: unknown): h is string => typeof h === 'string' && h.length > 0)
      .slice(0, 8);
  }

  // Generic: look for first-level keys with array values containing objects with heading/title
  for (const [_key, value] of Object.entries(obj)) {
    if (Array.isArray(value) && value.length > 0) {
      const first = value[0];
      if (first && typeof first === 'object') {
        const f = first as Record<string, unknown>;
        const headingKey = f.heading ?? f.title ?? f.name ?? f.topic;
        if (typeof headingKey === 'string' && headingKey.length > 0) {
          return value
            .map((v: unknown) => {
              if (v && typeof v === 'object') {
                const cast = v as Record<string, unknown>;
                const h = cast.heading ?? cast.title ?? cast.name ?? cast.topic;
                return typeof h === 'string' ? h : null;
              }
              return null;
            })
            .filter((h: unknown): h is string => typeof h === 'string' && h.length > 0)
            .slice(0, 8);
        }
      }
    }
  }

  return [];
}

export async function GET() {
  const session = await getSession();
  const identity = getTubeoUserIdentity(session);
  if (!identity) {
    return Response.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const state = await readNewsState(identity);
    if (!state) {
      return Response.json({ ok: true, dates: [] });
    }

    const entries: HistoryEntry[] = Object.values(state.summaries)
      .filter((e): e is NewsSummaryEntry => e != null && typeof e === 'object')
      .map((entry) => ({
        date: entry.date,
        generatedAt: entry.generatedAt,
        headings: extractHeadings(entry),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    return Response.json({ ok: true, dates: entries });
  } catch (error) {
    return Response.json(
      { ok: false, error: (error as Error).message },
      { status: 502 },
    );
  }
}
