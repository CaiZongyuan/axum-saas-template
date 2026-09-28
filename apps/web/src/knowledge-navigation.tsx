import { useState, type ReactNode } from 'react';
import { useBlocker } from '@tanstack/react-router';
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
import { DocumentGuardContext } from '@saas/views';

// The app adapter's router-backed implementation of the knowledge
// example's dirty-document guard: the example consumes the guard through
// its portable context (packages/views/src/knowledge/document-guard.tsx);
// only this adapter knows TanStack Router's blocker API.

export function DocumentGuardProvider({ children }: { children: ReactNode }) {
  const [dirty, onDirtyChange] = useState(false);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
    disabled: !dirty,
  });
  return (
    <DocumentGuardContext.Provider
      value={{
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
                <AlertDialogTitle>内容尚未保存</AlertDialogTitle>
                <AlertDialogDescription>
                  离开会丢失当前草稿。正在保存的请求也可能继续完成。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => blocker.reset?.()}>
                  继续编辑
                </AlertDialogCancel>
                <AlertDialogAction onClick={() => blocker.proceed?.()}>
                  确认离开
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ),
      }}
    >
      {children}
    </DocumentGuardContext.Provider>
  );
}
