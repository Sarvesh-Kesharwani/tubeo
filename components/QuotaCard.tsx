import { UsageProgressBar } from '@/components/UsageProgressBar';
import type { ApiUsageSummary } from '@/lib/types';

function formatUnits(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function UsagePanel({ summary }: { summary: ApiUsageSummary }) {
  return (
    <div className="rounded-2xl border-2 border-duo-border bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-duo-greenDark">Daily quota</p>
          <h3 className="mt-1 text-xl font-extrabold text-duo-ink">{summary.label}</h3>
        </div>
        <div className="text-right">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-duo-mute">Remaining</p>
          <p className="mt-1 text-xl font-extrabold text-duo-greenDark">{formatUnits(summary.remainingToday)}</p>
          <p className="text-sm font-bold text-duo-mute">of {formatUnits(summary.dailyLimit)}</p>
        </div>
      </div>

      <div className="mt-4">
        <UsageProgressBar
          dailyLimit={summary.dailyLimit}
          usedToday={summary.usedToday}
          operations={summary.operations}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="text-sm font-extrabold text-duo-ink">Operations today</h4>
          {summary.operations.length === 0 ? (
            <p className="mt-2 rounded-2xl bg-duo-soft px-3 py-2 text-sm font-bold text-duo-mute">
              No tracked operations today.
            </p>
          ) : (
            <ul className="mt-2 max-h-56 space-y-2 overflow-auto pr-1">
              {[...summary.operations].reverse().map((operation) => (
                <li key={operation.id} className="flex items-start justify-between gap-3 rounded-2xl bg-duo-soft px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold text-duo-ink">{operation.label}</p>
                    <p className="text-xs font-bold text-duo-mute">{new Date(operation.at).toLocaleTimeString()}</p>
                  </div>
                  <span className="chip cursor-default shrink-0">{formatUnits(operation.units)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h4 className="text-sm font-extrabold text-duo-ink">Triggers and cost</h4>
          <ul className="mt-2 space-y-2">
            {summary.triggerCosts.map((trigger) => (
              <li key={trigger.label} className="rounded-2xl border-2 border-duo-border px-3 py-2">
                <p className="text-sm font-extrabold text-duo-ink">{trigger.label}</p>
                <p className="text-xs font-bold text-duo-mute">{trigger.cost}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function QuotaCard({
  youtube,
  deepseek,
  resetTimezone,
}: {
  youtube: ApiUsageSummary;
  deepseek: ApiUsageSummary;
  resetTimezone: string;
}) {
  return (
    <section className="card p-5 space-y-4">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-duo-greenDark">Usage monitor</p>
        <h2 className="mt-1 text-2xl font-extrabold text-duo-ink">API quota budget</h2>
        <p className="mt-1 text-sm font-bold text-duo-mute">Daily usage resets at midnight ({resetTimezone}).</p>
      </div>
      <UsagePanel summary={youtube} />
      <UsagePanel summary={deepseek} />
    </section>
  );
}
