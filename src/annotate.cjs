const { isDeepStrictEqual: equal } = require('node:util');
const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];
const clone = value => value === undefined ? undefined : structuredClone(value);
const entries = value => Object.entries(value || {});
const keys = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])];
const set = (object, key, value) => Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true });
const maps = ['properties', 'patternProperties', 'dependentSchemas', '$defs'];
const singles = ['items', 'not', 'additionalProperties', 'if', 'then', 'else', 'contains', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties', 'contentSchema'];
const arrays = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
const nested = new Set([...maps, ...singles, ...arrays]);
const facets = schema => Object.fromEntries(entries(schema).filter(([key]) => !nested.has(key) && !key.startsWith('x-diff-')));

function mark(value, status) {
  if (value && typeof value === 'object' && !Array.isArray(value)) value['x-diff-status'] = status;
  return value;
}

function reviewSchema(value, status) {
  // Equivalent object forms carry diff metadata without triggering Swagger
  // Client's object-only allOf resolver on boolean composition branches.
  return mark(typeof value === 'boolean' ? (value ? {} : { not: {} }) : clone(value), status);
}

function annotateSchema(oldSchema, newSchema, depth = 0) {
  if (oldSchema === undefined || newSchema === undefined) {
    const value = newSchema === undefined ? oldSchema : newSchema;
    const result = reviewSchema(value, newSchema === undefined ? 'deleted' : 'added');
    if (typeof value === 'boolean') result['x-diff-details'] = [{ key: 'schema', before: oldSchema, after: newSchema }];
    return result;
  }
  if (equal(oldSchema, newSchema) || depth > 80) return clone(newSchema);
  if (typeof oldSchema === 'boolean' || typeof newSchema === 'boolean') {
    const result = reviewSchema(newSchema, 'updated');
    result['x-diff-details'] = [{ key: 'schema', before: oldSchema, after: newSchema }];
    return result;
  }
  if (!oldSchema || !newSchema || typeof oldSchema !== 'object' || typeof newSchema !== 'object') return clone(newSchema);
  const result = clone(newSchema);
  const before = facets(oldSchema), after = facets(newSchema);
  const details = keys(before, after).filter(key => !equal(before[key], after[key])).map(key => ({ key, before: before[key], after: after[key] }));
  for (const key of maps) if (oldSchema[key] || newSchema[key]) {
    result[key] = {};
    for (const name of keys(oldSchema[key], newSchema[key])) {
      let property = annotateSchema(oldSchema[key]?.[name], newSchema[key]?.[name], depth + 1);
      const wasRequired = oldSchema.required?.includes(name) || false;
      const isRequired = newSchema.required?.includes(name) || false;
      if (key === 'properties' && oldSchema.properties?.[name] !== undefined && newSchema.properties?.[name] !== undefined && wasRequired !== isRequired) {
        property = reviewSchema(property, 'updated');
        property['x-diff-details'] = [...(property['x-diff-details'] || []), { key: 'required', before: wasRequired, after: isRequired }];
      }
      set(result[key], name, property);
    }
  }
  for (const key of singles) {
    if (oldSchema[key] !== undefined || newSchema[key] !== undefined) {
      result[key] = annotateSchema(oldSchema[key], newSchema[key], depth + 1);
    }
  }
  for (const key of arrays) {
    if (oldSchema[key] || newSchema[key]) {
      const oldParts = oldSchema[key] || [], newParts = newSchema[key] || [];
      result[key] = Array.from({ length: Math.max(oldParts.length, newParts.length) }, (_, index) => annotateSchema(oldParts[index], newParts[index], depth + 1));
    }
  }
  mark(result, 'updated');
  result['x-diff-original'] = before;
  result['x-diff-new'] = after;
  if (details.length) result['x-diff-details'] = details;
  return result;
}

function annotateContent(oldContent, newContent) {
  const result = {};
  for (const mime of keys(oldContent, newContent)) {
    const before = oldContent?.[mime], after = newContent?.[mime];
    const media = clone(after || before);
    if (before?.schema !== undefined || after?.schema !== undefined) media.schema = annotateSchema(before?.schema, after?.schema);
    set(result, mime, media);
  }
  return result;
}

function annotateObject(before, after) {
  const result = clone(after || before);
  if (!before) mark(result, 'added');
  else if (!after) mark(result, 'deleted');
  else if (!equal(before, after)) mark(result, 'updated');
  if (before?.schema !== undefined || after?.schema !== undefined) result.schema = annotateSchema(before?.schema, after?.schema);
  if (before?.content || after?.content) result.content = annotateContent(before?.content, after?.content);
  return result;
}

function annotateOperation(before, after, pathBefore, pathAfter) {
  const result = annotateObject(before, after);
  const oldParams = [...(pathBefore?.parameters || []), ...(before?.parameters || [])];
  const newParams = [...(pathAfter?.parameters || []), ...(after?.parameters || [])];
  const paramKey = param => `${param.in}:${param.name}`;
  const oldMap = new Map(oldParams.map(p => [paramKey(p), p]));
  const newMap = new Map(newParams.map(p => [paramKey(p), p]));
  result.parameters = [...new Set([...newMap.keys(), ...oldMap.keys()])].map(key => annotateObject(oldMap.get(key), newMap.get(key)));
  if (before?.requestBody || after?.requestBody) result.requestBody = annotateObject(before?.requestBody, after?.requestBody);
  result.responses = {};
  for (const code of keys(before?.responses, after?.responses)) set(result.responses, code, annotateObject(before?.responses?.[code], after?.responses?.[code]));
  return result;
}

function affectedOperations(diff, oldSpec, newSpec, scope = 'paths') {
  const affected = [];
  const add = (path, method, status) => {
    if (methods.includes(method.toLowerCase())) affected.push({ path, method: method.toLowerCase(), status, scope });
  };
  for (const path of diff[scope]?.added || []) for (const method of methods) if (newSpec[scope]?.[path]?.[method]) add(path, method, 'added');
  for (const path of diff[scope]?.deleted || []) for (const method of methods) if (oldSpec[scope]?.[path]?.[method]) add(path, method, 'deleted');
  for (const [path, change] of entries(diff[scope]?.modified)) {
    for (const method of change.operations?.added || []) add(path, method, 'added');
    for (const method of change.operations?.deleted || []) add(path, method, 'deleted');
    for (const method of Object.keys(change.operations?.modified || {})) add(path, method, 'updated');
    // Shared parameters and path-level annotations can affect every operation.
    if (Object.keys(change).some(key => key !== 'operations')) {
      for (const method of methods) if ((newSpec[scope]?.[path]?.[method] || oldSpec[scope]?.[path]?.[method]) && !affected.some(op => op.path === path && op.method === method)) add(path, method, 'updated');
    }
  }
  return affected;
}

function annotate(oldSpec, newSpec, diff, changelog = []) {
  const spec = clone(newSpec), operations = [...affectedOperations(diff, oldSpec, newSpec), ...affectedOperations(diff, oldSpec, newSpec, 'webhooks')];
  spec.paths = clone(newSpec.paths || {});
  if (oldSpec.webhooks || newSpec.webhooks) spec.webhooks = clone(newSpec.webhooks || {});
  for (const op of operations) {
    const beforePath = oldSpec[op.scope]?.[op.path], afterPath = newSpec[op.scope]?.[op.path];
    if (!Object.hasOwn(spec[op.scope], op.path)) set(spec[op.scope], op.path, clone(afterPath || beforePath));
    const operation = annotateOperation(beforePath?.[op.method], afterPath?.[op.method], beforePath, afterPath);
    mark(operation, op.status);
    set(spec[op.scope][op.path], op.method, operation);
    const changePath = op.scope === 'webhooks' ? `webhook:${op.path}` : op.path;
    op.changes = changelog.filter(change => change.path === changePath && change.operation?.toLowerCase() === op.method);
  }
  if (oldSpec.components?.schemas || newSpec.components?.schemas) {
    spec.components ||= {};
    spec.components.schemas = {};
    for (const name of keys(oldSpec.components?.schemas, newSpec.components?.schemas)) set(spec.components.schemas, name, annotateSchema(oldSpec.components?.schemas?.[name], newSpec.components?.schemas?.[name]));
  }
  return { spec, operations, changelog };
}

module.exports = { annotate, annotateSchema, affectedOperations };
