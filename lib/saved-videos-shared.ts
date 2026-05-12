export type SavedVideoKind = 'youtube' | 'instagram' | 'webpage';

export interface SavedVideo {
  id: string;
  url: string;
  note: string;
  category: string;
  addedAt: string;
  source?: 'linknest';
  linkNestId?: string;
}

export const INSTAGRAM_SAVED_PREFIX = 'ig_';
export const WEBPAGE_SAVED_PREFIX = 'wp_';
export const UNCATEGORIZED_SAVED_CATEGORY = 'Uncategorized';

export function normalizeSavedVideoCategory(value: unknown): string {
  const category = typeof value === 'string' ? value.trim() : '';
  return category || UNCATEGORIZED_SAVED_CATEGORY;
}

export function getSavedVideoKind(saved: { id: string }): SavedVideoKind {
  if (saved.id.startsWith(INSTAGRAM_SAVED_PREFIX)) return 'instagram';
  if (saved.id.startsWith(WEBPAGE_SAVED_PREFIX)) return 'webpage';
  return 'youtube';
}
