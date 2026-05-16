import 'server-only';

export class TranscriptError extends Error {
  status: number;

  constructor(message: string, status = 404) {
    super(message);
    this.name = 'TranscriptError';
    this.status = status;
  }
}

interface CaptionTrack {
  baseUrl: string;
  languageCode?: string;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
  kind?: string;
}

const WATCH_URL = 'https://www.youtube.com/watch';

function assertVideoId(id: string): string {
  const value = id.trim();
  if (!/^[\w-]{11}$/.test(value)) {
    throw new TranscriptError('Invalid YouTube video id.', 400);
  }
  return value;
}

function decodeEntity(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractJsonArrayAfter(html: string, marker: string): unknown[] {
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return [];

  const start = html.indexOf('[', markerIndex);
  if (start === -1) return [];

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < html.length; index += 1) {
    const char = html[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '[') depth += 1;
    if (char === ']') depth -= 1;

    if (depth === 0) {
      const raw = html.slice(start, index + 1);
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
  }

  return [];
}

function readTrackName(track: CaptionTrack): string {
  return track.name?.simpleText ?? track.name?.runs?.map((run) => run.text ?? '').join('') ?? '';
}

function scoreTrack(track: CaptionTrack): number {
  const lang = track.languageCode?.toLowerCase() ?? '';
  const name = readTrackName(track).toLowerCase();
  const english = lang.startsWith('en') || name.includes('english');
  const manual = track.kind !== 'asr';

  if (english && manual) return 4;
  if (english) return 3;
  if (manual) return 2;
  return 1;
}

function chooseTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  return tracks
    .filter((track) => track.baseUrl)
    .sort((a, b) => scoreTrack(b) - scoreTrack(a))[0] ?? null;
}

async function getCaptionTracks(videoId: string): Promise<CaptionTrack[]> {
  const url = new URL(WATCH_URL);
  url.searchParams.set('v', videoId);

  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
    },
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new TranscriptError('Could not load YouTube video page.', 502);
  }

  const html = await response.text();
  const tracks = extractJsonArrayAfter(html, '"captionTracks":') as CaptionTrack[];
  return tracks.filter((track) => typeof track.baseUrl === 'string');
}

function withTranscriptFormat(baseUrl: string, format: 'json3' | 'srv3'): string {
  const url = new URL(baseUrl);
  url.searchParams.set('fmt', format);
  return url.toString();
}

function parseJson3Transcript(text: string): string[] {
  const payload = JSON.parse(text) as {
    events?: Array<{ segs?: Array<{ utf8?: string }> }>;
  };

  return (payload.events ?? [])
    .flatMap((event) => event.segs ?? [])
    .map((segment) => segment.utf8 ?? '')
    .filter((piece) => piece.trim() && piece !== '\n')
    .map((piece) => piece.replace(/\s+/g, ' ').trim());
}

function parseXmlTranscript(text: string): string[] {
  const pieces: string[] = [];
  const textNode = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
  const pNode = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

  for (const regex of [textNode, pNode]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
      const cleaned = decodeEntity(match[1].replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned) pieces.push(cleaned);
    }
    if (pieces.length > 0) break;
  }

  return pieces;
}

async function fetchTrackPieces(track: CaptionTrack): Promise<string[]> {
  const jsonResponse = await fetch(withTranscriptFormat(track.baseUrl, 'json3'), {
    next: { revalidate: 3600 },
  });

  if (jsonResponse.ok) {
    try {
      const pieces = parseJson3Transcript(await jsonResponse.text());
      if (pieces.length > 0) return pieces;
    } catch {
      // Fall through to XML parsing below.
    }
  }

  const xmlResponse = await fetch(withTranscriptFormat(track.baseUrl, 'srv3'), {
    next: { revalidate: 3600 },
  });
  if (!xmlResponse.ok) {
    throw new TranscriptError('Could not fetch transcript captions.', 502);
  }

  return parseXmlTranscript(await xmlResponse.text());
}

export async function fetchYouTubeTranscript(videoId: string): Promise<string> {
  const id = assertVideoId(videoId);
  const tracks = await getCaptionTracks(id);
  const track = chooseTrack(tracks);

  if (!track) {
    throw new TranscriptError('No captions or transcript found for this video.', 404);
  }

  const pieces = await fetchTrackPieces(track);
  const transcript = pieces.join(' ').replace(/\s+/g, ' ').trim();

  if (!transcript) {
    throw new TranscriptError('Transcript captions were empty.', 404);
  }

  return transcript;
}
