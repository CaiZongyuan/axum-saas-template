# Build your SaaS with Dougong

Start with a Rust + Axum backend. Implement your business module, connect identity, persistence, audit, files and jobs, then deliver an API you can verify and deploy.

<div class="docs-paths">
  <a class="docs-path" href="../learn/"><strong>Build a new business</strong><span>Develop a ticket SaaS backend with data, permissions, files and background jobs.</span></a>
  <a class="docs-path" href="../architecture/project-structure"><strong>Experienced developer</strong><span>Find code ownership, then enter the database, endpoint, use case and testing guides.</span></a>
  <a class="docs-path" href="../reference/api"><strong>Using the framework</strong><span>Look up public API, configuration, module integration and commands.</span></a>
</div>

## Framework and business responsibilities

| Framework capability                                    | Your business owns                                       |
| ------------------------------------------------------- | -------------------------------------------------------- |
| Identity, sessions, membership and organization roles   | Entities, rules and resource access                      |
| Settings, pools, migration entry and public errors      | Use cases, transactions and HTTP contracts               |
| Audit, idempotency, files, jobs, notifications and mail | Audit meaning, file ownership and business Handlers      |
| OpenAPI, generated SDK, testing and deployment          | Business checks, production configuration and operations |

Each deployment serves one Organization with multiple members and business resources. Sharing a deployment across customer organizations needs a new organization context and access contract; see the [deployment decision](../adr/0001-single-organization-deployment.md).

## Understand a business request

```text
HTTP / request DTO
  → your business use case
  → Core public capabilities and transaction
  → PostgreSQL / Platform adapters
  → response DTO / OpenAPI
```

The application composes Router and OpenAPI, your module owns rules and tables, Core provides reusable SaaS capabilities, and Platform encapsulates infrastructure. See [project structure](../architecture/project-structure.md) and [Core and business boundaries](../architecture/module-boundaries.md).

## Run, then develop

Prepare the tools in the [quick start](quickstart.md), then build `tickets` in an isolated copy with the [ticket SaaS course](../learn/index.en.md). Four checkpoints provide complete runnable code. Ten lessons follow one business through persistence, protocols, authorization, transactions, files, jobs, verification and deployment. [Add a business module](../guides/develop-module.md) is the concise integration guide.

Guides provide locations, public interfaces, minimal code, observable results and failure boundaries. Generated [API](site:reference/api.md) and [configuration](site:reference/config.md) keep the implementation as their source of truth.

<!-- example:knowledge:documentation:start -->

## Inspect a complete implementation

The built-in knowledge example combines CRUD, resource grants, attachments, exports, notifications and audit. Learn how it calls Core, then replace the rules with your own business. Inspect [document use cases](../tutorials/04-personal-documents.md), [resource permissions](../tutorials/07-library-grants.md) and [background exports](../tutorials/10-document-exports.md) for complete paths.

<!-- example:knowledge:documentation:end -->

## Clients and contributions

After the backend contract works, use [shared clients](../tutorials/20-electron-shell.md) and [business contributions](../tutorials/27-add-example.md) to connect Web and Electron. Chinese and English chapters stay paired during language switching. Search covers public documentation only.

Read the [author guide](../guides/maintain-docs.md) when changing documentation and the [publishing guide](publish-docs.md) to publish your own site.
