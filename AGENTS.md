# Project rules

- Use English for all project-owned UI text, messages, documentation, and comments. Preserve the language and content of user-provided API contracts.
- Update `CHANGELOG.md` within the same task whenever source code, UI, documentation, or builds change.
- Keep changelog entries short: what was added, changed, or fixed. Group related changes; do not describe the work process.
- Add entries under “Unreleased” until release. When building a release, move them under the version from `package.json` and the release date in `YYYY-MM-DD` format.
- Use patch increments for small improvements and fixes, such as `0.3.0` → `0.3.1`. Reserve minor increments for substantial new functionality and major increments for breaking changes.
- Preserve the history of previous versions. Do not include `AGENTS.md` in the VSIX.
