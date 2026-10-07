# Publication checklist

Prepared for Swagger Lens 0.3.7 on 2026-10-07. Checked items describe local evidence; unchecked items still need a publishing account or a remote run.

## Identity and repository

- [x] Extension name `swagger-lens`, display name **Swagger Lens**, publisher ID `Catomak`, author `catomak`.
- [x] Repository, homepage, and issue URLs point to [catomak/swagger-lens](https://github.com/catomak/swagger-lens). The public repository exists; its default branch is `master`.
- [x] Commands, settings, source text, documentation, and new package filenames use Swagger Lens. Legacy command/settings aliases and historical changelog/builds remain available.
- [x] PNG icon, description, keywords, categories, dark gallery banner, and supported workspace capabilities are declared.
- [x] Lockfile is synchronized. `.gitignore` excludes dependencies, generated bundles, native binaries, caches, test installations, and VSIX packages.
- [x] Project sources published to `master` in `catomak/swagger-lens`, preserving the repository's initial commit and Apache license.
- [ ] Confirm the first six-target GitHub Actions run; native runtime results are tracked in the Validation section below.

## License and packaged contents

- [x] Project-owned code: Apache-2.0; copyright **2026 catomak** in `NOTICE` and README.
- [x] Full third-party licenses, copyright statements, and upstream NOTICE files are retained. The npm inventory covers 109 packages from actual bundle inputs; the Go inventory includes 34 notice sets for native engine dependencies and the Go runtime.
- [x] `npm run package` uses the validated native release flow. No universal package is advertised for native engines.
- [x] All six 0.3.7 archives passed checks of the manifest, icon, runtime assets, native engine, license, and notices, with no development files or `AGENTS.md`. Previous VSIX files were preserved unchanged.

## Validation

- [x] 60 unit tests and 14 installed-VSIX webview scenarios passed on macOS ARM64 with VS Code 1.141.0. Reports: `builds/reports/0.3.7/`. The first run timed out while loading a second webview; the subsequent full release run passed. Failed-run diagnostics remain in `.build/failed-0.3.7/`.
- [ ] Test the installed package against the declared minimum VS Code version, 1.90.0.
- [ ] Obtain successful native CI results for macOS Intel/ARM64, Windows x64/ARM64, and Linux x64/ARM64. Cross-packaging alone does not confirm foreign-platform runtime behavior.
- [x] Production dependency audit reviewed on 2026-10-07: no high or critical findings; five moderate package entries refer to one [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), with no patched version. `sprintf-js` and `argparse` are excluded from both bundle input graphs; Remarkable's browser entry excludes its CLI dependency. The shipped prebuilt Swagger UI and Remarkable browser bundles contain no references to that dependency or its affected number-formatting calls. The dependency finding remains in the development install and must be reviewed again when dependencies change.
- [x] Project source/documentation scan found no private absolute paths, private keys, or common token formats. Test API data is synthetic; caches, binaries, builds, and test logs are excluded from Git.

## Marketplace release

- [ ] Verify that `Catomak` exists as a Marketplace publisher and that the publishing account has access. The provided ID alone does not prove account access.
- [ ] Review the Marketplace listing rendered from README, CHANGELOG, and icon. Exact-name search found no Swagger Lens listing on 2026-10-07; this does not reserve the name.
- [ ] Upload all six tested VSIX targets under the same extension/version, then install from Marketplace and check Preview/Diffs.

Follow the official [publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) and [manifest reference](https://code.visualstudio.com/api/references/extension-manifest). This project prepares packages and CI artifacts; it does not automatically publish to Marketplace.
