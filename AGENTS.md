# Project agent rules

## Scope and decisions

- Verify material premises against repository evidence. Use judgment silently for clear, low-risk tasks; correct a false premise with evidence and one recommended path.
- Inspect relevant code first. Ask only when unresolved interpretations materially change the goal, scope, behavior, or acceptance criteria; resolve safely reversible details without approval.
- Make the smallest change that fully satisfies the request. Preserve unrelated working and staged changes; avoid opportunistic cleanup.
- Reuse the current design before adding files, dependencies, abstractions, or settings. Add only what implementation, verification, or an approved requirement needs.

## Efficient execution

- Search with `rg` in relevant paths and read bounded ranges. Batch independent reads; limit output to useful evidence instead of dumping repositories or logs.
- Reuse verified session context and completed checks. Read again when files change, evidence becomes stale, or a new dependency matters.
- Use narrow tools and skills when they materially improve the result or reduce work. Avoid loading instructions solely because a keyword matches.
- Scale reasoning and verification to the risk. More reasoning should improve correctness, not expand scope, artifact count, or answer length.
- Stop when the requested result is verified. Do not add speculative improvements, exhaustive alternatives, or unsolicited next steps.

## Writing

- Use English for project-owned UI, messages, documentation, and comments. Preserve the language and content of user-provided API contracts.
- Use short, direct sentences and concrete claims. Remove filler, praise, canned transitions, generic boilerplate, and repeated summaries.
- Keep README brief; link to detailed usage and development documentation. Keep each rule or fact in one maintained place.
- Comments should explain a non-obvious reason or constraint. Omit comments that merely restate the code.
- Report the result, relevant files, verification, and material blockers. Distinguish verified behavior from assumptions and untested behavior; omit routine activity logs.

## Verification

- Investigate runtime failures before editing; reproduce them when feasible. Fix the responsible layer and test observable behavior or regressions rather than mirroring the implementation.
- Run the smallest relevant checks. Use a real VS Code host when editor tabs, webviews, or configuration behavior need runtime proof; do not package just to validate source changes.
- Check the diff and affected links, setting names, and dependants. Broaden or repeat tests only after new changes, failures, or unresolved concerns.
- Claim platform compatibility only to the extent verified on the corresponding native runner. Packaging a foreign target is not a runtime test.

## Change tracking and releases

- Update `CHANGELOG.md` in the same task whenever source, UI, documentation, or builds change. Write concise English entries about completed behavior, fixes, or developer-facing changes. Group related changes; omit task narration, backlog reminders, duplicate entries, and unverified claims.
- Keep changes under `## Unreleased` until release. Then move the changes being shipped into exactly one `## <version> — YYYY-MM-DD` section, using `### Added`, `### Changed`, and `### Fixed` only when they have entries. Preserve older releases.
- `CHANGELOG.md` is the sole source of release descriptions. CI extracts only the tagged version section; never replace it with commit-generated notes or maintain a separate release summary.
- Before pushing a release tag, synchronize `package.json` and both root versions in `package-lock.json`; verify the notes with `node scripts/release-notes.cjs --tag v<version>`. Push `v<version>` only after the authorized release changes pass local checks. GitHub publication waits for all six native CI targets; Marketplace uses the published release assets and uses GitHub OIDC and Microsoft Entra ID configured for the `marketplace` environment.
- After publication, verify the GitHub assets and Marketplace platform versions before marking release checks complete. If credentials or validation block publication, record the actual state instead of claiming success.
- Change version numbers for releases. Use patch increments for small fixes, minor increments for substantial functionality, and major increments for breaking changes.
- Preserve previous version history and builds. Exclude `AGENTS.md` from VSIX packages.
- Create local VSIX packages only when preparing a GitHub release. Use source-only checks during ordinary development. Existing automatic GitHub Actions builds remain enabled.
- Commit, push, and publish only with explicit user authorization, including approval already given in the session. Stage only relevant changes; never discard unrelated work or rewrite history without authorization.
