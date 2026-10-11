// Runs in every test file after the test framework is set up.
const { closeRedis } = require('../../src/redis/client');

// Each test file gets its own module registry, hence its own Redis
// connection: close it so Jest can exit without open handles.
afterAll(() => closeRedis());
