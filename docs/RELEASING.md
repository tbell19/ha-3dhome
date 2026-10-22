# Releasing

## How HACS decides what users get

HACS doesn't use branches to separate "staging" from "production". It installs **GitHub releases**:

- When a repository has releases, HACS offers the latest one (and lets people pick from the last five). Commits on `main` after that release don't reach anyone until the next release.
- A release marked **pre-release** is only offered to people who turned on *Show beta versions* for this repository. That is the beta channel.
- With no releases at all, HACS falls back to the default branch, so cut the first release before announcing the repository.

So `main` is the development branch, a version tag is the gate, and there is no need for a separate prod branch.

3D Home is an **integration** in HACS (it used to be a dashboard plugin, before the sidebar page). HACS downloads `custom_components/ha_3dhome/` from the release into the user's `/config/custom_components/`, and Home Assistant needs a restart to load the new version. The built card files are part of that folder (`custom_components/ha_3dhome/frontend/`): the integration serves them at `/ha_3dhome/…?v=<version>`, so browsers fetch the new files after an update without anyone bumping a resource.

## Cutting a release

1. Bump `VERSION3D` (`src/core/constants.ts`), `EDITOR_VERSION` (`src/ha-3dhome-editor.ts`), `version` in `package.json` and `version` in `custom_components/ha_3dhome/manifest.json` to the same number. The build refuses to run when the manifest and package.json disagree.
2. Run the tests (`npm run test:all`, with the integration's Python tests set up as in its `requirements_test.txt`), then `npm run build` and commit `custom_components/ha_3dhome/frontend/`.
3. Push to `main`, then tag that commit and push the tag:

   ```bash
   git tag v4.21.0 && git push origin v4.21.0        # stable
   git tag v4.21.0-beta.1 && git push origin v4.21.0-beta.1   # pre-release (beta testers only)
   ```

4. `.github/workflows/release.yml` checks that the four versions match the tag, that the committed card files are what the build produces, and runs the tests. Then it publishes the release with `ha_3dhome.zip` (the integration with its frontend files, for manual installs) attached, and notes generated from the commits.

To pull a bad release, mark it as a pre-release or delete it on GitHub; HACS then offers the previous one again. Don't move a tag that has been published.

## Version numbers

Semantic versioning: a patch for fixes, a minor for new features, a major when an existing dashboard config stops working without changes. The core, the editor and the integration always carry the same number, because the editor refuses to attach to a different core and the integration serves the card under its own version.

## Demo site

`site/` is a static page that runs the built card on a fictional home (`examples/sample-home.json`) with a fake `hass`: no Home Assistant, no network calls except the icons (from Iconify, standing in for Home Assistant's own).

- Locally: `npm run build && npm run demo`, then open http://localhost:8080.
- `node tools/demo.js --out _site` assembles the publishable folder (the page, the built card, the sample layout).
- `.github/workflows/pages.yml` publishes it to GitHub Pages on pushes to `main`. Pages needs a public repository, so the workflow skips itself until then. One-time setup: *Settings → Pages → Source: GitHub Actions*.

## Checks

`.github/workflows/validate.yml` runs the HACS action (`hacs/action`, category `integration`), Home Assistant's `hassfest` check of the integration, and the integration's Python tests. The HACS check needs a public repository, so it skips itself while the repo is private, and it ignores the brands check until 3D Home has an icon in `home-assistant/brands`. For the HACS default list (searchable without adding a custom repository), the repository also needs a description, topics, an issues tab and at least one release.
