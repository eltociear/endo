/* global process */

import fs from 'fs';
import { rollup as rollup0 } from 'rollup';
import url from 'url';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import resolve0 from '@rollup/plugin-node-resolve';
import commonjs0 from '@rollup/plugin-commonjs';
import { makeAndHashArchive } from '@endo/compartment-mapper/archive.js';
import { makeReadPowers } from '@endo/compartment-mapper/node-powers.js';
import { encodeBase64 } from '@endo/base64';
import { whereEndoCache } from '@endo/where';
import { transformSource } from './transform.js';

const DEFAULT_MODULE_FORMAT = 'endoZipBase64';
const DEFAULT_FILE_PREFIX = '/bundled-source/...';
const SUPPORTED_FORMATS = ['getExport', 'nestedEvaluate', 'endoZipBase64'];

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const readPowers = makeReadPowers({ fs, url, crypto });

/**
 * Finds the longest common prefix in an array of strings.
 *
 * @param {string[]} strings
 * @returns {string}
 */
function longestCommonPrefix(strings) {
  if (strings.length === 0) {
    return '';
  }
  const first = strings[0];
  const rest = strings.slice(1);
  let i = 0;
  for (; i < first.length; i += 1) {
    const c = first[i];
    if (rest.some(s => s[i] !== c)) {
      break;
    }
  }
  return first.slice(0, i);
}

async function bundleZipBase64(startFilename, options = {}, powers = {}) {
  const { dev = false, cacheSourceMaps = false } = options;
  const {
    computeSha512,
    pathResolve = path.resolve,
    userInfo = os.userInfo,
    env = process.env,
    platform = process.platform,
  } = powers;

  const entry = url.pathToFileURL(pathResolve(startFilename));

  const sourceMapJobs = new Set();
  let writeSourceMap = Function.prototype;
  if (cacheSourceMaps) {
    const { homedir: home } = userInfo();
    const cacheDirectory = whereEndoCache(platform, env, { home });
    const sourceMapsCacheDirectory = pathResolve(cacheDirectory, 'source-map');
    const sourceMapsTrackerDirectory = pathResolve(
      cacheDirectory,
      'source-map-track',
    );
    writeSourceMap = async (
      sourceMap,
      { sha512, compartment: packageLocation, module: moduleSpecifier },
    ) => {
      const location = new URL(moduleSpecifier, packageLocation).href;
      const locationSha512 = computeSha512(location);
      const locationSha512Head = locationSha512.slice(0, 2);
      const locationSha512Tail = locationSha512.slice(2);
      const sha512Head = sha512.slice(0, 2);
      const sha512Tail = sha512.slice(2);
      const sourceMapTrackerDirectory = pathResolve(
        sourceMapsTrackerDirectory,
        locationSha512Head,
      );
      const sourceMapTrackerPath = pathResolve(
        sourceMapTrackerDirectory,
        locationSha512Tail,
      );
      const sourceMapDirectory = pathResolve(
        sourceMapsCacheDirectory,
        sha512Head,
      );
      const sourceMapPath = pathResolve(
        sourceMapDirectory,
        `${sha512Tail}.map.json`,
      );

      await fs.promises
        .readFile(sourceMapTrackerPath, 'utf-8')
        .then(async oldSha512 => {
          oldSha512 = oldSha512.trim();
          if (oldSha512 === sha512) {
            return;
          }
          const oldSha512Head = oldSha512.slice(0, 2);
          const oldSha512Tail = oldSha512.slice(2);
          const oldSourceMapDirectory = pathResolve(
            sourceMapsCacheDirectory,
            oldSha512Head,
          );
          const oldSourceMapPath = pathResolve(
            oldSourceMapDirectory,
            `${oldSha512Tail}.map.json`,
          );
          await fs.promises.unlink(oldSourceMapPath);
          const entries = await fs.promises.readdir(oldSourceMapDirectory);
          if (entries.length === 0) {
            await fs.promises.rmdir(oldSourceMapDirectory);
          }
        })
        .catch(error => {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        });

      await fs.promises.mkdir(sourceMapDirectory, { recursive: true });
      await fs.promises.writeFile(sourceMapPath, sourceMap);

      await fs.promises.mkdir(sourceMapTrackerDirectory, { recursive: true });
      await fs.promises.writeFile(sourceMapTrackerPath, sha512);
    };
  }

  const { bytes, sha512 } = await makeAndHashArchive(powers, entry, {
    dev,
    moduleTransforms: {
      async mjs(
        sourceBytes,
        specifier,
        location,
        _packageLocation,
        { sourceMap },
      ) {
        const source = textDecoder.decode(sourceBytes);
        let object;
        ({ code: object, map: sourceMap } = await transformSource(source, {
          sourceType: 'module',
          sourceMap,
          sourceMapUrl: new URL(specifier, location).href,
        }));
        const objectBytes = textEncoder.encode(object);
        return { bytes: objectBytes, parser: 'mjs', sourceMap };
      },
    },
    sourceMapHook(sourceMap, sourceDescriptor) {
      sourceMapJobs.add(writeSourceMap(sourceMap, sourceDescriptor));
    },
  });
  assert(sha512);
  await Promise.all(sourceMapJobs);
  const endoZipBase64 = encodeBase64(bytes);
  return harden({
    moduleFormat: /** @type {const} */ ('endoZipBase64'),
    endoZipBase64,
    endoZipBase64Sha512: sha512,
  });
}

