// @ts-check

import { Far } from '@endo/far';
import { makeChangeTopic } from './pubsub.js';
import { makeIteratorRef } from './reader-ref.js';

const { quote: q } = assert;

const validIdPattern = /^[0-9a-f]{128}$/;
const validFormulaPattern =
  /^(?:host|pet-store|(?:readable-blob-sha512|worker-id512|pet-store-id512|eval-id512|import-unsafe-id512|import-bundle-id512|host-id512|guest-id512):[0-9a-f]{128}|web-bundle:[0-9a-f]{32})$/;

/**
 * @param {import('./types.js').FilePowers} filePowers
 * @param {import('./types.js').Locator} locator
 */
export const makePetStoreMaker = (filePowers, locator) => {
  /**
   * @param {string} petNameDirectoryPath
   * @param {(name: string) => void} assertValidName
   * @returns {Promise<import('@endo/far').FarRef<import('./types.js').PetStore>>}
   */
  const makePetStoreAtPath = async (petNameDirectoryPath, assertValidName) => {
    /** @type {Map<string, string>} */
    const petNames = new Map();
    /** @type {Map<string, Set<string>>} */
    const formulaIdentifiers = new Map();
    /** @type {import('./types.js').Topic<unknown>} */
    const changesTopic = makeChangeTopic();
    
    // TODO: I guess these would need to be persisted to disk
    const randomId = () => `${Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)}`;
    const idForFormulaIdentifier = new Map();
    const getIdForFormulaIdentifier = formulaIdentifier => {
      if (!idForFormulaIdentifier.has(formulaIdentifier)) {
        idForFormulaIdentifier.set(formulaIdentifier, randomId());
      }
      return idForFormulaIdentifier.get(formulaIdentifier);
    }
    const petNameToNameIdPair = (petName) => {
      const formulaIdentifier = petNames.get(petName);
      if (formulaIdentifier === undefined) {
        return undefined;
      }
      return {
        name: petName,
        id: getIdForFormulaIdentifier(formulaIdentifier),
      };
    }

    /** @param {string} petName */
    const read = async petName => {
      const petNamePath = filePowers.joinPath(petNameDirectoryPath, petName);
      const petNameText = await filePowers.readFileText(petNamePath);
      const formulaIdentifier = petNameText.trim();
      if (!validFormulaPattern.test(formulaIdentifier)) {
        throw new Error(
          `Invalid formula identifier ${q(formulaIdentifier)} for pet name ${q(
            petName,
          )}`,
        );
      }
      return formulaIdentifier;
    };

    await filePowers.makePath(petNameDirectoryPath);

    const fileNames = await filePowers.readDirectory(petNameDirectoryPath);
    await Promise.all(
      fileNames.map(async petName => {
        assertValidName(petName);
        const formulaIdentifier = await read(petName);
        petNames.set(petName, formulaIdentifier);
        const formulaPetNames = formulaIdentifiers.get(formulaIdentifier);
        if (formulaPetNames !== undefined) {
          formulaPetNames.add(petName);
        } else {
          formulaIdentifiers.set(formulaIdentifier, new Set([petName]));
        }
      }),
    );

    /** @param {string} petName */
    const has = petName => {
      assertValidName(petName);
      return petNames.has(petName);
    };

    /** @param {string} type */
    const queryByType = (type) => {
      return [...petNames.entries()]
        .filter(([_name, formulaIdentifier]) => formulaIdentifier.startsWith(`${type}:`))
        .map(([name]) => name)
    }

    /** @param {string} petName */
    const lookup = petName => {
      assertValidName(petName);
      const formulaIdentifier = petNames.get(petName);
      return formulaIdentifier;
    };

    /**
     * @param {string} petName
     * @param {string} formulaIdentifier
     */
    const write = async (petName, formulaIdentifier) => {
      assertValidName(petName);
      if (!validFormulaPattern.test(formulaIdentifier)) {
        throw new Error(`Invalid formula identifier ${q(formulaIdentifier)}`);
      }

      if (petNames.has(petName)) {
        // Perform cleanup on the overwritten pet name.
        const formulaPetNames = formulaIdentifiers.get(petName);
        if (formulaPetNames !== undefined) {
          formulaPetNames.delete(petName);
        }
        changesTopic.publisher.next({ remove: petName });
      }

      petNames.set(petName, formulaIdentifier);

      const formulaPetNames = formulaIdentifiers.get(formulaIdentifier);
      if (formulaPetNames === undefined) {
        formulaIdentifiers.set(formulaIdentifier, new Set([petName]));
      } else {
        formulaPetNames.add(petName);
      }

      const petNamePath = filePowers.joinPath(petNameDirectoryPath, petName);
      const petNameText = `${formulaIdentifier}\n`;
      await filePowers.writeFileText(petNamePath, petNameText);
      changesTopic.publisher.next({ add: petName });
    };

    const list = () => harden([...petNames.keys()].sort());
    const listWithId = () => list().map(petNameToNameIdPair);

    const mapForAddAndRemove = (mapFn) => {
      return (change) => {
        if ('add' in change) {
          return { add: mapFn(change.add) };
        } else if ('remove' in change) {
          return { remove: mapFn(change.remove) };
        }
        return undefined;
      }
    }
    const filterForAddAndRemove = (filterFn) => {
      return (change) => {
        if ('add' in change) {
          return filterFn(change.add);
        } else if ('remove' in change) {
          return filterFn(change.remove);
        }
        return false;
      }
    }

    const makeFollowIterator = () => {
      const changes = changesTopic.subscribe();
      return (async function* currentAndSubsequentNames() {
        for (const name of [...petNames.keys()].sort()) {
          yield { add: name };
        }
        yield* changes;
      })();
    }

    const makeFollowIteratorWithFilter = (filterFn) => {
      return (async function* currentAndSubsequentNames() {
        for await (const change of makeFollowIterator()) {
          if (filterFn(change)) {
            yield change;
          }
        }
      })();
    }

    const mapAsyncIterator = async function* (asyncIterator, mapFn) {
      for await (const value of asyncIterator) {
        yield mapFn(value);
      }
    }

    const follow = async () =>
      makeIteratorRef(
        makeFollowIterator(),
      );
    const followWithId = async () =>
      makeIteratorRef(
        mapAsyncIterator(
          makeFollowIterator(),
          mapForAddAndRemove(
            petNameToNameIdPair,
          ),
        ),
      );


    /** @param {string} type */
    const followQueryByType = async (type) => {
      return makeIteratorRef(
        makeFollowIteratorWithFilter(
          filterForAddAndRemove(name => {
            const formulaIdentifier = petNames.get(name);
            if (formulaIdentifier === undefined) {
              return false;
            }
            return formulaIdentifier.startsWith(`${type}:`)
          }),
        ),
      );
    }

    /**
     * @param {string} petName
     */
    const remove = async petName => {
      assertValidName(petName);
      const formulaIdentifier = petNames.get(petName);
      if (formulaIdentifier === undefined) {
        throw new Error(
          `Formula does not exist for pet name ${JSON.stringify(petName)}`,
        );
      }
      if (!validFormulaPattern.test(formulaIdentifier)) {
        throw new Error(`Invalid formula identifier ${q(formulaIdentifier)}`);
      }

      const petNamePath = filePowers.joinPath(petNameDirectoryPath, petName);
      await filePowers.removePath(petNamePath);
      petNames.delete(petName);
      const formulaPetNames = formulaIdentifiers.get(petName);
      if (formulaPetNames !== undefined) {
        formulaPetNames.delete(petName);
      }
      changesTopic.publisher.next({ remove: petName });
      // TODO consider retaining a backlog of deleted names for recovery
      // TODO consider tracking historical pet names for formulas
    };

    /**
     * @param {string} fromName
     * @param {string} toName
     */
    const rename = async (fromName, toName) => {
      assertValidName(fromName);
      assertValidName(toName);
      if (fromName === toName) {
        return;
      }
      const formulaIdentifier = petNames.get(fromName);
      const overwrittenFormulaIdentifier = petNames.get(toName);
      if (formulaIdentifier === undefined) {
        throw new Error(
          `Formula does not exist for pet name ${JSON.stringify(fromName)}`,
        );
      }
      if (!validFormulaPattern.test(formulaIdentifier)) {
        throw new Error(`Invalid formula identifier ${q(formulaIdentifier)}`);
      }
      if (
        overwrittenFormulaIdentifier !== undefined &&
        !validFormulaPattern.test(overwrittenFormulaIdentifier)
      ) {
        throw new Error(
          `Invalid formula identifier ${q(overwrittenFormulaIdentifier)}`,
        );
      }

      const fromPath = filePowers.joinPath(petNameDirectoryPath, fromName);
      const toPath = filePowers.joinPath(petNameDirectoryPath, toName);
      await filePowers.renamePath(fromPath, toPath);
      petNames.set(toName, formulaIdentifier);
      petNames.delete(fromName);

      // Delete the back-reference for the overwritten pet name if it existed.
      if (overwrittenFormulaIdentifier !== undefined) {
        const overwrittenFormulaPetNames = formulaIdentifiers.get(
          overwrittenFormulaIdentifier,
        );
        if (overwrittenFormulaPetNames !== undefined) {
          overwrittenFormulaPetNames.delete(toName);
        }
      }

      // Change the back-reference for the old pet name.
      const formulaPetNames = formulaIdentifiers.get(formulaIdentifier);
      if (formulaPetNames !== undefined) {
        formulaPetNames.delete(fromName);
        formulaPetNames.add(toName);
      }

      changesTopic.publisher.next({ add: toName });
      changesTopic.publisher.next({ remove: fromName });
      // TODO consider retaining a backlog of overwritten names for recovery
    };

    /**
     * @param {string} formulaIdentifier
     */
    const reverseLookup = formulaIdentifier => {
      if (!validFormulaPattern.test(formulaIdentifier)) {
        throw new Error(`Invalid formula identifier ${q(formulaIdentifier)}`);
      }
      const formulaPetNames = formulaIdentifiers.get(formulaIdentifier);
      if (formulaPetNames === undefined) {
        return harden([]);
      }
      return harden([...formulaPetNames]);
    };

    /** @type {import('./types.js').PetStore} */
    const petStore = {
      has,
      queryByType,
      followQueryByType,
      lookup,
      reverseLookup,
      list,
      listWithId,
      follow,
      followWithId,
      write,
      remove,
      rename,
      getIdForFormulaIdentifier,
    };

    return Far('PetStore', petStore);
  };

  /**
   * @param {string} id
   * @param {(name: string) => void} assertValidName
   */
  const makeIdentifiedPetStore = (id, assertValidName) => {
    if (!validIdPattern.test(id)) {
      throw new Error(`Invalid identifier for pet store ${q(id)}`);
    }
    const prefix = id.slice(0, 2);
    const suffix = id.slice(3);
    const petNameDirectoryPath = filePowers.joinPath(
      locator.statePath,
      'pet-store-id512',
      prefix,
      suffix,
    );
    return makePetStoreAtPath(petNameDirectoryPath, assertValidName);
  };

  /**
   * @param {string} name
   * @param {(name: string) => void} assertValidName
   */
  const makeOwnPetStore = (name, assertValidName) => {
    const petNameDirectoryPath = filePowers.joinPath(locator.statePath, name);
    return makePetStoreAtPath(petNameDirectoryPath, assertValidName);
  };

  return {
    makeIdentifiedPetStore,
    makeOwnPetStore,
  };
};
