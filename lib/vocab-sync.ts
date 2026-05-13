import type { VocabItem } from './types';

export function mergeVocabs(local: VocabItem[], remote: VocabItem[] = []): VocabItem[] {
  const seen = new Set<string>();
  const merged: VocabItem[] = [];

  for (const item of [...local, ...remote]) {
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }

  return merged;
}

export function sameVocabs(a: VocabItem[], b: VocabItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return (
      other?.id === item.id &&
      other.word === item.word &&
      other.meaning === item.meaning &&
      other.status === item.status &&
      other.addedAt === item.addedAt &&
      other.meaningUpdatedAt === item.meaningUpdatedAt
    );
  });
}
