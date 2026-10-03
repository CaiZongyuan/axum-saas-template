import { useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { useAppMessage } from '@saas/views';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@saas/ui/components/alert-dialog';

// Settings expose dirty state through a portable callback; the app owns
// SPA navigation and browser unload protection, as with the document adapter.
export function useSettingsNavigation() {
  const message = useAppMessage();
  const [dirty, onDirtyChange] = useState(false);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
    disabled: !dirty,
  });
  return {
    onDirtyChange,
    prompt: (
      <AlertDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {message('monitoring.leaveTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {message('monitoring.leaveDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>
              {message('monitoring.keepEditing')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed?.()}>
              {message('monitoring.leaveDiscard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ),
  };
}
