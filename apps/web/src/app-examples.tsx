import { assembleApp, type ExampleContribution } from '@saas/views';
// example:knowledge:assembly:start
import { createKnowledgeExample } from '@saas/views';
import { browserFileTransfer } from './knowledge-files';
import { DocumentGuardProvider } from './knowledge-navigation';
// example:knowledge:assembly:end
// example:notes:assembly:start
import { createNotesExample } from '@saas/views';
// example:notes:assembly:end

// The explicit assembly point (docs/ui/design.md §4.1): adding or removing
// an example means editing this file only — shared pages, navigation,
// settings, notifications and translations consume the assembled result.
// Each example owns two marker blocks: `assembly` for its imports and
// `entries` for its list entry; every marker name appears at most once per
// file so the removal tool can strip it mechanically.

export const exampleEntries: ExampleContribution[] = [
  // example:knowledge:entries:start
  createKnowledgeExample({
    fileTransfer: browserFileTransfer,
    provide: (page) => <DocumentGuardProvider>{page}</DocumentGuardProvider>,
  }),
  // example:knowledge:entries:end
  // example:notes:entries:start
  createNotesExample(),
  // example:notes:entries:end
];

// Default-entry strategy: the first assembled example that declares a
// default entry wins (the knowledge example today). Pass `defaultEntry`
// here to pin this deployment's entry explicitly; a Core-only app keeps
// the universal home.
export const assembledApp = assembleApp({ examples: exampleEntries });
