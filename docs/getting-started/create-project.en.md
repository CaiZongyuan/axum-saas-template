# Create Your SaaS Project

Use the Dougong creator to generate a renamed project, choose whether to retain reference applications, and allocate isolated local development ports.

## 1. Create a Copy

Prepare Node 24.18.0. Running the application also requires Rust 1.96.0, pnpm 11.17.0, just 1.58.0 and Docker Compose.

Create a project from npm:

```bash
npx create-axum-saas my-app
```

Omit the directory to be prompted for a project name. The final directory name must use lowercase kebab-case, start with a letter, and contain at most 48 characters. Existing directories are rejected without overwriting files. Knowledge, Notes and the teaching fixtures are included by default.

You can also build the current source snapshot and use a local package from the template repository root:

```bash
pnpm scaffold:pack
npx --yes --package ./.scratch/create-package/create-axum-saas-0.1.2.tgz create-axum-saas my-app
```

The package contains its source snapshot. Creation does not fetch a changing Git branch or install dependencies. The result excludes `.git`, local secrets, data volumes and build directories.

## 2. Run and Verify

```bash
cd my-app
pnpm install --frozen-lockfile
just dev
```

The creator writes available ports to `.env`. Development scripts derive connection URLs, bindings, proxy targets and browser origins from those ports. Startup prints this copy's Web, API, Worker and Mailpit URLs. Open `/register` on the Web origin, create an account, sign out, then sign in at `/login`. The first account is Owner; passwords require 12–128 characters.

Keep development running. In another terminal at the project root:

```bash
project_api=$(node --input-type=module -e \
  'import { developmentEnv } from "./scripts/lib/process.mjs"; console.log(developmentEnv().APP_BIND)')
curl -i "http://$project_api/health/ready"
```

Expect HTTP 200 with `x-request-id`. `Ctrl+C` stops host processes; `just services-down` stops dependencies and preserves volumes.

## 3. Keep Only Core

```bash
npx create-axum-saas plain-app --no-examples
```

`--no-examples` removes all reference businesses and the ticket teaching fixture, example tools, compilation references, dedicated migrations, tests and CI jobs. Contracts and lockfiles are regenerated when the package is built. Identity, membership, authorization, audit, Jobs, files, notifications and other shared capabilities remain. Registration and login land on the generic home. Documentation retains a minimal bilingual development entry and Core API/configuration references.

The project name applies to npm scopes, Rust crates, SQL schemas, metrics, cookies, browser storage keys, the Electron bridge and local credentials. Set your repository with `--repository owner/repo`; otherwise links use `your-org/<project-name>` until you configure the actual repository. License attribution is preserved.

## 4. Multiple Copies and Recovery

Create two directories, install each, and run their `just dev` commands. Reservations live in `create-axum-saas/ports.json` under the user cache directory, so copies that have not started yet still get distinct ports. The registry contains only paths and ports; records for deleted directories are removed on the next creation.

The development entry derives a Compose namespace from the directory name and full path. Identically named directories under different parents also get independent containers, volumes and networks. Previous development volumes remain and are not adopted automatically. To deliberately reuse a previous namespace, set `COMPOSE_PROJECT_NAME` in the process environment and retain its ports and credentials.

A port can become occupied after creation, so startup checks again every time. Conflicts identify a host listener/PID or Docker container/project and suggest stopping the owner or changing the corresponding `*_PORT` in `.env`. Healthy containers without actual bindings fail before migrations. Migration errors preserve the real SQLx cause.

Do not delete volumes to resolve a port conflict. Continue with [project structure](../architecture/project-structure.md) and [adding a business module](../guides/develop-module.md). A generated Core copy can begin its own business under `crates/app/src/modules`.

## 5. Publish the CLI as a Template Maintainer

Update the version in `tools/create-axum-saas/package.json` and merge it into `main` through a PR; published npm versions cannot be overwritten. Wait for CI on that main commit to pass.

The repository Actions Secret `NPM_TOKEN` must hold a granular token limited to `create-axum-saas`, with `Read and write (publish and stage)` permission and `Bypass two-factor authentication` enabled. Replace the Secret when it expires; Actions publishing requires no interactive login.

Open [Publish creator](https://github.com/CaiZongyuan/axum-saas-template/actions/workflows/npm-publish.yml), choose `Run workflow` on `main`, and enter the package metadata's `version`. Leave `publish` unchecked for a dry run and inspect the npm identity, package contents and successful result. Then dispatch the same version with `publish` checked. Publishing checks that the version is unregistered, builds reference and Core snapshots, and waits for registry integrity to match the archive. On failure, check the version, token permissions and expiration; do not republish a version that already succeeded.

[npm's token policy](https://docs.npmjs.com/about-access-tokens/)plans to remove direct new-version publishing with tokens in January 2027; migrate to Trusted Publishing or the new staging flow then. This maintainer workflow, release script and tests are excluded from generated projects.
