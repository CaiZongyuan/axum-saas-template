import { useState } from 'react';
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

export function useDocumentNavigationGuard() {
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
  };
}
