import { DEFAULT_MEDIA_FILTER, parseMediaFilter } from './media';
import { DEFAULT_RANGE, parseRange } from './time';
import { CHANNELS_OVERVIEW_SPACE, type ViewPreferences } from './types';
import { normalizeSpaceName } from './spaces';

export const DEFAULT_VIEW_PREFERENCES: ViewPreferences = {
  home: {
    range: DEFAULT_RANGE,
    media: DEFAULT_MEDIA_FILTER,
  },
  channels: {
    range: DEFAULT_RANGE,
    media: DEFAULT_MEDIA_FILTER,
    space: CHANNELS_OVERVIEW_SPACE,
  },
  updates: {
    range: DEFAULT_RANGE,
    media: DEFAULT_MEDIA_FILTER,
  },
};

export function normalizeViewSpace(value: string | undefined | null): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed === CHANNELS_OVERVIEW_SPACE) {
    return CHANNELS_OVERVIEW_SPACE;
  }

  return normalizeSpaceName(trimmed);
}

export function normalizeViewPreferences(value?: Partial<ViewPreferences> | null): ViewPreferences {
  return {
    home: {
      range: parseRange(value?.home?.range),
      media: parseMediaFilter(value?.home?.media),
    },
    channels: {
      range: parseRange(value?.channels?.range),
      media: parseMediaFilter(value?.channels?.media),
      space: normalizeViewSpace(value?.channels?.space),
    },
    updates: {
      range: parseRange(value?.updates?.range),
      media: parseMediaFilter(value?.updates?.media),
    },
  };
}

export function sameViewPreferences(a: ViewPreferences, b: ViewPreferences): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
