/** Updating a release version must not re-resolve or prune dependency metadata. */
export function updateLockVersion(contents, version) {
  const lock = JSON.parse(contents);
  if (!/^\d+\.\d+\.\d+$/.test(version) || !lock.packages?.['']) throw new Error('Invalid release version or package lock');
  lock.version = version;
  lock.packages[''].version = version;
  return JSON.stringify(lock, null, 2) + '\n';
}
