import { resetSupabaseDailyUsage } from '@/lib/supabase-sync';

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!expected || auth !== `Bearer ${expected}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const result = await resetSupabaseDailyUsage();
  return Response.json({ ok: true, ...result });
}
