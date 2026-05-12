import { Suspense } from 'react';
import { SignInPopupClient } from '@/components/SignInPopupClient';

export default function SignInPopupPage() {
  return (
    <Suspense fallback={null}>
      <SignInPopupClient />
    </Suspense>
  );
}
