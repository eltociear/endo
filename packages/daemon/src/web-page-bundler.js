// @ts-check

// This is a built-in unconfined plugin for lazily constructing the web-page.js
// bundle for booting up web caplets.
// The 'web-page-js' formula is a hard-coded 'make-unconfined' formula that runs
// this program in worker 0.
// It does not accept its endowed powers.

import 'ses';
import fs from 'node:fs';
import { makeBundle } from '@endo/compartment-mapper/bundle.js';
import { fileURLToPath } from 'url';

const read = async location => fs.promises.readFile(fileURLToPath(location));

export const make = async () => {
  return makeBundle(read, new URL('web-page.js', import.meta.url).href);
};
