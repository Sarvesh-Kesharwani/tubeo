import { Suspense } from 'react';
import { SignInPopupCompleteClient } from '@/components/SignInPopupCompleteClient';

export default function SignInPopupCompletePage() {
  return (
    <Suspense fallback={null}>
      <SignInPopupCompleteClient />
    </Suspense>
  );
}
