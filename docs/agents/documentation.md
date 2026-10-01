# Documentation maintenance

Read this when creating or editing public documentation, examples, navigation or generated references. The accepted direction is [documentation v2](../plans/documentation-rebuild.md): teach developers to build their own SaaS backend with Dougong.

## Write and verify one developer task

1. Identify the reader, task and page type. Use `overview`, `tutorial`, `guide`, `concept` or `reference` in `docs/site.json`.
2. Inspect the current public interface, source and existing behavior checks. Use CONTEXT terms and accepted ADRs. Distinguish framework capabilities, reference applications and code the reader adds.
3. Write the smallest complete path from source location to observable result. Tutorials continue the same business code; guides can be entered independently. Explain the reason after the first runnable result.
4. Deliver Chinese and English sources together with one stable chapter id. Set explicit `previous`/`next` ids when pages form a sequence; absent relationships disable automatic unrelated neighbors.
5. Update code, tests, source snippets, links and example ownership with the capability. Keep API DTOs and configuration defaults generated from implementation.
6. Run affected public behavior checks, `pnpm docs:check` and `pnpm docs:build`. Compare visible navigation and layouts with the accepted experience. Use the repository simplification and Standards + Spec review before delivery.

Done when the task can be followed in its declared source version, both languages have the same behavior, published links resolve, example ownership is correct, and validation records its actual scope.

## Content responsibilities

| Type | Required content |
| --- | --- |
| Tutorial | Starting code state, complete change, files, run/request, expected result, one failure check, next stage |
| Guide | Goal, prerequisites, public interface, complete minimal implementation, verification, recovery |
| Concept | Definition, real relationship diagram, minimal example, tradeoff and failure boundary, practical guide |
| Reference | Source, classified index, types/options/returns/errors/limits, links to usage |
| Overview | Framework scope, developer entry paths and a first result |

Keep historical tickets and validation reports in maintainer records. The public page describes current behavior. The footer SHA identifies the build source; it does not prove every command was tested.

## Source and ownership

Repository Markdown and tracked teaching code are canonical. `apps/docs/.generated` and VitePress output are derived. Use `<<<` for source snippets and Markdown links to source files; the renderer localizes destinations registered in the site model.

Keep historical published routes when reorganizing source files. Register new bilingual routes explicitly. Reference-domain content belongs in its manifest; shared pages wrap domain-specific links in registered `example:<prefix>:<marker>` blocks. Removing an example must leave Core documentation and other learning paths valid.

Use screenshots to identify actual UI or results with reproducible development content and a recorded version. Use compact code and diagrams for backend flow. Explain placeholders, command working directories, required services and whether a step changes persistent data.

Only add a new source of generated facts when the public reference needs it. Prefer the existing OpenAPI, Settings/FIELDS and task runners. Changes to an interface update its teaching examples in the same implementation.
