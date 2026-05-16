import type { ApiUsageOperation } from '@/lib/types';

function formatUnits(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function UsageProgressBar({
  dailyLimit,
  usedToday,
  operations,
  compact = false,
}: {
  dailyLimit: number;
  usedToday: number;
  operations: ApiUsageOperation[];
  compact?: boolean;
}) {
  const logged = operations.reduce((sum, operation) => sum + operation.units, 0);
  const legacyUnits = Math.max(0, usedToday - logged);
  const blocks = [
    ...(legacyUnits > 0
      ? [{ id: 'legacy', label: 'Earlier tracked usage', units: legacyUnits, at: '' }]
      : []),
    ...operations,
  ];

  return (
    <div className="space-y-1.5">
      <div
        className={`${compact ? 'h-2.5' : 'h-4'} flex overflow-hidden rounded-full border-2 border-duo-border bg-duo-soft`}
        title={`${formatUnits(usedToday)} of ${formatUnits(dailyLimit)} used`}
      >
        {blocks.map((operation, index) => {
          const width = dailyLimit > 0 ? (operation.units / dailyLimit) * 100 : 0;
          return (
            <span
              key={`${operation.id}-${index}`}
              title={`${operation.label}: ${formatUnits(operation.units)}`}
              className={`h-full shrink-0 ${operation.id === 'legacy' ? 'bg-duo-mute/50' : 'bg-duo-green'}`}
              style={{
                width: `${Math.min(100, Math.max(0, width))}%`,
                minWidth: operation.units > 0 ? 3 : 0,
                marginRight: index < blocks.length - 1 ? 2 : 0,
              }}
            />
          );
        })}
      </div>
      {!compact && (
        <div className="flex items-center justify-between gap-3 text-sm font-bold text-duo-mute">
          <span>{formatUnits(usedToday)} used today</span>
          <span>{dailyLimit > 0 ? ((usedToday / dailyLimit) * 100).toFixed(1) : '0.0'}%</span>
        </div>
      )}
    </div>
  );
}
