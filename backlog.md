# Backlog

Latest verified Marketplace release: `0.3.8`. Release `0.4.0` is being prepared; publication status is recorded in docs/publication-checklist.md.

1. [x] Add a button to collapse the panel with the list of changes. Use left/right chevrons for a side panel and up/down chevrons for a stacked panel; preserve list visibility when switching modes. Completed in `0.3.2`.
2. [x] Add YAML and OpenAPI 3.1.x test fixtures. Permanent before/after pairs for YAML 3.0, JSON 3.1, and split YAML 3.1, with automated 3.1.0/3.1.1/3.1.2 checks and demonstration instructions. Completed in `0.3.3`.
3. [x] **English throughout the project.** Switch the entire interface, generated change descriptions, messages, documentation, and project rules to English. Completed in `0.3.1`.
4. [x] **Swagger Preview by default, Diff as an optional mode.** Standard Swagger Preview is the primary feature. Diff remains an optional mode and the extension's key feature. Use a **Preview | Diffs** segmented control in the top toolbar next to the other buttons and the “Changes only” checkbox. Files outside a Git repository must work in Preview; disable the Diffs button for them.
5. [x] **Opening mode follows the VS Code context.** Open with `diffs = false` from an ordinary editor and `diffs = true` from a comparison editor. Detect the context through the VS Code API. Users can switch modes after opening using the toggle from item 4.
6. [ ] OpenAPI 3.2.x support.
7. [ ] AsyncAPI support.
8. [x] Light and dark themes with a pinned toolbar toggle. Default to VS Code's theme and persist the user's choice. Completed in `0.3.3`.
9. [ ] Cursor position in a file support. When the cursor position changes in the file that the extension has open, the extension automatically moves the focus in the preview to the same location.
10. [ ] Advanced focus tracking functionality—includes support for scrolling through the target file: when scrolling in the file, the preview also scrolls “to the desired location,” and the components in the preview naturally expand and collapse as you scroll.
11. [x] Self-contained builds and native installed-VSIX tests for macOS Intel/ARM64, Windows x64/ARM64, and Linux x64/ARM64. Local release commands and a GitHub Actions matrix. Flow added in `0.3.5`; all six native targets verified in `0.3.8` ([CI run](https://github.com/catomak/swagger-lens/actions/runs/37652097617)).
12. [x] Import only selected fragments and their reachable dependencies from neighboring JSON/YAML files, with one parse per file per refresh. Skip the expanded schema copy in Preview; preserve Diff expansion and version-specific Git dependencies. Completed in `0.3.6`.
13. [x] Rename the project to Swagger Lens, prepare GitHub and Marketplace metadata and a publication checklist, and license project-owned code under Apache-2.0 with bundled component notices. Completed in `0.3.7`; native CI passed in `0.3.8`. [Marketplace release `0.3.8`](https://marketplace.visualstudio.com/items?itemName=Catomak.swagger-lens) is public, with all six platform packages validated.
14. [x] Update the extension summary to emphasize Swagger Preview, semantic diffs, efficient shared-schema imports, and six native platforms. Updated README and Marketplace metadata in `0.4.0`.
15. [x] Automatically close Preview/Diffs when the last source-contract tab closes; preserve the panel while another source editor remains open. Controlled by `swaggerLens.autoClosePreview`, enabled by default. Included in `0.4.0`.
16. [x] Expose user settings for auto closure, refresh, opening mode, theme, change filtering/list visibility, schema expansion, and Try it out, alongside Git base and engine path. Documented in docs/usage.md; included in `0.4.0`.
17. [ ] Replace the Refresh button label with an icon and pin it on the right next to the light/dark theme toggle.
18. [x] Publish GitHub releases after all six native builds and installed-VSIX tests pass. Attach tested VSIX packages and SHA-256 checksums; GitHub provides tagged source ZIP/tar archives. Extract release descriptions from CHANGELOG.md. Implemented in `0.4.0`.
19. [x] Automatically publish the six GitHub release VSIX packages to VS Code Marketplace, with checksum/version/target checks and duplicate-safe retries. Requires the `VSCE_PAT` repository secret. Implemented in `0.4.0`.
