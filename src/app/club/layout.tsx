import { Suspense } from 'react';
import ClubShell from '@/components/ClubShell';
import { FullScreenLoader } from '@/components/ui';

export default function ClubLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <ClubShell>{children}</ClubShell>
    </Suspense>
  );
}
