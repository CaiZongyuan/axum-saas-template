import { ModuleIcon } from '@saas/ui/components/module-icon';
import type { AssembledApp } from './app-contract';
import { useAppMessage } from './messages';

// One sidebar link shape everywhere (shell and assembled groups alike).
// Compact h-9 on desktop; the drawer keeps the 44px touch target. Links
// carry their module icon (registry lookups are optional data — an entry
// without one still renders) before the label.
export const sidebarLinkClass =
  'flex h-11 items-center gap-2 rounded-md px-3 text-sm text-foreground hover:bg-accent lg:h-9 ';

// Renders the assembled business navigation groups. The shell never
// inspects which example a group came from — groups carry their own
// resolved labels, and the assembler already dropped empty ones. The
// landmark (`nav`) belongs to the shell layout around this renderer.

export function BusinessNavigation({
  navigation,
  moduleIcons,
  onOpen,
}: {
  navigation: AssembledApp['navigation'];
  moduleIcons?: AssembledApp['moduleIcons'];
  onOpen: (path: string) => void;
}) {
  const message = useAppMessage();
  return (
    <div className="flex flex-col gap-4">
      {navigation.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          <h3 className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {message(group.labelKey)}
          </h3>
          {group.items.map((item) => {
            const icon = moduleIcons?.[item.path];
            return (
              <a
                key={item.id}
                href={item.path}
                className={sidebarLinkClass.trim()}
                onClick={(event) => {
                  event.preventDefault();
                  onOpen(item.path);
                }}
              >
                {icon ? (
                  <ModuleIcon
                    icon={icon.icon}
                    variant={icon.variant}
                    appearance="bare"
                    size="sm"
                  />
                ) : null}
                {message(item.labelKey)}
              </a>
            );
          })}
        </div>
      ))}
    </div>
  );
}
