/* global process */
import os from 'os';
import { E } from '@endo/far';
import { withEndoParty } from '../context.js';
import { parsePetNamePath } from '../pet-name.js';

export const evalCommand = async ({
  source,
  names,
  resultName,
  workerName,
  partyNames,
}) =>
  withEndoParty(partyNames, { os, process }, async ({ party }) => {
    const pairs = names.map(name => {
      /** @type {Array<string>} */
      const pair = name.split(':');
      if (pair.length === 1) {
        return [name, name];
      }
      if (pair.length > 2) {
        throw new Error(
          `Specify either a name endowmentName:pet-name, got: ${JSON.stringify(
            name,
          )}`,
        );
      }
      return pair;
    });
    const codeNames = pairs.map(pair => pair[0]);
    const petNames = pairs.map(pair => parsePetNamePath(pair[1]));

    const result = await E(party).evaluate(
      workerName,
      source,
      codeNames,
      petNames,
      resultName,
    );
    console.log(result);
  });
