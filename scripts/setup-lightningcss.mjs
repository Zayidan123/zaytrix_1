#!/usr/bin/env node
/**
 * setup-lightningcss.mjs
 *
 * Installs a Proot-compatible lightningcss shim into node_modules/lightningcss/node/.
 *
 * Why: lightningcss ships a native .node binary (lightningcss-android-arm64.node)
 * that cannot load inside Termux/Proot ARM64. Proot restricts the process
 * namespace and LD_LIBRARY_PATH, so the native binary fails with ERR_DLOPEN_FAILED
 * ("not accessible for the namespace"). This shim provides the lightningcss API
 * as a no-op CSS pass-through, which is safe because:
 *   1. vite.config.ts already uses esbuild for CSS transformation
 *   2. TailwindCSS v4 generates CSS with its own JS engine
 *   3. The @tailwindcss/node "optimize" step is a post-processing pass that
 *      can safely pass CSS through unchanged on Proot
 *
 * This script is idempotent and runs as the "prebuild" hook so plain
 * `npm run build` never requires manual node_modules patching.
 */

import fs from 'node:fs';
import path from 'node:path';

const nodeDir = path.join(process.cwd(), 'node_modules', 'lightningcss', 'node');

const cjsShim = `'use strict';

// Proot-compatible lightningcss shim.
// Native lightningcss .node binaries cannot load in Termux/Proot ARM64
// (ERR_DLOPEN_FAILED: "not accessible for the namespace" due to Proot's
// restricted LD_LIBRARY_PATH). This pass-through keeps the lightningcss API
// stable for @tailwindcss/node's optimize step while vite.config.ts uses
// esbuild for actual CSS transformation.
//
// IMPORTANT: The @tailwindcss/node optimize() function expects the result of
// transform() to have a \`code\` property (string or Buffer). Do NOT return
// \`css\` here — that breaks the second optimize pass.

var transform = function (input, options) {
  return {
    code: input && input.code ? input.code : '',
    map: null,
    warnings: []
  };
};

var transformStyleAttribute = function (input, options) {
  return { code: '', warnings: [] };
};

var bundle = function (input, options) {
  return { code: '', map: null, warnings: [], exports: {} };
};

var bundleAsync = function (input, options) {
  return Promise.resolve({ code: '', map: null, warnings: [], exports: {} });
};

var browserslistToTargets = function (browsers) { return []; };
var composeVisitors = function (features) { return []; };

var Features = {
  Nesting: 1,
  MediaQueries: 2,
  LogicalProperties: 4,
  DirSelector: 8,
  LightDark: 16,
  CustomMedia: 32
};

module.exports = {
  transform: transform,
  transformStyleAttribute: transformStyleAttribute,
  bundle: bundle,
  bundleAsync: bundleAsync,
  browserslistToTargets: browserslistToTargets,
  composeVisitors: composeVisitors,
  Features: Features
};
`;

const esmShim = `// Proot-compatible lightningcss shim (ESM).
// See setup-lightningcss.mjs for the rationale. This mirrors the CJS shim
// above so @tailwindcss/node can import lightningcss in ESM mode.
// IMPORTANT: return \`code\` (string or Buffer), not \`css\`, because the
// @tailwindcss/node optimize() function performs a second transform pass
// with l.code as input.

export const Features = {
  Nesting: 1,
  MediaQueries: 2,
  LogicalProperties: 4,
  DirSelector: 8,
  LightDark: 16,
  CustomMedia: 32
};

export function transform(input, options) {
  return { code: input && input.code ? input.code : '', map: null, warnings: [] };
}

export function transformStyleAttribute(input, options) {
  return { code: '', warnings: [] };
}

export function bundle(input, options) {
  return { code: '', map: null, warnings: [], exports: {} };
}

export async function bundleAsync(input, options) {
  return { code: '', map: null, warnings: [], exports: {} };
}

export function browserslistToTargets(browsers) { return []; }
export function composeVisitors(features) { return []; }

export default {
  transform,
  transformStyleAttribute,
  bundle,
  bundleAsync,
  browserslistToTargets,
  composeVisitors,
  Features
};
`;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeShim(filename, content) {
  const target = path.join(nodeDir, filename);
  fs.writeFileSync(target, content);
  console.log(`[setup-lightningcss] wrote ${target}`);
}

try {
  ensureDir(nodeDir);
  writeShim('index.js', cjsShim);
  writeShim('index.mjs', esmShim);
  console.log('[setup-lightningcss] lightningcss shim installed (Proot-compatible)');
} catch (err) {
  console.error('[setup-lightningcss] failed to install shim:', err.message);
  process.exit(1);
}
