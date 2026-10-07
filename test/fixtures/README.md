# Test contracts

These permanent before/after pairs can be opened in VS Code and used by `npm run demo`. The automated fixture tests use the same files.

| Pair | Before | After | Expected affected operations |
| --- | --- | --- | --- |
| OpenAPI 3.0.3, YAML | `yaml/old.yaml` | `yaml/new.yaml` | 4 |
| OpenAPI 3.1.2, JSON | `openapi31/json/old.json` | `openapi31/json/new.json` | 6, including one webhook |
| OpenAPI 3.1.2, split YAML | `openapi31/yaml/old/openapi.yaml` | `openapi31/yaml/new/openapi.yaml` | The same 6 |

The existing `old.json` and `new.json` remain the original demonstration pair.

## Expected changes

The YAML 3.0 pair changes an enum in a schema nested five levels deep. It affects both `GET /applications` and `GET /applications/{id}`. The pair also adds `POST /applications/recheck`, removes `GET /legacy/status`, adds `reason`, and removes `legacyCode`. `GET /health` remains unchanged.

The 3.1 pairs describe the same API in two formats. The shared `Record` schema is reached through `Envelope → payload → meta → details → record`. Changes affect `GET /records`, `POST /records`, `GET /records/{id}`, and the `record.changed` webhook. `POST /records/recheck` is added; `GET /legacy/status` is removed. `GET /health` remains unchanged.

The 3.1 schema changes cover:

- Removing `null` from a union type and changing its enum.
- Changing `const`, numeric `exclusiveMinimum` and `exclusiveMaximum`, and boolean schemas.
- Adding a required field and removing an old field.
- Changing `maxLength` beside `$ref` while preserving the referenced schema's `minLength` and `pattern`.
- Changing `prefixItems`, `patternProperties`, and `if`/`then` constraints.

The split YAML pair stores the schema chain in `schemas/envelope.yaml` and the leaf schemas in `schemas/record.yaml`, separately for each side. The loader tracks all three files on each side. The automated tests also run both 3.1 pairs as OpenAPI `3.1.0` and `3.1.1`, using temporary copies that preserve the project fixtures.

## Browser demonstration

Run these commands from the project directory:

```bash
npm run build
npm run demo -- test/fixtures/openapi31/yaml/old/openapi.yaml test/fixtures/openapi31/yaml/new/openapi.yaml demo/openapi31-yaml
node test/preview-server.cjs demo/openapi31-yaml 8788
```

Open `http://127.0.0.1:8788/` and switch between Preview and Diffs. Diffs should show six affected operations with green, red, and amber markers. Preview should show the current contract, including the unchanged health operation, without the removed operation or diff markers. Both themes should keep schemas and Example Value readable.

All three pairs use `http://127.0.0.1:8788` as their server. With the local preview server running, `Try it out → Execute` on `GET /health` returns a JSON health response. Other fixture operations do not have a local implementation.

To check the empty state, pass the same new contract as both arguments to `npm run demo`. To run the automated checks, use `npm test`.
