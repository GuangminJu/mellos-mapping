"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// node_modules/which-runtime/index.js
var require_which_runtime = __commonJS({
  "node_modules/which-runtime/index.js"(exports2) {
    var { runtime, platform, arch, version } = typeof Bare !== "undefined" ? {
      runtime: "bare",
      platform: global.Bare.platform,
      arch: global.Bare.arch,
      version: global.Bare.version
    } : typeof process !== "undefined" ? {
      runtime: "node",
      platform: global.process.platform,
      arch: global.process.arch,
      version: global.process.version
    } : typeof Window !== "undefined" ? { runtime: "browser", platform: "unknown", arch: "unknown", version: "unknown" } : { runtime: "unknown", platform: "unknown", arch: "unknown", version: "unknown" };
    exports2.runtime = runtime;
    exports2.version = version;
    exports2.platform = platform;
    exports2.arch = arch;
    exports2.isBare = runtime === "bare";
    exports2.isBareKit = exports2.isBare && typeof BareKit !== "undefined";
    exports2.isPear = typeof Pear !== "undefined";
    exports2.isNode = runtime === "node";
    exports2.isBrowser = runtime === "browser";
    exports2.isWindows = platform === "win32";
    exports2.isLinux = platform === "linux";
    exports2.isMac = platform === "darwin";
    exports2.isIOS = platform === "ios" || platform === "ios-simulator";
    exports2.isAndroid = platform === "android";
    exports2.isElectron = typeof process !== "undefined" && !!global.process.versions?.electron;
    exports2.isElectronRenderer = exports2.isElectron && global.process.type === "renderer";
    exports2.isElectronWorker = exports2.isElectron && global.process.type === "worker";
  }
});

// scripts/native-lock-binding.cjs
var require_native_lock_binding = __commonJS({
  "scripts/native-lock-binding.cjs"(exports2, module2) {
    var { join } = require("node:path");
    var platform = `${process.platform}-${process.arch}`;
    if (!["darwin", "linux", "win32"].includes(process.platform) || !["arm64", "x64"].includes(process.arch)) {
      const error = new Error(`Native file locking is unavailable for ${platform}. Supported platforms: Windows 10+, macOS 13.0+, and Linux with glibc 2.28+ on x64 or arm64. The OS must also meet the installed Node.js version's requirements.`);
      error.code = "NATIVE_LOCK_UNSUPPORTED";
      throw error;
    }
    module2.exports = require(join(__dirname, "native", platform, "fs-native-extensions.node"));
  }
});

