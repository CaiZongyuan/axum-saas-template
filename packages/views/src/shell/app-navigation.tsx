import type { AssembledApp } from './app-contract';

// One sidebar link shape everywhere (shell and assembled groups alike).
// Compact h-9 on desktop; the drawer keeps the 44px touch target.
export const sidebarLinkClass =
  'flex h-11 items-center rounded-md px-3 text-sm text-foreground hover:bg-accent lg:h-9 ';
import { useAppMessage } from './messages';

// Renders the assembled business navigation groups. The shell never
// inspects which example a group came from — groups carry their own
// resolved labels, and the assembler already dropped empty ones. The
// landmark (`nav`) belongs to the shell layout around this renderer.

export function BusinessNavigation({
  navigation,
  onOpen,
}: {
  navigation: AssembledApp['navigation'];
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
          {group.items.map((item) => (
            <a
              key={item.id}
              href={item.path}
              className={sidebarLinkClass.trim()}
              onClick={(event) => {
                event.preventDefault();
                onOpen(item.path);
              }}
            >
              {message(item.labelKey)}
            </a>
          ))}
        </div>
      ))}
    </div>
  );
}
