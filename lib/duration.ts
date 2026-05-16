import type { DurationFilter, Video } from './types';

export const DEFAULT_DURATION_FILTER: DurationFilter = 'all';

const FIVE_MINUTES = 5 * 60;
const FIFTEEN_MINUTES = 15 * 60;

export const DURATION_FILTERS: Array<{ value: DurationFilter; label: string }> = [
  { value: 'all', label: 'Any length' },
  { value: 'under5', label: '<5 mins' },
  { value: 'under15', label: '<15 mins' },
  { value: 'over15', label: '15+ mins' },
];

export function isValidDurationFilter(value: string | undefined | null): value is DurationFilter {
  return value === 'all' || value === 'under5' || value === 'under15' || value === 'over15';
}

export function parseDurationFilter(value: string | undefined | null): DurationFilter {
  return isValidDurationFilter(value) ? value : DEFAULT_DURATION_FILTER;
}

export function matchesDurationFilter(video: Video, filter: DurationFilter): boolean {
  if (filter === 'all') return true;
  const seconds = video.durationSec;
  if (typeof seconds !== 'number') return filter === 'over15';
  if (filter === 'under5') return seconds < FIVE_MINUTES;
  if (filter === 'under15') return seconds < FIFTEEN_MINUTES;
  return seconds >= FIFTEEN_MINUTES;
}
