import type { AssembledApp } from './app-contract';
import { useAppMessage } from './messages';

// Renders the assembled business navigation grouped by example. The shell
// never inspects which example a group came from — groups carry their own
// resolved labels, and the assembler already dropped empty ones.

export function BusinessNavigation({
  navigation,
  onOpen,
}: {
  navigation: AssembledApp['navigation'];
  onOpen: (path: string) => void;
}) {
  const message = useAppMessage();
  if (navigation.length === 0) return null;
  return (
    <nav aria-label="业务导航" className="flex flex-col gap-4">
      {navigation.map((group) => (
        <div key={group.id} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            {message(group.labelKey)}
          </h3>
          <div className="flex flex-wrap gap-3">
            {group.items.map((item) => (
              <a
                key={item.id}
                href={item.path}
                className="text-sm underline"
                onClick={(event) => {
                  event.preventDefault();
                  onOpen(item.path);
                }}
              >
                {message(item.labelKey)}
              </a>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
