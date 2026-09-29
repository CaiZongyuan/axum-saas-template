// The registration blocks the notes example contributes to the assembled
// app. Notes ships unregistered by default (UI-R5): the CI example-removal
// scenario adds it back with scripts/example-add.mjs to prove the
// composition interface keeps working, and docs/tutorials/27-add-example.md
// walks through the same marker contract by hand.
export default {
  'apps/web/src/app-examples.tsx': [
    {
      marker: 'assembly',
      // After the last example's assembly block — never inside one, or a
      // later removal of that example would splice this import away.
      afterLastMatch: '^// example:\\w+:assembly:end',
      text: [
        '// example:notes:assembly:start',
        "import { createNotesExample } from '@saas/views';",
        '// example:notes:assembly:end',
      ].join('\n'),
    },
    {
      marker: 'entries',
      beforeLine: '];',
      text: [
        '  // example:notes:entries:start',
        '  createNotesExample(),',
        '  // example:notes:entries:end',
      ].join('\n'),
    },
  ],
};
