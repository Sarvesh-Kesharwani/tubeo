# YouTube Data API v3 — Quota Cost Report

## Quota System

- **Free daily quota**: 10,000 units/day per GCP project
- Resets at midnight Pacific Time

---

## Cost Per Operation

| Operation | API Method | Units | Trigger |
|-----------|-----------|-------|---------|
| Fetch channel info | `channels.list` | 1 per call (batched, up to 50 IDs) | Page load |
| Fetch all channel videos | `playlistItems.list` | 1 per page per channel | Page load |
| Resolve handle → channel ID | `search.list` | **100** | Adding a channel in Settings |

### What these actually do

**Fetch channel info (`channels.list`)**
Fetches basic details about each channel: name, profile picture, and an internal "uploads playlist ID" that YouTube secretly assigns to every channel to track all its uploads. This ID is what the app needs to then fetch videos.

**Fetch all channel videos (`playlistItems.list`)**
Uses that internal uploads playlist ID to get the channel's videos. This is **every video the channel has ever uploaded** — not just videos the creator manually added to a user-visible playlist. Think of it as YouTube's hidden "all uploads" list.

"1 per page per channel" — YouTube returns videos in batches of up to 50 at a time, and each batch is called a "page". If a channel has 120 recent videos, fetching them costs 3 units (page 1: 50 videos, page 2: 50 videos, page 3: 20 videos). The app caps at **3 pages max per channel** and also stops early once videos fall outside your selected time range — so in practice it's usually 1–2 pages per channel.

The two-step flow: get channel info (including the secret uploads ID) → use that ID to fetch recent videos.

---

## Realistic Per-Load Cost

Assuming **5 channels**, time range **7d**, up to **2 pages** of videos per channel:

| Step | Units |
|------|-------|
| `channels.list` (all 5 batched in 1 call) | 1 |
| `playlistItems.list` (5 channels × ~2 pages) | 10 |
| **Total per feed load** | **~11 units** |

10,000 ÷ 11 ≈ **~900 full feed loads/day** within the free tier.

---

## Adding a Channel (Settings Form)

Each handle/URL resolution via `search.list` costs **100 units**.  
This is a one-time cost per channel added — not per page view.

---

## Caching (Already in Place)

Your `lib/youtube.ts` uses Next.js `fetch` revalidation:

| Data | Cache TTL |
|------|-----------|
| Channel metadata | 1 hour (`revalidate: 3600`) |
| Playlist items (videos) | 10 minutes (`revalidate: 600`) |

This means refreshing the page does **not** re-hit the API until the cache expires — real-world quota usage is much lower than worst-case.

---

## Bottom Line

For personal use, you are well within the free 10,000 units/day limit.  
The only expensive call is `search.list` (100 units) when adding channels — done rarely.
