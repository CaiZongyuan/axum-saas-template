# Maintain developer documentation

Ship documentation with public capabilities. When implementing your SaaS feature, update its tutorials, code examples, translations and verification entry points together.

## Choose the page type

| Type      | Start with                                                                   | Completion check                                     |
| --------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| Tutorial  | Previous code state, complete change and result                              | The same business code continues into the next stage |
| Guide     | Development goal, prerequisites, public interface and minimal implementation | The task works when entered independently            |
| Concept   | Definition, real relationship diagram and minimal code                       | Readers know when to use it, why and its boundaries  |
| Reference | Fact source, categories, parameters, returns and limits                      | Readers can locate the current contract              |

Backend tutorials focus on files, code, requests and results. State working directory, dependencies, complete changes and expected responses. Show the runnable path before explaining details.

## Register bilingual pages

Markdown is the editable source. Add a same-named `.en.md` beside Chinese and register stable id, both titles, sources, published route, group and page type in [site.json](../site.json).

Use chapter ids in `previous` / `next` for a sequence. Without an explicit relationship, disable automatic neighbors so a next chapter does not lead to an unrelated guide.

Keep historical published routes stable. Move sources with their links and site declarations. Rendering localizes registered destinations, and the footer links to the build source commit.

## Keep examples runnable

Use `<<<` to include checked source. State insertion locations, compile or execute examples through the same verification entry, and link fragments to complete code. Rust/OpenAPI owns DTOs; Settings/FIELDS owns defaults.

```bash
pnpm docs:check
pnpm docs:build
```

Business HTTP or public-capability checks verify success, denial and critical failures. Browser checks verify reading and navigation. Building successfully does not establish that the teaching steps work.

## Example ownership

Register specific tutorials and code in the example manifest. Put example links on shared pages inside registered markers. Removing the example removes its content and navigation while preserving buildable Core documentation.

## Maintainer records

[CONTEXT](../../CONTEXT.md) owns terms, [architecture rules](../../ARCHITECTURE.md) describe dependencies and runtime contracts, and [ADRs](../adr/0002-executable-removable-reference.md) record decisions. [Capability coverage and historical acceptance](../architecture/v1-coverage.md) records evidence. The [development flow](../agents/development-flow.md) and [author rules](../agents/documentation.md) describe maintenance; GitHub Issues owns live implementation state.

Use [publish documentation](../getting-started/publish-docs.md) for your own site.
