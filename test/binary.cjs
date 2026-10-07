const path = require('node:path');
const { bundledBinary } = require('../src/platform.cjs');
module.exports = process.env.API_DIFF_TEST_BINARY || bundledBinary(path.resolve('.'));
