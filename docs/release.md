# Build and test flow

## Local GitHub release preparation

Create local VSIX packages only when preparing a GitHub release. Ordinary development uses source-only checks with an existing native oasdiff engine. GitHub Actions continues packaging and testing automatically through the existing workflow.

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

The installed-package tests verify OpenAPI 3.1 JSON and split YAML reference resolution in real webviews, imports of small fragments from large neighboring contracts, Preview/Diffs switches, Git revision/index comparisons with version-specific dependencies, added files, engine-error recovery, saved dependency refreshes, source-tab auto closure across editor groups and comparisons, and live preview settings in real Swagger UI controls. Unit tests cover semantic diffs, nested highlighting, selective dependency loading, schemas and constraints, themes, and executable architecture checks. These checks do not perform API requests or measure every visual layout or VS Code version.

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

Each runner builds its own package and runs the complete native release flow. The host and the extension host must match the declared target. No cross-CPU emulation is used. Successful jobs upload a `vsix-<filename-suffix>` artifact; JSON reports and VS Code logs are uploaded even when tests fail. Version-tag runs publish a GitHub release and then upload the same verified packages to Marketplace. Branch and pull-request runs only build and test. Manual runs build by default; the explicit `publish_marketplace` option uploads the current version's existing release without rebuilding.

