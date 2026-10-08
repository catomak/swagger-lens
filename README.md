# Swagger Lens

Swagger preview and semantic OpenAPI diffs in VS Code.

- OpenAPI **3.0.x / 3.1.x** in JSON and YAML.
- Highlight affected endpoints, nested schema changes, and before/after values.
- Import shared schemas from neighboring files, loading only referenced fragments and dependencies.
- **Try it out** in Preview; light and dark themes.
- macOS Intel/Apple Silicon, Windows and Linux x64/ARM64.

## Quick start

1. Install [Swagger Lens](https://marketplace.visualstudio.com/items?itemName=Catomak.swagger-lens).
2. Open a saved contract and click the editor's preview button, or run **Swagger Lens: Open Swagger Preview**.
3. Switch to **Diffs** to review changes. Use **Changes only** to filter operations and **Base** to select a Git revision (default: `HEAD`).

Opening from a VS Code comparison editor compares its left and right versions. Saving a contract or referenced schema refreshes the preview automatically.

Preview works without Git. Diffs use saved versions and disable API requests. Local file `$ref` imports are supported; HTTP schema references are not loaded.

## Documentation

[Usage and limitations](https://github.com/catomak/swagger-lens/blob/master/docs/usage.md) · [Builds and tests](https://github.com/catomak/swagger-lens/blob/master/docs/release.md) · [Test contracts](https://github.com/catomak/swagger-lens/blob/master/test/fixtures/README.md) · [Changelog](https://github.com/catomak/swagger-lens/blob/master/CHANGELOG.md)

Powered by [Swagger UI](https://github.com/swagger-api/swagger-ui), [oasdiff](https://github.com/oasdiff/oasdiff), and the [Inditex diff plugin](https://github.com/InditexTech/swagger-ui-plugin-diff-highlight).

[Apache-2.0](https://github.com/catomak/swagger-lens/blob/master/LICENSE) · [Third-party notices](https://github.com/catomak/swagger-lens/blob/master/NOTICE)
