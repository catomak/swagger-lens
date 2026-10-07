# Swagger Lens

A local VS Code extension for standard Swagger Preview and inline OpenAPI change reviews in Swagger UI.

Source and issues: [catomak/swagger-lens](https://github.com/catomak/swagger-lens). Version history: `CHANGELOG.md` in the project, or the **Changelog** tab in the installed extension's details.

## Usage

1. Install the VSIX for your OS and architecture: Extensions → `…` menu → Install from VSIX. Locally built packages are written to `builds/`; GitHub Actions uploads tested packages as workflow artifacts. macOS filenames use `macos-arm64` for Apple Silicon and `macos-x64` for Intel.
2. Open a saved OpenAPI JSON or YAML file.
3. Click the preview button on the right of the editor title. The command is also available as **Swagger Lens: Open Swagger Preview** and in the file's context menu.
4. An ordinary editor opens **Swagger Preview**: the full current contract, schemas, server selection, authorization, and **Try it out**. The **Preview | Diffs** control in the top toolbar selects the mode; its inactive half is dimmed but remains clickable. The **Changes only** checkbox is enabled in Diffs. Preview works outside Git, with the Diffs button disabled.
5. Saving the main file or a referenced schema file refreshes the preview automatically.

The sun/moon button stays at the top right of the toolbar when the window narrows or the controls wrap. Preview and Diffs both support light and dark themes. The extension follows VS Code's theme until you use the toggle, then remembers your choice across files, closed previews, and VS Code restarts.

Opening from a VS Code comparison editor starts **Diff** between its actual left and right versions. Git revisions, the Git index, and working files are supported. Each side's local `$ref` dependencies are read from the same version. Turning Diff off shows the right side's contract, including the staged version when the right side is the Git index.

When enabling Diff manually from ordinary Preview, the default base is `HEAD`. The **Base** button selects another branch, tag, or commit for the current preview; it can also replace the comparison editor's left version with a selected Git base. Set a persistent default using `swaggerLens.baseRef`.

Diff lists all affected operations on the left, or above the contract in a narrow window. Use the leftmost chevron button to hide or show the list; it appears only in Diffs, and its arrow points left/right for a side panel and up/down for a stacked panel. The list heading includes the color legend when operations have changed, or “No operation changes.” when the list is empty. The list visibility and “Changes only” setting are preserved when switching modes. Select an operation to expand its requests and responses. Opening again from an ordinary editor returns an existing preview to standard Preview mode.

If the file is missing from the selected revision, such as a newly added Git file, it is compared with an empty contract and all operations are shown as added. A notice explains that the base file is missing.

Additions are green, removals are red with strikethrough, and modified elements are amber. Each change card has a matching colored dot before its HTTP method. Changed fields show the previous and new values of `type`, `enum`, `required`, and other attributes. A change to a shared nested schema appears under every affected operation. **Example Value** matches **Schema** in both themes, including Diff colors.

## Supported scope

- Supports **OpenAPI 3.0.x and 3.1.x**, JSON/YAML, and internal and local file `$ref` dependencies.
- References such as `../service-b/api.yaml#/components/schemas/Item` import only that fragment and its reachable dependencies. Each source file is read and parsed once per refresh; unrelated schemas are not bundled and their dependencies are not followed. JSON/YAML text still needs to be read and parsed in full. Schema identifiers and named anchors retain the existing full-document resolver behavior. Preview keeps a compact bundle; only Diff creates an expanded copy for highlighting.
- OpenAPI 3.1 support includes webhooks, including contracts without `paths`, nullable types such as `type: ["string", "null"]`, boolean schemas, `const`, numeric `exclusiveMinimum`/`exclusiveMaximum`, and nested JSON Schema 2020-12 constructs. Constraints alongside `$ref` are preserved as a separate `allOf` branch to avoid replacing the target schema's constraints.
- oasdiff has limitations for `$dynamicRef`/`$dynamicAnchor` and `components.pathItems`. Diff shows a warning when these constructs are present because the corresponding changes may be missing from the diff.
- Compares **saved files**. Unsaved changes are shown in a notice; files are not saved automatically.
- External HTTP schema references are not loaded. All UI resources and diff computation are local.
- Base files and their dependencies are read from the selected Git revision or the comparison editor's left side. Working files are not modified.
- Recursive schemas retain circular `$ref` references without being expanded indefinitely.
- Changes to `allOf`/`oneOf`/`anyOf` are shown by branch position; reordering branches may create additional visual markers within an already modified operation.
- **Diff** restores removed elements for review. Request execution is disabled; the review document must not be used as the active API contract.
- Standard **Preview** supports **Try it out → Execute**. Requests are sent to the selected API server only when the user clicks Execute. The server must allow CORS for browser requests. The extension collects no telemetry.
- All six platform builds bundle oasdiff 1.33.0: macOS Intel/ARM64, Windows x64/ARM64, and Linux x64/ARM64. The `swaggerLens.oasdiffPath` setting can override the bundled engine; ordinary Preview does not need it.
- Project-owned text and generated change descriptions are in English. API contract content is displayed in its original language.

## Test contracts

`test/fixtures/` contains permanent before/after pairs for YAML 3.0, JSON 3.1, and split YAML 3.1 with local schema references. `test/fixtures/README.md` describes the expected changes and browser demonstration commands. `npm test` checks those files in Preview and Diff, including OpenAPI 3.1.0, 3.1.1, and 3.1.2 compatibility.

## Building from source

```bash
npm ci
npm run release
```

Requires Node.js 22.19+ (Node.js 24 in CI), npm, Git, and `tar`. Linux GUI tests also need Xvfb and the VS Code system libraries. The release command downloads verified binaries, builds the extension, runs unit tests, checks the VSIX, and installs and tests that package in an isolated VS Code profile. It writes the package and reports to `builds/`.

`npm run release:all` packages all six targets on one machine and runs VS Code only for the host target. Foreign packages are explicitly reported as `packaged-only`. The GitHub Actions workflow runs each target's complete release on a native runner. See `docs/release.md` in the source project for setup, coverage, and local commands.

After a release run, `npm test` can reuse its native engine via `API_DIFF_TEST_BINARY`; see the build guide. Tests never need to modify your normal VS Code profile.

Small improvements and fixes use patch versions, such as `0.3.0` → `0.3.1`. Minor versions are reserved for substantial new functionality; major versions are reserved for breaking changes.

## Components

- [oasdiff](https://github.com/oasdiff/oasdiff), Apache-2.0 — semantic diffs and affected operations.
- [Swagger UI](https://github.com/swagger-api/swagger-ui), Apache-2.0 — contract rendering.
- [Inditex diff plugin](https://github.com/InditexTech/swagger-ui-plugin-diff-highlight), Apache-2.0 — operation, parameter, and response highlighting.
- The local adapter preserves nested models, adds before/after values, and applies diff metadata to the preview document.

Third-party licenses are included in `THIRD-PARTY/`; generated license comments are in `dist/*.LEGAL.txt`.

## License

Copyright 2026 catomak. Swagger Lens's own code is licensed under [Apache-2.0](https://github.com/catomak/swagger-lens/blob/master/LICENSE). Bundled components retain their original licenses; full texts and attribution notices are included in `THIRD-PARTY/` and `NOTICE`.

## Upgrading from the local prototype

Swagger Lens uses the extension ID `Catomak.swagger-lens`. Remove the old Swagger API Diff installation to avoid duplicate preview buttons. Existing `swaggerApiDiff.baseRef` and `swaggerApiDiff.oasdiffPath` settings remain usable until an explicit `swaggerLens` setting overrides them, and old command shortcuts keep working. The theme preference starts from VS Code's theme for the new extension ID.
