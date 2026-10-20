# Releasing

## How HACS decides what users get

HACS doesn't use branches to separate "staging" from "production". It installs **GitHub releases**:

- When a repository has releases, HACS offers the latest one (and lets people pick from the last five). Commits on `main` after that release don't reach anyone until the next release.
- A release marked **pre-release** is only offered to people who turned on *Show beta versions* for this repository. That is the beta channel.
- With no releases at all, HACS falls back to the default branch, so cut the first release before announcing the repository.

So `main` is the development branch, a version tag is the gate, and there is no need for a separate prod branch.

For a dashboard plugin, HACS looks for `hacs.json` → `filename` (`ha-3dhome.js`) in `dist/`, and downloads every file in `dist/` alongside it. It registers only that one file as a resource; the core then loads `ha-3dhome-editor.js` from the same folder by itself.

## Cutting a release

1. Bump `VERSION3D` (`src/ha-3dhome.js`), `EDITOR_VERSION` (`src/ha-3dhome-editor.js`) and `version` in `package.json` to the same number.
2. Run the tests (`npm test`, `npm run test:mobile`, `npm run test:plan`, `npm run test:demo`), then `npm run build` and commit `dist/`.
3. Push to `main`, then tag that commit and push the tag:

   ```bash
   git tag v4.21.0 && git push origin v4.21.0        # stable
   git tag v4.21.0-beta.1 && git push origin v4.21.0-beta.1   # pre-release (beta testers only)
   ```

4. `.github/workflows/release.yml` checks that the three versions match the tag, that the committed `dist/` is what the build produces, and runs the tests. Then it publishes the release with both files attached and notes generated from the commits.

To pull a bad release, mark it as a pre-release or delete it on GitHub; HACS then offers the previous one again. Don't move a tag that has been published.

## Version numbers

Semantic versioning: a patch for fixes, a minor for new features, a major when an existing dashboard config stops working without changes. The core and editor always carry the same number, because the editor refuses to attach to a different core.

## Demo site

`site/` is a static page that runs the built card on a fictional home (`examples/sample-home.json`) with a fake `hass`: no Home Assistant, no network calls except the CDN (Three.js, icons).

- Locally: `npm run build && npm run demo`, then open http://localhost:8080.
- `node tools/demo.js --out _site` assembles the publishable folder (the page, the card from `dist/`, the sample layout).
- `.github/workflows/pages.yml` publishes it to GitHub Pages on pushes to `main`. Pages needs a public repository, so the workflow skips itself until then. One-time setup: *Settings → Pages → Source: GitHub Actions*.

## Checks

`.github/workflows/validate.yml` runs the HACS action (`hacs/action`, category `plugin`). It also needs a public repository, so it skips itself while the repo is private. For the HACS default list (searchable without adding a custom repository), the repository also needs a description, topics, an issues tab and at least one release.
