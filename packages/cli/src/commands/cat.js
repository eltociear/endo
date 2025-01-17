/* global process */

import os from 'os';
import { E } from '@endo/far';
import { makeRefReader } from '@endo/daemon';
import { withEndoParty } from '../context.js';

export const cat = async ({ name, partyNames }) =>
  withEndoParty(partyNames, { os, process }, async ({ party }) => {
    const readable = await E(party).lookup(name);
    const readerRef = E(readable).streamBase64();
    const reader = makeRefReader(readerRef);
    for await (const chunk of reader) {
      process.stdout.write(chunk);
    }
  });
