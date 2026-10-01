# Publish your documentation site

Publish a checked bilingual static build to your own GitHub Pages. Repository Markdown, [site.json](../site.json) and real code are canonical; generated sources and dist do not belong in the source branch. See [Maintain documentation](../guides/maintain-docs.md) for authoring and registration.

You need push access, plus repository administration access for initial setup. Requesting Pages builds requires an installed, authenticated GitHub CLI. Run commands from the repository root. Publishing writes static artifacts to remote `gh-pages`.

## Prepare public source and build

Confirm `origin` points to your GitHub repository and change `docs/site.json.repository` to `owner/repository`. Register bilingual pages, commit/push the source, then build:

```bash
git remote -v
pnpm docs:check
pnpm docs:build
```

The footer SHA identifies the source revision referenced by the build; it does not establish that every example command passed on that revision. Published content must exist in the corresponding commit. Rebuild after committing so source links resolve on GitHub.

The repository name determines the default Pages prefix. Set a custom path at build time:

```bash
DOCS_BASE=/my-saas/ pnpm docs:build
```

Base must match the actual deployment path. Chapters, language switching, assets and search share it; do not repair paths by editing dist.

## Publish and configure Pages once

```bash
node scripts/publish-docs.mjs
```

The [publish script](../../scripts/publish-docs.mjs) verifies the artifact repository/source revision against publish inputs, commits and pushes artifacts to independent `gh-pages`, and leaves the source branch and index unchanged. Identical artifacts do not create unnecessary commits.

In GitHub **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, branch `gh-pages`, directory `/ (root)`, and save. Whether Pages supports the repository's visibility depends on the account plan.

Then request and verify the online build:

```bash
node scripts/publish-docs.mjs --request-build
```

The command checks Pages configuration, explicitly requests a build, confirms its artifact commit and reads the live homepage's source SHA. It fails if this does not succeed within five minutes. A pushed branch does not establish that the page is live.

## Subsequent automatic publication

[CI](../../.github/workflows/ci.yml) selects checks by changed paths: tooling and documentation for docs, the backend course for teaching sources, and relevant client checks for client changes. `verify` aggregates all selected jobs; failures and unexpected skips prevent success. The documentation job preserves the checked website artifact. On `main`, publication requires both successful `verify` and documentation jobs, pushes that same artifact to `gh-pages`, then requests a Pages build with `contents: write` and `pages: write`. Commits without a website artifact do not publish documentation.

An Actions `GITHUB_TOKEN` push does not automatically trigger a Pages build, so keep `--request-build`. The publishing job does not implicitly change the administrator's one-time Pages settings.

## Verify and recover from failures

Open `https://<owner>.github.io/<repository>/` and verify bilingual counterparts, search, your chapter, source revision and links. Run `just e2e-docs` against static artifacts before navigation/base changes; API, databases and Electron are unnecessary.

| Failure                               | Recovery                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| Artifact repository/revision mismatch | Confirm repository/origin and intended commit, then rebuild                           |
| Pages configuration mismatch          | Select branch publishing from `gh-pages:/`, then request again                        |
| Permission or build failure           | Check CLI/CI permissions and Pages errors; preserve failure output                    |
| Page/asset 404                        | Align actual path and DOCS_BASE, fix source and rebuild/publish                       |
| Return to older content               | Check out a reviewed old revision and rebuild/publish instead of editing static pages |

Use [static-site maintenance](../tutorials/30-public-site.md) to add links for delivered product capabilities. Backend deployment and recovery are separate tasks in the [production guide](../tutorials/21-single-machine-production.md).
