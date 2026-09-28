# Publish the documentation site

The repository Markdown is the only editable source. The [site manifest](../site.json) decides the published pages; source snippets and the API/configuration references are generated from the implementation. `apps/docs/.generated` and build output are never committed to source branches.

## Registering bilingual chapters

The site publishes Simplified Chinese and English side by side: Chinese keeps its existing paths and English lives under the fixed `en/` prefix, one-to-one with the Chinese chapters. New pages must be delivered as a pair:

1. Create a same-named `.en.md` file next to the Chinese source (for example `docs/getting-started/quickstart.md` and `docs/getting-started/quickstart.en.md`). Both files use the same relative links and `<<<` snippet references; links land on the right language automatically depending on whether the target chapter has an English translation.
2. Register one stable `id` for the page in the `pages` array of `docs/site.json`, providing `title`/`titleEn` and `source`/`sourceEn` together; group names get labels for both languages through the top-level `groupLabels`.
3. Run `pnpm docs:check`. It validates chapter pairing, duplicate ids/routes, dangling links and the generated references, and fails when an English translation is missing.

Existing chapters without a translation are explicit migration items: `translation: { "status": "pending", "owner": "<ticket>" }` declares which implementation ticket will deliver the English page; validation only accepts ticket ids from the published plan. The site keeps building during the migration; these chapters stay out of the English navigation and never generate links to pages that do not exist. Placeholder text must not pretend an English translation exists.

The language switcher always targets the same chapter; when the target chapter has no English translation it falls back to the English documentation entry. Search covers every published documentation page and generated reference on this site. The whole site shares one top bar, font stack, light/dark theme and language rules; the upcoming Landing, Blog and Downloads pages reuse the same conventions.

## First-time GitHub Pages setup

These steps are for maintainers with repository administration rights. First commit and push the sources to your own GitHub repository, confirm `origin` points there, and change `repository` in `docs/site.json` to your own `owner/repository`. Source links embed the current commit SHA, so you must rebuild after committing.

```bash
pnpm docs:build
node scripts/publish-docs.mjs
```

The publish script commits the static files to a separate `gh-pages` branch without switching your current source branch or touching the staging area. Then in GitHub's **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, pick the `gh-pages` branch with `/ (root)`, and save. This works for public repositories; other visibility levels depend on your GitHub plan.

With the GitHub CLI installed and signed in locally, request a build and verify the online result:

```bash
node scripts/publish-docs.mjs --request-build
```

The command checks the Pages configuration, explicitly requests a build, confirms the build corresponds to the static artifact commit that was just published, and reads the online home page to verify the source version. It fails after five minutes; a successful push by itself does not mean the pages are reachable.

## Continuous publishing

The [CI workflow](../../.github/workflows/ci.yml) runs `just check` on PRs and stores the documentation artifact. Once sources merge to `main` and checks pass, the publish job pushes the same artifact to `gh-pages` and explicitly requests a Pages build using `contents: write` and `pages: write` permissions.

Pushing a branch with the `GITHUB_TOKEN` in GitHub Actions does not trigger a Pages build, so `--request-build` cannot be skipped. The first Pages setup still needs an administrator; CI never tries to change repository administration settings.

The default address is `https://<owner>.github.io/<repository>/`. The site path is derived from the repository name; custom domains or non-default paths can adjust the build base through `DOCS_BASE`. Under a subpath deployment, chapter switching, language switching, source links and search are all based on relative paths and the build-time base — no extra configuration required.
