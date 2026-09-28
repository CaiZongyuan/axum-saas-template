# Documentation

This is the unified entry to the online tutorials and the generated references. Everything shares one source with the repository: tutorial steps can be followed as-is, the [API contract](site:reference/api.md) and the [configuration reference](site:reference/config.md) are generated from the implementation, and each page's footer marks the repository commit the page was verified against.

- Start with the [quick start](quickstart.en.md) to run the template from a real request.
- The [tutorials](../tutorials/01-full-stack-request.md) walk through registration, sessions, documents, attachments, exports, members, audit and more, one real path at a time.
- The [generated references](site:reference/api.md) list the current API operationIds and configuration defaults, always matching the sources.
- When you are ready to publish your own site, read [publish the documentation site](publish-docs.en.md).

## Languages and scope

The site ships in Simplified Chinese and English, switched from the language menu in the navigation bar; chapters correspond one to one. Chapters that have no translation yet do not appear in the English navigation and never pretend an English page exists. Search covers every published documentation page and generated reference on this site, not in-application data. Links decide the reading language; a shared link is never redirected by device language.

English coverage note: the quick start, this entry, the publishing guide and both generated references are fully available in English. The remaining tutorial chapters are registered migration items in `docs/site.json` and arrive with the implementation tickets that rework their features.

## Maintaining bilingual chapters

New pages must be delivered as a pair: place a same-named `.en.md` file next to the Chinese source and register one stable `id`, both titles and both group labels in `docs/site.json`. The publish checks validate chapter pairing, links and generated references; see [publish the documentation site](publish-docs.en.md) for the full steps.
