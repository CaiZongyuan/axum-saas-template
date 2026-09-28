import { useMemo, useState } from 'react';
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  BellIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CircleXIcon,
  CompassIcon,
  CopyIcon,
  DatabaseIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  FilterIcon,
  FlagIcon,
  FolderIcon,
  GlobeIcon,
  HouseIcon,
  ImageIcon,
  InfoIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  MailIcon,
  MenuIcon,
  MessageSquareIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  RepeatIcon,
  SaveIcon,
  SearchIcon,
  SettingsIcon,
  Share2Icon,
  StarIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UploadIcon,
  UserIcon,
  UsersIcon,
  XIcon,
  ZapIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Input } from '@saas/ui/components/input';
import { useAppMessage } from '../shell/messages';
import { useCopyStatus } from './copy-status';

// The icon catalog (docs/ui/design.md §6 Q9): a curated subset of the
// bilingual product's Lucide icons, loaded as its own async chunk so the
// icon set never lands in the initial bundle. Categories color through
// production tokens; the copy button carries a localized accessible name,
// and copy feedback is text, never color alone.

type CatalogCategory = {
  id: 'actions' | 'navigation' | 'status' | 'objects';
  colorClass: string;
  icons: { name: string; Icon: LucideIcon }[];
};

const CATALOG: CatalogCategory[] = [
  {
    id: 'actions',
    colorClass: 'text-primary',
    icons: [
      { name: 'Plus', Icon: PlusIcon },
      { name: 'Pencil', Icon: PencilIcon },
      { name: 'Trash2', Icon: Trash2Icon },
      { name: 'Search', Icon: SearchIcon },
      { name: 'Download', Icon: DownloadIcon },
      { name: 'Upload', Icon: UploadIcon },
      { name: 'Copy', Icon: CopyIcon },
      { name: 'RefreshCw', Icon: RefreshCwIcon },
      { name: 'Play', Icon: PlayIcon },
      { name: 'Save', Icon: SaveIcon },
      { name: 'Filter', Icon: FilterIcon },
      { name: 'Share2', Icon: Share2Icon },
    ],
  },
  {
    id: 'navigation',
    colorClass: 'text-link',
    icons: [
      { name: 'ChevronUp', Icon: ChevronUpIcon },
      { name: 'ChevronDown', Icon: ChevronDownIcon },
      { name: 'ChevronLeft', Icon: ChevronLeftIcon },
      { name: 'ChevronRight', Icon: ChevronRightIcon },
      { name: 'ArrowRight', Icon: ArrowRightIcon },
      { name: 'ArrowUpRight', Icon: ArrowUpRightIcon },
      { name: 'Menu', Icon: MenuIcon },
      { name: 'X', Icon: XIcon },
      { name: 'ExternalLink', Icon: ExternalLinkIcon },
      { name: 'House', Icon: HouseIcon },
      { name: 'Compass', Icon: CompassIcon },
      { name: 'Repeat', Icon: RepeatIcon },
    ],
  },
  {
    id: 'status',
    colorClass: 'text-success',
    icons: [
      { name: 'Check', Icon: CheckIcon },
      { name: 'CircleCheck', Icon: CircleCheckIcon },
      { name: 'CircleX', Icon: CircleXIcon },
      { name: 'TriangleAlert', Icon: TriangleAlertIcon },
      { name: 'Info', Icon: InfoIcon },
      { name: 'CircleHelp', Icon: CircleHelpIcon },
      { name: 'LoaderCircle', Icon: LoaderCircleIcon },
      { name: 'Bell', Icon: BellIcon },
      { name: 'Star', Icon: StarIcon },
      { name: 'Flag', Icon: FlagIcon },
      { name: 'Zap', Icon: ZapIcon },
    ],
  },
  {
    id: 'objects',
    colorClass: 'text-warning',
    icons: [
      { name: 'File', Icon: FileIcon },
      { name: 'Folder', Icon: FolderIcon },
      { name: 'Image', Icon: ImageIcon },
      { name: 'Calendar', Icon: CalendarIcon },
      { name: 'Mail', Icon: MailIcon },
      { name: 'User', Icon: UserIcon },
      { name: 'Users', Icon: UsersIcon },
      { name: 'KeyRound', Icon: KeyRoundIcon },
      { name: 'Database', Icon: DatabaseIcon },
      { name: 'Globe', Icon: GlobeIcon },
      { name: 'MessageSquare', Icon: MessageSquareIcon },
      { name: 'Settings', Icon: SettingsIcon },
    ],
  },
];

export default function IconCatalog({
  copyText,
}: {
  copyText: (text: string) => Promise<void>;
}) {
  const message = useAppMessage();
  const [query, setQuery] = useState('');
  const { copy, status } = useCopyStatus(copyText);
  const needle = query.trim().toLowerCase();
  const categories = useMemo(
    () =>
      CATALOG.map((category) => ({
        ...category,
        icons: category.icons.filter((icon) =>
          icon.name.toLowerCase().includes(needle),
        ),
      })).filter((category) => category.icons.length > 0),
    [needle],
  );
  const total = categories.reduce(
    (count, category) => count + category.icons.length,
    0,
  );
  return (
    <div className="flex flex-col gap-4">
      <Input
        type="search"
        aria-label={message('design.icons.search')}
        placeholder={message('design.icons.search')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p className="text-sm text-muted-foreground">
        {message('design.icons.count', { count: total })}
        {' · '}
        {message('design.icons.licenseNote')}
      </p>
      {categories.map((category) => (
        <section key={category.id} className="flex flex-col gap-2">
          <h3 className={`text-sm font-semibold ${category.colorClass}`}>
            {message(`design.icons.cat.${category.id}`)}
          </h3>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {category.icons.map(({ name, Icon }) => (
              <li key={name}>
                <button
                  type="button"
                  aria-label={message('design.icons.copy', { name })}
                  className={`flex size-20 flex-col items-center justify-center gap-1 rounded-md border border-border hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${category.colorClass}`}
                  onClick={() => void copy(name)}
                >
                  <Icon aria-hidden="true" className="size-5" />
                  <span className="text-[10px] text-muted-foreground">
                    {name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">
          {message('design.icons.empty')}
        </p>
      ) : null}
      {status}
    </div>
  );
}
