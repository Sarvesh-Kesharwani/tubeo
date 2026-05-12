export type SavedVideoKind = 'youtube' | 'instagram' | 'webpage';

export interface SavedVideo {
  id: string;
  url: string;
  note: string;
  addedAt: string;
}

export const INSTAGRAM_SAVED_PREFIX = 'ig_';
export const WEBPAGE_SAVED_PREFIX = 'wp_';

export function getSavedVideoKind(saved: { id: string }): SavedVideoKind {
  if (saved.id.startsWith(INSTAGRAM_SAVED_PREFIX)) return 'instagram';
  if (saved.id.startsWith(WEBPAGE_SAVED_PREFIX)) return 'webpage';
  return 'youtube';
}
