# Publication checklist

GitHub release `0.4.0` is published and all six native platforms passed. Marketplace publication awaits Azure DevOps identity enrollment and publisher Contributor membership; the initial PAT job failed because `VSCE_PAT` was absent. The previous `0.3.8` release remains verified on all six Marketplace platforms; the historical checks below describe that release.

## Identity and repository

- [x] Extension name `swagger-lens`, display name **Swagger Lens**, publisher ID `Catomak`, author `catomak`.
- [x] Repository, homepage, and issue URLs point to [catomak/swagger-lens](https://github.com/catomak/swagger-lens). The public repository exists; its default branch is `master`.
- [x] Commands, settings, source text, documentation, and new package filenames use Swagger Lens. Legacy command/settings aliases and historical changelog/builds remain available.
- [x] PNG icon, description, keywords, categories, dark gallery banner, and supported workspace capabilities are declared.
- [x] Lockfile is synchronized. `.gitignore` excludes dependencies, generated bundles, native binaries, caches, test installations, and VSIX packages.
- [x] Project sources published to `master` in `catomak/swagger-lens`, preserving the repository's initial commit and Apache license.
- [x] All six targets pass [GitHub Actions run 37652097617](https://github.com/catomak/swagger-lens/actions/runs/37652097617), source commit `2317fac`. Windows drive-letter aliases, standalone fixture isolation, and the Windows VS Code CLI layout are covered by the 0.3.8 fixes.

## License and packaged contents

- [x] Project-owned code: Apache-2.0; copyright **2026 catomak** in `NOTICE` and README.
- [x] Full third-party licenses, copyright statements, and upstream NOTICE files are retained. The npm inventory covers 109 packages from actual bundle inputs; the Go inventory includes 34 notice sets for native engine dependencies and the Go runtime.
- [x] `npm run package` uses the validated native release flow. No universal package is advertised for native engines.
- [x] All six 0.3.8 packages pass archive and native installed-VSIX checks. Tested CI artifacts are saved in `builds/`, with matching SHA-256 values and reports under `builds/reports/0.3.8/`. Previous versions remain unchanged.

## Validation

- [x] All 66 unit tests and 14 installed-VSIX webview scenarios pass on every native target with VS Code stable 1.141.0. Windows drive aliases and CLI layouts have explicit regression coverage; standalone fixtures run outside the checkout.
- [x] All 14 installed-VSIX scenarios pass on macOS ARM64 against the declared minimum VS Code version, 1.90.0, and stable 1.141.0.
- [x] Native CI confirms macOS Intel/ARM64, Windows x64/ARM64, and Linux x64/ARM64. Each installed extension host matches its declared OS and architecture; no cross-CPU emulation is used.
- [x] Production dependency audit reviewed on 2026-10-07: no high or critical findings; five moderate package entries refer to one [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), with no patched version. `sprintf-js` and `argparse` are excluded from both bundle input graphs; Remarkable's browser entry excludes its CLI dependency. The shipped prebuilt Swagger UI and Remarkable browser bundles contain no references to that dependency or its affected number-formatting calls. The dependency finding remains in the development install and must be reviewed again when dependencies change.
- [x] Project source/documentation scan found no private absolute paths, private keys, or common token formats. Test API data is synthetic; caches, binaries, builds, and test logs are excluded from Git.

## Marketplace release

- [x] Publisher `Catomak` exists, publishing access is confirmed by the owner, and `Catomak.swagger-lens` is public in Marketplace.
- [ ] Review the published Marketplace listing rendered from README, CHANGELOG, and icon; review the updated summary when the next release is published.
- [x] All six tested VSIX targets are uploaded under extension `Catomak.swagger-lens`, version `0.3.8`, and report `validated` through the public Marketplace API.
- [ ] Install from Marketplace and check Preview/Diffs.

Follow the official [publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) and [manifest reference](https://code.visualstudio.com/api/references/extension-manifest). Version-tag CI publishes a GitHub release after all six native jobs pass, then publishes its verified assets to Marketplace using GitHub OIDC and Microsoft Entra ID.

## 0.4.0 release

- [x] Release version and changelog prepared; agent rules define changelog maintenance and release-note extraction.
- [x] Tag CI configured to wait for six native package/test jobs, publish a complete GitHub release, then publish the same Marketplace packages.
- [x] All six native `0.4.0` builds pass 108 unit tests and 32 installed-VSIX scenarios on VS Code 1.141.0: [CI run 37747217028](https://github.com/catomak/swagger-lens/actions/runs/37747217028), source commit `1850c57`. Reports are saved in `builds/reports/0.4.0/`.
- [x] [GitHub release `v0.4.0`](https://github.com/catomak/swagger-lens/releases/tag/v0.4.0) contains all six tested VSIX packages and verified checksums, matching changelog notes, and tagged source archives. The exact published packages are saved in `builds/`.
- [x] Entra application, federated credential, and repository `AZURE_CLIENT_ID`/`AZURE_TENANT_ID` secrets validated by [run 37800703821](https://github.com/catomak/swagger-lens/actions/runs/37800703821): GitHub OIDC login succeeds and the six published packages pass verification.
- [ ] Service principal enrolled in an Azure DevOps organization connected to the same tenant, then added to publisher Catomak as Contributor. Profile lookup currently reports `VSS011031` / `ProfileDoesNotExistException`; see docs/release.md.
- [ ] Marketplace publish job succeeds.
- [ ] All six Marketplace `0.4.0` platforms report validated.