All six standard runners are listed for public and private repositories. Standard hosted-runner usage is free for public repositories. Private repositories use the account's included minutes and then incur charges. See GitHub's [runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) and [billing documentation](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Automated publication

For a release, update the version in `package.json` and both root entries in `package-lock.json`. Move the changes being shipped from `Unreleased` into `## <version> — YYYY-MM-DD` in `CHANGELOG.md`; its body is the release description. Validate it before creating the tag:

```sh
node scripts/release-notes.cjs --tag v0.4.0
```

After the authorized release commit, push the matching version tag (for example `v0.4.0`). The tag workflow waits for all six native package/test jobs, validates the complete platform set, and creates a draft GitHub release. It uploads six VSIX files and `SHA256SUMS`, then publishes the completed release. GitHub supplies source ZIP and tar archives from the tag. A retry preserves a complete published release; it can resume an incomplete draft.

The Marketplace job runs after GitHub publication in the same workflow: releases created with `GITHUB_TOKEN` do not trigger separate release-event workflows. It downloads the published assets, verifies their checksums and extension identity/version/targets, and publishes all six using the pinned `@vscode/vsce`. It does not rebuild packages. Marketplace validation is asynchronous; successful upload is not a claim that all platforms are already validated.

If publication fails after credentials are configured, use **Re-run failed jobs** on a tag run that contains the current Entra workflow. For the initial `v0.4.0` release, whose tagged workflow used PAT, run **Actions → Build and test VSIX → Run workflow**, select `master`, and enable **publish_marketplace**. This explicit mode uses the current package version, downloads its existing published release, verifies all six assets and checksums, and publishes without rebuilding. Already published version/platform pairs are skipped. Ordinary branch and pull-request builds never publish.

## Marketplace authentication

Use **GitHub OIDC → Microsoft Entra ID → Visual Studio Marketplace**. The `marketplace` job uses `azure/login@v3` and the pinned `vsce` API with `azureCredential: true`. No client secret or PAT is stored. Azure login permits an identity with no Azure subscription; publishing permissions come from publisher membership, not an Azure resource role.

The owner must have a Microsoft Entra tenant and permission to register an application. The project cannot create or grant access to that tenant through GitHub. Reuse an existing Azure DevOps organization connected to this tenant. Creating a new organization requires an active Azure subscription, even though Azure login itself permits no subscription; see [Microsoft's organization prerequisites](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/create-organization#prerequisites). One-time setup:

1. In the [Entra admin center](https://entra.microsoft.com/), open **App registrations → New registration**. Name it `Swagger Lens Marketplace`, select this organizational directory only, and leave Redirect URI empty. Record **Application (client) ID** and **Directory (tenant) ID**. Do not create a client secret.
2. Open the app's **Certificates & secrets → Federated credentials → Add credential**. Select **GitHub Actions deploying Azure resources** and enter:

   | Field | Value |
   | --- | --- |
   | Organization | `catomak` |
   | Organization ID | `39189471` (GitHub owner ID) |
   | Repository | `swagger-lens` |
   | Repository ID | `1408835693` |
   | Entity type | Environment |
   | Environment | `marketplace` |
   | Name | `github-swagger-lens-marketplace` |
   | Issuer | `https://token.actions.githubusercontent.com` |
   | Subject | `repo:catomak@39189471/swagger-lens@1408835693:environment:marketplace` |
   | Audience | `api://AzureADTokenExchange` |

   These GitHub IDs and the immutable subject prefix were verified with the repository API on 2026-10-08. After selecting Environment and entering `marketplace`, confirm that the generated Subject matches the table. Re-check `gh api repos/catomak/swagger-lens/actions/oidc/customization/sub` if the repository is renamed, transferred, or its OIDC settings change. See [GitHub immutable subject claims](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims).

3. The repository environment **marketplace** is prepared under GitHub **Settings → Environments**, allowing tags `v*` and branch `master`; the latter permits retrying an existing release through the explicit manual option. Do not add a required reviewer if publication must remain automatic.
4. Under **Settings → Secrets and variables → Actions → Repository secrets**, add **AZURE_CLIENT_ID** and **AZURE_TENANT_ID** with the two recorded IDs. They identify the app and directory; they are not access tokens. `VSCE_PAT` is unused.
5. In the existing Azure DevOps organization, check **Organization Settings → Microsoft Entra ID** and confirm that its directory is the same tenant as the app. If the organization has no directory connection, use **Connect directory** and select that tenant; see [Microsoft's directory connection guide](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/connect-organization-to-azure-ad). Register the app's service principal through **Organization Settings → Users → Add users**, find `Swagger Lens Marketplace`, and add it. The profile lookup cannot create this registration. Use only the access needed for enrollment; project/repository permissions are not needed for Marketplace publishing. If the picker needs an ID, use the service principal's **Object ID from Enterprise applications**, not the app registration's Object ID. See [Microsoft's identity enrollment guide](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/service-principal-managed-identity#step-2-add-the-identity-to-azure-devops).
6. Run the workflow on `master` with **publish_marketplace** enabled. After Azure login, the **Resolve the Marketplace identity** step prints the app's Azure DevOps profile `id`, not a token. In [publisher Catomak](https://marketplace.visualstudio.com/manage/publishers/catomak), add that ID under **Members** with role **Contributor**. Publishing cannot succeed before this membership exists; use **Re-run failed jobs** after adding it.
7. Verify the successful publish job and all six version/platform entries through Marketplace. Validation is asynchronous, so record upload and validation separately.

If lookup fails with `VSS011031` / `ProfileDoesNotExistException`, complete Azure DevOps enrollment in step 5 before retrying. Entra login can succeed while this profile is still absent. If the profile ID is printed but publishing is denied, complete the publisher Contributor membership in step 6.

The equivalent identity lookup after authenticating Azure CLI as that same application is:

```sh
az rest --url https://app.vssps.visualstudio.com/_apis/profile/profiles/me \
  --resource 499b84ac-1321-427f-aa17-267ca6975798 --query id --output tsv
```

Sources: Microsoft's [extension authentication guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace), [GitHub federation setup](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-create-trust), and [Azure Login](https://github.com/Azure/login#login-without-subscription). The guide's Azure Pipelines example is adapted here to GitHub Actions with an app registration.

As checked on 2026-10-08, global Azure DevOps PATs stop working on **2026-12-01**; organization-scoped PATs are not part of that retirement. Direct `vsce --oidc` is present in the client but the maintainer reports incomplete Marketplace backend support in [issue 1275](https://github.com/microsoft/vscode-vsce/issues/1275). It is distinct from the working GitHub-to-Entra OIDC flow used here.

## Versions

Keep dependencies and engine checksums pinned. Update `package.json`, the root package version in `package-lock.json`, and `CHANGELOG.md` when releasing. Small fixes use patch increments. Preserve old files in `builds/`; new versions use distinct filenames.
