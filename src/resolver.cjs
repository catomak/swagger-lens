// Swagger Client treats a non-HTTP webview URI as a JSON Schema identifier.
// Our host already bundles local references, so use an in-memory HTTP identity
// for resolution only. This does not download a spec or change API servers.
const memoryDocument = 'https://swagger-lens.invalid/openapi.json';
function resolverOptions(options = {}) {
  return /^https?:\/\//i.test(options.baseDoc || '') ? options : { ...options, baseDoc: memoryDocument };
}

function InMemoryResolverPlugin(onResolved = () => {}) {
  return {
    afterLoad(system) {
      const { resolve, resolveSubtree } = system.fn;
      const report = (result, path) => {
        onResolved({ path, errors: (result.errors || []).map(error => error.message) });
        return result;
      };
      system.fn.resolve = options => Promise.resolve(resolve(resolverOptions(options))).then(result => report(result, []));
      system.fn.resolveSubtree = (spec, path, options) => Promise.resolve(resolveSubtree(spec, path, resolverOptions(options))).then(result => report(result, path));
    }
  };
}

module.exports = { InMemoryResolverPlugin, resolverOptions };
