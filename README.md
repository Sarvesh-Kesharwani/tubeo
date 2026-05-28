# Tubeo — Personal YouTube MVP

Curated YouTube feed from a whitelist of channels. Duolingo-inspired UI.

## Stack

- Next.js 15 (App Router, RSC, Node runtime)
- React 19
- Tailwind CSS
- YouTube Data API v3

## Features (MVP)

- **Channels view** (`/channels`) — each channel as its own row.
- **Time filters** — 24h / 3d / 7d / 30d via `?range=1d|3d|7d|30d`.
- Whitelist enforced server-side (only videos from listed channel IDs ever reach the UI).

## Setup

```bash
cp .env.example .env.local
# fill YOUTUBE_API_KEY and WHITELIST_CHANNELS=UCxxx,UCyyy
npm install
npm run dev
```

Get a YouTube Data API v3 key: https://console.cloud.google.com/apis/library/youtube.googleapis.com

Find a channel ID: open any channel → View Source → search `"channelId":"UC...`.

## Architecture

```
app/
  layout.tsx          root shell + header + tabs
  page.tsx            redirects to News
  channels/page.tsx   Channel-grouped feed (RSC)
  globals.css         Tailwind + Duolingo design tokens
components/
  NavTabs.tsx         top-level app navigation
  TimeFilter.tsx      range chips
  VideoCard.tsx       thumbnail + meta
  ChannelRow.tsx      row of videos per channel
  EmptyState.tsx      fallback states
lib/
  types.ts            Channel, Video, TimeRange
  time.ts             range parsing + timeAgo
  whitelist.ts        env-driven whitelist source
  youtube.ts          YouTube API client (server-only)
```

### Extension points

- **Whitelist source**: swap `lib/whitelist.ts` for DB/Postgres call — call sites unchanged.
- **Video source**: `lib/youtube.ts` is the only data layer. Replace with cached DB reads / background sync later.
- **Caching**: `fetch` uses `next: { revalidate }` (10 min videos, 1 hr channel meta). Move to Vercel Runtime Cache or Queues for periodic sync.
- **New views**: add `app/<route>/page.tsx`, reuse `VideoCard` / `ChannelRow`.

## Deploy to Vercel

```bash
npm i -g vercel
vercel link
vercel env add YOUTUBE_API_KEY
vercel env add WHITELIST_CHANNELS
vercel deploy
```
