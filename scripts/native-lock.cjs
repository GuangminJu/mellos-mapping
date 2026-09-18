// Bundle the upstream public wrappers, including their contention handling.
const { tryLock, unlock } = require('fs-native-extensions');

module.exports = { tryLock, unlock };
