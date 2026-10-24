---
title: Documentation site
description: Run, build, preview, and publish the Quell documentation site.
---

## Content and app structure

The Markdown guides and Fumadocs app live together in `docs/`. Edit `docs/*.md` to update published guides; the app code is in `docs/src`. Add a `title` and `description` in YAML frontmatter to each page, then update `docs/meta.json` to set its navigation order. The content collection includes only the top-level Markdown files and `meta.json`, keeping application configuration and generated files out of the page tree. Fumadocs supplies the page title, so Markdown pages should not add a duplicate top-level heading.

The documentation app uses Next.js 16 and is isolated from Quell's existing Next.js 15 web app. Its static export contains documentation only: it does not deploy the API, web application, a backend service, or a Mubit API key.

## Local commands

Run these from the repository root:

```sh
pnpm dev:docs
```

Starts the documentation development server on port 3200.

```sh
pnpm build:docs
```

Builds a static export in `docs/out`.

```sh
pnpm --filter @quell/docs typecheck
```

Type-checks the documentation app.

```sh
pnpm --filter @quell/docs preview
```

Serves the static export on port 3200 for local preview. The preview command requires a completed build.

The `NEXT_PUBLIC_BASE_PATH` setting defaults to an empty value for local development. GitHub Pages builds set it to the repository base path, such as `/cubit`.

## GitHub Pages workflow

The workflow is `.github/workflows/docs.yml`, named **Deploy documentation**. A push to `main` that changes documentation-site inputs triggers a build and deployment. A pull request runs the build only; it does not publish. `workflow_dispatch` permits a manual run. The workflow builds with Node.js 24 and pnpm 10.12.4, then uploads only `docs/out` as the Pages artifact. Deployment uses the `github-pages` environment and GitHub's Pages artifact flow.

The build job needs `contents: read` and `pages: read`; the deploy job needs `pages: write` and `id-token: write`. Configure the repository's Pages source to **GitHub Actions**. The workflow does not require the Mubit secret because it builds static documentation content.

The site is configured for [mosnfar.github.io/cubit](https://mosnfar.github.io/cubit/). For static export details, see [Fumadocs static deployment](https://www.fumadocs.dev/docs/deploying/static). For workflow-based Pages deployment, see [GitHub's custom workflows guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

After the workflow and content changes have merged to `main`, start a manual run if needed:

```sh
gh workflow run docs.yml --ref main
gh run list --workflow docs.yml
```

Confirm the run completed successfully before treating the site as published. To roll back a documentation change, revert the relevant documentation commit through the repository's normal review process and let the workflow publish the reverted content.
