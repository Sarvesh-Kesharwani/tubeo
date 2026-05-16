import { ChannelRow } from './ChannelRow';
import type { ChannelWithVideos } from '@/lib/types';

export function SpaceVideoBuckets({
  groups,
  now,
  emptyText = 'No videos in this space for the current filter.',
}: {
  groups: ChannelWithVideos[];
  now: number;
  emptyText?: string;
}) {
  const visibleGroups = groups.filter((group) => group.videos.length > 0);

  if (visibleGroups.length === 0) {
    return (
      <div className="rounded-chonk border-2 border-dashed border-duo-border bg-duo-soft/50 px-4 py-5 text-sm font-semibold text-duo-mute">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {visibleGroups.map((group) => (
        <ChannelRow key={group.channel.id} data={group} now={now} />
      ))}
    </div>
  );
}
