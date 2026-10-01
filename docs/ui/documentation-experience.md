# Documentation experience accepted on 2026-10-01

The user accepted v2 and asked for implementation. The documentation teaches backend developers to build their own SaaS with Dougong. v1's knowledge-product walkthrough was replaced by a developer path; Web/Desktop remains a client extension.

## Accepted inputs

- Sidebar content stays at the viewport's left edge with a stable 264px desktop width. Reading content is constrained independently; narrow screens use the existing navigation drawer.
- The documentation entry provides continuous business development, topic guides and reference entry points.
- Main sections: Start, Development, Core capabilities, Production, Reference and Client extensions; contributing material is disclosed separately.
- Project structure explains actual source locations, ownership, request flow and how to connect a module, migration, Router/OpenAPI, Handler and behavior tests.
- The ticket course demonstrates code the reader adds using the real Core and Platform. It does not register a new default product without a separate implementation scope.
- Both locales retain historical URLs, chapter pairing, search, theme and public Home/Documentation/Blog/Downloads navigation.

The retained preview is `.scratch/documentation-rebuild/v2/preview.html`, SHA-256 `f0b7cd98d04ce01542749b73c190b0da963ae90d89c232adde886c14b82f7971`. The starting revision is `0b53e60ef0f0991768399aec41a29b2bdd00ddaa`. The [implementation plan](../plans/documentation-rebuild.md) records scope and the [GitHub spec](https://github.com/CaiZongyuan/axum-saas-template/issues/115) is the canonical published specification.

## Acceptance evidence

DOC01 was verified against base `0b53e60` plus its uncommitted documentation, renderer/theme, author rules, manifest, teaching fixture, API test/dev dependency and validation changes. User-staged agent/browser installation changes were outside the implementation scope.

- The built site has the accepted backend entry, unframed reader paths, source diagrams and module guide. At 1920px the sidebar is at x=0, width=264px, and its navigation starts at x=26px; the reading container is independent. Existing public layouts retain their accepted structure.
- `just check` passed: format/lint/types, contracts/boundaries, tooling, backend/frontend behavior, performance budgets, Web/Desktop and bilingual documentation builds.
- `pnpm tutorial:check` applies the complete first-module edits in a temporary backend source copy, then verifies both actual API constructors and their OpenAPI over the real Router. It does not exercise PostgreSQL because the first-stage handler is static.
- `just e2e-docs` passed 14 public-site journeys and a custom-base smoke, including same-page languages, explicit next navigation, local search in both languages, theme and narrow-screen keyboard controls.

The complete persistence/authorization/jobs teaching course belongs to DOC02; this evidence covers DOC01 and does not claim that future course stages were executed. Later slices update this record with their own source revision and verification scope.
