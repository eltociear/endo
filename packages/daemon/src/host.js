// @ts-check

import { E, Far } from '@endo/far';
import { makeIteratorRef } from './reader-ref.js';
import { assertPetName, petNamePathFrom } from './pet-name.js';
import { makePetSitter } from './pet-sitter.js';
import { makeDeferredTasks } from './deferred-tasks.js';
import { parseId } from './formula-identifier.js';

const { quote: q } = assert;

/** @param {string} name */
const assertPowersName = name => {
  ['NONE', 'SELF', 'ENDO'].includes(name) || assertPetName(name);
};

/**
 * @param {object} args
 * @param {import('./types.js').DaemonCore['provideValueForFormulaIdentifier']} args.provideValueForFormulaIdentifier
 * @param {import('./types.js').DaemonCore['provideControllerForFormulaIdentifier']} args.provideControllerForFormulaIdentifier
 * @param {import('./types.js').DaemonCore['cancelValue']} args.cancelValue
 * @param {import('./types.js').DaemonCore['incarnateWorker']} args.incarnateWorker
 * @param {import('./types.js').DaemonCore['incarnateHost']} args.incarnateHost
 * @param {import('./types.js').DaemonCore['incarnateGuest']} args.incarnateGuest
 * @param {import('./types.js').DaemonCore['incarnateEval']} args.incarnateEval
 * @param {import('./types.js').DaemonCore['incarnateUnconfined']} args.incarnateUnconfined
 * @param {import('./types.js').DaemonCore['incarnateBundle']} args.incarnateBundle
 * @param {import('./types.js').DaemonCore['incarnateWebBundle']} args.incarnateWebBundle
 * @param {import('./types.js').DaemonCore['incarnateReadableBlob']} args.incarnateReadableBlob
 * @param {import('./types.js').DaemonCore['getAllNetworkAddresses']} args.getAllNetworkAddresses
 * @param {import('./types.js').MakeMailbox} args.makeMailbox
 * @param {import('./types.js').MakeDirectoryNode} args.makeDirectoryNode
 * @param {string} args.ownNodeIdentifier
 */