/**
 * @template {'nestedEvaluate' | 'getExport'} T
 * @param {string} startFilename
 * @param {T} moduleFormat
 * @param {*} powers
 */
async function bundleNestedEvaluateAndGetExports(
  startFilename,
  moduleFormat,
  powers,
) {
  const {
    commonjsPlugin = commonjs0,
    rollup = rollup0,
    resolvePlugin = resolve0,
    pathResolve = path.resolve,
    externals = [],
  } = powers || {};
  const resolvedPath = pathResolve(startFilename);
  const bundle = await rollup({
    input: resolvedPath,
    treeshake: false,
    preserveModules: moduleFormat === 'nestedEvaluate',
    external: [...externals],
    plugins: [resolvePlugin({ preferBuiltins: true }), commonjsPlugin()],
  });
  const { output } = await bundle.generate({
    exports: 'named',
    format: 'cjs',
    sourcemap: true,
  });
  // console.log(output);

  // Find the longest common prefix of all the normalized fileURLs.  We shorten
  // the paths to make the bundle output consistent between different absolute
  // directory locations.
  const fileNameToUrlPath = fileName =>
    readPowers.pathToFileURL(pathResolve(startFilename, fileName)).pathname;
  const pathnames = output.map(({ fileName }) => fileNameToUrlPath(fileName));
  const longestPrefix = longestCommonPrefix(pathnames);

  // Ensure the prefix ends with a slash.
  const pathnameEndPos = longestPrefix.lastIndexOf('/');
  const pathnamePrefix = longestPrefix.slice(0, pathnameEndPos + 1);

  // Create a source bundle.
  const unsortedSourceBundle = {};
  let entrypoint;
  await Promise.all(
    output.map(async chunk => {
      if (chunk.isAsset) {
        throw Error(`unprepared for assets: ${chunk.fileName}`);
      }
      const { code, fileName, isEntry } = chunk;
      const pathname = fileNameToUrlPath(fileName);
      const shortName = pathname.startsWith(pathnamePrefix)
        ? pathname.slice(pathnamePrefix.length)
        : fileName;
      if (isEntry) {
        entrypoint = shortName;
      }

      const useLocationUnmap =
        moduleFormat === 'nestedEvaluate' && !fileName.startsWith('_virtual/');

      const { code: transformedCode } = await transformSource(code, {
        sourceMapUrl: pathname,
        sourceMap: chunk.map,
        useLocationUnmap,
      });
      unsortedSourceBundle[shortName] = transformedCode;

      // console.log(`==== sourceBundle[${fileName}]\n${sourceBundle[fileName]}\n====`);
    }),
  );

  if (!entrypoint) {
    throw Error('No entrypoint found in output bundle');
  }

  /**
   * @param {string} a
   * @param {string} b
   */
  const strcmp = (a, b) => {
    if (a < b) {
      return -1;
    }
    if (a > b) {
      return 1;
    }
    return 0;
  };
  const sourceBundle = Object.fromEntries(
    Object.entries(unsortedSourceBundle).sort(([ka], [kb]) => strcmp(ka, kb)),
  );

  // 'sourceBundle' is now an object that contains multiple programs, which references
  // require() and sets module.exports . This is close, but we need a single
  // stringifiable function, so we must wrap it in an outer function that
  // returns the entrypoint exports.
  //
  // build-kernel.js will prefix this with 'export default' so it becomes an
  // ES6 module. The Vat controller will wrap it with parenthesis so it can
  // be evaluated and invoked to get at the exports.

  // const sourceMap = `//# sourceMappingURL=${output[0].map.toUrl()}\n`;

  // console.log(sourceMap);
  /** @type {string} */
  let sourceMap;
  /** @type {string} */
  let source;
  if (moduleFormat === 'getExport') {
    sourceMap = `//# sourceURL=${DEFAULT_FILE_PREFIX}/${entrypoint}\n`;

    if (Object.keys(sourceBundle).length !== 1) {
      throw Error('unprepared for more than one chunk');
    }

    source = `\
function getExport() { 'use strict'; \
let exports = {}; \
const module = { exports }; \
\
${sourceBundle[entrypoint]}

return module.exports;
}
${sourceMap}`;
    return harden({ moduleFormat, source, sourceMap });
  } else if (moduleFormat === 'nestedEvaluate') {
    sourceMap = `//# sourceURL=${DEFAULT_FILE_PREFIX}-preamble.js\n`;

    // This function's source code is inlined in the output bundle.
    // It creates an evaluable string for a given module filename.
    const filePrefix = DEFAULT_FILE_PREFIX;
    function createEvalString(filename) {
      const code = sourceBundle[filename];
      if (!code) {
        return undefined;
      }
      return `\
(function getExport(require, exports) { \
  'use strict'; \
  const module = { exports }; \
  \
  ${code}
  return module.exports;
})
//# sourceURL=${filePrefix}/${filename}
`;
    }

    // This function's source code is inlined in the output bundle.
    // It figures out the exports from a given module filename.
    const nsBundle = {};
    function computeExports(filename, exportPowers, exports) {
      const { require: systemRequire, systemEval, _log } = exportPowers;
      // This captures the endowed require.
      const match = filename.match(/^(.*)\/[^/]+$/);
      const thisdir = match ? match[1] : '.';
      const contextRequire = mod => {
        // Do path algebra to find the actual source.
        const els = mod.split('/');
        let prefix;
        if (els[0][0] === '@') {
          // Scoped name.
          prefix = els.splice(0, 2).join('/');
        } else if (els[0][0] === '.') {
          // Relative.
          els.unshift(...thisdir.split('/'));
        } else {
          // Bare or absolute.
          prefix = els.splice(0, 1);
        }

        const suffix = [];
        for (const el of els) {
          if (el === '.' || el === '') {
            // Do nothing.
          } else if (el === '..') {
            // Traverse upwards.
            suffix.pop();
          } else {
            suffix.push(el);
          }
        }

        // log(mod, prefix, suffix);
        if (prefix !== undefined) {
          suffix.unshift(prefix);
        }
        let modPath = suffix.join('/');
        if (modPath.startsWith('./')) {
          modPath = modPath.slice(2);
        }
        // log('requiring', modPath);
        if (!(modPath in nsBundle)) {
          // log('evaluating', modPath);
          // Break cycles, but be tolerant of modules
          // that completely override their exports object.
          nsBundle[modPath] = {};
          nsBundle[modPath] = computeExports(
            modPath,
            exportPowers,
            nsBundle[modPath],
          );
        }

        // log('returning', nsBundle[modPath]);
        return nsBundle[modPath];
      };

      const code = createEvalString(filename);
      if (!code) {
        // log('missing code for', filename, sourceBundle);
        if (systemRequire) {
          return systemRequire(filename);
        }
        throw Error(
          `require(${JSON.stringify(
            filename,
          )}) failed; no toplevel require endowment`,
        );
      }

      // log('evaluating', code);
      // eslint-disable-next-line no-eval
      return (systemEval || eval)(code)(contextRequire, exports);
    }

    source = `\
function getExportWithNestedEvaluate(filePrefix) {
  'use strict';
  // Serialised sources.
  if (filePrefix === undefined) {
    filePrefix = ${JSON.stringify(DEFAULT_FILE_PREFIX)};
  }
  const moduleFormat = ${JSON.stringify(moduleFormat)};
  const entrypoint = ${JSON.stringify(entrypoint)};
  const sourceBundle = ${JSON.stringify(sourceBundle, undefined, 2)};
  const nsBundle = {};

  ${createEvalString}

  ${computeExports}

  // Evaluate the entrypoint recursively, seeding the exports.
  const systemRequire = typeof require === 'undefined' ? undefined : require;
  const systemEval = typeof nestedEvaluate === 'undefined' ? undefined : nestedEvaluate;
  return computeExports(entrypoint, { require: systemRequire, systemEval }, {});
}
${sourceMap}`;
    return harden({ moduleFormat, source, sourceMap });
  }

  throw Error(`unrecognized moduleFormat ${moduleFormat}`);
}

/** @type {import('./types').BundleSource} */
const bundleSource = async (
  startFilename,
  options = {},
  powers = undefined,
) => {
  if (typeof options === 'string') {
    options = { format: options };
  }
  /** @type {{ format: import('./types').ModuleFormat }} */
  const { format: moduleFormat = DEFAULT_MODULE_FORMAT } = options;

  switch (moduleFormat) {
    case 'endoZipBase64':
      return bundleZipBase64(startFilename, options, {
        ...readPowers,
        ...powers,
      });
    case 'getExport':
      return bundleNestedEvaluateAndGetExports(
        startFilename,
        moduleFormat,
        powers,
      );
    case 'nestedEvaluate':
      return bundleNestedEvaluateAndGetExports(
        startFilename,
        moduleFormat,
        powers,
      );
    default:
      if (!SUPPORTED_FORMATS.includes(moduleFormat)) {
        throw Error(`moduleFormat ${moduleFormat} is not supported`);
      }
      throw Error(
        `moduleFormat ${moduleFormat} is not implemented but is in ${SUPPORTED_FORMATS}`,
      );
  }
};

export default bundleSource;
