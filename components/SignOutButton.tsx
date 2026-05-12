'use client';

export function SignOutButton({
  onSignOut,
  pending,
}: {
  onSignOut: () => void;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSignOut}
      disabled={pending}
      className="flex items-center gap-1"
    >
      <span className="text-duo-mute text-xs">{pending ? 'Signing out...' : 'Sign out'}</span>
    </button>
  );
}