export const makeHostMaker = ({
  provideValueForFormulaIdentifier,
  provideControllerForFormulaIdentifier,
  cancelValue,
  incarnateWorker,
  incarnateHost,
  incarnateGuest,
  incarnateEval,
  incarnateUnconfined,
  incarnateBundle,
  incarnateWebBundle,
  incarnateReadableBlob,
  getAllNetworkAddresses,
  makeMailbox,
  makeDirectoryNode,
  ownNodeIdentifier,
}) => {
  /**
   * @param {string} hostFormulaIdentifier
   * @param {string} storeFormulaIdentifier
   * @param {string} inspectorFormulaIdentifier
   * @param {string} mainWorkerFormulaIdentifier
   * @param {string} endoFormulaIdentifier
   * @param {string} networksDirectoryFormulaIdentifier
   * @param {string} leastAuthorityFormulaIdentifier
   * @param {import('./types.js').Context} context
   */
  const makeIdentifiedHost = async (
    hostFormulaIdentifier,
    storeFormulaIdentifier,
    inspectorFormulaIdentifier,
    mainWorkerFormulaIdentifier,
    endoFormulaIdentifier,
    networksDirectoryFormulaIdentifier,
    leastAuthorityFormulaIdentifier,
    context,
  ) => {
    context.thisDiesIfThatDies(storeFormulaIdentifier);
    context.thisDiesIfThatDies(mainWorkerFormulaIdentifier);

    const basePetStore = /** @type {import('./types.js').PetStore} */ (
      // Behold, recursion:
      // eslint-disable-next-line no-use-before-define
      await provideValueForFormulaIdentifier(storeFormulaIdentifier)
    );
    const specialStore = makePetSitter(basePetStore, {
      SELF: hostFormulaIdentifier,
      ENDO: endoFormulaIdentifier,
      NETS: networksDirectoryFormulaIdentifier,
      INFO: inspectorFormulaIdentifier,
      NONE: leastAuthorityFormulaIdentifier,
    });

    const mailbox = makeMailbox({
      petStore: specialStore,
      selfFormulaIdentifier: hostFormulaIdentifier,
      context,
    });
    const { petStore } = mailbox;
    const directory = makeDirectoryNode(petStore);
    const { lookup } = directory;

    const getEndoBootstrap = async () => {
      const endoBootstrap =
        /** @type {import('./types.js').FarEndoBootstrap} */ (
          await provideValueForFormulaIdentifier(endoFormulaIdentifier)
        );
      return endoBootstrap;
    };

    /**
     * @param {import('@endo/eventual-send').ERef<AsyncIterableIterator<string>>} readerRef
     * @param {string} [petName]
     */
    const store = async (readerRef, petName) => {
      /** @type {import('./types.js').DeferredTasks<import('./types.js').ReadableBlobDeferredTaskParams>} */
      const tasks = makeDeferredTasks();

      // TODO: Does it ever make sense to not have a name?
      if (petName !== undefined) {
        assertPetName(petName);
        tasks.push(identifiers =>
          petStore.write(petName, identifiers.readableBlobFormulaIdentifier),
        );
      }

      // TODO: Should we not return the value?
      await incarnateReadableBlob(readerRef, tasks);
    };

    /**
     * @param {string} workerName
     */
    const provideWorker = async workerName => {
      if (typeof workerName !== 'string') {
        throw new Error('worker name must be string');
      }
      let workerFormulaIdentifier = petStore.identifyLocal(workerName);
      if (workerFormulaIdentifier === undefined) {
        ({ formulaIdentifier: workerFormulaIdentifier } =
          await incarnateWorker());
        assertPetName(workerName);
        await petStore.write(workerName, workerFormulaIdentifier);
      } else if (!workerFormulaIdentifier.startsWith('worker:')) {
        throw new Error(`Not a worker ${q(workerName)}`);
      }
      return /** @type {Promise<import('./types.js').EndoWorker>} */ (
        // Behold, recursion:
        // eslint-disable-next-line no-use-before-define
        provideValueForFormulaIdentifier(workerFormulaIdentifier)
      );
    };

    /**
     * @param {string | 'MAIN' | 'NEW'} workerName
     * @param {import('./types.js').DeferredTasks<{ workerFormulaIdentifier: string }>['push']} deferTask
     * @returns {string | undefined}
     */
    const prepareWorkerFormulaIdentifier = (workerName, deferTask) => {
      if (workerName === 'MAIN') {
        return mainWorkerFormulaIdentifier;
      } else if (workerName === 'NEW') {
        return undefined;
      }

      assertPetName(workerName);
      const workerFormulaIdentifier = petStore.identifyLocal(workerName);
      if (workerFormulaIdentifier === undefined) {
        deferTask(identifiers =>
          petStore.write(workerName, identifiers.workerFormulaIdentifier),
        );
      }
      return workerFormulaIdentifier;
    };

    /**
     * @param {string | 'NONE' | 'SELF' | 'ENDO'} partyName
     * @param {import('./types.js').DeferredTasks<{ powersFormulaIdentifier: string }>['push']} deferTask
     * @returns {string | undefined}
     */
    const preparePowersFormulaIdentifier = (partyName, deferTask) => {
      const powersFormulaIdentifier = petStore.identifyLocal(partyName);
      if (powersFormulaIdentifier === undefined) {
        deferTask(identifiers =>
          petStore.write(partyName, identifiers.powersFormulaIdentifier),
        );
      }
      return powersFormulaIdentifier;
    };

    /**
     * @param {string | 'MAIN' | 'NEW'} workerName
     * @param {string} source
     * @param {string[]} codeNames
     * @param {(string | string[])[]} petNamePaths
     * @param {string} resultName
     */
    const evaluate = async (
      workerName,
      source,
      codeNames,
      petNamePaths,
      resultName,
    ) => {
      if (resultName !== undefined) {
        assertPetName(resultName);
      }
      if (petNamePaths.length !== codeNames.length) {
        throw new Error('Evaluator requires one pet name for each code name');
      }

      /** @type {import('./types.js').DeferredTasks<import('./types.js').EvalDeferredTaskParams>} */
      const tasks = makeDeferredTasks();

      const workerFormulaIdentifier = prepareWorkerFormulaIdentifier(
        workerName,
        tasks.push,
      );

      /** @type {(string | string[])[]} */
      const endowmentFormulaIdsOrPaths = petNamePaths.map(
        (petNameOrPath, index) => {
          if (typeof codeNames[index] !== 'string') {
            throw new Error(`Invalid endowment name: ${q(codeNames[index])}`);
          }

          const petNamePath = petNamePathFrom(petNameOrPath);
          if (petNamePath.length === 1) {
            const formulaIdentifier = petStore.identifyLocal(petNamePath[0]);
            if (formulaIdentifier === undefined) {
              throw new Error(`Unknown pet name ${q(petNamePath[0])}`);
            }
            return formulaIdentifier;
          }

          return petNamePath;
        },
      );

      if (resultName !== undefined) {
        tasks.push(identifiers =>
          petStore.write(resultName, identifiers.evalFormulaIdentifier),
        );
      }

      const { value } = await incarnateEval(
        hostFormulaIdentifier,
        source,
        codeNames,
        endowmentFormulaIdsOrPaths,
        tasks,
        workerFormulaIdentifier,
      );
      return value;
    };

    /**
     * Helper function for makeUnconfined and makeBundle.
     * @param {string} powersName
     * @param {string} workerName
     * @param {string} [resultName]
     */
    const prepareMakeCaplet = (powersName, workerName, resultName) => {
      assertPowersName(powersName);

      /** @type {import('./types.js').DeferredTasks<import('./types.js').MakeCapletDeferredTaskParams>} */
      const tasks = makeDeferredTasks();

      const workerFormulaIdentifier = prepareWorkerFormulaIdentifier(
        workerName,
        tasks.push,
      );

      const powersFormulaIdentifier = preparePowersFormulaIdentifier(
        powersName,
        tasks.push,
      );

      if (resultName !== undefined) {
        tasks.push(identifiers =>
          petStore.write(resultName, identifiers.capletFormulaIdentifier),
        );
      }

      return { tasks, workerFormulaIdentifier, powersFormulaIdentifier };
    };

    /** @type {import('./types.js').EndoHost['makeUnconfined']} */
    const makeUnconfined = async (
      workerName,
      specifier,
      powersName,
      resultName,
    ) => {
      const { tasks, workerFormulaIdentifier, powersFormulaIdentifier } =
        prepareMakeCaplet(powersName, workerName, resultName);

      // Behold, recursion:
      // eslint-disable-next-line no-use-before-define
      const { value } = await incarnateUnconfined(
        hostFormulaIdentifier,
        specifier,
        tasks,
        workerFormulaIdentifier,
        powersFormulaIdentifier,
      );
      return value;
    };

    /**
     * @param {string | 'MAIN' | 'NEW'} workerName
     * @param {string} bundleName
     * @param {string | 'NONE' | 'SELF' | 'ENDO'} powersName
     * @param {string} resultName
     */
    const makeBundle = async (
      workerName,
      bundleName,
      powersName,
      resultName,
    ) => {
      const bundleFormulaIdentifier = petStore.identifyLocal(bundleName);
      if (bundleFormulaIdentifier === undefined) {
        throw new TypeError(`Unknown pet name for bundle: ${q(bundleName)}`);
      }

      const { tasks, workerFormulaIdentifier, powersFormulaIdentifier } =
        prepareMakeCaplet(powersName, workerName, resultName);

      // Behold, recursion:
      // eslint-disable-next-line no-use-before-define
      const { value } = await incarnateBundle(
        hostFormulaIdentifier,
        bundleFormulaIdentifier,
        tasks,
        workerFormulaIdentifier,
        powersFormulaIdentifier,
      );
      return value;
    };

    /**
     * Attempts to introduce the given names to the specified party. The party in question
     * must be incarnated before this function is called.
     *
     * @param {string} formulaIdentifier - The party's formula identifier.
     * @param {Record<string,string>} introducedNames - The names to introduce.
     * @returns {Promise<void>}
     */
    const introduceNamesToParty = async (
      formulaIdentifier,
      introducedNames,
    ) => {
      /** @type {import('./types.js').Controller<any, any>} */
      const controller =
        provideControllerForFormulaIdentifier(formulaIdentifier);
      const { petStore: newPetStore } = await controller.internal;
      await Promise.all(
        Object.entries(introducedNames).map(async ([parentName, childName]) => {
          const introducedFormulaIdentifier =
            petStore.identifyLocal(parentName);
          if (introducedFormulaIdentifier === undefined) {
            return;
          }
          await newPetStore.write(childName, introducedFormulaIdentifier);
        }),
      );
    };

    /**
     * @param {'guest' | 'host'} formulaType - The party's formula type.
     * @param {string} [petName] - The party's potential pet name.
     */
    const getNamedParty = (formulaType, petName) => {
      if (petName !== undefined) {
        const formulaIdentifier = petStore.identifyLocal(petName);
        if (formulaIdentifier !== undefined) {
          if (parseId(formulaIdentifier).type !== formulaType) {
            throw new Error(
              `Existing pet name does not designate a ${formulaType} powers capability: ${q(
                petName,
              )}`,
            );
          }

          return {
            formulaIdentifier,
            value: /** @type {Promise<any>} */ (
              provideControllerForFormulaIdentifier(formulaIdentifier).external
            ),
          };
        }
      }
      return undefined;
    };

    /**
     * @param {string} [petName] - The pet name of the party.
     */
    const getDeferredTasksForParty = petName => {
      /** @type {import('./types.js').DeferredTasks<import('./types.js').PartyDeferredTaskParams>} */
      const tasks = makeDeferredTasks();
      if (petName !== undefined) {
        tasks.push(identifiers =>
          petStore.write(petName, identifiers.partyFormulaIdentifier),
        );
      }
      return tasks;
    };

    /**
     * @param {string} [petName]
     * @param {import('./types.js').MakeHostOrGuestOptions} [opts]
     * @returns {Promise<{formulaIdentifier: string, value: Promise<import('./types.js').EndoHost>}>}
     */
    const makeHost = async (petName, { introducedNames = {} } = {}) => {
      let host = getNamedParty('host', petName);
      if (host === undefined) {
        const { value, formulaIdentifier } =
          // Behold, recursion:
          await incarnateHost(
            endoFormulaIdentifier,
            networksDirectoryFormulaIdentifier,
            leastAuthorityFormulaIdentifier,
            getDeferredTasksForParty(petName),
          );
        host = { value: Promise.resolve(value), formulaIdentifier };
      }

      await introduceNamesToParty(host.formulaIdentifier, introducedNames);

      /** @type {{ formulaIdentifier: string, value: Promise<import('./types.js').EndoHost> }} */
      return host;
    };

    /** @type {import('./types.js').EndoHost['provideHost']} */
    const provideHost = async (petName, opts) => {
      const { value } = await makeHost(petName, opts);
      return value;
    };

    /**
     * @param {string} [petName]
     * @param {import('./types.js').MakeHostOrGuestOptions} [opts]
     * @returns {Promise<{formulaIdentifier: string, value: Promise<import('./types.js').EndoGuest>}>}
     */
    const makeGuest = async (petName, { introducedNames = {} } = {}) => {
      let guest = getNamedParty('guest', petName);
      if (guest === undefined) {
        const { value, formulaIdentifier } =
          // Behold, recursion:
          await incarnateGuest(
            hostFormulaIdentifier,
            getDeferredTasksForParty(petName),
          );
        guest = { value: Promise.resolve(value), formulaIdentifier };
      }

      await introduceNamesToParty(guest.formulaIdentifier, introducedNames);

      /** @type {{ formulaIdentifier: string, value: Promise<import('./types.js').EndoGuest> }} */
      return guest;
    };

    /** @type {import('./types.js').EndoHost['provideGuest']} */
    const provideGuest = async (petName, opts) => {
      const { value } = await makeGuest(petName, opts);
      return value;
    };

    /**
     * @param {string | 'NONE' | 'SELF' | 'ENDO'} partyName
     * @returns {Promise<string>}
     */
    const providePowersFormulaIdentifier = async partyName => {
      let guestFormulaIdentifier = petStore.identifyLocal(partyName);
      if (guestFormulaIdentifier === undefined) {
        ({ formulaIdentifier: guestFormulaIdentifier } = await makeGuest(
          partyName,
        ));
        if (guestFormulaIdentifier === undefined) {
          throw new Error(
            `panic: makeGuest must return a guest with a corresponding formula identifier`,
          );
        }
      }
      return guestFormulaIdentifier;
    };

    /**
     * @param {string} webPageName
     * @param {string} bundleName
     * @param {string | 'NONE' | 'SELF' | 'ENDO'} powersName
     */
    const provideWebPage = async (webPageName, bundleName, powersName) => {
      const bundleFormulaIdentifier = petStore.identifyLocal(bundleName);
      if (bundleFormulaIdentifier === undefined) {
        throw new Error(`Unknown pet name: ${q(bundleName)}`);
      }

      const powersFormulaIdentifier = await providePowersFormulaIdentifier(
        powersName,
      );

      // Behold, recursion:
      const { value, formulaIdentifier } = await incarnateWebBundle(
        powersFormulaIdentifier,
        bundleFormulaIdentifier,
      );

      if (webPageName !== undefined) {
        assertPetName(webPageName);
        await petStore.write(webPageName, formulaIdentifier);
      }

      return value;
    };

    /** @type {import('./types.js').EndoHost['cancel']} */
    const cancel = async (petName, reason = new Error('Cancelled')) => {
      const formulaIdentifier = petStore.identifyLocal(petName);
      if (formulaIdentifier === undefined) {
        throw new TypeError(`Unknown pet name: ${q(petName)}`);
      }
      return cancelValue(formulaIdentifier, reason);
    };

    /** @type {import('./types.js').EndoHost['gateway']} */
    const gateway = async () => {
      const endoBootstrap = getEndoBootstrap();
      return E(endoBootstrap).gateway();
    };

    /** @type {import('./types.js').EndoHost['addPeerInfo']} */
    const addPeerInfo = async peerInfo => {
      const endoBootstrap = getEndoBootstrap();
      await E(endoBootstrap).addPeerInfo(peerInfo);
    };

    /** @type {import('./types.js').EndoHost['getPeerInfo']} */
    const getPeerInfo = async () => {
      const addresses = await getAllNetworkAddresses(
        networksDirectoryFormulaIdentifier,
      );
      const peerInfo = {
        node: ownNodeIdentifier,
        addresses,
      };
      return peerInfo;
    };

    const {
      has,
      identify,
      list,
      listIdentifiers,
      followChanges,
      reverseLookup,
      write,
      remove,
      move,
      copy,
      makeDirectory,
    } = directory;
    const {
      listMessages,
      followMessages,
      resolve,
      reject,
      adopt,
      dismiss,
      request,
      send,
      receive,
      respond,
    } = mailbox;

    /** @type {import('./types.js').EndoHost} */
    const host = {
      // Directory
      has,
      identify,
      list,
      listIdentifiers,
      followChanges,
      lookup,
      reverseLookup,
      write,
      remove,
      move,
      copy,
      makeDirectory,
      // Mail
      listMessages,
      followMessages,
      resolve,
      reject,
      adopt,
      dismiss,
      request,
      send,
      // Host
      store,
      provideGuest,
      provideHost,
      provideWorker,
      evaluate,
      makeUnconfined,
      makeBundle,
      provideWebPage,
      cancel,
      gateway,
      getPeerInfo,
      addPeerInfo,
    };

    const external = Far('EndoHost', {
      ...host,
      followChanges: () => makeIteratorRef(host.followChanges()),
      followMessages: () => makeIteratorRef(host.followMessages()),
    });
    const internal = harden({ receive, respond, petStore });

    await provideValueForFormulaIdentifier(mainWorkerFormulaIdentifier);

    return harden({ external, internal });
  };

  return makeIdentifiedHost;
};
