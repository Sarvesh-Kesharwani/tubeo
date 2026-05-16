import type { DurationFilter, Video } from './types';

export const DEFAULT_DURATION_FILTER: DurationFilter = 'all';

const FIVE_MINUTES = 5 * 60;
const FIFTEEN_MINUTES = 15 * 60;
const THIRTY_MINUTES = 30 * 60;
const ONE_HOUR = 60 * 60;
const TWO_HOURS = 2 * 60 * 60;

export const DURATION_FILTERS: Array<{ value: DurationFilter; label: string }> = [
  { value: 'all', label: 'Any length' },
  { value: 'under5', label: '<5 mins' },
  { value: '5to15', label: '5-15 mins' },
  { value: '15to30', label: '15-30 mins' },
  { value: '30to60', label: '30-60 mins' },
  { value: '60to120', label: '1-2 hrs' },
  { value: 'over120', label: '2+ hrs' },
];

export function isValidDurationFilter(value: string | undefined | null): value is DurationFilter {
  return (
    value === 'all' ||
    value === 'under5' ||
    value === '5to15' ||
    value === '15to30' ||
    value === '30to60' ||
    value === '60to120' ||
    value === 'over120'
  );
}

export function parseDurationFilter(value: string | undefined | null): DurationFilter {
  if (value === 'under15') return '5to15';
  if (value === 'over15') return '15to30';
  return isValidDurationFilter(value) ? value : DEFAULT_DURATION_FILTER;
}

export function matchesDurationFilter(video: Video, filter: DurationFilter): boolean {
  if (filter === 'all') return true;
  const seconds = video.durationSec;
  if (typeof seconds !== 'number') return filter === 'over120';
  if (filter === 'under5') return seconds < FIVE_MINUTES;
  if (filter === '5to15') return seconds >= FIVE_MINUTES && seconds < FIFTEEN_MINUTES;
  if (filter === '15to30') return seconds >= FIFTEEN_MINUTES && seconds < THIRTY_MINUTES;
  if (filter === '30to60') return seconds >= THIRTY_MINUTES && seconds < ONE_HOUR;
  if (filter === '60to120') return seconds >= ONE_HOUR && seconds < TWO_HOURS;
  return seconds >= TWO_HOURS;
}
