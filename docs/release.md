# Build and test flow

## Local release

Install Node.js 22.19+ (CI uses Node.js 24), npm, Git, and `tar`. Run these commands from the project root:

```sh
npm ci
npm run release
```

The release command builds and tests the host's package. It downloads oasdiff 1.33.0 from its official GitHub release, verifies a pinned SHA-256 checksum and the binary's OS/architecture, and stages only runtime assets. It then:

1. Executes the staged engine and all unit tests.
2. Creates a platform-specific VSIX in `builds/`.
3. Checks its target/version, runtime assets, bundled binary, executable permissions, and icon; rejects unwanted files such as `AGENTS.md`, source maps, and development assets.
4. Downloads official stable VS Code, installs the VSIX in an isolated profile, and tests the installed extension with real webviews and disposable Git repositories.
5. Writes JSON reports to `builds/reports/`. Any failed step exits with a nonzero status.

The installed-package tests verify OpenAPI 3.1 JSON and split YAML reference resolution in real webviews, imports of small fragments from large neighboring contracts, Preview/Diffs switches, Git revision/index comparisons with version-specific dependencies, added files, engine-error recovery, and saved dependency refreshes. Unit tests cover semantic diffs, nested highlighting, selective dependency loading, schemas and constraints, themes, and executable architecture checks. These checks do not perform API requests or measure every visual layout or VS Code version.

An explicit native target works too:

```sh
npm run release -- --target darwin-arm64
```

The target must match the host. To package every target on one machine:

```sh
npm run release:all
```

This runs VS Code only for the native target. Other packages receive `packaged-only` status, with their archive, metadata, assets and executable format checked. Their runtime tests require a runner with the corresponding OS and architecture.

Linux needs a display and the VS Code system libraries. On Ubuntu 24.04:

```sh
sudo apt-get update
sudo apt-get install -y xvfb libgtk-3-0 libnss3 libgbm1 libasound2t64
xvfb-run -a npm run release
```

Xvfb provides a virtual display; it does not emulate Linux or another CPU.

Downloads are cached under `.cache/oasdiff/` and `.vscode-test/`. Staged files, isolated extensions and VS Code logs are under `.build/`. Test fixtures live in a short temporary directory outside the checkout so standalone contracts cannot inherit its Git repository. Fixtures and the short temporary VS Code profile are removed after the run; the short profile also avoids Unix socket path limits. The normal VS Code installation and extensions stay untouched. Set `API_DIFF_VSCODE_VERSION` to a specific release to reproduce a run; the report records the actual VS Code version.

For faster source-only checks after a release, reuse the staged native engine. Examples:

```sh
# macOS ARM64
API_DIFF_TEST_BINARY="$PWD/.build/darwin-arm64/extension/bin/oasdiff" npm test
```

```powershell
# Windows ARM64
$env:API_DIFF_TEST_BINARY = "$PWD/.build/win32-arm64/extension/bin/oasdiff.exe"
npm test
```

`npm run build` rebuilds JavaScript and CSS without packaging or launching VS Code. Unit tests also accept `bin/oasdiff` (or `bin/oasdiff.exe` on Windows) when provided locally.

## GitHub Actions

macOS packages use `macos-arm64` and `macos-x64` in filenames and artifact labels. Their VSIX metadata and release command targets remain `darwin-arm64` and `darwin-x64`, as required by VS Code.

The workflow is `.github/workflows/build.yml`. Add the source project, including `package-lock.json`, to a GitHub repository. No repository or upload is created by the local release command.

The workflow runs on pull requests, pushes to `main`/`master`, version tags beginning with `v`, and manual **Actions → Build and test VSIX → Run workflow**. It uses six independent native runners:

| Filename suffix | VS Code target | GitHub-hosted runner |
| --- | --- | --- |
| `macos-arm64` | `darwin-arm64` | `macos-15` |
| `macos-x64` | `darwin-x64` | `macos-15-intel` |
| `win32-x64` | `win32-x64` | `windows-2025` |
| `win32-arm64` | `win32-arm64` | `windows-11-arm` |
| `linux-x64` | `linux-x64` | `ubuntu-24.04` |
| `linux-arm64` | `linux-arm64` | `ubuntu-24.04-arm` |

Each runner builds its own package and runs the complete native release flow. The host and the extension host must match the declared target. No cross-CPU emulation is used. Successful jobs upload a `vsix-<filename-suffix>` artifact; JSON reports and VS Code logs are uploaded even when tests fail. Packages are not published to the Marketplace.

All six standard runners are listed for public and private repositories. Standard hosted-runner usage is free for public repositories. Private repositories use the account's included minutes and then incur charges. See GitHub's [runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) and [billing documentation](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Versions

Keep dependencies and engine checksums pinned. Update `package.json`, the root package version in `package-lock.json`, and `CHANGELOG.md` when releasing. Small fixes use patch increments. Preserve old files in `builds/`; new versions use distinct filenames.
