window.__ModuleLoader__.load({
	id: "mellos-mapping-dsh-client",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let react_dom = require("react-dom");
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.js
		var _a$1;
		function $constructor(name, initializer, params) {
			function init(inst, def) {
				if (!inst._zod) Object.defineProperty(inst, "_zod", {
					value: {
						def,
						constr: _,
						traits: /* @__PURE__ */ new Set()
					},
					enumerable: false
				});
				if (inst._zod.traits.has(name)) return;
				inst._zod.traits.add(name);
				initializer(inst, def);
				const proto = _.prototype;
				const keys = Object.keys(proto);
				for (let i = 0; i < keys.length; i++) {
					const k = keys[i];
					if (!(k in inst)) inst[k] = proto[k].bind(inst);
				}
			}
			const Parent = params?.Parent ?? Object;
			class Definition extends Parent {}
			Object.defineProperty(Definition, "name", { value: name });
			function _(def) {
				var _a;
				const inst = params?.Parent ? new Definition() : this;
				init(inst, def);
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				for (const fn of inst._zod.deferred) fn();
				return inst;
			}
			Object.defineProperty(_, "init", { value: init });
			Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
				if (params?.Parent && inst instanceof params.Parent) return true;
				return inst?._zod?.traits?.has(name);
			} });
			Object.defineProperty(_, "name", { value: name });
			return _;
		}
		var $ZodAsyncError = class extends Error {
			constructor() {
				super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
			}
		};
		var $ZodEncodeError = class extends Error {
			constructor(name) {
				super(`Encountered unidirectional transform during encode: ${name}`);
				this.name = "ZodEncodeError";
			}
		};
		(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
		const globalConfig = globalThis.__zod_globalConfig;
		function config(newConfig) {
			if (newConfig) Object.assign(globalConfig, newConfig);
			return globalConfig;
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.js
		function getEnumValues(entries) {
			const numericValues = Object.values(entries).filter((v) => typeof v === "number");
			return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
		}
		function jsonStringifyReplacer(_, value) {
			if (typeof value === "bigint") return value.toString();
			return value;
		}
		function cached(getter) {
			return { get value() {
				{
					const value = getter();
					Object.defineProperty(this, "value", { value });
					return value;
				}
				throw new Error("cached value already set");
			} };
		}
		function nullish(input) {
			return input === null || input === void 0;
		}
		function cleanRegex(source) {
			const start = source.startsWith("^") ? 1 : 0;
			const end = source.endsWith("$") ? source.length - 1 : source.length;
			return source.slice(start, end);
		}
		function floatSafeRemainder(val, step) {
			const ratio = val / step;
			const roundedRatio = Math.round(ratio);
			const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
			if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
			return ratio - roundedRatio;
		}
		const EVALUATING = /* @__PURE__*/ Symbol("evaluating");
		function defineLazy(object, key, getter) {
			let value = void 0;
			Object.defineProperty(object, key, {
				get() {
					if (value === EVALUATING) return;
					if (value === void 0) {
						value = EVALUATING;
						value = getter();
					}
					return value;
				},
				set(v) {
					Object.defineProperty(object, key, { value: v });
				},
				configurable: true
			});
		}
		function assignProp(target, prop, value) {
			Object.defineProperty(target, prop, {
				value,
				writable: true,
				enumerable: true,
				configurable: true
			});
		}
		function mergeDefs(...defs) {
			const mergedDescriptors = {};
			for (const def of defs) Object.assign(mergedDescriptors, Object.getOwnPropertyDescriptors(def));
			return Object.defineProperties({}, mergedDescriptors);
		}
		function esc(str) {
			return JSON.stringify(str);
		}
		function slugify(input) {
			return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
		}
		const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
		function isObject(data) {
			return typeof data === "object" && data !== null && !Array.isArray(data);
		}
		const allowsEval = /* @__PURE__*/ cached(() => {
			if (globalConfig.jitless) return false;
			if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
			try {
				new Function("");
				return true;
			} catch (_) {
				return false;
			}
		});
		function isPlainObject(o) {
			if (isObject(o) === false) return false;
			const ctor = o.constructor;
			if (ctor === void 0) return true;
			if (typeof ctor !== "function") return true;
			const prot = ctor.prototype;
			if (isObject(prot) === false) return false;
			if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
			return true;
		}
		function shallowClone(o) {
			if (isPlainObject(o)) return { ...o };
			if (Array.isArray(o)) return [...o];
			if (o instanceof Map) return new Map(o);
			if (o instanceof Set) return new Set(o);
			return o;
		}
		const propertyKeyTypes = /* @__PURE__*/ new Set([
			"string",
			"number",
			"symbol"
		]);
		function escapeRegex(str) {
			return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
		function clone(inst, def, params) {
			const cl = new inst._zod.constr(def ?? inst._zod.def);
			if (!def || params?.parent) cl._zod.parent = inst;
			return cl;
		}
		function normalizeParams(_params) {
			const params = _params;
			if (!params) return {};
			if (typeof params === "string") return { error: () => params };
			if (params?.message !== void 0) {
				if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
				params.error = params.message;
			}
			delete params.message;
			if (typeof params.error === "string") return {
				...params,
				error: () => params.error
			};
			return params;
		}
		function optionalKeys(shape) {
			return Object.keys(shape).filter((k) => {
				return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
			});
		}
		const NUMBER_FORMAT_RANGES = {
			safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
			int32: [-2147483648, 2147483647],
			uint32: [0, 4294967295],
			float32: [-34028234663852886e22, 34028234663852886e22],
			float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
		};
		function pick(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const newShape = {};
					for (const key in mask) {
						if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						newShape[key] = currDef.shape[key];
					}
					assignProp(this, "shape", newShape);
					return newShape;
				},
				checks: []
			}));
		}
		function omit(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const newShape = { ...schema._zod.def.shape };
					for (const key in mask) {
						if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						delete newShape[key];
					}
					assignProp(this, "shape", newShape);
					return newShape;
				},
				checks: []
			}));
		}
		function extend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) {
				const existingShape = schema._zod.def.shape;
				for (const key in shape) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
			}
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const _shape = {
					...schema._zod.def.shape,
					...shape
				};
				assignProp(this, "shape", _shape);
				return _shape;
			} }));
		}
		function safeExtend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const _shape = {
					...schema._zod.def.shape,
					...shape
				};
				assignProp(this, "shape", _shape);
				return _shape;
			} }));
		}
		function merge(a, b) {
			if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
			return clone(a, mergeDefs(a._zod.def, {
				get shape() {
					const _shape = {
						...a._zod.def.shape,
						...b._zod.def.shape
					};
					assignProp(this, "shape", _shape);
					return _shape;
				},
				get catchall() {
					return b._zod.def.catchall;
				},
				checks: b._zod.def.checks ?? []
			}));
		}
		function partial(Class, schema, mask) {
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const oldShape = schema._zod.def.shape;
					const shape = { ...oldShape };
					if (mask) for (const key in mask) {
						if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						shape[key] = Class ? new Class({
							type: "optional",
							innerType: oldShape[key]
						}) : oldShape[key];
					}
					else for (const key in oldShape) shape[key] = Class ? new Class({
						type: "optional",
						innerType: oldShape[key]
					}) : oldShape[key];
					assignProp(this, "shape", shape);
					return shape;
				},
				checks: []
			}));
		}
		function required(Class, schema, mask) {
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const oldShape = schema._zod.def.shape;
				const shape = { ...oldShape };
				if (mask) for (const key in mask) {
					if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
					if (!mask[key]) continue;
					shape[key] = new Class({
						type: "nonoptional",
						innerType: oldShape[key]
					});
				}
				else for (const key in oldShape) shape[key] = new Class({
					type: "nonoptional",
					innerType: oldShape[key]
				});
				assignProp(this, "shape", shape);
				return shape;
			} }));
		}
		function aborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
			return false;
		}
		function explicitlyAborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
			return false;
		}
		function prefixIssues(path, issues) {
			return issues.map((iss) => {
				var _a;
				(_a = iss).path ?? (_a.path = []);
				iss.path.unshift(path);
				return iss;
			});
		}
		function unwrapMessage(message) {
			return typeof message === "string" ? message : message?.message;
		}
		function finalizeIssue(iss, ctx, config) {
			const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
			const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
			rest.path ?? (rest.path = []);
			rest.message = message;
			if (ctx?.reportInput) rest.input = _input;
			return rest;
		}
		function getLengthableOrigin(input) {
			if (Array.isArray(input)) return "array";
			if (typeof input === "string") return "string";
			return "unknown";
		}
		function issue(...args) {
			const [iss, input, inst] = args;
			if (typeof iss === "string") return {
				message: iss,
				code: "custom",
				input,
				inst
			};
			return { ...iss };
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/errors.js
		const initializer$1 = (inst, def) => {
			inst.name = "$ZodError";
			Object.defineProperty(inst, "_zod", {
				value: inst._zod,
				enumerable: false
			});
			Object.defineProperty(inst, "issues", {
				value: def,
				enumerable: false
			});
			inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
			Object.defineProperty(inst, "toString", {
				value: () => inst.message,
				enumerable: false
			});
		};
		const $ZodError = $constructor("$ZodError", initializer$1);
		const $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
		function flattenError(error, mapper = (issue) => issue.message) {
			const fieldErrors = {};
			const formErrors = [];
			for (const sub of error.issues) if (sub.path.length > 0) {
				fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
				fieldErrors[sub.path[0]].push(mapper(sub));
			} else formErrors.push(mapper(sub));
			return {
				formErrors,
				fieldErrors
			};
		}
		function formatError(error, mapper = (issue) => issue.message) {
			const fieldErrors = { _errors: [] };
			const processError = (error, path = []) => {
				for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
				else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else {
					const fullpath = [...path, ...issue.path];
					if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
					else {
						let curr = fieldErrors;
						let i = 0;
						while (i < fullpath.length) {
							const el = fullpath[i];
							if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
							else {
								curr[el] = curr[el] || { _errors: [] };
								curr[el]._errors.push(mapper(issue));
							}
							curr = curr[el];
							i++;
						}
					}
				}
			};
			processError(error);
			return fieldErrors;
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/parse.js
		const _parse = (_Err) => (schema, value, _ctx, _params) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			if (result.issues.length) {
				const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
				captureStackTrace(e, _params?.callee);
				throw e;
			}
			return result.value;
		};
		const _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			if (result.issues.length) {
				const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
				captureStackTrace(e, params?.callee);
				throw e;
			}
			return result.value;
		};
		const _safeParse = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			return result.issues.length ? {
				success: false,
				error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			} : {
				success: true,
				data: result.value
			};
		};
		const safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
		const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			return result.issues.length ? {
				success: false,
				error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			} : {
				success: true,
				data: result.value
			};
		};
		const safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
		const _encode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _parse(_Err)(schema, value, ctx);
		};
		const _decode = (_Err) => (schema, value, _ctx) => {
			return _parse(_Err)(schema, value, _ctx);
		};
		const _encodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _parseAsync(_Err)(schema, value, ctx);
		};
		const _decodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _parseAsync(_Err)(schema, value, _ctx);
		};
		const _safeEncode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParse(_Err)(schema, value, ctx);
		};
		const _safeDecode = (_Err) => (schema, value, _ctx) => {
			return _safeParse(_Err)(schema, value, _ctx);
		};
		const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParseAsync(_Err)(schema, value, ctx);
		};
		const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _safeParseAsync(_Err)(schema, value, _ctx);
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/regexes.js
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const cuid = /^[cC][0-9a-z]{6,}$/;
		const cuid2 = /^[0-9a-z]+$/;
		const ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
		const xid = /^[0-9a-vA-V]{20}$/;
		const ksuid = /^[A-Za-z0-9]{27}$/;
		const nanoid = /^[a-zA-Z0-9_-]{21}$/;
		/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
		const duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
		/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
		const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
		/** Returns a regex for validating an RFC 9562/4122 UUID.
		*
		* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
		const uuid = (version) => {
			if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
			return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
		};
		/** Practical email validation */
		const email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
		const _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
		function emoji() {
			return new RegExp(_emoji$1, "u");
		}
		const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
		const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
		const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
		const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
		const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
		const base64url = /^[A-Za-z0-9_-]*$/;
		const httpProtocol = /^https?$/;
		const e164 = /^\+[1-9]\d{6,14}$/;
		const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
		const date$1 = /*@__PURE__*/ new RegExp(`^${dateSource}$`);
		function timeSource(args) {
			const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
			return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
		}
		function time$1(args) {
			return new RegExp(`^${timeSource(args)}$`);
		}
		function datetime$1(args) {
			const time = timeSource({ precision: args.precision });
			const opts = ["Z"];
			if (args.local) opts.push("");
			if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
			const timeRegex = `${time}(?:${opts.join("|")})`;
			return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
		}
		const string$1 = (params) => {
			const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
			return new RegExp(`^${regex}$`);
		};
		const integer = /^-?\d+$/;
		const number$1 = /^-?\d+(?:\.\d+)?$/;
		const lowercase = /^[^A-Z]*$/;
		const uppercase = /^[^a-z]*$/;
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/checks.js
		const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
			var _a;
			inst._zod ?? (inst._zod = {});
			inst._zod.def = def;
			(_a = inst._zod).onattach ?? (_a.onattach = []);
		});
		const numericOriginMap = {
			number: "number",
			bigint: "bigint",
			object: "date"
		};
		const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
				if (def.value < curr) if (def.inclusive) bag.maximum = def.value;
				else bag.exclusiveMaximum = def.value;
			});
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
				if (def.value > curr) if (def.inclusive) bag.minimum = def.value;
				else bag.exclusiveMinimum = def.value;
			});
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.onattach.push((inst) => {
				var _a;
				(_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
			});
			inst._zod.check = (payload) => {
				if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
				if (typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
				payload.issues.push({
					origin: typeof payload.value,
					code: "not_multiple_of",
					divisor: def.value,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
			$ZodCheck.init(inst, def);
			def.format = def.format || "float64";
			const isInt = def.format?.includes("int");
			const origin = isInt ? "int" : "number";
			const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.format = def.format;
				bag.minimum = minimum;
				bag.maximum = maximum;
				if (isInt) bag.pattern = integer;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (isInt) {
					if (!Number.isInteger(input)) {
						payload.issues.push({
							expected: origin,
							format: def.format,
							code: "invalid_type",
							continue: false,
							input,
							inst
						});
						return;
					}
					if (!Number.isSafeInteger(input)) {
						if (input > 0) payload.issues.push({
							input,
							code: "too_big",
							maximum: Number.MAX_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						else payload.issues.push({
							input,
							code: "too_small",
							minimum: Number.MIN_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						return;
					}
				}
				if (input < minimum) payload.issues.push({
					origin: "number",
					input,
					code: "too_small",
					minimum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
				if (input > maximum) payload.issues.push({
					origin: "number",
					input,
					code: "too_big",
					maximum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
				if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (input.length <= def.maximum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: def.maximum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
				if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (input.length >= def.minimum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: def.minimum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.minimum = def.length;
				bag.maximum = def.length;
				bag.length = def.length;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				const length = input.length;
				if (length === def.length) return;
				const origin = getLengthableOrigin(input);
				const tooBig = length > def.length;
				payload.issues.push({
					origin,
					...tooBig ? {
						code: "too_big",
						maximum: def.length
					} : {
						code: "too_small",
						minimum: def.length
					},
					inclusive: true,
					exact: true,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
			var _a, _b;
			$ZodCheck.init(inst, def);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.format = def.format;
				if (def.pattern) {
					bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
					bag.patterns.add(def.pattern);
				}
			});
			if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: def.format,
					input: payload.value,
					...def.pattern ? { pattern: def.pattern.toString() } : {},
					inst,
					continue: !def.abort
				});
			});
			else (_b = inst._zod).check ?? (_b.check = () => {});
		});
		const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "regex",
					input: payload.value,
					pattern: def.pattern.toString(),
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
			def.pattern ?? (def.pattern = lowercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
			def.pattern ?? (def.pattern = uppercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
			$ZodCheck.init(inst, def);
			const escapedRegex = escapeRegex(def.includes);
			const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
			def.pattern = pattern;
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.includes(def.includes, def.position)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "includes",
					includes: def.includes,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.startsWith(def.prefix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "starts_with",
					prefix: def.prefix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.endsWith(def.suffix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "ends_with",
					suffix: def.suffix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.check = (payload) => {
				payload.value = def.tx(payload.value);
			};
		});
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/doc.js
		var Doc = class {
			constructor(args = []) {
				this.content = [];
				this.indent = 0;
				if (this) this.args = args;
			}
			indented(fn) {
				this.indent += 1;
				fn(this);
				this.indent -= 1;
			}
			write(arg) {
				if (typeof arg === "function") {
					arg(this, { execution: "sync" });
					arg(this, { execution: "async" });
					return;
				}
				const lines = arg.split("\n").filter((x) => x);
				const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
				const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
				for (const line of dedented) this.content.push(line);
			}
			compile() {
				const F = Function;
				const args = this?.args;
				const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
				return new F(...args, lines.join("\n"));
			}
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/versions.js
		const version = {
			major: 4,
			minor: 4,
			patch: 3
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/schemas.js
		const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
			var _a;
			inst ?? (inst = {});
			inst._zod.def = def;
			inst._zod.bag = inst._zod.bag || {};
			inst._zod.version = version;
			const checks = [...inst._zod.def.checks ?? []];
			if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
			for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
			if (checks.length === 0) {
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred?.push(() => {
					inst._zod.run = inst._zod.parse;
				});
			} else {
				const runChecks = (payload, checks, ctx) => {
					let isAborted = aborted(payload);
					let asyncResult;
					for (const ch of checks) {
						if (ch._zod.def.when) {
							if (explicitlyAborted(payload)) continue;
							if (!ch._zod.def.when(payload)) continue;
						} else if (isAborted) continue;
						const currLen = payload.issues.length;
						const _ = ch._zod.check(payload);
						if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
						if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
							await _;
							if (payload.issues.length === currLen) return;
							if (!isAborted) isAborted = aborted(payload, currLen);
						});
						else {
							if (payload.issues.length === currLen) continue;
							if (!isAborted) isAborted = aborted(payload, currLen);
						}
					}
					if (asyncResult) return asyncResult.then(() => {
						return payload;
					});
					return payload;
				};
				const handleCanaryResult = (canary, payload, ctx) => {
					if (aborted(canary)) {
						canary.aborted = true;
						return canary;
					}
					const checkResult = runChecks(payload, checks, ctx);
					if (checkResult instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
					}
					return inst._zod.parse(checkResult, ctx);
				};
				inst._zod.run = (payload, ctx) => {
					if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
					if (ctx.direction === "backward") {
						const canary = inst._zod.parse({
							value: payload.value,
							issues: []
						}, {
							...ctx,
							skipChecks: true
						});
						if (canary instanceof Promise) return canary.then((canary) => {
							return handleCanaryResult(canary, payload, ctx);
						});
						return handleCanaryResult(canary, payload, ctx);
					}
					const result = inst._zod.parse(payload, ctx);
					if (result instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return result.then((result) => runChecks(result, checks, ctx));
					}
					return runChecks(result, checks, ctx);
				};
			}
			defineLazy(inst, "~standard", () => ({
				validate: (value) => {
					try {
						const r = safeParse$1(inst, value);
						return r.success ? { value: r.data } : { issues: r.error?.issues };
					} catch (_) {
						return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
					}
				},
				vendor: "zod",
				version: 1
			}));
		});
		const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
			inst._zod.parse = (payload, _) => {
				if (def.coerce) try {
					payload.value = String(payload.value);
				} catch (_) {}
				if (typeof payload.value === "string") return payload;
				payload.issues.push({
					expected: "string",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			$ZodString.init(inst, def);
		});
		const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
			def.pattern ?? (def.pattern = guid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
			if (def.version) {
				const v = {
					v1: 1,
					v2: 2,
					v3: 3,
					v4: 4,
					v5: 5,
					v6: 6,
					v7: 7,
					v8: 8
				}[def.version];
				if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
				def.pattern ?? (def.pattern = uuid(v));
			} else def.pattern ?? (def.pattern = uuid());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
			def.pattern ?? (def.pattern = email);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				try {
					const trimmed = payload.value.trim();
					if (!def.normalize && def.protocol?.source === httpProtocol.source) {
						if (!/^https?:\/\//i.test(trimmed)) {
							payload.issues.push({
								code: "invalid_format",
								format: "url",
								note: "Invalid URL format",
								input: payload.value,
								inst,
								continue: !def.abort
							});
							return;
						}
					}
					const url = new URL(trimmed);
					if (def.hostname) {
						def.hostname.lastIndex = 0;
						if (!def.hostname.test(url.hostname)) payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid hostname",
							pattern: def.hostname.source,
							input: payload.value,
							inst,
							continue: !def.abort
						});
					}
					if (def.protocol) {
						def.protocol.lastIndex = 0;
						if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid protocol",
							pattern: def.protocol.source,
							input: payload.value,
							inst,
							continue: !def.abort
						});
					}
					if (def.normalize) payload.value = url.href;
					else payload.value = trimmed;
					return;
				} catch (_) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
			def.pattern ?? (def.pattern = emoji());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
			def.pattern ?? (def.pattern = nanoid);
			$ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
			def.pattern ?? (def.pattern = cuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
			def.pattern ?? (def.pattern = cuid2);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
			def.pattern ?? (def.pattern = ulid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
			def.pattern ?? (def.pattern = xid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
			def.pattern ?? (def.pattern = ksuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
			def.pattern ?? (def.pattern = datetime$1(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
			def.pattern ?? (def.pattern = date$1);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
			def.pattern ?? (def.pattern = time$1(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
			def.pattern ?? (def.pattern = duration$1);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
			def.pattern ?? (def.pattern = ipv4);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.format = `ipv4`;
		});
		const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
			def.pattern ?? (def.pattern = ipv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.format = `ipv6`;
			inst._zod.check = (payload) => {
				try {
					new URL(`http://[${payload.value}]`);
				} catch {
					payload.issues.push({
						code: "invalid_format",
						format: "ipv6",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv4);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				const parts = payload.value.split("/");
				try {
					if (parts.length !== 2) throw new Error();
					const [address, prefix] = parts;
					if (!prefix) throw new Error();
					const prefixNum = Number(prefix);
					if (`${prefixNum}` !== prefix) throw new Error();
					if (prefixNum < 0 || prefixNum > 128) throw new Error();
					new URL(`http://[${address}]`);
				} catch {
					payload.issues.push({
						code: "invalid_format",
						format: "cidrv6",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		function isValidBase64(data) {
			if (data === "") return true;
			if (/\s/.test(data)) return false;
			if (data.length % 4 !== 0) return false;
			try {
				atob(data);
				return true;
			} catch {
				return false;
			}
		}
		const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
			def.pattern ?? (def.pattern = base64);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.contentEncoding = "base64";
			inst._zod.check = (payload) => {
				if (isValidBase64(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		function isValidBase64URL(data) {
			if (!base64url.test(data)) return false;
			const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
			return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
		}
		const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
			def.pattern ?? (def.pattern = base64url);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.contentEncoding = "base64url";
			inst._zod.check = (payload) => {
				if (isValidBase64URL(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64url",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
			def.pattern ?? (def.pattern = e164);
			$ZodStringFormat.init(inst, def);
		});
		function isValidJWT(token, algorithm = null) {
			try {
				const tokensParts = token.split(".");
				if (tokensParts.length !== 3) return false;
				const [header] = tokensParts;
				if (!header) return false;
				const parsedHeader = JSON.parse(atob(header));
				if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
				if (!parsedHeader.alg) return false;
				if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
				return true;
			} catch {
				return false;
			}
		}
		const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (isValidJWT(payload.value, def.alg)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "jwt",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = inst._zod.bag.pattern ?? number$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Number(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
				const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
				payload.issues.push({
					expected: "number",
					code: "invalid_type",
					input,
					inst,
					...received ? { received } : {}
				});
				return payload;
			};
		});
		const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
			$ZodCheckNumberFormat.init(inst, def);
			$ZodNumber.init(inst, def);
		});
		const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload) => payload;
		});
		const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _ctx) => {
				payload.issues.push({
					expected: "never",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		function handleArrayResult(result, final, index) {
			if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
			final.value[index] = result.value;
		}
		const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!Array.isArray(input)) {
					payload.issues.push({
						expected: "array",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = Array(input.length);
				const proms = [];
				for (let i = 0; i < input.length; i++) {
					const item = input[i];
					const result = def.element._zod.run({
						value: item,
						issues: []
					}, ctx);
					if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
					else handleArrayResult(result, payload, i);
				}
				if (proms.length) return Promise.all(proms).then(() => payload);
				return payload;
			};
		});
		function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
			const isPresent = key in input;
			if (result.issues.length) {
				if (isOptionalIn && isOptionalOut && !isPresent) return;
				final.issues.push(...prefixIssues(key, result.issues));
			}
			if (!isPresent && !isOptionalIn) {
				if (!result.issues.length) final.issues.push({
					code: "invalid_type",
					expected: "nonoptional",
					input: void 0,
					path: [key]
				});
				return;
			}
			if (result.value === void 0) {
				if (isPresent) final.value[key] = void 0;
			} else final.value[key] = result.value;
		}
		function normalizeDef(def) {
			const keys = Object.keys(def.shape);
			for (const k of keys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
			const okeys = optionalKeys(def.shape);
			return {
				...def,
				keys,
				keySet: new Set(keys),
				numKeys: keys.length,
				optionalKeys: new Set(okeys)
			};
		}
		function handleCatchall(proms, input, payload, ctx, def, inst) {
			const unrecognized = [];
			const keySet = def.keySet;
			const _catchall = def.catchall._zod;
			const t = _catchall.def.type;
			const isOptionalIn = _catchall.optin === "optional";
			const isOptionalOut = _catchall.optout === "optional";
			for (const key in input) {
				if (key === "__proto__") continue;
				if (keySet.has(key)) continue;
				if (t === "never") {
					unrecognized.push(key);
					continue;
				}
				const r = _catchall.run({
					value: input[key],
					issues: []
				}, ctx);
				if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
				else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
			}
			if (unrecognized.length) payload.issues.push({
				code: "unrecognized_keys",
				keys: unrecognized,
				input,
				inst
			});
			if (!proms.length) return payload;
			return Promise.all(proms).then(() => {
				return payload;
			});
		}
		const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
			$ZodType.init(inst, def);
			if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
				const sh = def.shape;
				Object.defineProperty(def, "shape", { get: () => {
					const newSh = { ...sh };
					Object.defineProperty(def, "shape", { value: newSh });
					return newSh;
				} });
			}
			const _normalized = cached(() => normalizeDef(def));
			defineLazy(inst._zod, "propValues", () => {
				const shape = def.shape;
				const propValues = {};
				for (const key in shape) {
					const field = shape[key]._zod;
					if (field.values) {
						propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
						for (const v of field.values) propValues[key].add(v);
					}
				}
				return propValues;
			});
			const isObject$1 = isObject;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$1(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = {};
				const proms = [];
				const shape = value.shape;
				for (const key of value.keys) {
					const el = shape[key];
					const isOptionalIn = el._zod.optin === "optional";
					const isOptionalOut = el._zod.optout === "optional";
					const r = el._zod.run({
						value: input[key],
						issues: []
					}, ctx);
					if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
					else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
				}
				if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
				return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
			};
		});
		const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
			$ZodObject.init(inst, def);
			const superParse = inst._zod.parse;
			const _normalized = cached(() => normalizeDef(def));
			const generateFastpass = (shape) => {
				const doc = new Doc([
					"shape",
					"payload",
					"ctx"
				]);
				const normalized = _normalized.value;
				const parseStr = (key) => {
					const k = esc(key);
					return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
				};
				doc.write(`const input = payload.value;`);
				const ids = Object.create(null);
				let counter = 0;
				for (const key of normalized.keys) ids[key] = `key_${counter++}`;
				doc.write(`const newResult = {};`);
				for (const key of normalized.keys) {
					const id = ids[key];
					const k = esc(key);
					const schema = shape[key];
					const isOptionalIn = schema?._zod?.optin === "optional";
					const isOptionalOut = schema?._zod?.optout === "optional";
					doc.write(`const ${id} = ${parseStr(key)};`);
					if (isOptionalIn && isOptionalOut) doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
					else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
					else doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
				}
				doc.write(`payload.value = newResult;`);
				doc.write(`return payload;`);
				const fn = doc.compile();
				return (payload, ctx) => fn(shape, payload, ctx);
			};
			let fastpass;
			const isObject$2 = isObject;
			const jit = !globalConfig.jitless;
			const fastEnabled = jit && allowsEval.value;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$2(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
					if (!fastpass) fastpass = generateFastpass(def.shape);
					payload = fastpass(payload, ctx);
					if (!catchall) return payload;
					return handleCatchall([], input, payload, ctx, value, inst);
				}
				return superParse(payload, ctx);
			};
		});
		function handleUnionResults(results, final, inst, ctx) {
			for (const result of results) if (result.issues.length === 0) {
				final.value = result.value;
				return final;
			}
			const nonaborted = results.filter((r) => !aborted(r));
			if (nonaborted.length === 1) {
				final.value = nonaborted[0].value;
				return nonaborted[0];
			}
			final.issues.push({
				code: "invalid_union",
				input: final.value,
				inst,
				errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			});
			return final;
		}
		const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
			defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
			defineLazy(inst._zod, "values", () => {
				if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
			});
			defineLazy(inst._zod, "pattern", () => {
				if (def.options.every((o) => o._zod.pattern)) {
					const patterns = def.options.map((o) => o._zod.pattern);
					return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
				}
			});
			const first = def.options.length === 1 ? def.options[0]._zod.run : null;
			inst._zod.parse = (payload, ctx) => {
				if (first) return first(payload, ctx);
				let async = false;
				const results = [];
				for (const option of def.options) {
					const result = option._zod.run({
						value: payload.value,
						issues: []
					}, ctx);
					if (result instanceof Promise) {
						results.push(result);
						async = true;
					} else {
						if (result.issues.length === 0) return result;
						results.push(result);
					}
				}
				if (!async) return handleUnionResults(results, payload, inst, ctx);
				return Promise.all(results).then((results) => {
					return handleUnionResults(results, payload, inst, ctx);
				});
			};
		});
		const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				const left = def.left._zod.run({
					value: input,
					issues: []
				}, ctx);
				const right = def.right._zod.run({
					value: input,
					issues: []
				}, ctx);
				if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
					return handleIntersectionResults(payload, left, right);
				});
				return handleIntersectionResults(payload, left, right);
			};
		});
		function mergeValues(a, b) {
			if (a === b) return {
				valid: true,
				data: a
			};
			if (a instanceof Date && b instanceof Date && +a === +b) return {
				valid: true,
				data: a
			};
			if (isPlainObject(a) && isPlainObject(b)) {
				const bKeys = Object.keys(b);
				const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
				const newObj = {
					...a,
					...b
				};
				for (const key of sharedKeys) {
					const sharedValue = mergeValues(a[key], b[key]);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
					};
					newObj[key] = sharedValue.data;
				}
				return {
					valid: true,
					data: newObj
				};
			}
			if (Array.isArray(a) && Array.isArray(b)) {
				if (a.length !== b.length) return {
					valid: false,
					mergeErrorPath: []
				};
				const newArray = [];
				for (let index = 0; index < a.length; index++) {
					const itemA = a[index];
					const itemB = b[index];
					const sharedValue = mergeValues(itemA, itemB);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
					};
					newArray.push(sharedValue.data);
				}
				return {
					valid: true,
					data: newArray
				};
			}
			return {
				valid: false,
				mergeErrorPath: []
			};
		}
		function handleIntersectionResults(result, left, right) {
			const unrecKeys = /* @__PURE__ */ new Map();
			let unrecIssue;
			for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
				unrecIssue ?? (unrecIssue = iss);
				for (const k of iss.keys) {
					if (!unrecKeys.has(k)) unrecKeys.set(k, {});
					unrecKeys.get(k).l = true;
				}
			} else result.issues.push(iss);
			for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
				if (!unrecKeys.has(k)) unrecKeys.set(k, {});
				unrecKeys.get(k).r = true;
			}
			else result.issues.push(iss);
			const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
			if (bothKeys.length && unrecIssue) result.issues.push({
				...unrecIssue,
				keys: bothKeys
			});
			if (aborted(result)) return result;
			const merged = mergeValues(left.value, right.value);
			if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
			result.value = merged.data;
			return result;
		}
		const $ZodRecord = /*@__PURE__*/ $constructor("$ZodRecord", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!isPlainObject(input)) {
					payload.issues.push({
						expected: "record",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				const proms = [];
				const values = def.keyType._zod.values;
				if (values) {
					payload.value = {};
					const recordKeys = /* @__PURE__ */ new Set();
					for (const key of values) if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
						recordKeys.add(typeof key === "number" ? key.toString() : key);
						const keyResult = def.keyType._zod.run({
							value: key,
							issues: []
						}, ctx);
						if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
						if (keyResult.issues.length) {
							payload.issues.push({
								code: "invalid_key",
								origin: "record",
								issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
								input: key,
								path: [key],
								inst
							});
							continue;
						}
						const outKey = keyResult.value;
						const result = def.valueType._zod.run({
							value: input[key],
							issues: []
						}, ctx);
						if (result instanceof Promise) proms.push(result.then((result) => {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[outKey] = result.value;
						}));
						else {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[outKey] = result.value;
						}
					}
					let unrecognized;
					for (const key in input) if (!recordKeys.has(key)) {
						unrecognized = unrecognized ?? [];
						unrecognized.push(key);
					}
					if (unrecognized && unrecognized.length > 0) payload.issues.push({
						code: "unrecognized_keys",
						input,
						inst,
						keys: unrecognized
					});
				} else {
					payload.value = {};
					for (const key of Reflect.ownKeys(input)) {
						if (key === "__proto__") continue;
						if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
						let keyResult = def.keyType._zod.run({
							value: key,
							issues: []
						}, ctx);
						if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
						if (typeof key === "string" && number$1.test(key) && keyResult.issues.length) {
							const retryResult = def.keyType._zod.run({
								value: Number(key),
								issues: []
							}, ctx);
							if (retryResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
							if (retryResult.issues.length === 0) keyResult = retryResult;
						}
						if (keyResult.issues.length) {
							if (def.mode === "loose") payload.value[key] = input[key];
							else payload.issues.push({
								code: "invalid_key",
								origin: "record",
								issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
								input: key,
								path: [key],
								inst
							});
							continue;
						}
						const result = def.valueType._zod.run({
							value: input[key],
							issues: []
						}, ctx);
						if (result instanceof Promise) proms.push(result.then((result) => {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[keyResult.value] = result.value;
						}));
						else {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[keyResult.value] = result.value;
						}
					}
				}
				if (proms.length) return Promise.all(proms).then(() => payload);
				return payload;
			};
		});
		const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
			$ZodType.init(inst, def);
			const values = getEnumValues(def.entries);
			const valuesSet = new Set(values);
			inst._zod.values = valuesSet;
			inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (valuesSet.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
			$ZodType.init(inst, def);
			if (def.values.length === 0) throw new Error("Cannot create literal schema with no valid values");
			const values = new Set(def.values);
			inst._zod.values = values;
			inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (values.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values: def.values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				const _out = def.transform(payload.value, payload);
				if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
					payload.value = output;
					payload.fallback = true;
					return payload;
				});
				if (_out instanceof Promise) throw new $ZodAsyncError();
				payload.value = _out;
				payload.fallback = true;
				return payload;
			};
		});
		function handleOptionalResult(result, input) {
			if (input === void 0 && (result.issues.length || result.fallback)) return {
				issues: [],
				value: void 0
			};
			return result;
		}
		const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			inst._zod.optout = "optional";
			defineLazy(inst._zod, "values", () => {
				return def.innerType._zod.values ? new Set([...def.innerType._zod.values, void 0]) : void 0;
			});
			defineLazy(inst._zod, "pattern", () => {
				const pattern = def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (def.innerType._zod.optin === "optional") {
					const input = payload.value;
					const result = def.innerType._zod.run(payload, ctx);
					if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
					return handleOptionalResult(result, input);
				}
				if (payload.value === void 0) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
			inst._zod.parse = (payload, ctx) => {
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
			defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
			defineLazy(inst._zod, "pattern", () => {
				const pattern = def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
			});
			defineLazy(inst._zod, "values", () => {
				return def.innerType._zod.values ? new Set([...def.innerType._zod.values, null]) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (payload.value === null) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) {
					payload.value = def.defaultValue;
					/**
					* $ZodDefault returns the default value immediately in forward direction.
					* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
					return payload;
				}
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
				return handleDefaultResult(result, def);
			};
		});
		function handleDefaultResult(payload, def) {
			if (payload.value === void 0) payload.value = def.defaultValue;
			return payload;
		}
		const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) payload.value = def.defaultValue;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "values", () => {
				const v = def.innerType._zod.values;
				return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
				return handleNonOptionalResult(result, inst);
			};
		});
		function handleNonOptionalResult(payload, inst) {
			if (!payload.issues.length && payload.value === void 0) payload.issues.push({
				code: "invalid_type",
				expected: "nonoptional",
				input: payload.value,
				inst
			});
			return payload;
		}
		const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => {
					payload.value = result.value;
					if (result.issues.length) {
						payload.value = def.catchValue({
							...payload,
							error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
							input: payload.value
						});
						payload.issues = [];
						payload.fallback = true;
					}
					return payload;
				});
				payload.value = result.value;
				if (result.issues.length) {
					payload.value = def.catchValue({
						...payload,
						error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
						input: payload.value
					});
					payload.issues = [];
					payload.fallback = true;
				}
				return payload;
			};
		});
		const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "values", () => def.in._zod.values);
			defineLazy(inst._zod, "optin", () => def.in._zod.optin);
			defineLazy(inst._zod, "optout", () => def.out._zod.optout);
			defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") {
					const right = def.out._zod.run(payload, ctx);
					if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
					return handlePipeResult(right, def.in, ctx);
				}
				const left = def.in._zod.run(payload, ctx);
				if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
				return handlePipeResult(left, def.out, ctx);
			};
		});
		function handlePipeResult(left, next, ctx) {
			if (left.issues.length) {
				left.aborted = true;
				return left;
			}
			return next._zod.run({
				value: left.value,
				issues: left.issues,
				fallback: left.fallback
			}, ctx);
		}
		const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
			defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then(handleReadonlyResult);
				return handleReadonlyResult(result);
			};
		});
		function handleReadonlyResult(payload) {
			payload.value = Object.freeze(payload.value);
			return payload;
		}
		const $ZodLazy = /*@__PURE__*/ $constructor("$ZodLazy", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "innerType", () => {
				const d = def;
				if (!d._cachedInner) d._cachedInner = def.getter();
				return d._cachedInner;
			});
			defineLazy(inst._zod, "pattern", () => inst._zod.innerType?._zod?.pattern);
			defineLazy(inst._zod, "propValues", () => inst._zod.innerType?._zod?.propValues);
			defineLazy(inst._zod, "optin", () => inst._zod.innerType?._zod?.optin ?? void 0);
			defineLazy(inst._zod, "optout", () => inst._zod.innerType?._zod?.optout ?? void 0);
			inst._zod.parse = (payload, ctx) => {
				return inst._zod.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
			$ZodCheck.init(inst, def);
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _) => {
				return payload;
			};
			inst._zod.check = (payload) => {
				const input = payload.value;
				const r = def.fn(input);
				if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
				handleRefineResult(r, payload, input, inst);
			};
		});
		function handleRefineResult(result, payload, input, inst) {
			if (!result) {
				const _iss = {
					code: "custom",
					input,
					inst,
					path: [...inst._zod.def.path ?? []],
					continue: !inst._zod.def.abort
				};
				if (inst._zod.def.params) _iss.params = inst._zod.def.params;
				payload.issues.push(issue(_iss));
			}
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.js
		var _a;
		var $ZodRegistry = class {
			constructor() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
			}
			add(schema, ..._meta) {
				const meta = _meta[0];
				this._map.set(schema, meta);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
				return this;
			}
			clear() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
				return this;
			}
			remove(schema) {
				const meta = this._map.get(schema);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
				this._map.delete(schema);
				return this;
			}
			get(schema) {
				const p = schema._zod.parent;
				if (p) {
					const pm = { ...this.get(p) ?? {} };
					delete pm.id;
					const f = {
						...pm,
						...this._map.get(schema)
					};
					return Object.keys(f).length ? f : void 0;
				}
				return this._map.get(schema);
			}
			has(schema) {
				return this._map.has(schema);
			}
		};
		function registry() {
			return new $ZodRegistry();
		}
		(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
		const globalRegistry = globalThis.__zod_globalRegistry;
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/api.js
		// @__NO_SIDE_EFFECTS__
		function _string(Class, params) {
			return new Class({
				type: "string",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _email(Class, params) {
			return new Class({
				type: "string",
				format: "email",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _guid(Class, params) {
			return new Class({
				type: "string",
				format: "guid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuid(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv4(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v4",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv6(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v6",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv7(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v7",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _url(Class, params) {
			return new Class({
				type: "string",
				format: "url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _emoji(Class, params) {
			return new Class({
				type: "string",
				format: "emoji",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _nanoid(Class, params) {
			return new Class({
				type: "string",
				format: "nanoid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link _cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		// @__NO_SIDE_EFFECTS__
		function _cuid(Class, params) {
			return new Class({
				type: "string",
				format: "cuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cuid2(Class, params) {
			return new Class({
				type: "string",
				format: "cuid2",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ulid(Class, params) {
			return new Class({
				type: "string",
				format: "ulid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _xid(Class, params) {
			return new Class({
				type: "string",
				format: "xid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ksuid(Class, params) {
			return new Class({
				type: "string",
				format: "ksuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv4(Class, params) {
			return new Class({
				type: "string",
				format: "ipv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv6(Class, params) {
			return new Class({
				type: "string",
				format: "ipv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv4(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv6(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64(Class, params) {
			return new Class({
				type: "string",
				format: "base64",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64url(Class, params) {
			return new Class({
				type: "string",
				format: "base64url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _e164(Class, params) {
			return new Class({
				type: "string",
				format: "e164",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _jwt(Class, params) {
			return new Class({
				type: "string",
				format: "jwt",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDateTime(Class, params) {
			return new Class({
				type: "string",
				format: "datetime",
				check: "string_format",
				offset: false,
				local: false,
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDate(Class, params) {
			return new Class({
				type: "string",
				format: "date",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoTime(Class, params) {
			return new Class({
				type: "string",
				format: "time",
				check: "string_format",
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDuration(Class, params) {
			return new Class({
				type: "string",
				format: "duration",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _number(Class, params) {
			return new Class({
				type: "number",
				checks: [],
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _int(Class, params) {
			return new Class({
				type: "number",
				check: "number_format",
				abort: false,
				format: "safeint",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _unknown(Class) {
			return new Class({ type: "unknown" });
		}
		// @__NO_SIDE_EFFECTS__
		function _never(Class, params) {
			return new Class({
				type: "never",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lt(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lte(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gt(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gte(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _multipleOf(value, params) {
			return new $ZodCheckMultipleOf({
				check: "multiple_of",
				...normalizeParams(params),
				value
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _maxLength(maximum, params) {
			return new $ZodCheckMaxLength({
				check: "max_length",
				...normalizeParams(params),
				maximum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _minLength(minimum, params) {
			return new $ZodCheckMinLength({
				check: "min_length",
				...normalizeParams(params),
				minimum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _length(length, params) {
			return new $ZodCheckLengthEquals({
				check: "length_equals",
				...normalizeParams(params),
				length
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _regex(pattern, params) {
			return new $ZodCheckRegex({
				check: "string_format",
				format: "regex",
				...normalizeParams(params),
				pattern
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lowercase(params) {
			return new $ZodCheckLowerCase({
				check: "string_format",
				format: "lowercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uppercase(params) {
			return new $ZodCheckUpperCase({
				check: "string_format",
				format: "uppercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _includes(includes, params) {
			return new $ZodCheckIncludes({
				check: "string_format",
				format: "includes",
				...normalizeParams(params),
				includes
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _startsWith(prefix, params) {
			return new $ZodCheckStartsWith({
				check: "string_format",
				format: "starts_with",
				...normalizeParams(params),
				prefix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _endsWith(suffix, params) {
			return new $ZodCheckEndsWith({
				check: "string_format",
				format: "ends_with",
				...normalizeParams(params),
				suffix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _overwrite(tx) {
			return new $ZodCheckOverwrite({
				check: "overwrite",
				tx
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _normalize(form) {
			return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
		}
		// @__NO_SIDE_EFFECTS__
		function _trim() {
			return /* @__PURE__ */ _overwrite((input) => input.trim());
		}
		// @__NO_SIDE_EFFECTS__
		function _toLowerCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _toUpperCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _slugify() {
			return /* @__PURE__ */ _overwrite((input) => slugify(input));
		}
		// @__NO_SIDE_EFFECTS__
		function _array(Class, element, params) {
			return new Class({
				type: "array",
				element,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _refine(Class, fn, _params) {
			return new Class({
				type: "custom",
				check: "custom",
				fn,
				...normalizeParams(_params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _superRefine(fn, params) {
			const ch = /* @__PURE__ */ _check((payload) => {
				payload.addIssue = (issue$2) => {
					if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
					else {
						const _issue = issue$2;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						_issue.input ?? (_issue.input = payload.value);
						_issue.inst ?? (_issue.inst = ch);
						_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
						payload.issues.push(issue(_issue));
					}
				};
				return fn(payload.value, payload);
			}, params);
			return ch;
		}
		// @__NO_SIDE_EFFECTS__
		function _check(fn, params) {
			const ch = new $ZodCheck({
				check: "custom",
				...normalizeParams(params)
			});
			ch._zod.check = fn;
			return ch;
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
		function initializeContext(params) {
			let target = params?.target ?? "draft-2020-12";
			if (target === "draft-4") target = "draft-04";
			if (target === "draft-7") target = "draft-07";
			return {
				processors: params.processors ?? {},
				metadataRegistry: params?.metadata ?? globalRegistry,
				target,
				unrepresentable: params?.unrepresentable ?? "throw",
				override: params?.override ?? (() => {}),
				io: params?.io ?? "output",
				counter: 0,
				seen: /* @__PURE__ */ new Map(),
				cycles: params?.cycles ?? "ref",
				reused: params?.reused ?? "inline",
				external: params?.external ?? void 0
			};
		}
		function process(schema, ctx, _params = {
			path: [],
			schemaPath: []
		}) {
			var _a;
			const def = schema._zod.def;
			const seen = ctx.seen.get(schema);
			if (seen) {
				seen.count++;
				if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
				return seen.schema;
			}
			const result = {
				schema: {},
				count: 1,
				cycle: void 0,
				path: _params.path
			};
			ctx.seen.set(schema, result);
			const overrideSchema = schema._zod.toJSONSchema?.();
			if (overrideSchema) result.schema = overrideSchema;
			else {
				const params = {
					..._params,
					schemaPath: [..._params.schemaPath, schema],
					path: _params.path
				};
				if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
				else {
					const _json = result.schema;
					const processor = ctx.processors[def.type];
					if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
					processor(schema, ctx, _json, params);
				}
				const parent = schema._zod.parent;
				if (parent) {
					if (!result.ref) result.ref = parent;
					process(parent, ctx, params);
					ctx.seen.get(parent).isParent = true;
				}
			}
			const meta = ctx.metadataRegistry.get(schema);
			if (meta) Object.assign(result.schema, meta);
			if (ctx.io === "input" && isTransforming(schema)) {
				delete result.schema.examples;
				delete result.schema.default;
			}
			if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
			delete result.schema._prefault;
			return ctx.seen.get(schema).schema;
		}
		function extractDefs(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const idToSchema = /* @__PURE__ */ new Map();
			for (const entry of ctx.seen.entries()) {
				const id = ctx.metadataRegistry.get(entry[0])?.id;
				if (id) {
					const existing = idToSchema.get(id);
					if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
					idToSchema.set(id, entry[0]);
				}
			}
			const makeURI = (entry) => {
				const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
				if (ctx.external) {
					const externalId = ctx.external.registry.get(entry[0])?.id;
					const uriGenerator = ctx.external.uri ?? ((id) => id);
					if (externalId) return { ref: uriGenerator(externalId) };
					const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
					entry[1].defId = id;
					return {
						defId: id,
						ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
					};
				}
				if (entry[1] === root) return { ref: "#" };
				const defUriPrefix = `#/${defsSegment}/`;
				const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
				return {
					defId,
					ref: defUriPrefix + defId
				};
			};
			const extractToDef = (entry) => {
				if (entry[1].schema.$ref) return;
				const seen = entry[1];
				const { ref, defId } = makeURI(entry);
				seen.def = { ...seen.schema };
				if (defId) seen.defId = defId;
				const schema = seen.schema;
				for (const key in schema) delete schema[key];
				schema.$ref = ref;
			};
			if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
			}
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (schema === entry[0]) {
					extractToDef(entry);
					continue;
				}
				if (ctx.external) {
					const ext = ctx.external.registry.get(entry[0])?.id;
					if (schema !== entry[0] && ext) {
						extractToDef(entry);
						continue;
					}
				}
				if (ctx.metadataRegistry.get(entry[0])?.id) {
					extractToDef(entry);
					continue;
				}
				if (seen.cycle) {
					extractToDef(entry);
					continue;
				}
				if (seen.count > 1) {
					if (ctx.reused === "ref") {
						extractToDef(entry);
						continue;
					}
				}
			}
		}
		function finalize(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const flattenRef = (zodSchema) => {
				const seen = ctx.seen.get(zodSchema);
				if (seen.ref === null) return;
				const schema = seen.def ?? seen.schema;
				const _cached = { ...schema };
				const ref = seen.ref;
				seen.ref = null;
				if (ref) {
					flattenRef(ref);
					const refSeen = ctx.seen.get(ref);
					const refSchema = refSeen.schema;
					if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
						schema.allOf = schema.allOf ?? [];
						schema.allOf.push(refSchema);
					} else Object.assign(schema, refSchema);
					Object.assign(schema, _cached);
					if (zodSchema._zod.parent === ref) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (!(key in _cached)) delete schema[key];
					}
					if (refSchema.$ref && refSeen.def) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
					}
				}
				const parent = zodSchema._zod.parent;
				if (parent && parent !== ref) {
					flattenRef(parent);
					const parentSeen = ctx.seen.get(parent);
					if (parentSeen?.schema.$ref) {
						schema.$ref = parentSeen.schema.$ref;
						if (parentSeen.def) for (const key in schema) {
							if (key === "$ref" || key === "allOf") continue;
							if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
						}
					}
				}
				ctx.override({
					zodSchema,
					jsonSchema: schema,
					path: seen.path ?? []
				});
			};
			for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
			const result = {};
			if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
			else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
			else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
			else if (ctx.target === "openapi-3.0") {}
			if (ctx.external?.uri) {
				const id = ctx.external.registry.get(schema)?.id;
				if (!id) throw new Error("Schema is missing an `id` property");
				result.$id = ctx.external.uri(id);
			}
			Object.assign(result, root.def ?? root.schema);
			const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
			if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
			const defs = ctx.external?.defs ?? {};
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.def && seen.defId) {
					if (seen.def.id === seen.defId) delete seen.def.id;
					defs[seen.defId] = seen.def;
				}
			}
			if (ctx.external) {} else if (Object.keys(defs).length > 0) if (ctx.target === "draft-2020-12") result.$defs = defs;
			else result.definitions = defs;
			try {
				const finalized = JSON.parse(JSON.stringify(result));
				Object.defineProperty(finalized, "~standard", {
					value: {
						...schema["~standard"],
						jsonSchema: {
							input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
							output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
						}
					},
					enumerable: false,
					writable: false
				});
				return finalized;
			} catch (_err) {
				throw new Error("Error converting schema to JSON.");
			}
		}
		function isTransforming(_schema, _ctx) {
			const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
			if (ctx.seen.has(_schema)) return false;
			ctx.seen.add(_schema);
			const def = _schema._zod.def;
			if (def.type === "transform") return true;
			if (def.type === "array") return isTransforming(def.element, ctx);
			if (def.type === "set") return isTransforming(def.valueType, ctx);
			if (def.type === "lazy") return isTransforming(def.getter(), ctx);
			if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
			if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
			if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
			if (def.type === "pipe") {
				if (_schema._zod.traits.has("$ZodCodec")) return true;
				return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
			}
			if (def.type === "object") {
				for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
				return false;
			}
			if (def.type === "union") {
				for (const option of def.options) if (isTransforming(option, ctx)) return true;
				return false;
			}
			if (def.type === "tuple") {
				for (const item of def.items) if (isTransforming(item, ctx)) return true;
				if (def.rest && isTransforming(def.rest, ctx)) return true;
				return false;
			}
			return false;
		}
		/**
		* Creates a toJSONSchema method for a schema instance.
		* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
		*/
		const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
			const ctx = initializeContext({
				...params,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
			const { libraryOptions, target } = params ?? {};
			const ctx = initializeContext({
				...libraryOptions ?? {},
				target,
				io,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/json-schema-processors.js
		const formatMap = {
			guid: "uuid",
			url: "uri",
			datetime: "date-time",
			json_string: "json-string",
			regex: ""
		};
		const stringProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			json.type = "string";
			const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
			if (typeof minimum === "number") json.minLength = minimum;
			if (typeof maximum === "number") json.maxLength = maximum;
			if (format) {
				json.format = formatMap[format] ?? format;
				if (json.format === "") delete json.format;
				if (format === "time") delete json.format;
			}
			if (contentEncoding) json.contentEncoding = contentEncoding;
			if (patterns && patterns.size > 0) {
				const regexes = [...patterns];
				if (regexes.length === 1) json.pattern = regexes[0].source;
				else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
					...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
					pattern: regex.source
				}))];
			}
		};
		const numberProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
			if (typeof format === "string" && format.includes("int")) json.type = "integer";
			else json.type = "number";
			const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
			const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
			const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
			if (exMin) if (legacy) {
				json.minimum = exclusiveMinimum;
				json.exclusiveMinimum = true;
			} else json.exclusiveMinimum = exclusiveMinimum;
			else if (typeof minimum === "number") json.minimum = minimum;
			if (exMax) if (legacy) {
				json.maximum = exclusiveMaximum;
				json.exclusiveMaximum = true;
			} else json.exclusiveMaximum = exclusiveMaximum;
			else if (typeof maximum === "number") json.maximum = maximum;
			if (typeof multipleOf === "number") json.multipleOf = multipleOf;
		};
		const neverProcessor = (_schema, _ctx, json, _params) => {
			json.not = {};
		};
		const enumProcessor = (schema, _ctx, json, _params) => {
			const def = schema._zod.def;
			const values = getEnumValues(def.entries);
			if (values.every((v) => typeof v === "number")) json.type = "number";
			if (values.every((v) => typeof v === "string")) json.type = "string";
			json.enum = values;
		};
		const literalProcessor = (schema, ctx, json, _params) => {
			const def = schema._zod.def;
			const vals = [];
			for (const val of def.values) if (val === void 0) {
				if (ctx.unrepresentable === "throw") throw new Error("Literal `undefined` cannot be represented in JSON Schema");
			} else if (typeof val === "bigint") if (ctx.unrepresentable === "throw") throw new Error("BigInt literals cannot be represented in JSON Schema");
			else vals.push(Number(val));
			else vals.push(val);
			if (vals.length === 0) {} else if (vals.length === 1) {
				const val = vals[0];
				json.type = val === null ? "null" : typeof val;
				if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
				else json.const = val;
			} else {
				if (vals.every((v) => typeof v === "number")) json.type = "number";
				if (vals.every((v) => typeof v === "string")) json.type = "string";
				if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
				if (vals.every((v) => v === null)) json.type = "null";
				json.enum = vals;
			}
		};
		const customProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
		};
		const transformProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
		};
		const arrayProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			const { minimum, maximum } = schema._zod.bag;
			if (typeof minimum === "number") json.minItems = minimum;
			if (typeof maximum === "number") json.maxItems = maximum;
			json.type = "array";
			json.items = process(def.element, ctx, {
				...params,
				path: [...params.path, "items"]
			});
		};
		const objectProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			json.type = "object";
			json.properties = {};
			const shape = def.shape;
			for (const key in shape) json.properties[key] = process(shape[key], ctx, {
				...params,
				path: [
					...params.path,
					"properties",
					key
				]
			});
			const allKeys = new Set(Object.keys(shape));
			const requiredKeys = new Set([...allKeys].filter((key) => {
				const v = def.shape[key]._zod;
				if (ctx.io === "input") return v.optin === void 0;
				else return v.optout === void 0;
			}));
			if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
			if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
			else if (!def.catchall) {
				if (ctx.io === "output") json.additionalProperties = false;
			} else if (def.catchall) json.additionalProperties = process(def.catchall, ctx, {
				...params,
				path: [...params.path, "additionalProperties"]
			});
		};
		const unionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const isExclusive = def.inclusive === false;
			const options = def.options.map((x, i) => process(x, ctx, {
				...params,
				path: [
					...params.path,
					isExclusive ? "oneOf" : "anyOf",
					i
				]
			}));
			if (isExclusive) json.oneOf = options;
			else json.anyOf = options;
		};
		const intersectionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const a = process(def.left, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					0
				]
			});
			const b = process(def.right, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					1
				]
			});
			const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
			json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
		};
		const recordProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			json.type = "object";
			const keyType = def.keyType;
			const patterns = keyType._zod.bag?.patterns;
			if (def.mode === "loose" && patterns && patterns.size > 0) {
				const valueSchema = process(def.valueType, ctx, {
					...params,
					path: [
						...params.path,
						"patternProperties",
						"*"
					]
				});
				json.patternProperties = {};
				for (const pattern of patterns) json.patternProperties[pattern.source] = valueSchema;
			} else {
				if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") json.propertyNames = process(def.keyType, ctx, {
					...params,
					path: [...params.path, "propertyNames"]
				});
				json.additionalProperties = process(def.valueType, ctx, {
					...params,
					path: [...params.path, "additionalProperties"]
				});
			}
			const keyValues = keyType._zod.values;
			if (keyValues) {
				const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
				if (validKeyValues.length > 0) json.required = validKeyValues;
			}
		};
		const nullableProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const inner = process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			if (ctx.target === "openapi-3.0") {
				seen.ref = def.innerType;
				json.nullable = true;
			} else json.anyOf = [inner, { type: "null" }];
		};
		const nonoptionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		const defaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.default = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const prefaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const catchProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			let catchValue;
			try {
				catchValue = def.catchValue(void 0);
			} catch {
				throw new Error("Dynamic catch values are not supported in JSON Schema");
			}
			json.default = catchValue;
		};
		const pipeProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			const inIsTransform = def.in._zod.traits.has("$ZodTransform");
			const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
			process(innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = innerType;
		};
		const readonlyProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.readOnly = true;
		};
		const optionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		const lazyProcessor = (schema, ctx, _json, params) => {
			const innerType = schema._zod.innerType;
			process(innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = innerType;
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/iso.js
		const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
			$ZodISODateTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function datetime(params) {
			return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
		}
		const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
			$ZodISODate.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function date(params) {
			return /* @__PURE__ */ _isoDate(ZodISODate, params);
		}
		const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
			$ZodISOTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function time(params) {
			return /* @__PURE__ */ _isoTime(ZodISOTime, params);
		}
		const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
			$ZodISODuration.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function duration(params) {
			return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/errors.js
		const initializer = (inst, issues) => {
			$ZodError.init(inst, issues);
			inst.name = "ZodError";
			Object.defineProperties(inst, {
				format: { value: (mapper) => formatError(inst, mapper) },
				flatten: { value: (mapper) => flattenError(inst, mapper) },
				addIssue: { value: (issue) => {
					inst.issues.push(issue);
					inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
				} },
				addIssues: { value: (issues) => {
					inst.issues.push(...issues);
					inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
				} },
				isEmpty: { get() {
					return inst.issues.length === 0;
				} }
			});
		};
		const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, { Parent: Error });
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/parse.js
		const parse = /* @__PURE__ */ _parse(ZodRealError);
		const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
		const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
		const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
		const encode = /* @__PURE__ */ _encode(ZodRealError);
		const decode = /* @__PURE__ */ _decode(ZodRealError);
		const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
		const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
		const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
		const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
		const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
		const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/schemas.js
		const _installedGroups = /* @__PURE__ */ new WeakMap();
		function _installLazyMethods(inst, group, methods) {
			const proto = Object.getPrototypeOf(inst);
			let installed = _installedGroups.get(proto);
			if (!installed) {
				installed = /* @__PURE__ */ new Set();
				_installedGroups.set(proto, installed);
			}
			if (installed.has(group)) return;
			installed.add(group);
			for (const key in methods) {
				const fn = methods[key];
				Object.defineProperty(proto, key, {
					configurable: true,
					enumerable: false,
					get() {
						const bound = fn.bind(this);
						Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							enumerable: true,
							value: bound
						});
						return bound;
					},
					set(v) {
						Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							enumerable: true,
							value: v
						});
					}
				});
			}
		}
		const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
			$ZodType.init(inst, def);
			Object.assign(inst["~standard"], { jsonSchema: {
				input: createStandardJSONSchemaMethod(inst, "input"),
				output: createStandardJSONSchemaMethod(inst, "output")
			} });
			inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
			inst.def = def;
			inst.type = def.type;
			Object.defineProperty(inst, "_def", { value: def });
			inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
			inst.safeParse = (data, params) => safeParse(inst, data, params);
			inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
			inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
			inst.spa = inst.safeParseAsync;
			inst.encode = (data, params) => encode(inst, data, params);
			inst.decode = (data, params) => decode(inst, data, params);
			inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
			inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
			inst.safeEncode = (data, params) => safeEncode(inst, data, params);
			inst.safeDecode = (data, params) => safeDecode(inst, data, params);
			inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
			inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
			_installLazyMethods(inst, "ZodType", {
				check(...chks) {
					const def = this.def;
					return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
						check: ch,
						def: { check: "custom" },
						onattach: []
					} } : ch)] }), { parent: true });
				},
				with(...chks) {
					return this.check(...chks);
				},
				clone(def, params) {
					return clone(this, def, params);
				},
				brand() {
					return this;
				},
				register(reg, meta) {
					reg.add(this, meta);
					return this;
				},
				refine(check, params) {
					return this.check(refine(check, params));
				},
				superRefine(refinement, params) {
					return this.check(superRefine(refinement, params));
				},
				overwrite(fn) {
					return this.check(/* @__PURE__ */ _overwrite(fn));
				},
				optional() {
					return optional(this);
				},
				exactOptional() {
					return exactOptional(this);
				},
				nullable() {
					return nullable(this);
				},
				nullish() {
					return optional(nullable(this));
				},
				nonoptional(params) {
					return nonoptional(this, params);
				},
				array() {
					return array(this);
				},
				or(arg) {
					return union([this, arg]);
				},
				and(arg) {
					return intersection(this, arg);
				},
				transform(tx) {
					return pipe(this, transform(tx));
				},
				default(d) {
					return _default(this, d);
				},
				prefault(d) {
					return prefault(this, d);
				},
				catch(params) {
					return _catch(this, params);
				},
				pipe(target) {
					return pipe(this, target);
				},
				readonly() {
					return readonly(this);
				},
				describe(description) {
					const cl = this.clone();
					globalRegistry.add(cl, { description });
					return cl;
				},
				meta(...args) {
					if (args.length === 0) return globalRegistry.get(this);
					const cl = this.clone();
					globalRegistry.add(cl, args[0]);
					return cl;
				},
				isOptional() {
					return this.safeParse(void 0).success;
				},
				isNullable() {
					return this.safeParse(null).success;
				},
				apply(fn) {
					return fn(this);
				}
			});
			Object.defineProperty(inst, "description", {
				get() {
					return globalRegistry.get(inst)?.description;
				},
				configurable: true
			});
			return inst;
		});
		/** @internal */
		const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
			const bag = inst._zod.bag;
			inst.format = bag.format ?? null;
			inst.minLength = bag.minimum ?? null;
			inst.maxLength = bag.maximum ?? null;
			_installLazyMethods(inst, "_ZodString", {
				regex(...args) {
					return this.check(/* @__PURE__ */ _regex(...args));
				},
				includes(...args) {
					return this.check(/* @__PURE__ */ _includes(...args));
				},
				startsWith(...args) {
					return this.check(/* @__PURE__ */ _startsWith(...args));
				},
				endsWith(...args) {
					return this.check(/* @__PURE__ */ _endsWith(...args));
				},
				min(...args) {
					return this.check(/* @__PURE__ */ _minLength(...args));
				},
				max(...args) {
					return this.check(/* @__PURE__ */ _maxLength(...args));
				},
				length(...args) {
					return this.check(/* @__PURE__ */ _length(...args));
				},
				nonempty(...args) {
					return this.check(/* @__PURE__ */ _minLength(1, ...args));
				},
				lowercase(params) {
					return this.check(/* @__PURE__ */ _lowercase(params));
				},
				uppercase(params) {
					return this.check(/* @__PURE__ */ _uppercase(params));
				},
				trim() {
					return this.check(/* @__PURE__ */ _trim());
				},
				normalize(...args) {
					return this.check(/* @__PURE__ */ _normalize(...args));
				},
				toLowerCase() {
					return this.check(/* @__PURE__ */ _toLowerCase());
				},
				toUpperCase() {
					return this.check(/* @__PURE__ */ _toUpperCase());
				},
				slugify() {
					return this.check(/* @__PURE__ */ _slugify());
				}
			});
		});
		const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			_ZodString.init(inst, def);
			inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
			inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
			inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
			inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
			inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
			inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
			inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
			inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
			inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
			inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
			inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
			inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
			inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
			inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
			inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
			inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
			inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
			inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
			inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
			inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
			inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
			inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
			inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
			inst.datetime = (params) => inst.check(datetime(params));
			inst.date = (params) => inst.check(date(params));
			inst.time = (params) => inst.check(time(params));
			inst.duration = (params) => inst.check(duration(params));
		});
		function string(params) {
			return /* @__PURE__ */ _string(ZodString, params);
		}
		const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			_ZodString.init(inst, def);
		});
		const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
			$ZodEmail.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
			$ZodGUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
			$ZodUUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
			$ZodURL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
			$ZodEmoji.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
			$ZodNanoID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
			$ZodCUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
			$ZodCUID2.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
			$ZodULID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
			$ZodXID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
			$ZodKSUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
			$ZodIPv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
			$ZodIPv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
			$ZodCIDRv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
			$ZodCIDRv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
			$ZodBase64.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
			$ZodBase64URL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
			$ZodE164.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
			$ZodJWT.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
			$ZodNumber.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
			_installLazyMethods(inst, "ZodNumber", {
				gt(value, params) {
					return this.check(/* @__PURE__ */ _gt(value, params));
				},
				gte(value, params) {
					return this.check(/* @__PURE__ */ _gte(value, params));
				},
				min(value, params) {
					return this.check(/* @__PURE__ */ _gte(value, params));
				},
				lt(value, params) {
					return this.check(/* @__PURE__ */ _lt(value, params));
				},
				lte(value, params) {
					return this.check(/* @__PURE__ */ _lte(value, params));
				},
				max(value, params) {
					return this.check(/* @__PURE__ */ _lte(value, params));
				},
				int(params) {
					return this.check(int(params));
				},
				safe(params) {
					return this.check(int(params));
				},
				positive(params) {
					return this.check(/* @__PURE__ */ _gt(0, params));
				},
				nonnegative(params) {
					return this.check(/* @__PURE__ */ _gte(0, params));
				},
				negative(params) {
					return this.check(/* @__PURE__ */ _lt(0, params));
				},
				nonpositive(params) {
					return this.check(/* @__PURE__ */ _lte(0, params));
				},
				multipleOf(value, params) {
					return this.check(/* @__PURE__ */ _multipleOf(value, params));
				},
				step(value, params) {
					return this.check(/* @__PURE__ */ _multipleOf(value, params));
				},
				finite() {
					return this;
				}
			});
			const bag = inst._zod.bag;
			inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
			inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
			inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? .5);
			inst.isFinite = true;
			inst.format = bag.format ?? null;
		});
		function number(params) {
			return /* @__PURE__ */ _number(ZodNumber, params);
		}
		const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
			$ZodNumberFormat.init(inst, def);
			ZodNumber.init(inst, def);
		});
		function int(params) {
			return /* @__PURE__ */ _int(ZodNumberFormat, params);
		}
		const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
			$ZodUnknown.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => void 0;
		});
		function unknown() {
			return /* @__PURE__ */ _unknown(ZodUnknown);
		}
		const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
			$ZodNever.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
		});
		function never(params) {
			return /* @__PURE__ */ _never(ZodNever, params);
		}
		const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
			$ZodArray.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
			inst.element = def.element;
			_installLazyMethods(inst, "ZodArray", {
				min(n, params) {
					return this.check(/* @__PURE__ */ _minLength(n, params));
				},
				nonempty(params) {
					return this.check(/* @__PURE__ */ _minLength(1, params));
				},
				max(n, params) {
					return this.check(/* @__PURE__ */ _maxLength(n, params));
				},
				length(n, params) {
					return this.check(/* @__PURE__ */ _length(n, params));
				},
				unwrap() {
					return this.element;
				}
			});
		});
		function array(element, params) {
			return /* @__PURE__ */ _array(ZodArray, element, params);
		}
		const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
			$ZodObjectJIT.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
			defineLazy(inst, "shape", () => {
				return def.shape;
			});
			_installLazyMethods(inst, "ZodObject", {
				keyof() {
					return _enum(Object.keys(this._zod.def.shape));
				},
				catchall(catchall) {
					return this.clone({
						...this._zod.def,
						catchall
					});
				},
				passthrough() {
					return this.clone({
						...this._zod.def,
						catchall: unknown()
					});
				},
				loose() {
					return this.clone({
						...this._zod.def,
						catchall: unknown()
					});
				},
				strict() {
					return this.clone({
						...this._zod.def,
						catchall: never()
					});
				},
				strip() {
					return this.clone({
						...this._zod.def,
						catchall: void 0
					});
				},
				extend(incoming) {
					return extend(this, incoming);
				},
				safeExtend(incoming) {
					return safeExtend(this, incoming);
				},
				merge(other) {
					return merge(this, other);
				},
				pick(mask) {
					return pick(this, mask);
				},
				omit(mask) {
					return omit(this, mask);
				},
				partial(...args) {
					return partial(ZodOptional, this, args[0]);
				},
				required(...args) {
					return required(ZodNonOptional, this, args[0]);
				}
			});
		});
		function object(shape, params) {
			return new ZodObject({
				type: "object",
				shape: shape ?? {},
				...normalizeParams(params)
			});
		}
		const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
			$ZodUnion.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
			inst.options = def.options;
		});
		function union(options, params) {
			return new ZodUnion({
				type: "union",
				options,
				...normalizeParams(params)
			});
		}
		const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
			$ZodIntersection.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
		});
		function intersection(left, right) {
			return new ZodIntersection({
				type: "intersection",
				left,
				right
			});
		}
		const ZodRecord = /*@__PURE__*/ $constructor("ZodRecord", (inst, def) => {
			$ZodRecord.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
			inst.keyType = def.keyType;
			inst.valueType = def.valueType;
		});
		function record(keyType, valueType, params) {
			if (!valueType || !valueType._zod) return new ZodRecord({
				type: "record",
				keyType: string(),
				valueType: keyType,
				...normalizeParams(valueType)
			});
			return new ZodRecord({
				type: "record",
				keyType,
				valueType,
				...normalizeParams(params)
			});
		}
		const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
			$ZodEnum.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
			inst.enum = def.entries;
			inst.options = Object.values(def.entries);
			const keys = new Set(Object.keys(def.entries));
			inst.extract = (values, params) => {
				const newEntries = {};
				for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
			inst.exclude = (values, params) => {
				const newEntries = { ...def.entries };
				for (const value of values) if (keys.has(value)) delete newEntries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
		});
		function _enum(values, params) {
			return new ZodEnum({
				type: "enum",
				entries: Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values,
				...normalizeParams(params)
			});
		}
		const ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
			$ZodLiteral.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
			inst.values = new Set(def.values);
			Object.defineProperty(inst, "value", { get() {
				if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
				return def.values[0];
			} });
		});
		function literal(value, params) {
			return new ZodLiteral({
				type: "literal",
				values: Array.isArray(value) ? value : [value],
				...normalizeParams(params)
			});
		}
		const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
			$ZodTransform.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
			inst._zod.parse = (payload, _ctx) => {
				if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				payload.addIssue = (issue$1) => {
					if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
					else {
						const _issue = issue$1;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						_issue.input ?? (_issue.input = payload.value);
						_issue.inst ?? (_issue.inst = inst);
						payload.issues.push(issue(_issue));
					}
				};
				const output = def.transform(payload.value, payload);
				if (output instanceof Promise) return output.then((output) => {
					payload.value = output;
					payload.fallback = true;
					return payload;
				});
				payload.value = output;
				payload.fallback = true;
				return payload;
			};
		});
		function transform(fn) {
			return new ZodTransform({
				type: "transform",
				transform: fn
			});
		}
		const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function optional(innerType) {
			return new ZodOptional({
				type: "optional",
				innerType
			});
		}
		const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
			$ZodExactOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function exactOptional(innerType) {
			return new ZodExactOptional({
				type: "optional",
				innerType
			});
		}
		const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
			$ZodNullable.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nullable(innerType) {
			return new ZodNullable({
				type: "nullable",
				innerType
			});
		}
		const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
			$ZodDefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeDefault = inst.unwrap;
		});
		function _default(innerType, defaultValue) {
			return new ZodDefault({
				type: "default",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
			$ZodPrefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function prefault(innerType, defaultValue) {
			return new ZodPrefault({
				type: "prefault",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
			$ZodNonOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nonoptional(innerType, params) {
			return new ZodNonOptional({
				type: "nonoptional",
				innerType,
				...normalizeParams(params)
			});
		}
		const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
			$ZodCatch.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeCatch = inst.unwrap;
		});
		function _catch(innerType, catchValue) {
			return new ZodCatch({
				type: "catch",
				innerType,
				catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
			});
		}
		const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
			$ZodPipe.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
			inst.in = def.in;
			inst.out = def.out;
		});
		function pipe(in_, out) {
			return new ZodPipe({
				type: "pipe",
				in: in_,
				out
			});
		}
		const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
			$ZodReadonly.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function readonly(innerType) {
			return new ZodReadonly({
				type: "readonly",
				innerType
			});
		}
		const ZodLazy = /*@__PURE__*/ $constructor("ZodLazy", (inst, def) => {
			$ZodLazy.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => lazyProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.getter();
		});
		function lazy(getter) {
			return new ZodLazy({
				type: "lazy",
				getter
			});
		}
		const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
			$ZodCustom.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
		});
		function refine(fn, _params = {}) {
			return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
		}
		function superRefine(fn, params) {
			return /* @__PURE__ */ _superRefine(fn, params);
		}
		//#endregion
		//#region ../../mmap/mmap-host/lib/typert.remote-client.js
		const JsonValueRemoteCodec$schema = union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema)),
			record(string(), lazy(() => JsonValueRemoteCodec$schema))
		]);
		const _deepseek_ai_dsh_mmap_host_mmap_read_parameter_0$schema = string();
		const _deepseek_ai_dsh_mmap_host_mmap_read_result$schema = object({
			"cwd": union([literal(null), string()]).readonly(),
			"pages": array(object({
				"page": union([literal(null), string()]).readonly(),
				"map": union([
					literal(null),
					string(),
					number(),
					literal(false),
					literal(true),
					array(lazy(() => JsonValueRemoteCodec$schema)),
					record(string(), lazy(() => JsonValueRemoteCodec$schema))
				]).readonly(),
				"error": union([literal(null), string()]).readonly(),
				"mtimeMs": union([literal(null), number()]).readonly()
			})).readonly()
		});
		const TYPERT_REMOTE = {
			package: "mellos-mapping-dsh",
			descriptors: [{
				id: "mellos-mapping-dsh#mmap/read",
				service: "mmap",
				namespace: "mmap",
				method: "read",
				invocation: { kind: "direct" },
				parameters: [{
					name: "sessionId",
					wire: "sessionId",
					source: "json",
					codec: {
						mode: "strict",
						typeSymbol: "mellos-mapping-dsh#mmap/read:sessionId",
						schema: _deepseek_ai_dsh_mmap_host_mmap_read_parameter_0$schema
					}
				}],
				result: {
					mode: "strict",
					typeSymbol: "mellos-mapping-dsh/types#MmapReadResult",
					schema: _deepseek_ai_dsh_mmap_host_mmap_read_result$schema
				},
				sourceLocation: {
					"file": "packages/mmap/mmap-host/src/index.ts",
					"line": 137,
					"column": 9
				}
			}]
		};
		//#endregion
		//#region \0dsh-css:D:\deepseek-harness\packages\client\ui-mmap\src\client\MmapView.module.css.mjs
		const css = ".o21LrG_view{box-sizing:border-box;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);outline:none;flex-direction:column;padding:8px 10px 6px;display:flex}.o21LrG_status{color:var(--dsw-alias-label-secondary);padding:8px 4px;font-size:13px}.o21LrG_failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:8px;font-size:13px;display:flex}.o21LrG_emptyState{flex-direction:column;gap:4px;padding:8px 4px;font-size:13px;display:flex}.o21LrG_cursor:after{content:\"▍\";color:var(--dsw-alias-state-success-primary);animation:1.1s step-end infinite o21LrG_mmap-blink}.o21LrG_hint{color:var(--dsw-alias-label-tertiary)}.o21LrG_tabs{flex-wrap:wrap;gap:4px;padding-bottom:6px;display:flex}.o21LrG_tabs button{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:1px solid #0000;border-radius:0;padding:1px 7px;font-size:12px}.o21LrG_tabs button b{color:var(--dsw-alias-label-tertiary);font-weight:400}.o21LrG_tabs button[data-active=true] b,.o21LrG_tabs button[data-fresh=true] b{color:var(--dsw-alias-label-secondary)}.o21LrG_tabs button[data-active=true]{background:var(--dsw-alias-interactive-bg-active);border-color:var(--dsw-alias-border-l3);font-weight:600}.o21LrG_tabs button[data-active=true][data-status=done]{color:var(--dsw-alias-state-success-primary)}.o21LrG_tabs button[data-active=true][data-status=in-progress]{color:var(--dsw-alias-state-warn-primary)}.o21LrG_tabs button[data-active=true][data-status=regressed]{color:var(--dsw-alias-state-error-primary)}.o21LrG_tabs button[data-active=true][data-status=planned],.o21LrG_tabs button[data-active=true][data-status=neutral]{color:var(--dsw-alias-label-primary)}.o21LrG_tabs button[data-fresh=true][data-status=done]{color:var(--dsw-alias-state-success-primary)}.o21LrG_tabs button[data-fresh=true][data-status=in-progress]{color:var(--dsw-alias-state-warn-primary)}.o21LrG_tabs button[data-fresh=true][data-status=regressed]{color:var(--dsw-alias-state-error-primary)}.o21LrG_tabs button[data-fresh=true][data-status=planned],.o21LrG_tabs button[data-fresh=true][data-status=neutral]{color:var(--dsw-alias-label-primary)}.o21LrG_crumb{text-align:start;width:100%;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;padding:2px 4px 8px;font-size:12px;display:block}.o21LrG_crumb strong{color:var(--dsw-alias-label-primary)}.o21LrG_scroll{cursor:grab;touch-action:none;user-select:none;overscroll-behavior:contain;flex:1;min-height:0;overflow:auto}.o21LrG_scroll:active{cursor:grabbing}.o21LrG_map{font-size:12px;display:block}.o21LrG_lane text{fill:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600}.o21LrG_lane line{stroke:var(--dsw-alias-border-l1);stroke-dasharray:2 6}.o21LrG_band line{stroke:var(--dsw-alias-border-l2);stroke-dasharray:1 3}.o21LrG_band text{fill:var(--dsw-alias-label-tertiary);font-size:11px}.o21LrG_edge path{fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-opacity:.55;stroke-width:1.4px;transition:d .18s}.o21LrG_edge[data-active=true] path{stroke:var(--dsw-alias-label-secondary);stroke-opacity:1;stroke-width:1.8px}.o21LrG_edge text{fill:var(--dsw-alias-label-tertiary);text-anchor:middle;font-size:10px}.o21LrG_node{cursor:pointer;transition:transform .18s;animation:.16s o21LrG_mmap-enter}.o21LrG_node rect{fill:var(--dsw-alias-bg-layer-1);stroke-width:1.4px;transition:width .18s,height .18s}.o21LrG_node text{fill:var(--dsw-alias-label-primary)}.o21LrG_boxLine[data-role=evidence]{fill:var(--dsw-alias-label-tertiary);font-size:10.5px}.o21LrG_boxLine[data-role=note]{fill:var(--dsw-alias-label-secondary);font-size:10.5px}.o21LrG_submapBadge{fill:var(--dsw-alias-label-tertiary);font-size:10px}.o21LrG_node[data-status=planned] rect{stroke:var(--dsw-alias-border-l4);stroke-dasharray:4 3}.o21LrG_node[data-status=planned] text{fill:var(--dsw-alias-label-secondary)}.o21LrG_node[data-status=in-progress] rect{stroke:var(--dsw-alias-state-warn-primary);animation:1.4s ease-in-out infinite o21LrG_mmap-pulse}.o21LrG_node[data-status=done] rect{stroke:var(--dsw-alias-state-success-primary);stroke-width:2px}.o21LrG_node[data-status=regressed] rect{stroke:var(--dsw-alias-state-error-primary);stroke-width:2px}.o21LrG_node[data-status=neutral] rect{stroke:var(--dsw-alias-border-l3)}.o21LrG_node[data-focused=true] rect{stroke-width:2.4px}.o21LrG_node[data-selected=true] rect{fill:var(--dsw-alias-interactive-bg-active)}@keyframes o21LrG_mmap-pulse{0%,to{stroke-opacity:1}50%{stroke-opacity:.35}}@keyframes o21LrG_mmap-blink{0%,55%{opacity:1}56%,to{opacity:0}}@keyframes o21LrG_mmap-enter{0%{opacity:0}}@media (prefers-reduced-motion:reduce){.o21LrG_node,.o21LrG_node[data-status=in-progress] rect{animation:none}.o21LrG_node,.o21LrG_node rect,.o21LrG_edge path{transition:none}.o21LrG_cursor:after{animation:none}}.o21LrG_stale,.o21LrG_flash{color:var(--dsw-alias-state-warn-primary);margin:0;padding:2px 4px;font-size:11px}.o21LrG_flash{color:var(--dsw-alias-label-secondary)}.o21LrG_divider{border-top:1px dashed var(--dsw-alias-border-l2);height:12px;color:var(--dsw-alias-label-tertiary);cursor:row-resize;touch-action:none;user-select:none;justify-content:center;align-items:center;margin-top:2px;font-size:10px;line-height:10px;display:flex;position:relative}.o21LrG_dividerGrip{pointer-events:none}.o21LrG_followTag{color:var(--dsw-alias-label-tertiary);opacity:.55;cursor:pointer;background:0 0;border:0;padding:0 4px;font-size:10px;line-height:12px;position:absolute;top:0;right:6px}.o21LrG_followTag[data-armed=true]{color:var(--dsw-alias-brand-primary);opacity:1}.o21LrG_panel{flex-shrink:0;font-size:12px;overflow-y:auto}.o21LrG_panelBody{flex-direction:column;gap:3px;display:flex}.o21LrG_panelBody p{margin:0}.o21LrG_panelTitle,.o21LrG_panelHeader{font-weight:600}.o21LrG_panelHeader code{color:var(--dsw-alias-label-tertiary);font-size:11px}.o21LrG_panelHeader[data-status=done]{color:var(--dsw-alias-state-success-primary)}.o21LrG_panelHeader[data-status=in-progress]{color:var(--dsw-alias-state-warn-primary)}.o21LrG_panelHeader[data-status=regressed]{color:var(--dsw-alias-state-error-primary)}.o21LrG_pinMark{color:var(--dsw-alias-label-tertiary);margin-inline-start:8px;font-size:11px;font-weight:400}.o21LrG_panelMeta{color:var(--dsw-alias-label-tertiary)}.o21LrG_statusCounts{gap:12px;display:flex}.o21LrG_statusCounts span[data-status=done]{color:var(--dsw-alias-state-success-primary)}.o21LrG_statusCounts span[data-status=in-progress]{color:var(--dsw-alias-state-warn-primary)}.o21LrG_statusCounts span[data-status=planned]{color:var(--dsw-alias-label-secondary)}.o21LrG_statusCounts span[data-status=regressed]{color:var(--dsw-alias-state-error-primary)}.o21LrG_panelHint{color:var(--dsw-alias-label-tertiary)}.o21LrG_wireRow{color:var(--dsw-alias-label-secondary);flex-wrap:wrap;align-items:baseline;gap:4px 8px;display:flex}.o21LrG_detailKey{color:var(--dsw-alias-label-tertiary)}.o21LrG_chip{align-items:baseline;gap:5px;display:inline-flex}.o21LrG_chip:before{content:\"·\";font-size:11px}.o21LrG_chip em{color:var(--dsw-alias-label-tertiary);font-style:normal}.o21LrG_chip[data-status=done]:before{content:\"■\";color:var(--dsw-alias-state-success-primary)}.o21LrG_chip[data-status=in-progress]:before{content:\"◐\";color:var(--dsw-alias-state-warn-primary)}.o21LrG_chip[data-status=planned]:before{content:\"·\";color:var(--dsw-alias-label-tertiary)}.o21LrG_chip[data-status=regressed]:before{content:\"✗\";color:var(--dsw-alias-state-error-primary)}.o21LrG_panelNotes{color:var(--dsw-alias-label-secondary);white-space:pre-wrap}.o21LrG_footer{border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);justify-content:space-between;gap:12px;margin-top:6px;padding-top:5px;font-size:11px;display:flex}.o21LrG_toggle{min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;padding:3px 6px;font-size:12px;line-height:18px;display:inline-flex}.o21LrG_toggle:hover,.o21LrG_toggle:focus-visible{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}.o21LrG_drawer{background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l2);z-index:60;flex-direction:column;width:min(560px,70vw);transition:transform .2s;display:flex;position:fixed;top:0;bottom:0;right:0;transform:translate(102%);box-shadow:-12px 0 32px #0000002e}.o21LrG_drawer[data-open]{transform:translate(0)}.o21LrG_drawerClose{z-index:1;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:6px;padding:2px 7px;font-size:13px;line-height:20px;position:absolute;top:6px;right:8px}.o21LrG_drawerClose:hover,.o21LrG_drawerClose:focus-visible{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}.o21LrG_toggle[data-open]{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-active)}@media (prefers-reduced-motion:reduce){.o21LrG_drawer{transition:none}}";
		const tagId = "mellos-mapping-dsh-client/MmapView.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "mellos-mapping-dsh-client";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var MmapView_module_css_default = {
			"mmap-enter": "o21LrG_mmap-enter",
			"toggle": "o21LrG_toggle",
			"scroll": "o21LrG_scroll",
			"mmap-blink": "o21LrG_mmap-blink",
			"panel": "o21LrG_panel",
			"map": "o21LrG_map",
			"failure": "o21LrG_failure",
			"statusCounts": "o21LrG_statusCounts",
			"tabs": "o21LrG_tabs",
			"followTag": "o21LrG_followTag",
			"panelHeader": "o21LrG_panelHeader",
			"detailKey": "o21LrG_detailKey",
			"emptyState": "o21LrG_emptyState",
			"submapBadge": "o21LrG_submapBadge",
			"flash": "o21LrG_flash",
			"panelTitle": "o21LrG_panelTitle",
			"pinMark": "o21LrG_pinMark",
			"drawer": "o21LrG_drawer",
			"lane": "o21LrG_lane",
			"hint": "o21LrG_hint",
			"footer": "o21LrG_footer",
			"node": "o21LrG_node",
			"divider": "o21LrG_divider",
			"panelBody": "o21LrG_panelBody",
			"chip": "o21LrG_chip",
			"stale": "o21LrG_stale",
			"panelMeta": "o21LrG_panelMeta",
			"dividerGrip": "o21LrG_dividerGrip",
			"crumb": "o21LrG_crumb",
			"status": "o21LrG_status",
			"wireRow": "o21LrG_wireRow",
			"mmap-pulse": "o21LrG_mmap-pulse",
			"drawerClose": "o21LrG_drawerClose",
			"band": "o21LrG_band",
			"boxLine": "o21LrG_boxLine",
			"panelHint": "o21LrG_panelHint",
			"edge": "o21LrG_edge",
			"view": "o21LrG_view",
			"panelNotes": "o21LrG_panelNotes",
			"cursor": "o21LrG_cursor"
		};
		//#endregion
		//#region lib/types/client/MapToggleAction.js
		/** One header button toggling the side-by-side map column. */
		function MapToggleAction({ toggle, t }) {
			return (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: MmapView_module_css_default.toggle,
				onClick: toggle,
				title: t("view.mmap"),
				children: t("view.mmap")
			});
		}
		//#endregion
		//#region C:/Users/14293/Desktop/mellos-mapping/lib/domain/ops.js
		/** Aggregate status over a set of nodes: regression trumps, then activity, then completion. */
		function aggregateStatus(nodes) {
			if (nodes.some((n) => n.status === "regressed")) return "regressed";
			if (nodes.some((n) => n.status === "in-progress")) return "in-progress";
			if (nodes.length > 0 && nodes.every((n) => n.status === "done")) return "done";
			return "planned";
		}
		/**
		* Derived, never stored: a group's aggregate status. Any regressed member
		* cracks the group; else any spinner spins it; else all-done (non-empty)
		* completes it; anything else is planned.
		*/
		function groupStatus(map, id) {
			return aggregateStatus(map.nodes.filter((n) => n.group === id));
		}
		/** Derived, never stored: the whole map's aggregate status (same rules as groupStatus). */
		function mapStatus(map) {
			return aggregateStatus(map.nodes);
		}
		//#endregion
		//#region C:/Users/14293/Desktop/mellos-mapping/lib/semantics/semantics.js
		/**
		* Layer 1c — medium-neutral VIEW SEMANTICS of a MellosMap.
		*
		* Every renderer (the terminal pane, a web panel, a future editor view) must
		* agree on what a zoom step MEANS, when a map aggregates into its groups,
		* how sequence time is oriented, and which map kinds render neutrally.
		* Those rules live here, pure of any medium: no cells, no glyphs, no DOM,
		* no I/O. Geometry — how a mode maps onto character cells or pixels — stays
		* private to each renderer.
		*/
		/**
		* What a zoom step MEANS, before any renderer decides what it looks like:
		* scaling only compresses, the ends of the ladder switch mode. 'detail'
		* unfolds evidence and design notes; 'overview' switches to the aggregated
		* far view (groups become the nodes — see aggregateMap); 'boxes' is every
		* step in between, where boxes stay boxes and only whitespace and label
		* budgets change.
		*/
		function zoomMode(zoom) {
			if (zoom >= 1) return "detail";
			if (zoom <= -4) return "overview";
			return "boxes";
		}
		/** What a footer shows: a percentage while scaling, a mode name at the ends. */
		function zoomLabel(zoom) {
			switch (zoom) {
				case 2: return "detail+";
				case 1: return "detail";
				case 0: return "100%";
				case -1: return "85%";
				case -2: return "70%";
				case -3: return "55%";
				case -4: return "overview";
			}
		}
		/** Documentation kinds render neutrally: no status skins, no progress counts. */
		function isNeutralKind(map) {
			return map.kind !== void 0 && map.kind !== "dev";
		}
		/**
		* The derived coarse picture the far zoom renders when the map declares
		* groups: each group becomes ONE labeled node (status derived from members,
		* label carrying done/total), ungrouped nodes stay themselves, and edges
		* collapse onto representatives (intra-group wiring disappears into the
		* box). Derived for rendering only — never persisted. A map without groups
		* returns undefined and falls back to whatever anonymous overview the
		* renderer draws.
		*/
		function aggregateMap(map) {
			if (map.groups.length === 0) return void 0;
			const representative = /* @__PURE__ */ new Map();
			for (const n of map.nodes) representative.set(n.id, n.group ?? n.id);
			const nodes = map.groups.map((g) => {
				const members = map.nodes.filter((n) => n.group === g.id);
				const done = members.filter((n) => n.status === "done").length;
				return {
					id: g.id,
					label: isNeutralKind(map) ? g.label : `${g.label} ${done}/${members.length}`,
					layer: g.layer,
					status: groupStatus(map, g.id)
				};
			});
			for (const n of map.nodes) if (n.group === void 0) nodes.push(n);
			const seen = /* @__PURE__ */ new Set();
			const edges = [];
			for (const e of map.edges) {
				const from = representative.get(e.from);
				const to = representative.get(e.to);
				if (from === to || seen.has(`${from}->${to}`)) continue;
				seen.add(`${from}->${to}`);
				edges.push({
					from,
					to
				});
			}
			return {
				...map.title !== void 0 ? { title: map.title } : {},
				...map.kind !== void 0 ? { kind: map.kind } : {},
				layers: map.layers,
				groups: [],
				lanes: map.lanes,
				nodes,
				edges
			};
		}
		/**
		* Derive what a detail panel says about one focused id — a node, or a group
		* when the far zoom's aggregated boxes are what the pointer is over. Pure
		* data: every renderer picks its own glyphs, colors, and words (a sequence
		* page reads uses/usedBy as after/before; that is the caller's vocabulary).
		* @param map - the map the focus lives in.
		* @param focusId - node or group id.
		* @returns the focus view, or undefined when the id names neither.
		*/
		function focusInfo(map, focusId) {
			const layerNameOf = (layerId) => map.layers.find((l) => l.id === layerId)?.name ?? layerId;
			const group = map.groups.find((g) => g.id === focusId);
			if (group) {
				const members = map.nodes.filter((n) => n.group === group.id);
				const memberIds = new Set(members.map((n) => n.id));
				const rep = (id) => {
					const n = map.nodes.find((x) => x.id === id);
					const owner = n.group !== void 0 ? map.groups.find((g) => g.id === n.group) : void 0;
					return owner !== void 0 ? {
						id: owner.id,
						label: owner.label,
						status: groupStatus(map, owner.id)
					} : {
						id: n.id,
						label: n.label,
						status: n.status
					};
				};
				const dedupe = (refs) => {
					const seen = /* @__PURE__ */ new Set();
					const out = [];
					for (const r of refs) {
						if (seen.has(r.id)) continue;
						seen.add(r.id);
						out.push(r);
					}
					return out;
				};
				return {
					kind: "group",
					group,
					status: groupStatus(map, group.id),
					layerName: layerNameOf(group.layer),
					members,
					uses: dedupe(map.edges.filter((e) => memberIds.has(e.from) && !memberIds.has(e.to)).map((e) => rep(e.to))),
					usedBy: dedupe(map.edges.filter((e) => memberIds.has(e.to) && !memberIds.has(e.from)).map((e) => rep(e.from)))
				};
			}
			const node = map.nodes.find((n) => n.id === focusId);
			if (!node) return void 0;
			const ref = (id, edgeLabel) => {
				const n = map.nodes.find((x) => x.id === id);
				return {
					id,
					label: n?.label ?? id,
					status: n?.status ?? "planned",
					...edgeLabel !== void 0 ? { edgeLabel } : {}
				};
			};
			const laneLabel = node.lane !== void 0 ? map.lanes.find((l) => l.id === node.lane)?.label : void 0;
			return {
				kind: "node",
				node,
				layerName: layerNameOf(node.layer),
				...laneLabel !== void 0 ? { laneLabel } : {},
				uses: map.edges.filter((e) => e.from === node.id).map((e) => ref(e.to, e.label)),
				usedBy: map.edges.filter((e) => e.to === node.id).map((e) => ref(e.from, e.label))
			};
		}
		/**
		* Page slugs some node of any map dives into. A page referenced as a submap
		* is interior detail — it is reached by diving through its linking node,
		* never by sitting beside its parent as a sibling tab.
		* @param maps - every known page's map (undefined entries are skipped).
		* @returns the referenced submap slugs.
		*/
		function submapRefs(maps) {
			const refs = /* @__PURE__ */ new Set();
			for (const m of maps) for (const n of m?.nodes ?? []) if (n.submap !== void 0) refs.add(n.submap);
			return refs;
		}
		/**
		* Where a sub-map page was dived into from: the entry whose map links the
		* page, plus the linking node's label. Derived by scan, so a breadcrumb
		* survives any client restart with an empty dive stack.
		* @param entries - known pages as (key, map) pairs; keys are caller-owned.
		* @param pageId - the sub-map page's slug.
		* @returns the linking entry's key and node label, or undefined for a top-level page.
		*/
		function diveParent(entries, pageId) {
			for (const [key, m] of entries) {
				const node = m?.nodes.find((n) => n.submap === pageId);
				if (node !== void 0) return {
					parent: key,
					label: node.label
				};
			}
		}
		/**
		* The page a client shows when nobody asked for one: the most recently
		* WRITTEN page — the ledger last touched is almost always the effort under
		* way. Keys without a readable timestamp lose; an empty set answers the
		* first key (caller-ordered: default page first, then slug order).
		* @param keys - candidate page keys in the caller's fallback order.
		* @param mtimeOf - last-written timestamp of a key, undefined when unknown.
		* @returns the winning key, or undefined for an empty candidate set.
		*/
		function mostRecentKey(keys, mtimeOf) {
			let best;
			let bestMtime = -Infinity;
			for (const key of keys) {
				const mtime = mtimeOf(key);
				if (mtime !== void 0 && mtime > bestMtime) {
					best = key;
					bestMtime = mtime;
				}
			}
			return best ?? keys[0];
		}
		/**
		* Sequence pages read like the classic diagram: time flows DOWNWARD, the
		* earliest step right under the participant headers. The stored map keeps
		* rank 0 = earliest with edges pointing later -> earlier ("later stands on
		* earlier"); this derived value inverts the ranks and reverses the edges so
		* unchanged top-down machinery draws top-down time — each wire now runs
		* from the sender's moment down into the receiver's. Derived for rendering
		* only, never persisted (same contract as aggregateMap).
		*/
		function flipForSequence(map) {
			if (map.kind !== "sequence") return map;
			return {
				...map,
				layers: map.layers.map((l) => ({
					...l,
					rank: -l.rank
				})),
				edges: map.edges.map((e) => ({
					from: e.to,
					to: e.from,
					...e.label !== void 0 ? { label: e.label } : {}
				}))
			};
		}
		//#endregion
		//#region C:/Users/14293/Desktop/mellos-mapping/lib/render/render.js
		/**
		* Known node kinds -> [unicode, ascii] glyphs (all display width 1).
		* Behavior trees, dataflow and architecture vocabularies; an unknown kind
		* renders without a glyph and stays readable in the detail panel.
		*/
		const NODE_KIND_GLYPHS = {
			selector: ["?", "?"],
			sequence: ["»", ">"],
			parallel: ["‖", "="],
			decorator: ["◌", "o"],
			condition: ["◇", "c"],
			action: ["·", "."],
			source: ["○", "o"],
			transform: ["◐", "%"],
			sink: ["●", "*"],
			service: ["◆", "S"],
			db: ["▤", "D"],
			queue: ["≣", "Q"],
			ui: ["▣", "U"]
		};
		/** Glyph for a node kind, or undefined for unknown kinds. Shared with the watcher's panel. */
		function kindGlyph(kind, unicode) {
			const pair = NODE_KIND_GLYPHS[kind];
			return pair === void 0 ? void 0 : unicode ? pair[0] : pair[1];
		}
		//#endregion
		//#region lib/types/client/layout.js
		/**
		* Pure geometry over a Mellos map value at one zoom step: bands stacked
		* top-down by descending rank (primitives at the bottom, matching the
		* terminal pane), boxes packed left-to-right per band — under lane columns
		* when the map declares lanes — and downward edges between box centers.
		*
		* Medium semantics (zoom-step meaning, far-zoom aggregation, sequence
		* orientation, neutral kinds) come from the mellos-mapping semantics library
		* so this view and the terminal pane can never disagree on what a map MEANS.
		* What zoom LOOKS like is owned here, in the medium's own strength: the view
		* scales geometry CONTINUOUSLY (SVG scales for free where a terminal must
		* compress whitespace) and this module maps the scale to a content step by
		* thresholds — the detail steps unfold evidence and notes inside
		* the boxes, and the overview step renders the aggregated map. A map without
		* groups has no aggregate and simply stays itself at the far step — the
		* terminal's glyph constellation is a character-grid necessity, not a
		* semantic obligation.
		*/
		/** Pixel geometry constants at the view's base font size. */
		const LINE_H = 17;
		const BOX_PAD_Y = 8;
		const PAD_X = 14;
		const GAP_X = 18;
		const LANE_GAP = 34;
		const BAND_LABEL_H = 24;
		const LANE_HEADER_H = 22;
		const MARGIN = 16;
		const MIN_BOX_W = 64;
		/** Wire-routing geometry, the terminal renderer's routing preference in
		* pixels. Horizontal runs pack into shared track rows per band gap, so the
		* gap between two bands is as tall as its traffic needs and no taller —
		* packing is what keeps the bands close together. */
		const TRACK_H = 13;
		/** Breathing room above the top track row; taller than below because edge
		* labels sit 4px above their run. */
		const GAP_BREATHE_TOP = 18;
		const GAP_BREATHE_BOTTOM = 14;
		/** A gap no horizontal run crosses: bands pull close. */
		const GAP_EMPTY = 30;
		/** Two runs may share one track row when a clear break this wide separates
		* them; anything closer reads as one line and gets its own row. */
		const TRACK_CLEARANCE = 14;
		/** Minimum distance between attach columns promised on one box border. */
		const SEAT_MIN = 10;
		/** Search step when nudging an attach column off a claimed one. */
		const SEAT_STEP = 6;
		/** Attach columns keep off the box corners by this much. */
		const EDGE_INSET = 8;
		/** A thread descent column keeps this clear of every intermediate box. */
		const THREAD_CLEAR = 6;
		/** Corridor search step for thread descent columns. */
		const THREAD_STEP = 4;
		/** Minimum distance between two descent columns. */
		const THREAD_SEP = 8;
		/** First right-margin fallback column sits this far beyond the content. */
		const THREAD_FALLBACK_PAD = 14;
		/** Character budget and note-line cap of the two detail steps. The first
		* step unfolds gently (evidence plus one note line) so crossing its
		* threshold reflows a few lines, not a wall of text; the far step opens up. */
		const DETAIL_BUDGET = {
			chars: 34,
			noteLines: 1
		};
		const DETAIL_PLUS_BUDGET = {
			chars: 48,
			noteLines: 12
		};
		/** Continuous display-scale range; the view multiplies geometry by it. */
		const SCALE_MIN = .4;
		const SCALE_MAX = 2.4;
		/**
		* Fold a value into the scale range. Non-finite input (a viewpoint persisted
		* by an older build carried ladder steps in this seat) lands on the default.
		* @param value - candidate scale.
		* @returns a usable scale inside the contract range.
		*/
		function clampScale(value) {
			return Number.isFinite(value) ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, value)) : 1;
		}
		/** Content-step thresholds, descending; scale >= at renders as `above`.
		* Boundary values dodge the landing spots of the standard gestures (a wheel
		* detent is x1.162 per click, the +/- keys x1.25), so ordinary zoom paths
		* clear the hysteresis band instead of parking inside it. */
		const STEP_BOUNDS = [
			{
				at: 1.5,
				above: 2
			},
			{
				at: 1.2,
				above: 1
			},
			{
				at: .625,
				above: 0
			},
			{
				at: .505,
				above: -3
			}
		];
		/** Schmitt margin: leaving the current step requires clearing a boundary by
		* this much. Wide enough for wheel jitter (well under one percent of scale),
		* narrow enough that a full detent always clears it — the same scale must
		* not show different content depending on the approach direction. */
		const STEP_HYSTERESIS = .02;
		/**
		* The semantic step a continuous scale renders with: a magnified picture
		* unfolds detail inside the boxes, a small one carries counts on the band
		* bars, and the far end aggregates groups. Thresholds instead of discrete
		* stops — the wheel zooms geometrically and the content follows. With the
		* current step supplied, boundaries act as a Schmitt trigger: hovering at a
		* threshold cannot flap the layout open and shut on wheel jitter.
		* @param scale - continuous display scale.
		* @param current - step currently rendered, engages hysteresis when given.
		* @returns the content step to lay out with.
		*/
		function stepForScale(scale, current) {
			let raw = -4;
			for (const bound of STEP_BOUNDS) if (scale >= bound.at) {
				raw = bound.above;
				break;
			}
			if (current === void 0 || raw === current) return raw;
			const crossed = STEP_BOUNDS.find((bound) => bound.above === (raw > current ? raw : current));
			return crossed !== void 0 && Math.abs(scale - crossed.at) < STEP_HYSTERESIS ? current : raw;
		}
		/**
		* Approximate rendered width of a label at the view's base font: CJK glyphs
		* occupy roughly double an ASCII glyph. An estimate is enough — boxes carry
		* padding, and exact text measurement would drag DOM layout into a pure
		* function.
		* @param text - label text.
		* @returns estimated pixel width.
		*/
		function estimateTextWidth(text) {
			let width = 0;
			for (const ch of text) width += (ch.codePointAt(0) ?? 0) > 255 ? 13 : 7.2;
			return width;
		}
		/** Hard word-wrap by character budget (CJK counts double), for in-box notes. */
		function wrapChars(text, budget) {
			const out = [];
			let line = "";
			let cost = 0;
			for (const ch of text) {
				const w = (ch.codePointAt(0) ?? 0) > 255 ? 2 : 1;
				if (cost + w > budget && line !== "") {
					out.push(line);
					line = "";
					cost = 0;
				}
				line += ch;
				cost += w;
			}
			if (line !== "") out.push(line);
			return out;
		}
		/** Status glyphs of the terminal pane's glyphFor, the spinner held at ◐. */
		const STATUS_GLYPHS = {
			"planned": "·",
			"in-progress": "◐",
			"done": "■",
			"regressed": "✗"
		};
		/** The text lines one node box carries at this zoom step. */
		function boxLines(node, zoom, neutral) {
			const glyph = neutral ? node.kind !== void 0 ? kindGlyph(node.kind, true) : void 0 : STATUS_GLYPHS[node.status];
			const lines = [{
				text: glyph !== void 0 ? `${glyph} ${node.label}` : node.label,
				role: "label"
			}];
			if (zoomMode(zoom) !== "detail") return lines;
			const budget = zoom >= 2 ? DETAIL_PLUS_BUDGET : DETAIL_BUDGET;
			if (!neutral && node.evidence !== void 0) for (const text of wrapChars(node.evidence, budget.chars).slice(0, 2)) lines.push({
				text,
				role: "evidence"
			});
			if (node.detail !== void 0) for (const text of wrapChars(node.detail, budget.chars).slice(0, budget.noteLines)) lines.push({
				text,
				role: "note"
			});
			return lines;
		}
		/**
		* Compute the full layered picture for one map value at one zoom step.
		* @param map - a validated Mellos map value.
		* @param zoom - position on the semantic zoom ladder.
		* @returns positioned bands, lanes, boxes, and edges with the content extent.
		*/
		function computeLayout(map, zoom = 0) {
			const oriented = flipForSequence(map);
			const aggregated = zoomMode(zoom) === "overview" ? aggregateMap(oriented) : void 0;
			const working = aggregated ?? oriented;
			const neutral = isNeutralKind(working);
			const bands = [...working.layers].sort((a, b) => b.rank - a.rank);
			const withCounts = zoom <= -3 && !neutral;
			const speced = working.nodes.map((node) => {
				const lines = boxLines(node, zoom, neutral);
				return {
					node,
					spec: {
						w: Math.max(MIN_BOX_W, Math.round(Math.max(...lines.map((l) => estimateTextWidth(l.text)))) + PAD_X * 2),
						h: BOX_PAD_Y * 2 + LINE_H * lines.length,
						lines
					}
				};
			});
			const laneCount = working.lanes.length;
			const laneIndexOf = new Map(working.lanes.map((l, i) => [l.id, i]));
			const regions = laneCount + 1;
			const regionOf = (node) => node.lane !== void 0 ? laneIndexOf.get(node.lane) ?? regions - 1 : regions - 1;
			const laneX = [];
			const laneW = [];
			if (laneCount > 0) {
				const regionW = Array.from({ length: regions }, () => 0);
				for (const band of bands) {
					const rowW = Array.from({ length: regions }, () => 0);
					for (const { node, spec } of speced) {
						if (node.layer !== band.id) continue;
						const region = regionOf(node);
						rowW[region] = (rowW[region] ?? 0) + spec.w + ((rowW[region] ?? 0) > 0 ? GAP_X : 0);
					}
					for (let i = 0; i < regions; i++) regionW[i] = Math.max(regionW[i] ?? 0, rowW[i] ?? 0);
				}
				for (const [i, lane] of working.lanes.entries()) regionW[i] = Math.max(regionW[i] ?? 0, Math.round(estimateTextWidth(lane.label)) + PAD_X);
				let x0 = MARGIN;
				for (let i = 0; i < regions; i++) {
					const w = regionW[i] ?? 0;
					laneX.push(x0);
					laneW.push(w);
					x0 += w + (w > 0 ? LANE_GAP : 0);
				}
			}
			const placed = [];
			const bandMembers = [];
			const byId = /* @__PURE__ */ new Map();
			let width = MARGIN * 2;
			for (const band of bands) {
				const row = [];
				const cursors = laneCount === 0 ? [MARGIN] : [...laneX];
				for (const { node, spec } of speced) {
					if (node.layer !== band.id) continue;
					const region = laneCount === 0 ? 0 : regionOf(node);
					const x = cursors[region] ?? MARGIN;
					const box = {
						node,
						x,
						w: spec.w,
						h: spec.h,
						lines: spec.lines,
						y: 0
					};
					row.push(box);
					placed.push(box);
					byId.set(node.id, box);
					cursors[region] = x + spec.w + GAP_X;
				}
				bandMembers.push(row);
				width = Math.max(width, ...cursors.map((c) => c - GAP_X + MARGIN));
			}
			const laneHeaders = working.lanes.map((lane, i) => ({
				label: lane.label,
				x: laneX[i] ?? MARGIN,
				w: laneW[i] ?? 0
			}));
			for (const header of laneHeaders) width = Math.max(width, header.x + header.w + MARGIN);
			const bandIndexOf = new Map(bands.map((band, index) => [band.id, index]));
			const routed = [];
			for (const edge of working.edges) {
				const a = byId.get(edge.from);
				const b = byId.get(edge.to);
				if (a === void 0 || b === void 0) continue;
				const si = bandIndexOf.get(a.node.layer);
				const ti = bandIndexOf.get(b.node.layer);
				if (si === void 0 || ti === void 0 || ti <= si) continue;
				routed.push({
					from: edge.from,
					to: edge.to,
					a,
					b,
					label: edge.label,
					si,
					ti,
					sx: a.x + a.w / 2,
					ex: b.x + b.w / 2
				});
			}
			const claimed = /* @__PURE__ */ new Map();
			const isFree = (box, x) => (claimed.get(box) ?? []).every((taken) => Math.abs(taken - x) >= SEAT_MIN);
			const claim = (box, x) => {
				claimed.set(box, [...claimed.get(box) ?? [], x]);
				return x;
			};
			const freeColumn = (ideal, lo, hi, ok) => {
				for (let d = 0; d * SEAT_STEP <= hi - lo; d++) for (const x of d === 0 ? [ideal] : [ideal - d * SEAT_STEP, ideal + d * SEAT_STEP]) if (x >= lo && x <= hi && ok(x)) return x;
			};
			for (const wire of routed) {
				if (wire.ti - wire.si !== 1) continue;
				const lo = Math.max(wire.a.x, wire.b.x) + EDGE_INSET;
				const hi = Math.min(wire.a.x + wire.a.w, wire.b.x + wire.b.w) - EDGE_INSET;
				if (lo > hi) continue;
				const x = freeColumn(Math.round((lo + hi) / 2), lo, hi, (c) => isFree(wire.a, c) && isFree(wire.b, c));
				if (x !== void 0) {
					wire.straightX = claim(wire.b, claim(wire.a, x));
					wire.sx = x;
					wire.ex = x;
				}
			}
			const bent = routed.filter((wire) => wire.straightX === void 0);
			const fan = (groupOf, counterpartX, boxOf, assign) => {
				const groups = /* @__PURE__ */ new Map();
				for (const wire of bent) {
					const key = groupOf(wire);
					groups.set(key, [...groups.get(key) ?? [], wire]);
				}
				for (const wires of groups.values()) {
					wires.sort((m, n) => counterpartX(m) - counterpartX(n));
					wires.forEach((wire, index) => {
						const box = boxOf(wire);
						const ideal = Math.round(box.x + box.w * ((index + 1) / (wires.length + 1)));
						assign(wire, claim(box, freeColumn(ideal, box.x + EDGE_INSET, box.x + box.w - EDGE_INSET, (c) => isFree(box, c)) ?? ideal));
					});
				}
			};
			fan((wire) => wire.from, (wire) => wire.b.x + wire.b.w / 2, (wire) => wire.a, (wire, x) => {
				wire.sx = x;
			});
			fan((wire) => wire.to, (wire) => wire.a.x + wire.a.w / 2, (wire) => wire.b, (wire, x) => {
				wire.ex = x;
			});
			const descents = [];
			let fallbackCount = 0;
			const blockedByBox = (band, x) => (bandMembers[band] ?? []).some((box) => x >= box.x - THREAD_CLEAR && x <= box.x + box.w + THREAD_CLEAR);
			for (const wire of bent) {
				if (wire.ti - wire.si <= 1) continue;
				let chosen;
				const lo = MARGIN;
				const hi = width - MARGIN;
				for (let d = 0; chosen === void 0 && d * THREAD_STEP <= hi - lo; d++) for (const c of d === 0 ? [wire.ex] : [wire.ex - d * THREAD_STEP, wire.ex + d * THREAD_STEP]) {
					if (c < lo || c > hi) continue;
					if (descents.some((taken) => Math.abs(taken - c) < THREAD_SEP)) continue;
					let hit = false;
					for (let band = wire.si + 1; band < wire.ti && !hit; band++) hit = blockedByBox(band, c);
					if (!hit) {
						chosen = c;
						break;
					}
				}
				if (chosen === void 0) chosen = width - MARGIN + THREAD_FALLBACK_PAD + fallbackCount++ * THREAD_SEP;
				descents.push(chosen);
				wire.cx = chosen;
			}
			const widthFinal = Math.max(width, ...descents.map((c) => c + MARGIN));
			const runs = [];
			const runsOf = /* @__PURE__ */ new Map();
			for (const wire of bent) if (wire.cx === void 0) {
				const landing = {
					wire,
					gap: wire.si,
					lo: Math.min(wire.sx, wire.ex),
					hi: Math.max(wire.sx, wire.ex),
					row: 0
				};
				runs.push(landing);
				runsOf.set(wire, { landing });
			} else {
				const entry = {
					wire,
					gap: wire.si,
					lo: Math.min(wire.sx, wire.cx),
					hi: Math.max(wire.sx, wire.cx),
					row: 0
				};
				const landing = {
					wire,
					gap: wire.ti - 1,
					lo: Math.min(wire.cx, wire.ex),
					hi: Math.max(wire.cx, wire.ex),
					row: 0
				};
				runs.push(entry, landing);
				runsOf.set(wire, {
					entry,
					landing
				});
			}
			const gapRows = Array.from({ length: Math.max(0, bands.length - 1) }, () => 0);
			for (let gap = 0; gap < gapRows.length; gap++) {
				const rowEnds = [];
				for (const run of runs.filter((r) => r.gap === gap).sort((m, n) => m.lo - n.lo)) {
					const row = rowEnds.findIndex((end) => run.lo > end + TRACK_CLEARANCE);
					if (row === -1) {
						rowEnds.push(run.hi);
						run.row = rowEnds.length - 1;
					} else {
						rowEnds[row] = Math.max(rowEnds[row] ?? run.hi, run.hi);
						run.row = row;
					}
				}
				gapRows[gap] = rowEnds.length;
			}
			const bandRules = [];
			const gapTop = [];
			let y = MARGIN + (laneCount > 0 ? LANE_HEADER_H : 0);
			bands.forEach((band, index) => {
				const row = bandMembers[index] ?? [];
				const done = row.filter((box) => box.node.status === "done").length;
				bandRules.push({
					name: band.name,
					y: y + BAND_LABEL_H / 2,
					...withCounts && row.length > 0 ? { counts: `${done}/${row.length}` } : {}
				});
				y += BAND_LABEL_H;
				const rowH = Math.max(0, ...row.map((box) => box.h));
				for (const box of row) box.y = y;
				y += row.length > 0 ? rowH : 0;
				if (index < bands.length - 1) {
					gapTop.push(y);
					const tracks = gapRows[index] ?? 0;
					y += tracks === 0 ? GAP_EMPTY : GAP_BREATHE_TOP + tracks * TRACK_H + GAP_BREATHE_BOTTOM;
				}
			});
			const height = bands.length === 0 ? MARGIN * 2 : y + MARGIN;
			const boxes = placed;
			const trackY = (run) => (gapTop[run.gap] ?? 0) + GAP_BREATHE_TOP + (run.row + .5) * TRACK_H;
			const edges = [];
			for (const wire of routed) {
				const y1 = wire.a.y + wire.a.h;
				const y2 = wire.b.y;
				if (wire.straightX !== void 0) {
					const x = wire.straightX;
					const midY = (y1 + y2) / 2;
					edges.push({
						from: wire.from,
						to: wire.to,
						x1: x,
						y1,
						x2: x,
						y2,
						midY,
						points: [[x, y1], [x, y2]],
						label: wire.label,
						labelX: x + 6 + (wire.label !== void 0 ? estimateTextWidth(wire.label) / 2 : 0),
						labelY: midY + 3
					});
					continue;
				}
				const wireRuns = runsOf.get(wire);
				if (wireRuns === void 0) continue;
				if (wire.cx === void 0) {
					const midY = trackY(wireRuns.landing);
					edges.push({
						from: wire.from,
						to: wire.to,
						x1: wire.sx,
						y1,
						x2: wire.ex,
						y2,
						midY,
						points: [
							[wire.sx, y1],
							[wire.sx, midY],
							[wire.ex, midY],
							[wire.ex, y2]
						],
						label: wire.label,
						labelX: (wire.sx + wire.ex) / 2,
						labelY: midY - 4
					});
				} else {
					const entryY = wireRuns.entry === void 0 ? trackY(wireRuns.landing) : trackY(wireRuns.entry);
					const exitY = trackY(wireRuns.landing);
					edges.push({
						from: wire.from,
						to: wire.to,
						x1: wire.sx,
						y1,
						x2: wire.ex,
						y2,
						midY: entryY,
						points: [
							[wire.sx, y1],
							[wire.sx, entryY],
							[wire.cx, entryY],
							[wire.cx, exitY],
							[wire.ex, exitY],
							[wire.ex, y2]
						],
						label: wire.label,
						labelX: (wire.sx + wire.cx) / 2,
						labelY: entryY - 4
					});
				}
			}
			return {
				width: widthFinal,
				height,
				bands: bandRules,
				boxes,
				edges,
				lanes: laneHeaders,
				neutral,
				aggregated: aggregated !== void 0
			};
		}
		//#endregion
		//#region lib/types/client/wheel.js
		/**
		* Wheel-to-scale: continuous exponential zoom, the canvas-app native feel.
		*
		* Real devices disagree wildly on wheel granularity — a mouse emits one
		* ~100px pixel-mode event per detent (line-mode browsers report whole
		* lines), a touchpad emits dozens of tiny events per flick plus a decaying
		* momentum tail, and a pinch arrives as ctrl+wheel with tiny deltas. An
		* exponential factor per event absorbs all of that by construction: equal
		* travel means equal zoom ratio regardless of how many events carry it, a
		* momentum tail decays into ever-smaller ratios instead of drilling on, and
		* no step quantization exists to slam.
		*/
		/** Pixel worth of one line/page-mode unit (the classic wheel-line height). */
		const LINE_PX = 40;
		/** e-fold zoom per pixel of wheel travel: one ~100px detent ≈ ×1.16. */
		const ZOOM_RATE = .0015;
		/** Pinch ctrl+wheel deltas are tiny but deliberate; zoom faster per pixel. */
		const PINCH_RATE = .005;
		/**
		* The multiplicative scale factor one wheel event contributes.
		* @param event - wheel facts of the incoming event.
		* @returns factor > 1 for wheel-up (zoom in), < 1 for wheel-down, 1 for zero delta.
		*/
		function wheelScaleFactor(event) {
			const px = event.deltaMode === 0 ? event.deltaY : event.deltaY * LINE_PX;
			return Math.exp(-px * (event.ctrlKey ? PINCH_RATE : ZOOM_RATE));
		}
		/**
		* Fold one read result into the held page set: a page that fails to parse
		* keeps its last good map (`error` still reported), and a background page
		* whose file moved becomes fresh until viewed. The startup read marks
		* nothing fresh — existing state is not news.
		* @param prev - pages as currently held (empty on the first read).
		* @param result - the incoming whole-store read.
		* @param activeKey - the page currently on screen (never marked fresh).
		* @returns the next held page set, in store order.
		*/
		function mergePages(prev, result, activeKey) {
			const first = prev.length === 0;
			return result.pages.map((page) => {
				const key = page.page ?? "";
				const old = prev.find((entry) => entry.key === key);
				const map = page.map != null ? page.map : old?.map;
				const moved = old !== void 0 && page.mtimeMs !== old.mtimeMs;
				const fresh = !first && key !== activeKey && ((old?.fresh ?? false) || moved || old === void 0);
				return {
					key,
					map,
					error: page.error,
					mtimeMs: page.mtimeMs,
					fresh
				};
			});
		}
		/** Mark one page viewed: its fresh light goes out. */
		function markViewed(pages, key) {
			return pages.map((page) => page.key === key && page.fresh ? {
				...page,
				fresh: false
			} : page);
		}
		/**
		* Keys whose files moved between two held sets — auto-follow's candidates.
		* The first read reports nothing: existing state is not news to follow.
		* @param prev - pages as held before the read (empty on the first).
		* @param next - pages as held after the read.
		* @returns changed keys in store order.
		*/
		function changedKeys(prev, next) {
			if (prev.length === 0) return [];
			return next.filter((page) => {
				const old = prev.find((entry) => entry.key === page.key);
				return old === void 0 || old.mtimeMs !== page.mtimeMs;
			}).map((page) => page.key);
		}
		/**
		* Keys that deserve a sibling tab: pages NO node of any page dives into.
		* The default page is never hidden.
		* @param pages - the held page set.
		* @returns top-level keys in store order.
		*/
		function topLevelKeys(pages) {
			const refs = submapRefs(pages.map((page) => page.map));
			return pages.filter((page) => page.key === "" || !refs.has(page.key)).map((page) => page.key);
		}
		/**
		* The page to show: the current choice while it still exists, else the most
		* recently written top-level page (the effort under way), else the first.
		* @param pages - the held page set.
		* @param currentKey - the page currently chosen, if any.
		* @returns the resolved active key, or undefined for an empty store.
		*/
		function resolveActiveKey(pages, currentKey) {
			if (currentKey !== void 0 && pages.some((page) => page.key === currentKey)) return currentKey;
			return mostRecentKey(topLevelKeys(pages), (key) => pages.find((page) => page.key === key)?.mtimeMs ?? void 0);
		}
		/**
		* Sibling tabs over the top-level pages, in store order.
		* @param pages - the held page set.
		* @param activeKey - the page on screen.
		* @returns tab view models.
		*/
		function pageTabs(pages, activeKey) {
			const refs = submapRefs(pages.map((page) => page.map));
			return pages.filter((entry) => entry.key === "" || !refs.has(entry.key)).map((entry) => ({
				key: entry.key,
				title: entry.map?.title,
				status: entry.map !== void 0 ? mapStatus(entry.map) : "planned",
				active: entry.key === activeKey,
				fresh: entry.fresh,
				neutral: entry.map !== void 0 && isNeutralKind(entry.map)
			}));
		}
		/**
		* The breadcrumb of a dived-into page: the linking parent and node label,
		* derived by scan so it survives any remount with an empty dive stack.
		* @param pages - the held page set.
		* @param activeKey - the page on screen.
		* @returns the origin, or undefined while a top-level page is active.
		*/
		function breadcrumbOf(pages, activeKey) {
			if (topLevelKeys(pages).includes(activeKey)) return void 0;
			const origin = diveParent(pages.filter((page) => page.key !== activeKey).map((page) => [page.key, page.map]), activeKey);
			if (origin === void 0) return void 0;
			return {
				parentKey: origin.parent,
				parentTitle: pages.find((page) => page.key === origin.parent)?.map?.title,
				label: origin.label
			};
		}
		//#endregion
		//#region lib/types/client/DetailPanel.js
		/** One neighbour chip: status-colored dot, label, and what flows on the edge. */
		function NeighborChip({ neighbor }) {
			return (0, react_jsx_runtime.jsxs)("span", {
				className: MmapView_module_css_default.chip,
				"data-status": neighbor.status,
				children: [neighbor.label, neighbor.edgeLabel !== void 0 ? (0, react_jsx_runtime.jsxs)("em", { children: [
					"(",
					neighbor.edgeLabel,
					")"
				] }) : null]
			});
		}
		/** A `word → chips` wire-direction row. */
		function WireRow({ word, refs, t }) {
			return (0, react_jsx_runtime.jsxs)("p", {
				className: MmapView_module_css_default.wireRow,
				children: [(0, react_jsx_runtime.jsx)("span", {
					className: MmapView_module_css_default.detailKey,
					children: word
				}), refs.length === 0 ? t("none") : refs.map((r) => (0, react_jsx_runtime.jsx)(NeighborChip, { neighbor: r }, r.id))]
			});
		}
		/**
		* The resident three-state panel the terminal pane keeps below the map:
		* a focused node (status header, evidence, both wire directions, notes), a
		* focused group (members plus outside-the-group wires), or — with nothing
		* focused — the map dashboard. Never floats over the map.
		*/
		function DetailPanel({ map, focus, pinned, t }) {
			const info = focus === null ? void 0 : focusInfo(map, focus);
			const neutral = isNeutralKind(map);
			const [usesWord, usedByWord] = map.kind === "sequence" ? [t("after"), t("before")] : [t("uses"), t("usedBy")];
			if (info === void 0) {
				const count = (status) => map.nodes.filter((n) => n.status === status).length;
				const parts = [
					`${map.layers.length} ${t("unit.layers")}`,
					`${map.nodes.length} ${t("unit.nodes")}`,
					`${map.edges.length} ${t("unit.edges")}`,
					...map.lanes.length > 0 ? [`${map.lanes.length} ${t("unit.lanes")}`] : []
				];
				return (0, react_jsx_runtime.jsxs)("div", {
					className: MmapView_module_css_default.panelBody,
					children: [
						(0, react_jsx_runtime.jsx)("p", {
							className: MmapView_module_css_default.panelTitle,
							children: map.title ?? "mellos map"
						}),
						(0, react_jsx_runtime.jsx)("p", {
							className: MmapView_module_css_default.panelMeta,
							children: parts.join(" · ")
						}),
						neutral ? (0, react_jsx_runtime.jsx)("p", {
							className: MmapView_module_css_default.panelMeta,
							children: map.kind
						}) : (0, react_jsx_runtime.jsx)("p", {
							className: MmapView_module_css_default.statusCounts,
							children: [
								"done",
								"in-progress",
								"planned",
								"regressed"
							].filter((status) => count(status) > 0).map((status) => (0, react_jsx_runtime.jsxs)("span", {
								"data-status": status,
								children: [
									count(status),
									" ",
									t(`status.${status}`)
								]
							}, status))
						}),
						(0, react_jsx_runtime.jsx)("p", {
							className: MmapView_module_css_default.panelHint,
							children: t("dashboardHint")
						})
					]
				});
			}
			if (info.kind === "group") return (0, react_jsx_runtime.jsxs)("div", {
				className: MmapView_module_css_default.panelBody,
				children: [
					(0, react_jsx_runtime.jsxs)("p", {
						className: MmapView_module_css_default.panelHeader,
						"data-status": info.status,
						children: [
							info.group.label,
							" ",
							(0, react_jsx_runtime.jsxs)("code", { children: [
								"[",
								info.group.id,
								"]"
							] }),
							" · ",
							info.layerName,
							" · ",
							t(`status.${info.status}`),
							" ",
							"· ",
							info.members.length,
							" ",
							t("unit.members"),
							pinned ? (0, react_jsx_runtime.jsx)("span", {
								className: MmapView_module_css_default.pinMark,
								children: t("pinned")
							}) : null
						]
					}),
					(0, react_jsx_runtime.jsxs)("p", {
						className: MmapView_module_css_default.wireRow,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: MmapView_module_css_default.detailKey,
							children: t("members")
						}), info.members.map((member) => (0, react_jsx_runtime.jsx)("span", {
							className: MmapView_module_css_default.chip,
							"data-status": member.status,
							children: member.label
						}, member.id))]
					}),
					(0, react_jsx_runtime.jsx)(WireRow, {
						word: usesWord,
						refs: info.uses,
						t
					}),
					(0, react_jsx_runtime.jsx)(WireRow, {
						word: usedByWord,
						refs: info.usedBy,
						t
					})
				]
			});
			const { node } = info;
			const headParts = [
				info.layerName,
				...info.laneLabel !== void 0 ? [info.laneLabel] : [],
				...node.kind !== void 0 ? [node.kind] : [],
				...neutral ? [] : [t(`status.${node.status}`)],
				...node.submap !== void 0 ? [`⊞ ${node.submap}`] : []
			];
			return (0, react_jsx_runtime.jsxs)("div", {
				className: MmapView_module_css_default.panelBody,
				children: [
					(0, react_jsx_runtime.jsxs)("p", {
						className: MmapView_module_css_default.panelHeader,
						"data-status": neutral ? "neutral" : node.status,
						children: [
							node.label,
							" ",
							(0, react_jsx_runtime.jsxs)("code", { children: [
								"[",
								node.id,
								"]"
							] }),
							" · ",
							headParts.join(" · "),
							pinned ? (0, react_jsx_runtime.jsx)("span", {
								className: MmapView_module_css_default.pinMark,
								children: t("pinned")
							}) : null
						]
					}),
					neutral ? null : (0, react_jsx_runtime.jsx)("p", {
						className: MmapView_module_css_default.panelMeta,
						children: node.evidence !== void 0 ? `${t("evidence")}: ${node.evidence}` : t("noEvidence")
					}),
					(0, react_jsx_runtime.jsx)(WireRow, {
						word: usesWord,
						refs: info.uses,
						t
					}),
					(0, react_jsx_runtime.jsx)(WireRow, {
						word: usedByWord,
						refs: info.usedBy,
						t
					}),
					(0, react_jsx_runtime.jsx)("p", {
						className: MmapView_module_css_default.panelNotes,
						children: node.detail ?? t("noNotes")
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/MapSvg.js
		/**
		* Draw one computed layout as a layered SVG: lane headers, band rules with
		* names (and far-zoom member counts), status-skinned node boxes with their
		* unfolded detail lines and ⊞ submap badges, and downward orthogonal wires
		* routed with the terminal pane's preference — straight drops, packed track
		* runs, threaded descents — labels riding the primary run. The skins port the terminal
		* pane's border weights: the heavy square ┏━┓ of done/regressed becomes a
		* sharp 2px corner, the dashed rounded ╭╌╮ of planned stays soft.
		* The focused node's box and every wire touching it render bright. Pure
		* function of props — selection and hover live with the caller.
		*/
		function MapSvg({ layout, scale, focus, selected, onHover, onSelect, onDive }) {
			return (0, react_jsx_runtime.jsxs)("svg", {
				className: MmapView_module_css_default.map,
				viewBox: `0 0 ${layout.width} ${layout.height}`,
				width: layout.width * scale,
				height: layout.height * scale,
				role: "img",
				onClick: () => {
					onSelect(null);
				},
				children: [
					layout.lanes.map((lane) => (0, react_jsx_runtime.jsxs)("g", {
						className: MmapView_module_css_default.lane,
						children: [(0, react_jsx_runtime.jsx)("text", {
							x: lane.x + lane.w / 2,
							y: 14,
							textAnchor: "middle",
							children: lane.label
						}), (0, react_jsx_runtime.jsx)("line", {
							x1: lane.x + lane.w / 2,
							y1: 20,
							x2: lane.x + lane.w / 2,
							y2: layout.height
						})]
					}, `lane:${lane.x}`)),
					layout.bands.map((band) => (0, react_jsx_runtime.jsxs)("g", {
						className: MmapView_module_css_default.band,
						children: [(0, react_jsx_runtime.jsx)("line", {
							x1: 0,
							y1: band.y,
							x2: layout.width,
							y2: band.y
						}), (0, react_jsx_runtime.jsx)("text", {
							x: 8,
							y: band.y - 5,
							children: band.counts !== void 0 ? `${band.name} ${band.counts}` : band.name
						})]
					}, `${band.name}:${band.y}`)),
					(0, react_jsx_runtime.jsx)("defs", { children: (0, react_jsx_runtime.jsx)("marker", {
						id: "mmap-arrow",
						viewBox: "0 0 8 8",
						refX: "6.5",
						refY: "4",
						markerWidth: "6.5",
						markerHeight: "6.5",
						orient: "auto-start-reverse",
						children: (0, react_jsx_runtime.jsx)("path", {
							d: "M 0 0 L 8 4 L 0 8 z",
							fill: "context-stroke",
							stroke: "none"
						})
					}) }),
					layout.edges.map((edge) => (0, react_jsx_runtime.jsxs)("g", {
						className: MmapView_module_css_default.edge,
						"data-active": focus === edge.from || focus === edge.to ? "true" : void 0,
						children: [(0, react_jsx_runtime.jsx)("path", {
							d: edge.points.map((point, index) => `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`).join(" "),
							markerEnd: "url(#mmap-arrow)"
						}), edge.label !== void 0 ? (0, react_jsx_runtime.jsx)("text", {
							x: edge.labelX,
							y: edge.labelY,
							children: edge.label
						}) : null]
					}, `${edge.from}->${edge.to}`)),
					layout.boxes.map((box) => (0, react_jsx_runtime.jsxs)("g", {
						className: MmapView_module_css_default.node,
						transform: `translate(${box.x} ${box.y})`,
						"data-status": layout.neutral ? "neutral" : box.node.status,
						"data-selected": selected === box.node.id ? "true" : void 0,
						"data-focused": focus === box.node.id ? "true" : void 0,
						onPointerEnter: () => {
							onHover(box.node.id);
						},
						onPointerLeave: () => {
							onHover(null);
						},
						onClick: (event) => {
							event.stopPropagation();
							onSelect(box.node.id);
						},
						onDoubleClick: (event) => {
							event.stopPropagation();
							onDive(box.node.id);
						},
						children: [
							(0, react_jsx_runtime.jsx)("rect", {
								x: 0,
								y: 0,
								width: box.w,
								height: box.h,
								rx: !layout.neutral && (box.node.status === "done" || box.node.status === "regressed") ? 0 : 6
							}),
							box.lines.map((line, index) => (0, react_jsx_runtime.jsx)("text", {
								className: MmapView_module_css_default.boxLine,
								"data-role": line.role,
								x: line.role === "label" ? box.w / 2 : 10,
								y: 12 + index * 17 + (line.role === "label" ? 3 : 2),
								textAnchor: line.role === "label" ? "middle" : "start",
								children: line.text
							}, `${line.role}:${index}`)),
							box.node.submap !== void 0 ? (0, react_jsx_runtime.jsx)("text", {
								className: MmapView_module_css_default.submapBadge,
								x: box.w - 10,
								y: 13,
								children: "⊞"
							}) : null
						]
					}, box.node.id))
				]
			});
		}
		//#endregion
		//#region lib/types/client/MmapView.js
		/** Keyboard zoom ratio per +/- press. */
		const KEY_ZOOM = 1.25;
		/** Render the live Mellos map of this session's workspace. */
		function MmapView(props) {
			const { read, autoOpen, t, useStore, actions } = props;
			const revision = props.useMmapRevision((value) => value);
			const [fetchState, setFetchState] = (0, react.useState)("loading");
			const [pages, setPages] = (0, react.useState)([]);
			const [retries, setRetries] = (0, react.useState)(0);
			const [scale, setScale] = (0, react.useState)(1);
			const [selected, setSelected] = (0, react.useState)(null);
			const [hover, setHover] = (0, react.useState)(null);
			const [flash, setFlash] = (0, react.useState)(null);
			const chosenKey = useStore((s) => s.chosenKey);
			const follow = useStore((s) => s.follow);
			const panelH = useStore((s) => s.panelH);
			const views = useStore((s) => s.views);
			const scrollRef = (0, react.useRef)(null);
			const pagesRef = (0, react.useRef)([]);
			const followRef = (0, react.useRef)(follow);
			followRef.current = follow;
			const viewsRef = (0, react.useRef)(views);
			viewsRef.current = views;
			const scaleRef = (0, react.useRef)(scale);
			scaleRef.current = scale;
			const selectedRef = (0, react.useRef)(selected);
			selectedRef.current = selected;
			const diveStackRef = (0, react.useRef)([]);
			const activeKeyRef = (0, react.useRef)(void 0);
			const chosenRef = (0, react.useRef)(void 0);
			chosenRef.current = chosenKey;
			const openedRef = (0, react.useRef)(false);
			/** Last ok read found a resolved workspace with zero pages (a true empty store). */
			const emptyStoreRef = (0, react.useRef)(false);
			const dragRef = (0, react.useRef)(null);
			const swallowClickRef = (0, react.useRef)(false);
			const zoomAnchorRef = (0, react.useRef)(null);
			const activeKey = resolveActiveKey(pages, chosenKey);
			activeKeyRef.current = activeKey;
			const active = pages.find((page) => page.key === activeKey);
			const activeMap = active?.map;
			const stepRef = (0, react.useRef)(stepForScale(scale));
			const step = stepForScale(scale, stepRef.current);
			stepRef.current = step;
			const layout = (0, react.useMemo)(() => activeMap === void 0 ? void 0 : computeLayout(activeMap, step), [activeMap, step]);
			const focus = hover ?? selected;
			const tabs = (0, react.useMemo)(() => pageTabs(pages, activeKey), [activeKey, pages]);
			const crumb = activeKey === void 0 ? void 0 : breadcrumbOf(pages, activeKey);
			const failsRef = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				let current = true;
				let retryTimer;
				const scheduleRetry = () => {
					failsRef.current += 1;
					const delay = Math.min(1e4, 1e3 * 2 ** (failsRef.current - 1));
					retryTimer = setTimeout(() => {
						setRetries((value) => value + 1);
					}, delay);
				};
				Promise.resolve().then(() => read()).then((result) => {
					if (!current) return;
					setFetchState("ready");
					const prev = pagesRef.current;
					const next = mergePages(prev, result, activeKeyRef.current);
					pagesRef.current = next;
					setPages(next);
					const top = new Set(topLevelKeys(next));
					const hidden = next.find((page) => page.fresh && !top.has(page.key) && !(prev.find((old) => old.key === page.key)?.fresh ?? false));
					if (hidden !== void 0) setFlash(`⊞ ${hidden.map?.title ?? hidden.key}`);
					const changed = changedKeys(prev, next);
					const born = emptyStoreRef.current && next.length > 0;
					if ((changed.length > 0 || born) && !openedRef.current) {
						openedRef.current = true;
						autoOpen();
					}
					emptyStoreRef.current = result.cwd !== null && result.pages.length === 0;
					if (followRef.current && changed.length > 0 && dragRef.current === null) {
						const target = mostRecentKey(changed, (key) => next.find((page) => page.key === key)?.mtimeMs ?? void 0);
						if (target !== void 0 && target !== activeKeyRef.current) switchPageRef.current(target);
					}
					const resolved = resolveActiveKey(pagesRef.current, chosenRef.current);
					if (resolved !== void 0 && resolved !== chosenRef.current) {
						chosenRef.current = resolved;
						actions.choosePage(resolved);
						pagesRef.current = markViewed(pagesRef.current, resolved);
						setPages(pagesRef.current);
					}
					if (result.cwd === null || result.pages.length === 0) scheduleRetry();
					else failsRef.current = 0;
				}, (error) => {
					if (!current) return;
					console.warn("mmap: read failed", error);
					setFetchState("error");
					scheduleRetry();
				});
				return () => {
					current = false;
					if (retryTimer !== void 0) clearTimeout(retryTimer);
				};
			}, [
				actions,
				autoOpen,
				read,
				revision,
				retries,
				props.sessionId
			]);
			(0, react.useEffect)(() => {
				if (flash === null) return;
				const timer = setTimeout(() => {
					setFlash(null);
				}, 4e3);
				return () => {
					clearTimeout(timer);
				};
			}, [flash]);
			const switchPage = (0, react.useCallback)((key) => {
				const el = scrollRef.current;
				const from = activeKeyRef.current;
				if (from !== void 0) actions.parkView(from, {
					scale,
					selected,
					scrollX: el?.scrollLeft ?? 0,
					scrollY: el?.scrollTop ?? 0
				});
				const view = viewsRef.current[key];
				chosenRef.current = key;
				actions.choosePage(key);
				setScale(view === void 0 ? 1 : clampScale(view.scale));
				setSelected(view?.selected ?? null);
				setHover(null);
				pagesRef.current = markViewed(pagesRef.current, key);
				setPages(pagesRef.current);
				requestAnimationFrame(() => {
					const target = scrollRef.current;
					if (target !== null) {
						target.scrollLeft = view?.scrollX ?? 0;
						target.scrollTop = view?.scrollY ?? 0;
					}
				});
			}, [
				actions,
				selected,
				scale
			]);
			const switchPageRef = (0, react.useRef)(switchPage);
			switchPageRef.current = switchPage;
			/**
			* A page switch the USER made — it turns auto-follow off: a view that
			* yanks back while its user deliberately looks elsewhere would make
			* follow its own enemy.
			*/
			const manualSwitch = (0, react.useCallback)((key) => {
				if (followRef.current) {
					actions.setFollow(false);
					setFlash(t("followOff"));
				}
				switchPage(key);
			}, [
				actions,
				switchPage,
				t
			]);
			const toggleFollow = (0, react.useCallback)(() => {
				const next = !followRef.current;
				actions.setFollow(next);
				setFlash(next ? t("followOn") : t("followOff"));
			}, [actions, t]);
			const climbBack = (0, react.useCallback)(() => {
				const stack = diveStackRef.current;
				let parent = stack.pop();
				while (parent !== void 0 && !pages.some((page) => page.key === parent)) parent = stack.pop();
				parent ??= activeKey === void 0 ? void 0 : breadcrumbOf(pages, activeKey)?.parentKey;
				if (parent !== void 0 && parent !== activeKey) {
					manualSwitch(parent);
					return true;
				}
				return false;
			}, [
				activeKey,
				manualSwitch,
				pages
			]);
			const dive = (0, react.useCallback)((id) => {
				const submap = activeMap?.nodes.find((node) => node.id === id)?.submap;
				if (submap === void 0) return;
				if (pages.some((page) => page.key === submap)) {
					if (activeKey !== void 0) diveStackRef.current.push(activeKey);
					manualSwitch(submap);
				} else setFlash(`${t("submapMissing")}: ${submap}`);
			}, [
				activeKey,
				activeMap,
				manualSwitch,
				pages,
				t
			]);
			const applyScale = (0, react.useCallback)((next, clientX, clientY) => {
				const el = scrollRef.current;
				if (next === scale || el === null || layout === void 0) return;
				const box = el.getBoundingClientRect();
				const ax = clientX !== void 0 ? clientX - box.left : el.clientWidth / 2;
				const ay = clientY !== void 0 ? clientY - box.top : el.clientHeight / 2;
				const cx = (el.scrollLeft + ax) / scale;
				const cy = (el.scrollTop + ay) / scale;
				const anchorId = stepForScale(next, stepRef.current) === stepRef.current ? void 0 : focus ?? layout.boxes.find((b) => cx >= b.x && cx < b.x + b.w && cy >= b.y && cy < b.y + b.h)?.node.id;
				const anchorBox = anchorId === void 0 ? void 0 : layout.boxes.find((b) => b.node.id === anchorId);
				zoomAnchorRef.current = {
					id: anchorId,
					kinId: anchorId === void 0 || activeMap === void 0 ? void 0 : layout.aggregated ? activeMap.nodes.find((node) => node.group === anchorId)?.id : activeMap.nodes.find((node) => node.id === anchorId)?.group,
					screenX: anchorBox !== void 0 ? (anchorBox.x + anchorBox.w / 2) * scale - el.scrollLeft : ax,
					screenY: anchorBox !== void 0 ? (anchorBox.y + anchorBox.h / 2) * scale - el.scrollTop : ay,
					cx,
					cy
				};
				setScale(next);
			}, [
				activeMap,
				focus,
				layout,
				scale
			]);
			(0, react.useLayoutEffect)(() => {
				const anchor = zoomAnchorRef.current;
				const el = scrollRef.current;
				if (anchor === null || el === null || layout === void 0) return;
				zoomAnchorRef.current = null;
				const boxOf = (id) => id === void 0 ? void 0 : layout.boxes.find((b) => b.node.id === id);
				const after = boxOf(anchor.id) ?? boxOf(anchor.kinId);
				if (after !== void 0) {
					el.scrollLeft = Math.max(0, (after.x + after.w / 2) * scale - anchor.screenX);
					el.scrollTop = Math.max(0, (after.y + after.h / 2) * scale - anchor.screenY);
				} else {
					el.scrollLeft = Math.max(0, anchor.cx * scale - anchor.screenX);
					el.scrollTop = Math.max(0, anchor.cy * scale - anchor.screenY);
				}
			}, [layout, scale]);
			(0, react.useEffect)(() => {
				const el = scrollRef.current;
				if (el === null) return;
				const onWheel = (event) => {
					if (event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
					event.preventDefault();
					applyScale(clampScale(scale * wheelScaleFactor(event)), event.clientX, event.clientY);
				};
				el.addEventListener("wheel", onWheel, { passive: false });
				return () => {
					el.removeEventListener("wheel", onWheel);
				};
			}, [applyScale, scale]);
			const onPointerDown = (0, react.useCallback)((event) => {
				if (event.button !== 0) return;
				const el = scrollRef.current;
				if (el === null) return;
				swallowClickRef.current = false;
				dragRef.current = {
					x: event.clientX,
					y: event.clientY,
					sl: el.scrollLeft,
					st: el.scrollTop,
					moved: false
				};
			}, []);
			const autoPanRef = (0, react.useRef)(null);
			const overshootRef = (0, react.useRef)({
				x: 0,
				y: 0
			});
			const lastPointerAt = (0, react.useRef)(0);
			const stopAutoPan = (0, react.useCallback)(() => {
				if (autoPanRef.current !== null) cancelAnimationFrame(autoPanRef.current);
				autoPanRef.current = null;
				overshootRef.current = {
					x: 0,
					y: 0
				};
			}, []);
			(0, react.useEffect)(() => stopAutoPan, [stopAutoPan]);
			const ensureAutoPan = (0, react.useCallback)(() => {
				if (autoPanRef.current !== null) return;
				const tick = () => {
					const el = scrollRef.current;
					const drag = dragRef.current;
					const { x, y } = overshootRef.current;
					if (el === null || drag === null || x === 0 && y === 0) {
						autoPanRef.current = null;
						return;
					}
					if (performance.now() - lastPointerAt.current < 150) {
						autoPanRef.current = requestAnimationFrame(tick);
						return;
					}
					const stepX = Math.max(-24, Math.min(24, x * .2));
					const stepY = Math.max(-24, Math.min(24, y * .2));
					const beforeX = el.scrollLeft;
					const beforeY = el.scrollTop;
					el.scrollLeft -= stepX;
					el.scrollTop -= stepY;
					drag.sl += el.scrollLeft - beforeX;
					drag.st += el.scrollTop - beforeY;
					autoPanRef.current = requestAnimationFrame(tick);
				};
				autoPanRef.current = requestAnimationFrame(tick);
			}, []);
			const endDrag = (0, react.useCallback)((event) => {
				if (dragRef.current === null) return;
				stopAutoPan();
				swallowClickRef.current = dragRef.current.moved;
				dragRef.current = null;
				const el = scrollRef.current;
				if (el !== null && el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
			}, [stopAutoPan]);
			const onPointerMove = (0, react.useCallback)((event) => {
				const drag = dragRef.current;
				const el = scrollRef.current;
				if (drag === null || el === null) return;
				if (event.buttons === 0) {
					endDrag(event);
					return;
				}
				lastPointerAt.current = performance.now();
				const dx = event.clientX - drag.x;
				const dy = event.clientY - drag.y;
				if (!drag.moved) {
					if (Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return;
					drag.moved = true;
					el.setPointerCapture(event.pointerId);
				}
				el.scrollLeft = drag.sl - dx;
				el.scrollTop = drag.st - dy;
				drag.sl = el.scrollLeft + dx;
				drag.st = el.scrollTop + dy;
				const rect = el.getBoundingClientRect();
				overshootRef.current = {
					x: event.clientX < rect.left ? event.clientX - rect.left : event.clientX > rect.right ? event.clientX - rect.right : 0,
					y: event.clientY < rect.top ? event.clientY - rect.top : event.clientY > rect.bottom ? event.clientY - rect.bottom : 0
				};
				if (overshootRef.current.x !== 0 || overshootRef.current.y !== 0) ensureAutoPan();
			}, [endDrag, ensureAutoPan]);
			const onClickCapture = (0, react.useCallback)((event) => {
				if (swallowClickRef.current) {
					swallowClickRef.current = false;
					event.stopPropagation();
					event.preventDefault();
				}
			}, []);
			const onKeyDown = (0, react.useCallback)((event) => {
				const el = scrollRef.current;
				const top = topLevelKeys(pages);
				const nudge = (dx, dy) => {
					el?.scrollBy({
						left: dx,
						top: dy
					});
				};
				switch (event.key) {
					case "+":
					case "=":
						applyScale(clampScale(scale * KEY_ZOOM));
						break;
					case "-":
						applyScale(clampScale(scale / KEY_ZOOM));
						break;
					case "0":
						setScale(1);
						requestAnimationFrame(() => {
							if (el !== null) {
								el.scrollLeft = 0;
								el.scrollTop = 0;
							}
						});
						break;
					case "Escape":
						if (selected !== null) setSelected(null);
						else climbBack();
						break;
					case "Backspace":
						climbBack();
						break;
					case "Tab": {
						if (top.length < 2 || activeKey === void 0) return;
						const target = top[(top.indexOf(activeKey) + (event.shiftKey ? -1 : 1) + top.length) % top.length];
						if (target !== void 0) manualSwitch(target);
						break;
					}
					case "f":
					case "F":
						toggleFollow();
						break;
					case "ArrowLeft":
					case "h":
						nudge(-48, 0);
						break;
					case "ArrowRight":
					case "l":
						nudge(48, 0);
						break;
					case "ArrowUp":
					case "k":
						nudge(0, -48);
						break;
					case "ArrowDown":
					case "j":
						nudge(0, 48);
						break;
					default: {
						const digit = Number(event.key);
						const target = Number.isInteger(digit) && digit >= 1 && digit <= 9 ? top[digit - 1] : void 0;
						if (target === void 0) return;
						manualSwitch(target);
						break;
					}
				}
				event.preventDefault();
			}, [
				activeKey,
				applyScale,
				climbBack,
				manualSwitch,
				pages,
				selected,
				toggleFollow,
				scale
			]);
			const dividerDown = (0, react.useCallback)((event) => {
				const startY = event.clientY;
				const startH = panelH;
				const target = event.currentTarget;
				target.setPointerCapture(event.pointerId);
				const move = (ev) => {
					actions.setPanelH(startH + (startY - ev.clientY));
				};
				const up = () => {
					target.removeEventListener("pointermove", move);
					target.removeEventListener("pointerup", up);
					target.removeEventListener("pointercancel", up);
				};
				target.addEventListener("pointermove", move);
				target.addEventListener("pointerup", up);
				target.addEventListener("pointercancel", up);
			}, [actions, panelH]);
			const restoredRef = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (restoredRef.current || activeKey === void 0) return;
				restoredRef.current = true;
				const view = viewsRef.current[activeKey];
				if (view !== void 0) {
					setScale(clampScale(view.scale));
					setSelected(view.selected);
				}
				requestAnimationFrame(() => {
					const el = scrollRef.current;
					if (el !== null) {
						el.scrollLeft = view?.scrollX ?? 0;
						el.scrollTop = view?.scrollY ?? 0;
					}
				});
			}, [activeKey]);
			(0, react.useEffect)(() => () => {
				const key = activeKeyRef.current;
				const el = scrollRef.current;
				if (key === void 0) return;
				actions.parkView(key, {
					scale: scaleRef.current,
					selected: selectedRef.current,
					scrollX: el?.scrollLeft ?? 0,
					scrollY: el?.scrollTop ?? 0
				});
			}, [actions]);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: MmapView_module_css_default.view,
				tabIndex: 0,
				onKeyDown,
				children: [
					fetchState === "loading" && pages.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
						className: MmapView_module_css_default.status,
						children: t("loading")
					}) : null,
					fetchState === "error" && pages.length === 0 ? (0, react_jsx_runtime.jsxs)("div", {
						className: MmapView_module_css_default.failure,
						children: [(0, react_jsx_runtime.jsx)("p", {
							role: "alert",
							children: t("error")
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => {
								setRetries((value) => value + 1);
							},
							children: t("retry")
						})]
					}) : null,
					fetchState === "ready" && pages.length === 0 ? (0, react_jsx_runtime.jsxs)("div", {
						className: MmapView_module_css_default.emptyState,
						children: [(0, react_jsx_runtime.jsx)("p", { children: (0, react_jsx_runtime.jsx)("span", {
							className: MmapView_module_css_default.cursor,
							children: t("empty")
						}) }), (0, react_jsx_runtime.jsx)("p", {
							className: MmapView_module_css_default.hint,
							children: t("emptyHint")
						})]
					}) : null,
					pages.length > 0 && active !== void 0 ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						crumb !== void 0 ? (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: MmapView_module_css_default.crumb,
							title: t("back"),
							onClick: () => {
								climbBack();
							},
							children: [
								"⌫ ",
								crumb.parentTitle ?? (crumb.parentKey === "" ? t("defaultPage") : crumb.parentKey),
								" ▸ ",
								(0, react_jsx_runtime.jsx)("strong", { children: crumb.label })
							]
						}) : tabs.length > 1 ? (0, react_jsx_runtime.jsx)("div", {
							className: MmapView_module_css_default.tabs,
							role: "tablist",
							children: tabs.map((tab, index) => (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								role: "tab",
								"aria-selected": tab.active,
								"data-active": tab.active ? "true" : void 0,
								"data-status": tab.neutral ? "neutral" : tab.status,
								"data-fresh": tab.fresh ? "true" : void 0,
								onClick: () => {
									if (!tab.active) manualSwitch(tab.key);
								},
								children: [
									(0, react_jsx_runtime.jsxs)("b", { children: [
										"[",
										index + 1,
										"]"
									] }),
									tab.title ?? (tab.key === "" ? t("defaultPage") : tab.key),
									tab.fresh ? "*" : null
								]
							}, tab.key))
						}) : null,
						(0, react_jsx_runtime.jsx)("div", {
							ref: scrollRef,
							className: MmapView_module_css_default.scroll,
							onPointerDown,
							onPointerMove,
							onPointerUp: endDrag,
							onPointerCancel: endDrag,
							onLostPointerCapture: endDrag,
							onClickCapture,
							children: layout !== void 0 && layout.boxes.length > 0 ? (0, react_jsx_runtime.jsx)(MapSvg, {
								layout,
								scale,
								focus,
								selected,
								onHover: setHover,
								onSelect: setSelected,
								onDive: dive
							}) : (0, react_jsx_runtime.jsx)("p", {
								className: MmapView_module_css_default.status,
								children: active.error !== null && activeMap === void 0 ? `${t("pageInvalid")}: ${active.error}` : t("emptyMap")
							})
						}),
						active.error !== null && activeMap !== void 0 ? (0, react_jsx_runtime.jsx)("p", {
							className: MmapView_module_css_default.stale,
							role: "alert",
							children: t("stalePage")
						}) : null,
						flash !== null ? (0, react_jsx_runtime.jsxs)("p", {
							className: MmapView_module_css_default.flash,
							children: ["» ", flash]
						}) : null,
						(0, react_jsx_runtime.jsxs)("div", {
							className: MmapView_module_css_default.divider,
							onPointerDown: dividerDown,
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: MmapView_module_css_default.dividerGrip,
								children: "╌╌╌"
							}), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: MmapView_module_css_default.followTag,
								"data-armed": follow ? "true" : void 0,
								title: follow ? t("followOn") : t("followOff"),
								onPointerDown: (event) => {
									event.stopPropagation();
								},
								onClick: toggleFollow,
								children: t("followTag")
							})]
						}),
						(0, react_jsx_runtime.jsx)("div", {
							className: MmapView_module_css_default.panel,
							style: { height: panelH },
							children: activeMap !== void 0 ? (0, react_jsx_runtime.jsx)(DetailPanel, {
								map: activeMap,
								focus,
								pinned: focus !== null && focus === selected,
								t
							}) : null
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: MmapView_module_css_default.footer,
							children: [(0, react_jsx_runtime.jsxs)("span", { children: [
								"⊕ ",
								Math.round(scale * 100),
								"%",
								step >= 1 ? ` · ${zoomLabel(step)}` : "",
								layout?.aggregated === true ? ` · ${t("aggregated")}` : ""
							] }), (0, react_jsx_runtime.jsx)("span", { children: t("zoomHint") })]
						})
					] }) : null
				]
			});
		}
		//#endregion
		//#region lib/types/client/MapDrawerAction.js
		/**
		* The map surface for hosts whose web frame has no aux column: the same
		* header button, but toggling a right-edge drawer this component portals to
		* the document body. The drawer stays mounted while closed (slid offscreen),
		* mirroring the aux column's width-0 behavior, so live mapping activity can
		* auto-open it through the view's ordinary autoOpen callback.
		*/
		function MapDrawerAction(props) {
			const { t } = props;
			const [open, setOpen] = (0, react.useState)(false);
			const autoOpen = (0, react.useCallback)(() => {
				setOpen(true);
			}, []);
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: MmapView_module_css_default.toggle,
				"data-open": open || void 0,
				onClick: () => {
					setOpen((value) => !value);
				},
				title: t("view.mmap"),
				children: t("view.mmap")
			}), (0, react_dom.createPortal)((0, react_jsx_runtime.jsxs)("div", {
				className: MmapView_module_css_default.drawer,
				"data-open": open || void 0,
				role: "complementary",
				"aria-label": t("view.mmap"),
				children: [(0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: MmapView_module_css_default.drawerClose,
					onClick: () => {
						setOpen(false);
					},
					title: t("close"),
					children: "✕"
				}), (0, react_jsx_runtime.jsx)(MmapView, {
					...props,
					autoOpen
				})]
			}), document.body)] });
		}
		const PANEL_MIN_H = 64;
		const PANEL_MAX_H = 480;
		/**
		* Create the per-session viewpoint store handle.
		* @returns the store handle; the framework instantiates one per session.
		*/
		function createMmapViewStore() {
			return (0, _deepseek_ai_dsh_client_runtime_client.defineStore)({
				init: () => ({
					chosenKey: void 0,
					follow: true,
					panelH: 168,
					views: {}
				}),
				persist: "dsh.mmap.view",
				actions: {
					choosePage: (d, key) => {
						d.chosenKey = key;
					},
					setFollow: (d, on) => {
						d.follow = on;
					},
					setPanelH: (d, px) => {
						d.panelH = Math.min(PANEL_MAX_H, Math.max(PANEL_MIN_H, px));
					},
					parkView: (d, key, view) => {
						d.views[key] = view;
					}
				}
			});
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** Copy dictionaries for the Mellos map companion column. */
		/** Simplified Chinese dictionary and key source of truth. */
		const zh = {
			"view.mmap": "地图",
			loading: "正在读取地图…",
			error: "暂时无法读取地图。",
			retry: "重试",
			empty: "这个工作区还没有 Mellos 地图。",
			emptyHint: "让智能体声明设计(mmap_declare)后,这里会随构建实时亮起。",
			defaultPage: "主图",
			pageInvalid: "页面文件无效",
			stalePage: "文件当前无效,保留上一次的有效画面",
			"status.planned": "计划",
			"status.in-progress": "进行中",
			"status.done": "已验证",
			"status.regressed": "已回归",
			evidence: "证据",
			noEvidence: "证据:—",
			notes: "设计说明",
			noNotes: "(还没有设计说明)",
			uses: "依赖 →",
			usedBy: "← 被依赖",
			after: "之后 →",
			before: "← 之前",
			members: "成员",
			none: "—",
			pinned: "⊙ 已钉选",
			emptyMap: "(空地图 —— 等待第一次声明)",
			dashboardHint: "悬停节点查看 · 点击钉选 · 双击 ⊞ 潜入子图",
			"unit.layers": "层",
			"unit.nodes": "节点",
			"unit.edges": "边",
			"unit.lanes": "泳道",
			"unit.members": "个成员",
			back: "返回上级",
			close: "关闭地图",
			submapMissing: "子图还没有页面",
			zoomHint: "+/- 缩放 · hjkl 平移 · f 跟随 · 0 复位",
			aggregated: "俯瞰(按子系统聚合)",
			followTag: "⇢ 跟随",
			followOn: "已开启自动跟随",
			followOff: "已关闭自动跟随 —— 按 f 或点 ⇢ 重新开启"
		};
		/** English dictionary checked against the Chinese key set. */
		const en = {
			"view.mmap": "Map",
			loading: "Reading the map…",
			error: "The map is temporarily unavailable.",
			retry: "Retry",
			empty: "This workspace has no Mellos map yet.",
			emptyHint: "Ask the agent to declare a design (mmap_declare) and this view lights up live.",
			defaultPage: "Main",
			pageInvalid: "Invalid page file",
			stalePage: "File currently invalid; keeping the last good picture",
			"status.planned": "planned",
			"status.in-progress": "in progress",
			"status.done": "verified",
			"status.regressed": "regressed",
			evidence: "Evidence",
			noEvidence: "evidence: —",
			notes: "Notes",
			noNotes: "(no design notes yet)",
			uses: "uses →",
			usedBy: "← used by",
			after: "after →",
			before: "← before",
			members: "Members",
			none: "—",
			pinned: "⊙ pinned",
			emptyMap: "(empty map — waiting for the first declaration)",
			dashboardHint: "hover to inspect · click to pin · double-click ⊞ to dive",
			"unit.layers": "layers",
			"unit.nodes": "nodes",
			"unit.edges": "edges",
			"unit.lanes": "lanes",
			"unit.members": "member(s)",
			back: "Back",
			close: "Close map",
			submapMissing: "this submap has no page yet",
			zoomHint: "+/- zoom · hjkl pan · f follow · 0 reset",
			aggregated: "overview (aggregated by subsystem)",
			followTag: "⇢ follow",
			followOn: "auto-follow on",
			followOff: "auto-follow off — press f or click ⇢ to re-enable"
		};
		//#endregion
		//#region lib/types/client/index.js
		/** Live Mellos map column beside the conversation, plus its header toggle. */
		/** Dictionary namespace owned by this plugin. */
		const NS = "mmap";
		/** Services required by the registrations, the layout face, and the Remote gateway. */
		const inject = [
			"slots",
			"locale",
			"layout",
			"remote"
		];
		/** Poll cadence keeping closed hosts fresh; far above any read's real cost. */
		const POLL_MS = 5e3;
		/**
		* Contribute the side-by-side map column and its header toggle, and keep the
		* column live: one shared revision source bumps on every forwarded
		* `mmap/changed` and on connection reset (forwarded events carry no reconnect
		* replay, so a reset must force a fresh pull), and the mounted view re-reads
		* through the Remote seam when it moves. The view stays mounted while the
		* column is closed (width 0), which is what lets live mapping activity —
		* a page actually moving, never mere existence — auto-open the column.
		*
		* The plugin mounts its own `remote.mmap` face unless a host assembly already
		* did, and additionally polls at a slow cadence: a host whose forwarded-event
		* allowlist predates `mmap/changed` (any stock dsh today) never pushes the
		* event, and the poll keeps the map live there — an event-forwarding host
		* merely refreshes faster than the poll.
		* @param ctx - client root context.
		* @returns the Remote unmount when this plugin mounted the face itself.
		*/
		async function apply(ctx) {
			const unmount = ctx.remote.mmap === void 0 ? await ctx.remote.$mount(TYPERT_REMOTE) : void 0;
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-mmap: dictionaries");
			const revision = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(0);
			const bump = () => {
				revision.set(revision.getSnapshot() + 1);
			};
			ctx.remote.$on("mmap/changed", bump);
			ctx.on("connection/reset", bump);
			ctx.effect(() => {
				const timer = setInterval(() => {
					if (document.visibilityState === "visible") bump();
				}, POLL_MS);
				return () => {
					clearInterval(timer);
				};
			}, "ui-mmap: freshness poll");
			ctx.inject(["remote.mmap"], (scoped) => {
				const readFor = (sessionId) => async () => {
					const result = await scoped.remote.mmap.read(sessionId);
					if (!result.ok) throw new Error(`mmap.read failed: ${result.error.code}: ${result.error.message}`);
					return result.value;
				};
				const layoutFace = scoped.layout;
				if (typeof layoutFace.openAux === "function" && typeof layoutFace.toggleAux === "function") {
					scoped.slots.inject("aux", () => scoped.slots.register({
						name: "aux",
						locale: NS,
						store: createMmapViewStore,
						inject: (sessionId) => ({
							hooks: { mmapRevision: revision },
							read: readFor(sessionId),
							autoOpen: () => {
								scoped.layout.openAux();
							}
						})
					}, MmapView));
					scoped.slots.inject("conversation.session.header.actions", () => scoped.slots.register({
						name: "conversation.session.header.actions",
						id: "mmap-toggle",
						order: 30,
						locale: NS,
						inject: () => ({ toggle: () => {
							scoped.layout.toggleAux();
						} })
					}, MapToggleAction));
				} else scoped.slots.inject("conversation.session.header.actions", () => scoped.slots.register({
					name: "conversation.session.header.actions",
					id: "mmap-toggle",
					order: 30,
					locale: NS,
					store: createMmapViewStore,
					inject: (sessionId) => ({
						hooks: { mmapRevision: revision },
						read: readFor(sessionId)
					})
				}, MapDrawerAction));
			});
			return unmount === void 0 ? void 0 : async () => {
				await unmount();
			};
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map