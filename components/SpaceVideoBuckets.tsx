import { ChannelRow } from './ChannelRow';
import type { ChannelWithVideos } from '@/lib/types';

export function SpaceVideoBuckets({
  groups,
  now,
  emptyText = 'No channels in this space.',
}: {
  groups: ChannelWithVideos[];
  now: number;
  emptyText?: string;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-chonk border-2 border-dashed border-duo-border bg-duo-soft/50 px-4 py-5 text-sm font-semibold text-duo-mute">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <ChannelRow key={group.channel.id} data={group} now={now} />
      ))}
    </div>
  );
}
