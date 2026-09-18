// This replaces only upstream's addon discovery during the build. __dirname
// belongs to the generated dist/native-lock.cjs, never to node_modules.
const { join } = require('node:path');

const platform = `${process.platform}-${process.arch}`;
if (!['darwin', 'linux', 'win32'].includes(process.platform) || !['arm64', 'x64'].includes(process.arch)) {
  const error = new Error(`Native file locking is unavailable for ${platform}. Supported platforms: Windows 10+, macOS 13.0+, and Linux with glibc 2.28+ on x64 or arm64. The OS must also meet the installed Node.js version's requirements.`);
  error.code = 'NATIVE_LOCK_UNSUPPORTED';
  throw error;
}

module.exports = require(join(__dirname, 'native', platform, 'fs-native-extensions.node'));
