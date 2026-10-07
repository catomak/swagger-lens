// JSON Schema $ref siblings are additional constraints, rather than overrides.
// Keep the siblings in place and express the reference as another allOf branch.
const schemaKeywords = new Set(['$id', '$schema', '$anchor', '$defs', 'type', 'const', 'enum', 'properties', 'patternProperties', 'dependentSchemas', 'dependentRequired', 'required', 'items', 'prefixItems', 'contains', 'minContains', 'maxContains', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'propertyNames', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', 'contentSchema']);

const nameMaps = new Set(['properties', 'patternProperties', 'dependentSchemas', '$defs', 'schemas', 'paths', 'webhooks', 'responses', 'headers', 'content', 'examples']);
function isLiteral(path) {
  const tokens = path.split('/');
  return tokens.some((key, index) => !nameMaps.has(tokens[index - 1]) && (['example', 'default', 'enum', 'const'].includes(key) || (key === 'examples' && (/^\d+$/.test(tokens[index + 1] || '') || tokens[index + 2] === 'value'))));
}

function prepareRefs(value, path = '') {
  if (isLiteral(path)) return value;
  if (Array.isArray(value)) return value.map((child, index) => prepareRefs(child, `${path}/${index}`));
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key.startsWith('x-') ? child : prepareRefs(child, `${path}/${key}`)]));
  if (typeof result.$ref === 'string' && Object.keys(result).some(key => schemaKeywords.has(key))) {
    const reference = result.$ref;
    delete result.$ref;
    result.allOf = [...(result.allOf || []), { $ref: reference }];
  }
  return result;
}

function compatibilityWarnings(spec) {
  const warnings = new Set();
  if (Object.keys(spec.components?.pathItems || {}).length) warnings.add('oasdiff does not fully support components.pathItems: changes to reusable Path Items may be missing from the diff.');
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.$dynamicRef !== undefined || value.$dynamicAnchor !== undefined) warnings.add('oasdiff does not resolve $dynamicRef/$dynamicAnchor: schema changes through dynamic references may be missing from the diff.');
    for (const [key, child] of Object.entries(value)) if (key !== 'example' && key !== 'examples' && !key.startsWith('x-')) visit(child);
  };
  visit(spec);
  return [...warnings];
}

module.exports = { prepareRefs, compatibilityWarnings, isLiteral };
