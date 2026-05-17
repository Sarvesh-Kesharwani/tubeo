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

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
    };
  };
}

const WATCH_URL = 'https://www.youtube.com/watch';
const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

// Each context here corresponds to a real YouTube client. The WEB client works for
// most videos; the ANDROID and IOS clients unlock age-restricted ones. We try them
// in order until one returns a captionTracks list.
const INNERTUBE_CONTEXTS: Array<{
  name: 'WEB' | 'ANDROID' | 'IOS';
  clientVersion: string;
  userAgent: string;
  clientNameId: string;
  extraBody?: Record<string, unknown>;
}> = [
  {
    name: 'WEB',
    clientVersion: '2.20240821.00.00',
    clientNameId: '1',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  },
  {
    name: 'ANDROID',
    clientVersion: '19.30.36',
    clientNameId: '3',
    userAgent: 'com.google.android.youtube/19.30.36 (Linux; U; Android 14) gzip',
    extraBody: { params: 'CgIQBg==' },
  },
  {
    name: 'IOS',
    clientVersion: '19.29.1',
    clientNameId: '5',
    userAgent: 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)',
  },
];

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

/**
 * Finds the first balanced JSON value (object or array) starting at or after `marker`.
 * Handles strings with escaped quotes so that braces inside strings don't confuse the depth counter.
 */
function extractBalancedJsonAfter(html: string, marker: string): unknown | null {
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return null;

  let start = -1;
  for (let i = markerIndex + marker.length; i < html.length; i += 1) {
    const c = html[i];
    if (c === '{' || c === '[') {
      start = i;
      break;
    }
    if (c && !/\s/.test(c) && c !== ':') break;
  }
  if (start === -1) return null;

  const open = html[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i += 1) {
    const c = html[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === open) depth += 1;
    if (c === close) {
      depth -= 1;
      if (depth === 0) {
        const raw = html.slice(start, i + 1);
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
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
  return (
    tracks
      .filter((track) => typeof track.baseUrl === 'string' && track.baseUrl.length > 0)
      .sort((a, b) => scoreTrack(b) - scoreTrack(a))[0] ?? null
  );
}

function tracksFromPlayerResponse(player: PlayerResponse | null | undefined): CaptionTrack[] {
  return player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
}

async function getCaptionTracksViaInnerTube(videoId: string): Promise<{
  tracks: CaptionTrack[];
  playabilityStatus?: string;
  playabilityReason?: string;
}> {
  let playabilityStatus: string | undefined;
  let playabilityReason: string | undefined;

  for (const ctx of INNERTUBE_CONTEXTS) {
    let res: Response;
    try {
      res = await fetch(INNERTUBE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': ctx.userAgent,
          'X-YouTube-Client-Name': ctx.clientNameId,
          'X-YouTube-Client-Version': ctx.clientVersion,
          'Accept-Language': 'en-US,en;q=0.9',
          Origin: 'https://www.youtube.com',
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: ctx.name,
              clientVersion: ctx.clientVersion,
              hl: 'en',
              gl: 'US',
              ...(ctx.name === 'ANDROID'
                ? { androidSdkVersion: 34, osName: 'Android', osVersion: '14' }
                : {}),
              ...(ctx.name === 'IOS'
                ? { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iOS', osVersion: '17.5.1.21F90' }
                : {}),
            },
          },
          ...ctx.extraBody,
        }),
        next: { revalidate: 3600 },
      });
    } catch {
      continue;
    }

    if (!res.ok) continue;

    let player: PlayerResponse;
    try {
      player = (await res.json()) as PlayerResponse;
    } catch {
      continue;
    }

    playabilityStatus = player.playabilityStatus?.status ?? playabilityStatus;
    playabilityReason = player.playabilityStatus?.reason ?? playabilityReason;

    const tracks = tracksFromPlayerResponse(player);
    if (tracks.length > 0) {
      return { tracks, playabilityStatus, playabilityReason };
    }

    // If the WEB client says LOGIN_REQUIRED / AGE_VERIFICATION, the next pass (ANDROID/IOS) often unlocks.
    // For OK status with no tracks we still try the next client because some videos selectively
    // disable captions on WEB but expose them on mobile clients.
  }

  return { tracks: [], playabilityStatus, playabilityReason };
}

async function getCaptionTracksViaWatchPage(videoId: string): Promise<CaptionTrack[]> {
  const url = new URL(WATCH_URL);
  url.searchParams.set('v', videoId);
  url.searchParams.set('hl', 'en');

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        // Bypass the EU consent interstitial that hides ytInitialPlayerResponse.
        Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+000; SOCS=CAESEwgDEgk0NDc4MDgyMjAaAmVuIAEaBgiA_LyaBg',
      },
      next: { revalidate: 3600 },
    });
  } catch {
    return [];
  }

  if (!response.ok) return [];

  const html = await response.text();

  const player = extractBalancedJsonAfter(html, 'ytInitialPlayerResponse') as PlayerResponse | null;
  const tracks = tracksFromPlayerResponse(player);
  if (tracks.length > 0) return tracks.filter((t) => typeof t.baseUrl === 'string');

  // Last-resort: a stripped HTML may still contain the captionTracks array directly.
  const direct = extractBalancedJsonAfter(html, '"captionTracks":') as CaptionTrack[] | null;
  if (Array.isArray(direct)) {
    return direct.filter((t) => typeof t.baseUrl === 'string');
  }

  return [];
}

async function getCaptionTracks(videoId: string): Promise<CaptionTrack[]> {
  const innerTube = await getCaptionTracksViaInnerTube(videoId);
  if (innerTube.tracks.length > 0) return innerTube.tracks;

  // The "no captions yet but the video is playable" path: try the watch page as a fallback.
  const fromHtml = await getCaptionTracksViaWatchPage(videoId);
  if (fromHtml.length > 0) return fromHtml;

  // Surface a clear, actionable error if YouTube told us the video itself is blocked.
  const status = innerTube.playabilityStatus;
  if (status && status !== 'OK') {
    const reason = innerTube.playabilityReason || status;
    throw new TranscriptError(`Video not playable: ${reason}`, 451);
  }

  return [];
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