// node_modules/fs-native-extensions/index.js
var require_fs_native_extensions = __commonJS({
  "node_modules/fs-native-extensions/index.js"(exports2) {
    var { isWindows } = require_which_runtime();
    var binding = require_native_lock_binding();
    function onwork(err, result) {
      if (err) this.reject(err);
      else this.resolve(result);
    }
    exports2.tryLock = function tryLock2(fd, offset = 0, length = 0, opts = {}) {
      if (typeof offset === "object") {
        opts = offset;
        offset = 0;
      }
      if (typeof length === "object") {
        opts = length;
        length = 0;
      }
      if (typeof opts !== "object" || opts === null) {
        opts = {};
      }
      try {
        binding.tryLock(fd, offset, length, opts.shared !== true);
      } catch (err) {
        if (err.code === "EAGAIN") return false;
        throw err;
      }
      return true;
    };
    exports2.waitForLock = function waitForLock(fd, offset = 0, length = 0, opts = {}) {
      if (typeof offset === "object") {
        opts = offset;
        offset = 0;
      }
      if (typeof length === "object") {
        opts = length;
        length = 0;
      }
      if (typeof opts !== "object" || opts === null) {
        opts = {};
      }
      const req = {
        handle: null,
        resolve: null,
        reject: null
      };
      const promise = new Promise((resolve, reject) => {
        req.resolve = resolve;
        req.reject = reject;
      });
      try {
        req.handle = binding.waitForLock(fd, offset, length, opts.shared !== true, req, onwork);
      } catch (err) {
        return Promise.reject(err);
      }
      return promise;
    };
    exports2.waitForLockSync = function waitForLockSync(fd, offset = 0, length = 0, opts = {}) {
      if (typeof offset === "object") {
        opts = offset;
        offset = 0;
      }
      if (typeof length === "object") {
        opts = length;
        length = 0;
      }
      if (typeof opts !== "object" || opts === null) {
        opts = {};
      }
      binding.waitForLockSync(fd, offset, length, opts.shared !== true);
    };
    exports2.tryDowngradeLock = function tryDowngradeLock(fd, offset = 0, length = 0) {
      try {
        binding.tryDowngradeLock(fd, offset, length);
      } catch (err) {
        if (err.code === "EAGAIN") return false;
        throw err;
      }
      return true;
    };
    exports2.waitForDowngradeLock = function downgradeLock(fd, offset = 0, length = 0) {
      const req = {
        handle: null,
        resolve: null,
        reject: null
      };
      const promise = new Promise((resolve, reject) => {
        req.resolve = resolve;
        req.reject = reject;
      });
      try {
        req.handle = binding.waitForDowngradeLock(fd, offset, length, req, onwork);
      } catch (err) {
        return Promise.reject(err);
      }
      return promise;
    };
    exports2.waitForDowngradeLockSync = function waitForDowngradeLockSync(fd, offset = 0, length = 0) {
      binding.waitForDowngradeLockSync(fd, offset, length);
    };
    exports2.tryUpgradeLock = function tryUpgradeLock(fd, offset = 0, length = 0) {
      try {
        binding.tryUpgradeLock(fd, offset, length);
      } catch (err) {
        if (err.code === "EAGAIN") return false;
        throw err;
      }
      return true;
    };
    exports2.waitForUpgradeLock = function upgradeLock(fd, offset = 0, length = 0) {
      const req = {
        handle: null,
        resolve: null,
        reject: null
      };
      const promise = new Promise((resolve, reject) => {
        req.resolve = resolve;
        req.reject = reject;
      });
      try {
        req.handle = binding.waitForUpgradeLock(fd, offset, length, req, onwork);
      } catch (err) {
        return Promise.reject(err);
      }
      return promise;
    };
    exports2.waitForUpgradeLockSync = function waitForUpgradeLockSync(fd, offset = 0, length = 0) {
      binding.waitForUpgradeLockSync(fd, offset, length);
    };
    exports2.unlock = function unlock2(fd, offset = 0, length = 0) {
      binding.unlock(fd, offset, length);
    };
    exports2.trim = function trim(fd, offset, length) {
      const req = {
        handle: null,
        resolve: null,
        reject: null
      };
      const promise = new Promise((resolve, reject) => {
        req.resolve = resolve;
        req.reject = reject;
      });
      try {
        req.handle = binding.trim(fd, offset, length, req, onwork);
      } catch (err) {
        return Promise.reject(err);
      }
      return promise;
    };
    exports2.trimSync = function trimSync(fd, offset, length) {
      binding.trimSync(fd, offset, length);
    };
    exports2.sparse = function sparse(fd) {
      if (!isWindows) return Promise.resolve();
      const req = {
        handle: null,
        resolve: null,
        reject: null
      };
      const promise = new Promise((resolve, reject) => {
        req.resolve = resolve;
        req.reject = reject;
      });
      try {
        req.handle = binding.sparse(fd, req, onwork);
      } catch (err) {
        return Promise.reject(err);
      }
      return promise;
    };
    exports2.sparseSync = function sparseSync(fd) {
      if (!isWindows) return;
      binding.sparseSync(fd);
    };
    exports2.swap = function swap(from, to) {
      const req = {
        handle: null,
        resolve: null,
        reject: null
      };
      const promise = new Promise((resolve, reject) => {
        req.resolve = resolve;
        req.reject = reject;
      });
      try {
        req.handle = binding.swap(from, to, req, onwork);
      } catch (err) {
        return Promise.reject(err);
      }
      return promise;
    };
    exports2.swapSync = function swapSync(from, to) {
      binding.swapSync(from, to);
    };
    exports2.getAttr = function getAttr(fd, name) {
      const req = {
        handle: null,
        resolve: null,
        reject: null
      };
      const promise = new Promise((resolve, reject) => {
        req.resolve = resolve;
        req.reject = reject;
      });
      try {
        req.handle = binding.getAttr(fd, name, req, onwork);
      } catch (err) {
        return Promise.reject(err);
      }
      return promise.then((buffer) => buffer === null ? null : Buffer.from(buffer));
    };
    exports2.getAttrSync = function getAttrSync(fd, name) {
      const buffer = binding.getAttrSync(fd, name);
      return buffer === null ? null : Buffer.from(buffer);
    };
    exports2.setAttr = function setAttr(fd, name, value, encoding) {
      if (typeof value === "string") value = Buffer.from(value, encoding);
      const req = {
        value,
        handle: null,
        resolve: null,
        reject: null
      };
      const promise = new Promise((resolve, reject) => {
        req.resolve = resolve;
        req.reject = reject;
      });
      try {
        req.handle = binding.setAttr(
          fd,
          name,
          value.buffer,
          value.byteOffset,
          value.byteLength,
          req,
          onwork
        );
      } catch (err) {
        return Promise.reject(err);
      }
      return promise;
    };
    exports2.setAttrSync = function setAttrSync(fd, name, value, encoding) {
      if (typeof value === "string") value = Buffer.from(value, encoding);
      binding.setAttrSync(fd, name, value.buffer, value.byteOffset, value.byteLength);
    };
    exports2.removeAttr = function removeAttr(fd, name) {
      const req = {
        handle: null,
        resolve: null,
        reject: null
      };
      const promise = new Promise((resolve, reject) => {
        req.resolve = resolve;
        req.reject = reject;
      });
      try {
        req.handle = binding.removeAttr(fd, name, req, onwork);
      } catch (err) {
        return Promise.reject(err);
      }
      return promise;
    };
    exports2.removeAttrSync = function removeAttrSync(fd, name) {
      binding.removeAttrSync(fd, name);
    };
    exports2.listAttrs = function listAttrs(fd) {
      const req = {
        handle: null,
        resolve: null,
        reject: null
      };
      const promise = new Promise((resolve, reject) => {
        req.resolve = resolve;
        req.reject = reject;
      });
      try {
        req.handle = binding.listAttrs(fd, req, onwork);
      } catch (err) {
        return Promise.reject(err);
      }
      return promise;
    };
    exports2.listAttrsSync = function listAttrsSync(fd) {
      return binding.listAttrsSync(fd);
    };
  }
});

// scripts/native-lock.cjs
var { tryLock, unlock } = require_fs_native_extensions();
module.exports = { tryLock, unlock };
