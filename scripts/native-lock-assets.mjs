/** Files shared by clone installs, npm packages, and both release editions. */
export const NATIVE_LOCK_PLATFORMS = [
  'darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64',
];

export const NATIVE_LOCK_FILES = [
  'dist/native-lock.cjs',
  'dist/native/LICENSES.txt',
  ...NATIVE_LOCK_PLATFORMS.map(platform => `dist/native/${platform}/fs-native-extensions.node`),
];
