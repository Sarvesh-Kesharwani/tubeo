import { EmptyState } from '@/components/EmptyState';
import { VocabClient } from '@/components/VocabClient';
import { getCookieChannelStore } from '@/lib/channels-cookie';
import { getSession } from '@/lib/session';

export default async function VocabPage() {
  const session = await getSession();
  if (!session?.user) {
    return (
      <EmptyState
        emoji="AZ"
        title="Sign in to track vocabulary"
        description="Save words you encounter and get a quick definition from DeepSeek."
      />
    );
  }

  const store = await getCookieChannelStore();

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-duo-ink">Vocab</h1>
        <p className="text-sm font-bold text-duo-ink/60">
          Drop a word. DeepSeek fills in the meaning.
        </p>
      </section>
      <VocabClient vocabs={store.vocabs} />
    </div>
  );
}
