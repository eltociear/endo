// Establish a perimeter:
import 'ses';
import '@endo/eventual-send/shim.js';
import '@endo/promise-kit/shim.js';
import '@endo/lockdown/commit.js';

import fs from 'fs';

import { writeBundle } from '@endo/compartment-mapper/bundle.js';
import { makeWritePowers, makeReadPowers } from '@endo/compartment-mapper/node-powers.js';

const { write } = makeWritePowers({ fs });
const { read } = makeReadPowers({ fs });

const workerEnvModuleLocation = new URL(
  'worker-env.js',
  import.meta.url,
).toString();
const workerEnvBundleLocation = new URL(
  '../dist-worker-env-bundle.js',
  import.meta.url,
).toString();

const daemonModuleLocation = new URL(
  'daemon-web.js',
  import.meta.url,
).toString();
const daemonBundleLocation = new URL(
  '../dist-daemon-web-bundle.js',
  import.meta.url,
).toString();
const daemonInitModuleLocation = new URL(
  'daemon-web-init.js',
  import.meta.url,
).toString();
const daemonInitBundleLocation = new URL(
  '../dist-daemon-web-init-bundle.js',
  import.meta.url,
).toString();

const workerModuleLocation = new URL(
  'worker-web.js',
  import.meta.url,
).toString();
const workerBundleLocation = new URL(
  '../dist-worker-web-bundle.js',
  import.meta.url,
).toString();
const workerInitModuleLocation = new URL(
  'worker-web-init.js',
  import.meta.url,
).toString();
const workerInitBundleLocation = new URL(
  '../dist-worker-init-bundle.js',
  import.meta.url,
).toString();

const bundleOptions = {
  // node builtin shims for browser
  commonDependencies: {
    'util': 'util',
    'path': 'path-browserify',
    'events': 'events',
    'buffer': 'buffer',
    // dummy fs
    'fs': 'util',
  },
}

async function main() {
  // worker env bundle
  await writeBundle(
    write,
    read,
    workerEnvBundleLocation,
    workerEnvModuleLocation,
    bundleOptions,
  )
  // daemon kit hermetic bundle
  await writeBundle(
    write,
    read,
    daemonBundleLocation,
    daemonModuleLocation,
    bundleOptions,
  )
  // worker kit hermetic bundle
  await writeBundle(
    write,
    read,
    workerBundleLocation,
    workerModuleLocation,
    bundleOptions,
  )
  // self-initing daemon
  await writeBundle(
    write,
    read,
    daemonInitBundleLocation,
    daemonInitModuleLocation,
    bundleOptions,
  )
  // self-initing worker
  await writeBundle(
    write,
    read,
    workerInitBundleLocation,
    workerInitModuleLocation,
    bundleOptions,
  )
}

main()