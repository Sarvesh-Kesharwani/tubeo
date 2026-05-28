# Plan: Connect Prompt Editor to Summary Generation

## Problem
The UX flow for generating an InsightsOnIndia summary is disjointed:
1. User visits `/news` → sees "no-prompt" banner
2. Scrolls down to prompt editor → types a prompt → saves
3. Must scroll back up to the summary card → clicks "Regenerate"
4. Two separate sections, two separate actions, unclear connection

## Solution
Add a "Generate Summary" button directly inside the `NewsPromptEditor`. When clicked, it saves the prompt (if needed), calls the DeepSeek summarize API, then refreshes the page so the `NewsSummaryCard` picks up the freshly generated summary.

## Files to Modify

### 1. `components/NewsPromptEditor.tsx`
**Add "Generate Summary" button + generation logic**

- Import `useRouter` from `next/navigation`
- Add `generating` state (boolean)
- Add `generateError` state (string | null)
- Add a "Generate Summary" button in the footer row, after the existing "Save prompt" button
- On click of "Generate Summary":
  1. If prompt is dirty (unsaved), save it first via `PUT /api/news/prompt`
  2. Then call `POST /api/news/summary` (no date param = uses today's IST date)
  3. On success: `router.refresh()` to trigger server re-render with fresh summary
  4. On error: show error message
- Button shows "Generating…" while busy, disabled during generation
- Only show the button when prompt is saved (not dirty) OR auto-save on click

### 2. `components/NewsSummaryCard.tsx`
**Sync initial prop when server re-renders**

- Add `useEffect` that watches `initial` prop
- When `initial` changes (from `router.refresh()` server re-render), update `result` state
- This ensures the card shows fresh data after prompt-editor-triggered generation
- Guard against overriding a result that was just set via the card's own "Regenerate" button (compare `result.date` and `result.regenerated` with new `initial`)

### 3. `lib/news-source.ts`
**Improve HTML extraction robustness** (preventive fix)

- The regex `<div[^>]*class="[^"]*(?:entry-content|td-post-content|post-content)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/(?:section|div|article|main)>` is fragile — the closing pattern requires the div to be immediately followed by a closing parent tag
- Fix: simplify to only match the opening div, capture content until the NEXT `</div>` at the same nesting level (use a simpler closing pattern like `</div>` with a non-greedy match, or just grab everything from the article start)
- Better approach: after matching the opening container, capture everything until the next `<footer`, `<aside`, `</article>`, or end of document
- Add `"tdb_single_content"` to the class list (another common Newspaper theme class)
- Fallback: if no article container found, try `<div class="post">` or just use a broader slice of body content

## Verification

1. **Fresh user flow**: Visit `/news` signed in → see "no-prompt" banner → scroll to prompt editor → type a prompt → click "Generate Summary" → summary appears above without needing to scroll back and click Regenerate
2. **Existing user flow still works**: Visit `/news` with an existing prompt and cached summary → summary shows immediately → can still use the card's "Regenerate" button independently
3. **Prompt editor "Generate" after edit**: Edit an existing prompt → click "Generate Summary" → prompt is auto-saved, then summary regenerates, page refreshes with new data
4. **Error handling**: If DeepSeek fails, error message appears in the prompt editor (not just silence)
5. **HTML extraction**: Fetch a real InsightsOnIndia URL, verify article text is extracted correctly (≥500 chars, contains article headings/paragraphs, not navigation/boilerplate)
