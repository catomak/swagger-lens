# Changelog

Release descriptions come from the matching version section below. Editing rules are in [AGENTS.md](https://github.com/catomak/swagger-lens/blob/master/AGENTS.md#change-tracking-and-releases).

## Unreleased

- Corrected federated-credential setup to match this repository's GitHub OIDC subject, including immutable owner and repository IDs.

- Replaced PAT-based Marketplace publishing with GitHub OIDC and Microsoft Entra ID. Added an explicit retry of the current GitHub release without rebuilding its packages.

## 0.4.0 — 2026-10-08

### Added

- Preview and Diffs in GitLab merge requests and GitHub pull request/review editors, with commit-specific references, unchanged shared schemas, renamed files, and empty comparison sides.
- Automatic preview closure when the last source-file tab closes, enabled by default through `swaggerLens.autoClosePreview`; duplicate source editors keep the preview open.
- Settings for opening mode, automatic refresh, theme, change filters/list visibility, schema expansion, and Try it out, with live updates to open panels.
- GitHub releases after all six native VSIX builds and installed-extension tests pass, with tested packages, SHA-256 checksums, tagged source archives, and descriptions from this changelog.
- Automatic Marketplace publication of the same six release packages; retries skip already published platform versions.

### Changed

- Condensed README and moved detailed behavior and limitations to the usage guide; updated the extension summary to highlight preview, diffs, and shared-schema imports.
- Preview errors now refer to files and the extension instead of contracts and a prototype.
- macOS package filenames and artifact labels use `macos-*`; VS Code target metadata remains `darwin-*`.
- Updated agent rules for focused changes, concise writing, proportionate checks, and changelog-based releases. Local VSIX packaging is reserved for release preparation; automatic CI builds remain enabled.

## 0.3.8 — 2026-10-07

- Fixed Windows drive-letter aliases bypassing selective schema imports and duplicating dependencies.
- Follow the official Windows VS Code launcher when locating its CLI, including versioned application directories.
- Isolated installed-VSIX fixtures from the project repository and waited for final preview state when test actions overlap automatic refreshes.

- Published project sources on GitHub and enabled the six-platform build and test workflow.

## 0.3.7 — 2026-10-07

- Renamed the project and extension to Swagger Lens, added GitHub/Marketplace metadata, and preserved legacy command and setting compatibility.
- Licensed project-owned code under Apache-2.0 and included original notices for bundled JavaScript and native dependencies.
- Added a publication readiness checklist and made the package command use the validated platform release flow.

- Added two editable icon concepts using a directional diff symbol, including a rotated version with arrow-facing pupils.

## 0.3.6 — 2026-10-07

- Load only referenced fragments and their dependencies from neighboring JSON/YAML documents; reuse each parsed file within a load and preserve full resolution for schema identifiers and named anchors.
- Skip the expanded schema copy in ordinary Preview, including Git snapshots; retain expansion for Diff.
- Stabilize installed-VSIX tests when automatic refreshes overlap mode changes.

## 0.3.5 — 2026-10-07

- Fixed OpenAPI 3.1 internal reference resolution inside VS Code webviews without changing contracts or making network requests.
- Added verified, self-contained builds for macOS Intel/ARM64, Windows x64/ARM64, and Linux x64/ARM64, with native GitHub Actions tests of installed VSIX packages and local release commands.
- Fixed comparison snapshot paths on Windows and made test execution and bundled engine selection platform-aware.

## 0.3.4 — 2026-10-07

- Added green-and-black and green-and-white `{ツ}` icon concepts with PNG previews and editable SVG sources.
- Set the selected green-and-black variant as the extension icon. Package only the selected PNG.

## 0.3.3 — 2026-10-07

- Added permanent YAML 3.0 and JSON/split YAML 3.1 test contracts, demonstration instructions, and checks for OpenAPI 3.1.0, 3.1.1, and 3.1.2.
- Replaced each change card's status heading with a colored dot beside the HTTP method, matching the legend in both themes.
- Added light and dark themes with a pinned toolbar toggle. Follow VS Code's theme until the user chooses one, then preserve that choice across previews and restarts.
- Restricted the changes-list toggle to Diffs, moved the legend beside the affected operations heading, and replaced it with “No operation changes.” for an empty list. Removed the selection hint.

## 0.3.2 — 2026-10-07

- Removed the toolbar's title and version row and replaced the Diff toggle with a **Preview | Diffs** segmented control.
- Added a persistent changes-list toggle with left/right chevrons for side layouts and up/down chevrons for stacked layouts.

## 0.3.1 — 2026-10-06

- Switched the entire interface, messages, oasdiff change descriptions, documentation, and project rules to English.
- Matched Example Value JSON to Schema's light color scheme while preserving Diff highlighting.
- Added version history in `CHANGELOG.md`, a README reference, and rules for updating it and using patch versions for small releases.
- Fixed local VSIX packaging by referring to the built-in Changelog tab instead of a README link that requires a repository URL.

## 0.3.0 — 2026-10-06

- Made Swagger Preview the default mode, with a separate Diff toggle. Preview works outside Git; Diff is disabled there.
- Opening from a VS Code comparison editor uses Diff between its actual left and right versions, including staged files and each side's `$ref` dependencies.
- Enabled Try it out in Preview; request execution is disabled in Diff.
- Fixed nested highlighting and the schema list when switching modes; preserved the “Changes only” setting.
- Added refreshes for local `$ref` dependencies outside Git and recovery to Preview after a diff engine error; ordinary Preview does not require oasdiff.

## 0.2.0 — 2026-10-06

- Added OpenAPI 3.1.x support in JSON and YAML, including webhooks and contracts without `paths`.
- Added diffs for nullable types, boolean schemas, `const`, numeric bounds, and nested JSON Schema 2020-12 constructs.
- Preserved additional constraints alongside `$ref`; added OpenAPI 3.1 schema highlighting with before/after values.
- Added warnings about oasdiff limitations for `$dynamicRef`/`$dynamicAnchor` and `components.pathItems`.

## 0.1.1 — 2026-10-06

- Fixed opening new files missing from the Git base: staged and untracked contracts are compared with an empty API, showing all operations as added.
- Added a notice for a missing base file; invalid Git revisions and missing dependencies still produce errors.

## 0.1.0 — 2026-10-06

- Created a VS Code extension with Swagger UI and semantic OpenAPI 3.0.x diffs in JSON and YAML against a selected Git revision.
- Added an affected operations list, highlighting for additions, removals, and modifications, before/after values, and navigation to operation schemas.
- Supported internal and local `$ref` dependencies, deeply nested and recursive schemas; Git base dependencies are read from the same revision.
- Added an editor title button, a “Changes only” filter, Git base selection, refresh after saving, and an unsaved changes notice.
- Built a macOS VSIX with a bundled oasdiff executable.
