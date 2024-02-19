// @ts-check
/// <reference types="ses"/>

/* global setTimeout, clearTimeout */

import { E, Far } from '@endo/far';
import { makePromiseKit } from '@endo/promise-kit';
import { q } from '@endo/errors';
import { makeRefReader } from './ref-reader.js';
import { makeMailboxMaker } from './mail.js';
import { makeGuestMaker } from './guest.js';
import { makeHostMaker } from './host.js';
import { assertPetName } from './pet-name.js';
import { makeContextMaker } from './context.js';
import { parseFormulaIdentifier } from './formula-identifier.js';

const delay = async (ms, cancelled) => {
  // Do not attempt to set up a timer if already cancelled.
  await Promise.race([cancelled, undefined]);
  return new Promise((resolve, reject) => {
    const handle = setTimeout(resolve, ms);
    cancelled.catch(error => {
      reject(error);
      clearTimeout(handle);
    });
  });
};

/**
 * Creates an inspector object for a formula.
 *
 * @param {string} type - The formula type.
 * @param {string} number - The formula number.
 * @param {Record<string, unknown>} record - A mapping from special names to formula values.
 * @returns {import('./types.js').EndoInspector} The inspector for the given formula.
 */
const makeInspector = (type, number, record) =>
  Far(`Inspector (${type} ${number})`, {
    lookup: async petName => {
      if (!Object.hasOwn(record, petName)) {
        return undefined;
      }
      return record[petName];
    },
    list: () => Object.keys(record),
  });

/**
 * @param {import('./types.js').DaemonicPowers} powers
 * @param {Promise<number>} webletPortP
 * @param {object} args
 * @param {Promise<never>} args.cancelled
 * @param {(error: Error) => void} args.cancel
 * @param {number} args.gracePeriodMs
 * @param {Promise<never>} args.gracePeriodElapsed
 */
const makeDaemonCore = async (
  powers,
  webletPortP,
  { cancelled, cancel, gracePeriodMs, gracePeriodElapsed },
) => {
  const {
    crypto: cryptoPowers,
    petStore: petStorePowers,
    persistence: persistencePowers,
    control: controlPowers,
  } = powers;
  const { randomHex512, makeSha512 } = cryptoPowers;
  const derive = (...path) => {
    const digester = makeSha512();
    digester.updateText(path.join(':'));
    return digester.digestHex();
  };

  const contentStore = persistencePowers.makeContentSha512Store();

  /** @type {Map<string, import('./types.js').Controller<>>} */
  const controllerForFormulaIdentifier = new Map();
  // Reverse look-up, for answering "what is my name for this near or far
  // reference", and not for "what is my name for this promise".
  /** @type {WeakMap<object, string>} */
  const formulaIdentifierForRef = new WeakMap();
  const getFormulaIdentifierForRef = ref => formulaIdentifierForRef.get(ref);

  /**
   * @param {string} sha512
   * @returns {import('./types.js').FarEndoReadable}
   */
  const makeReadableBlob = sha512 => {
    const { text, json, streamBase64 } = contentStore.fetch(sha512);
    return Far(`Readable file with SHA-512 ${sha512.slice(0, 8)}...`, {
      sha512: () => sha512,
      streamBase64,
      text,
      json,
    });
  };

  /**
   * @param {import('@endo/eventual-send').ERef<AsyncIterableIterator<string>>} readerRef
   */
  const storeReaderRef = async readerRef => {
    const sha512Hex = await contentStore.store(makeRefReader(readerRef));
    // eslint-disable-next-line no-use-before-define
    const { formulaIdentifier } = await incarnateReadableBlob(sha512Hex);
    return formulaIdentifier;
  };

  /**
   * @param {string} workerId512
   */
  const makeWorkerBootstrap = async workerId512 => {
    // TODO validate workerId512
    return Far(`Endo for worker ${workerId512}`, {});
  };

  /**
   * @param {string} workerId512
   * @param {import('./types.js').Context} context
   */
  const makeIdentifiedWorkerController = async (workerId512, context) => {
    // TODO validate workerId512
    const daemonWorkerFacet = makeWorkerBootstrap(workerId512);

    const { promise: forceCancelled, reject: forceCancel } =
      /** @type {import('@endo/promise-kit').PromiseKit<never>} */ (
        makePromiseKit()
      );

    const { workerTerminated, workerDaemonFacet } =
      await controlPowers.makeWorker(
        workerId512,
        daemonWorkerFacet,
        Promise.race([forceCancelled, gracePeriodElapsed]),
      );

    const gracefulCancel = async () => {
      E.sendOnly(workerDaemonFacet).terminate();
      const cancelWorkerGracePeriod = () => {
        throw new Error('Exited gracefully before grace period elapsed');
      };
      const workerGracePeriodCancelled = Promise.race([
        gracePeriodElapsed,
        workerTerminated,
      ]).then(cancelWorkerGracePeriod, cancelWorkerGracePeriod);
      await delay(gracePeriodMs, workerGracePeriodCancelled)
        .then(() => {
          throw new Error(
            `Worker termination grace period ${gracePeriodMs}ms elapsed`,
          );
        })
        .catch(forceCancel);
      await workerTerminated;
    };

    context.onCancel(gracefulCancel);

    const worker = Far('EndoWorker', {});

    return {
      external: worker,
      internal: workerDaemonFacet,
    };
  };

  /**
   * @param {string} workerFormulaIdentifier
   * @param {string} source
   * @param {Array<string>} codeNames
   * @param {Array<string>} formulaIdentifiers
   * @param {import('./types.js').Context} context
   */
  const makeControllerForEval = async (
    workerFormulaIdentifier,
    source,
    codeNames,
    formulaIdentifiers,
    context,
  ) => {
    context.thisDiesIfThatDies(workerFormulaIdentifier);
    for (const formulaIdentifier of formulaIdentifiers) {
      context.thisDiesIfThatDies(formulaIdentifier);
    }

    const workerController =
      /** @type {import('./types.js').Controller<unknown, import('./worker.js').WorkerBootstrap>} */ (
        // Behold, recursion:
        // eslint-disable-next-line no-use-before-define
        provideControllerForFormulaIdentifier(workerFormulaIdentifier)
      );
    const workerDaemonFacet = workerController.internal;
    assert(
      workerDaemonFacet,
      `panic: No internal bootstrap for worker ${workerFormulaIdentifier}`,
    );

    const endowmentValues = await Promise.all(
      formulaIdentifiers.map(formulaIdentifier =>
        // Behold, recursion:
        // eslint-disable-next-line no-use-before-define
        provideValueForFormulaIdentifier(formulaIdentifier),
      ),
    );

    const external = E(workerDaemonFacet).evaluate(
      source,
      codeNames,
      endowmentValues,
      context.cancelled,
    );

    // TODO check whether the promise resolves to data that can be marshalled
    // into the content-address-store and truncate the dependency chain.
    // That will require some funny business around allowing eval formulas to
    // have a level of indirection where the settled formula depends on how
    // the indirect formula resolves.
    // That might mean racing two formulas and terminating the evaluator
    // if it turns out the value can be captured.

    return { external, internal: undefined };
  };

  /**
   * Creates a controller for a `lookup` formula. The external facet is the
   * resolved value of the lookup.
   *
   * @param {string} hubFormulaIdentifier
   * @param {string[]} path
   * @param {import('./types.js').Context} context
   */
  const makeControllerForLookup = async (
    hubFormulaIdentifier,
    path,
    context,
  ) => {
    context.thisDiesIfThatDies(hubFormulaIdentifier);

    // Behold, recursion:
    // eslint-disable-next-line no-use-before-define
    const hub = provideValueForFormulaIdentifier(hubFormulaIdentifier);
    // @ts-expect-error calling lookup on an unknown object
    const external = E(hub).lookup(...path);
    return { external, internal: undefined };
  };

  /**
   * @param {string} workerFormulaIdentifier
   * @param {string} guestFormulaIdentifier
   * @param {string} specifier
   * @param {import('./types.js').Context} context
   */
  const makeControllerForUnconfinedPlugin = async (
    workerFormulaIdentifier,
    guestFormulaIdentifier,
    specifier,
    context,
  ) => {
    context.thisDiesIfThatDies(workerFormulaIdentifier);
    context.thisDiesIfThatDies(guestFormulaIdentifier);

    const workerController =
      /** @type {import('./types.js').Controller<unknown, import('./worker.js').WorkerBootstrap>} */ (
        // Behold, recursion:
        // eslint-disable-next-line no-use-before-define
        provideControllerForFormulaIdentifier(workerFormulaIdentifier)
      );
    const workerDaemonFacet = workerController.internal;
    assert(
      workerDaemonFacet,
      `panic: No internal bootstrap for worker ${workerFormulaIdentifier}`,
    );
    const guestP = /** @type {Promise<import('./types.js').EndoGuest>} */ (
      // Behold, recursion:
      // eslint-disable-next-line no-use-before-define
      provideValueForFormulaIdentifier(guestFormulaIdentifier)
    );
    const external = E(workerDaemonFacet).makeUnconfined(specifier, guestP);
    return { external, internal: undefined };
  };

  /**
   * @param {string} workerFormulaIdentifier
   * @param {string} guestFormulaIdentifier
   * @param {string} bundleFormulaIdentifier
   * @param {import('./types.js').Context} context
   */
  const makeControllerForSafeBundle = async (
    workerFormulaIdentifier,
    guestFormulaIdentifier,
    bundleFormulaIdentifier,
    context,
  ) => {
    context.thisDiesIfThatDies(workerFormulaIdentifier);
    context.thisDiesIfThatDies(guestFormulaIdentifier);

    const workerController =
      /** @type {import('./types.js').Controller<unknown, import('./worker.js').WorkerBootstrap>} */ (
        // Behold, recursion:
        // eslint-disable-next-line no-use-before-define
        provideControllerForFormulaIdentifier(workerFormulaIdentifier)
      );
    const workerDaemonFacet = workerController.internal;
    assert(
      workerDaemonFacet,
      `panic: No internal bootstrap for worker ${workerFormulaIdentifier}`,
    );
    // Behold, recursion:
    // eslint-disable-next-line no-use-before-define
    const readableBundleP =
      /** @type {Promise<import('./types.js').EndoReadable>} */ (
        // Behold, recursion:
        // eslint-disable-next-line no-use-before-define
        provideValueForFormulaIdentifier(bundleFormulaIdentifier)
      );
    const guestP = /** @type {Promise<import('./types.js').EndoGuest>} */ (
      // Behold, recursion:
      // eslint-disable-next-line no-use-before-define
      provideValueForFormulaIdentifier(guestFormulaIdentifier)
    );
    const external = E(workerDaemonFacet).makeBundle(readableBundleP, guestP);
    return { external, internal: undefined };
  };

  /**
   * @param {string} formulaIdentifier
   * @param {string} formulaNumber
   * @param {import('./types.js').Formula} formula
   * @param {import('./types.js').Context} context
   */
  const makeControllerForFormula = async (
    formulaIdentifier,
    formulaNumber,
    formula,
    context,
  ) => {
    if (formula.type === 'eval') {
      return makeControllerForEval(
        formula.worker,
        formula.source,
        formula.names,
        formula.values,
        context,
      );
    } else if (formula.type === 'readable-blob') {
      const external = makeReadableBlob(formula.content);
      return { external, internal: undefined };
    } else if (formula.type === 'lookup') {
      return makeControllerForLookup(formula.hub, formula.path, context);
    } else if (formula.type === 'make-unconfined') {
      return makeControllerForUnconfinedPlugin(
        formula.worker,
        formula.powers,
        formula.specifier,
        context,
      );
    } else if (formula.type === 'make-bundle') {
      return makeControllerForSafeBundle(
        formula.worker,
        formula.powers,
        formula.bundle,
        context,
      );
    } else if (formula.type === 'host') {
      // Behold, recursion:
      // eslint-disable-next-line no-use-before-define
      return makeIdentifiedHost(
        formulaIdentifier,
        formula.endo,
        formula.petStore,
        formula.inspector,
        formula.worker,
        formula.leastAuthority,
        context,
      );
    } else if (formula.type === 'guest') {
      const storeFormulaNumber = derive(formulaNumber, 'pet-store');
      const storeFormulaIdentifier = `pet-store:${storeFormulaNumber}`;
      const workerFormulaNumber = derive(formulaNumber, 'worker');
      const workerFormulaIdentifier = `worker:${workerFormulaNumber}`;
      // Behold, recursion:
      // eslint-disable-next-line no-use-before-define
      return makeIdentifiedGuestController(
        formulaIdentifier,
        formula.host,
        storeFormulaIdentifier,
        workerFormulaIdentifier,
        context,
      );
    } else if (formula.type === 'web-bundle') {
      // Behold, forward-reference:
      // eslint-disable-next-line no-use-before-define
      context.thisDiesIfThatDies(formula.bundle);
      context.thisDiesIfThatDies(formula.powers);
      return {
        external: (async () =>
          harden({
            url: `http://${formulaNumber}.endo.localhost:${await webletPortP}`,
            // Behold, recursion:
            // eslint-disable-next-line no-use-before-define
            bundle: provideValueForFormulaIdentifier(formula.bundle),
            // Behold, recursion:
            // eslint-disable-next-line no-use-before-define
            powers: provideValueForFormulaIdentifier(formula.powers),
          }))(),
        internal: undefined,
      };
    } else if (formula.type === 'handle') {
      context.thisDiesIfThatDies(formula.target);
      return {
        external: {},
        internal: {
          targetFormulaIdentifier: formula.target,
        },
      };
    } else if (formula.type === 'endo') {
      /** @type {import('./types.js').EndoBootstrap} */
      const endoBootstrap = Far('Endo private facet', {
        // TODO for user named
        ping: async () => 'pong',
        terminate: async () => {
          cancel(new Error('Termination requested'));
        },
        host: () => {
          // Behold, recursion:
          return /** @type {Promise<import('./types.js').EndoHost>} */ (
            // eslint-disable-next-line no-use-before-define
            provideValueForFormulaIdentifier(formula.host)
          );
        },
        leastAuthority: () => {
          // Behold, recursion:
          return /** @type {Promise<import('./types.js').EndoGuest>} */ (
            // eslint-disable-next-line no-use-before-define
            provideValueForFormulaIdentifier(formula.leastAuthority)
          );
        },
        webPageJs: () => {
          if (formula.webPageJs === undefined) {
            throw new Error('No web-page-js formula provided.');
          }
          // Behold, recursion:
          // eslint-disable-next-line no-use-before-define
          return provideValueForFormulaIdentifier(formula.webPageJs);
        },
        importAndEndowInWebPage: async (webPageP, webPageNumber) => {
          const { bundle: bundleBlob, powers: endowedPowers } =
            /** @type {import('./types.js').EndoWebBundle} */ (
              // Behold, recursion:
              // eslint-disable-next-line no-use-before-define
              await provideValueForFormulaIdentifier(
                `web-bundle:${webPageNumber}`,
              ).catch(() => {
                throw new Error('Not found');
              })
            );
          const bundle = await E(bundleBlob).json();
          await E(webPageP).makeBundle(bundle, endowedPowers);
        },
      });
      return {
        external: endoBootstrap,
        internal: undefined,
      };
    } else if (formula.type === 'least-authority') {
      /** @type {import('./types.js').EndoGuest} */
      const leastAuthority = Far('EndoGuest', {
        async request() {
          throw new Error('declined');
        },
      });
      return { external: leastAuthority, internal: undefined };
    } else {
      throw new TypeError(`Invalid formula: ${q(formula)}`);
    }
  };

  /**
   * @param {string} formulaType
   * @param {string} formulaNumber
   * @param {import('./types.js').Context} context
   */
  const makeControllerForFormulaIdentifier = async (
    formulaType,
    formulaNumber,
    context,
  ) => {
    const formulaIdentifier = `${formulaType}:${formulaNumber}`;
    if (formulaType === 'worker') {
      return makeIdentifiedWorkerController(formulaNumber, context);
    } else if (formulaType === 'pet-inspector') {
      const storeFormulaNumber = derive(formulaNumber, 'pet-store');
      const storeFormulaIdentifier = `pet-store:${storeFormulaNumber}`;
      // Behold, unavoidable forward-reference:
      // eslint-disable-next-line no-use-before-define
      const external = makePetStoreInspector(storeFormulaIdentifier);
      return { external, internal: undefined };
    } else if (formulaType === 'pet-store') {
      const external = petStorePowers.makeIdentifiedPetStore(
        formulaNumber,
        assertPetName,
      );
      return { external, internal: undefined };
    } else if (
      [
        'endo',
        'eval',
        'readable-blob',
        'make-unconfined',
        'make-bundle',
        'host',
        'guest',
        'least-authority',
        'web-bundle',
        'web-page-js',
        'handle',
      ].includes(formulaType)
    ) {
      const formula = await persistencePowers.readFormula(
        formulaType,
        formulaNumber,
      );
      // TODO validate
      return makeControllerForFormula(
        formulaIdentifier,
        formulaNumber,
        formula,
        context,
      );
    } else {
      throw new TypeError(
        `Invalid formula identifier, unrecognized type ${q(formulaIdentifier)}`,
      );
    }
  };

  // The two functions provideValueForFormula and provideValueForFormulaIdentifier
  // share a responsibility for maintaining the memoization tables
  // controllerForFormulaIdentifier and formulaIdentifierForRef, since the
  // former bypasses the latter in order to avoid a round trip with disk.
  /** @type {import('./types.js').ProvideValueForNumberedFormula} */
  const provideValueForNumberedFormula = async (
    formulaType,
    formulaNumber,
    formula,
  ) => {
    const formulaIdentifier = `${formulaType}:${formulaNumber}`;

    // Memoize for lookup.
    console.log(`Making ${formulaIdentifier}`);
    const { promise: partial, resolve } =
      /** @type {import('@endo/promise-kit').PromiseKit<import('./types.js').InternalExternal<>>} */ (
        makePromiseKit()
      );

    // Behold, recursion:
    // eslint-disable-next-line no-use-before-define
    const context = makeContext(formulaIdentifier);
    partial.catch(context.cancel);
    const controller = harden({
      context,
      external: E.get(partial).external.then(value => {
        if (typeof value === 'object' && value !== null) {
          formulaIdentifierForRef.set(value, formulaIdentifier);
        }
        return value;
      }),
      internal: E.get(partial).internal,
    });
    controllerForFormulaIdentifier.set(formulaIdentifier, controller);

    await persistencePowers.writeFormula(formula, formulaType, formulaNumber);
    resolve(
      makeControllerForFormula(
        formulaIdentifier,
        formulaNumber,
        formula,
        context,
      ),
    );

    return harden({
      formulaIdentifier,
      value: controller.external,
    });
  };

  /**
   * @param {import('./types.js').Formula} formula
   * @param {string} formulaType
   */
  const provideValueForFormula = async (formula, formulaType) => {
    const formulaNumber = await randomHex512();
    return provideValueForNumberedFormula(formulaType, formulaNumber, formula);
  };

  /** @type {import('./types.js').ProvideControllerForFormulaIdentifier} */
  const provideControllerForFormulaIdentifier = formulaIdentifier => {
    const { type: formulaType, number: formulaNumber } =
      parseFormulaIdentifier(formulaIdentifier);

    let controller = controllerForFormulaIdentifier.get(formulaIdentifier);
    if (controller !== undefined) {
      return controller;
    }

    console.log(`Making ${formulaIdentifier}`);
    const { promise: partial, resolve } =
      /** @type {import('@endo/promise-kit').PromiseKit<import('./types.js').InternalExternal<>>} */ (
        makePromiseKit()
      );

    // Behold, recursion:
    // eslint-disable-next-line no-use-before-define
    const context = makeContext(formulaIdentifier);
    partial.catch(context.cancel);
    controller = harden({
      context,
      external: E.get(partial).external,
      internal: E.get(partial).internal,
    });
    controllerForFormulaIdentifier.set(formulaIdentifier, controller);

    resolve(
      makeControllerForFormulaIdentifier(formulaType, formulaNumber, context),
    );

    return controller;
  };

  /** @type {import('./types.js').ProvideValueForFormulaIdentifier} */
  const provideValueForFormulaIdentifier = async formulaIdentifier => {
    const controller = /** @type {import('./types.js').Controller<>} */ (
      provideControllerForFormulaIdentifier(formulaIdentifier)
    );
    const value = await controller.external;
    if (typeof value === 'object' && value !== null) {
      formulaIdentifierForRef.set(value, formulaIdentifier);
    }
    return value;
  };

  /** @type {import('./types.js').ProvideControllerForFormulaIdentifierAndResolveHandle} */
  const provideControllerForFormulaIdentifierAndResolveHandle =
    async formulaIdentifier => {
      let currentFormulaIdentifier = formulaIdentifier;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const controller = provideControllerForFormulaIdentifier(
          currentFormulaIdentifier,
        );
        // eslint-disable-next-line no-await-in-loop
        const internalFacet = await controller.internal;
        if (internalFacet === undefined || internalFacet === null) {
          return controller;
        }
        // @ts-expect-error We can't know the type of the internal facet.
        if (internalFacet.targetFormulaIdentifier === undefined) {
          return controller;
        }
        const handle = /** @type {import('./types.js').InternalHandle} */ (
          internalFacet
        );
        currentFormulaIdentifier = handle.targetFormulaIdentifier;
      }
    };

  const makeContext = makeContextMaker({
    controllerForFormulaIdentifier,
    provideControllerForFormulaIdentifier,
  });

  const makeMailbox = makeMailboxMaker({
    getFormulaIdentifierForRef,
    provideValueForFormulaIdentifier,
    provideControllerForFormulaIdentifier,
    makeSha512,
    provideValueForNumberedFormula,
    provideControllerForFormulaIdentifierAndResolveHandle,
  });

  const makeIdentifiedGuestController = makeGuestMaker({
    provideValueForFormulaIdentifier,
    provideControllerForFormulaIdentifierAndResolveHandle,
    makeMailbox,
  });

  /**
   * @returns {Promise<{ formulaIdentifier: string, value: import('./types').EndoGuest }>}
   */
  const incarnateLeastAuthority = async () => {
    const formulaNumber = await randomHex512();
    /** @type {import('./types.js').LeastAuthorityFormula} */
    const formula = {
      type: 'least-authority',
    };
    return /** @type {Promise<{ formulaIdentifier: string, value: import('./types').EndoGuest }>} */ (
      provideValueForNumberedFormula(formula.type, formulaNumber, formula)
    );
  };

  /**
   * @param {string} targetFormulaIdentifier
   * @returns {Promise<{ formulaIdentifier: string, value: import('./types').Handle }>}
   */
  const incarnateHandle = async targetFormulaIdentifier => {
    const formulaNumber = await randomHex512();
    /** @type {import('./types.js').HandleFormula} */
    const formula = {
      type: 'handle',
      target: targetFormulaIdentifier,
    };
    return /** @type {Promise<{ formulaIdentifier: string, value: import('./types').Handle }>} */ (
      provideValueForNumberedFormula(formula.type, formulaNumber, formula)
    );
  };

  /**
   * @param {string} endoFormulaIdentifier
   * @param {string} leastAuthorityFormulaIdentifier
   * @param {string} [specifiedWorkerFormulaIdentifier]
   * @returns {Promise<{ formulaIdentifier: string, value: import('./types').EndoHost }>}
   */
  const incarnateHost = async (
    endoFormulaIdentifier,
    leastAuthorityFormulaIdentifier,
    specifiedWorkerFormulaIdentifier,
  ) => {
    const formulaNumber = await randomHex512();
    const workerFormulaIdentifier =
      specifiedWorkerFormulaIdentifier || `worker:${await randomHex512()}`;
    const inspectorFormulaNumber = derive(formulaNumber, 'pet-inspector');
    const inspectorFormulaIdentifier = `pet-inspector:${inspectorFormulaNumber}`;
    // Note the pet store formula number derivation path:
    // root -> host -> inspector -> pet store
    const storeFormulaNumber = derive(inspectorFormulaNumber, 'pet-store');
    const storeFormulaIdentifier = `pet-store:${storeFormulaNumber}`;
    /** @type {import('./types.js').HostFormula} */
    const formula = {
      type: 'host',
      petStore: storeFormulaIdentifier,
      inspector: inspectorFormulaIdentifier,
      worker: workerFormulaIdentifier,
      endo: endoFormulaIdentifier,
      leastAuthority: leastAuthorityFormulaIdentifier,
    };
    return /** @type {Promise<{ formulaIdentifier: string, value: import('./types').EndoHost }>} */ (
      provideValueForNumberedFormula('host', formulaNumber, formula)
    );
  };

  /**
   * @param {string} hostHandleFormulaIdentifier
   * @returns {Promise<{ formulaIdentifier: string, value: import('./types').EndoGuest }>}
   */
  const incarnateGuest = async hostHandleFormulaIdentifier => {
    const formulaNumber = await randomHex512();
    /** @type {import('./types.js').GuestFormula} */
    const formula = {
      type: 'guest',
      host: hostHandleFormulaIdentifier,
    };
    return /** @type {Promise<{ formulaIdentifier: string, value: import('./types').EndoGuest }>} */ (
      provideValueForNumberedFormula(formula.type, formulaNumber, formula)
    );
  };

  /**
   * @param {string} workerFormulaIdentifier
   * @param {string} source
   * @param {string[]} codeNames
   * @param {string[]} endowmentFormulaIdentifiers
   * @returns {Promise<{ formulaIdentifier: string, value: unknown }>}
   */
  const incarnateEval = async (
    workerFormulaIdentifier,
    source,
    codeNames,
    endowmentFormulaIdentifiers,
  ) => {
    const formulaNumber = await randomHex512();
    /** @type {import('./types.js').EvalFormula} */
    const formula = {
      type: 'eval',
      worker: workerFormulaIdentifier,
      source,
      names: codeNames,
      values: endowmentFormulaIdentifiers,
    };
    return /** @type {Promise<{ formulaIdentifier: string, value: unknown }>} */ (
      provideValueForNumberedFormula(formula.type, formulaNumber, formula)
    );
  };

  /**
   * @param {string} contentSha512
   * @returns {Promise<{ formulaIdentifier: string, value: import('./types.js').FarEndoReadable }>}
   */
  const incarnateReadableBlob = async contentSha512 => {
    const formulaNumber = await randomHex512();
    /** @type {import('./types.js').ReadableBlobFormula} */
    const formula = {
      type: 'readable-blob',
      content: contentSha512,
    };
    return /** @type {Promise<{ formulaIdentifier: string, value: import('./types.js').FarEndoReadable }>} */ (
      provideValueForNumberedFormula(formula.type, formulaNumber, formula)
    );
  };

  /**
   * @param {string} powersFormulaIdentifier
   * @param {string} workerFormulaIdentifier
   * @returns {Promise<{ formulaIdentifier: string, value: unknown }>}
   */
  const incarnateBundler = async (
    powersFormulaIdentifier,
    workerFormulaIdentifier,
  ) => {
    if (persistencePowers.getWebPageBundlerFormula === undefined) {
      throw Error('No web-page-js bundler formula provided.');
    }
    const formulaNumber = await randomHex512();
    const formula = persistencePowers.getWebPageBundlerFormula(
      powersFormulaIdentifier,
      workerFormulaIdentifier,
    );
    return provideValueForNumberedFormula(formula.type, formulaNumber, formula);
  };

  /**
   * @param {string} [specifiedFormulaNumber]
   * @returns {Promise<{ formulaIdentifier: string, value: import('./types').EndoBootstrap }>}
   */
  const incarnateEndoBootstrap = async specifiedFormulaNumber => {
    const formulaNumber = specifiedFormulaNumber || (await randomHex512());
    const endoFormulaIdentifier = `endo:${formulaNumber}`;
    const defaultHostWorkerFormulaIdentifier = `worker:${await randomHex512()}`;

    const { formulaIdentifier: leastAuthorityFormulaIdentifier } =
      await incarnateLeastAuthority();

    // Ensure the default host is incarnated and persisted.
    const { formulaIdentifier: defaultHostFormulaIdentifier } =
      await incarnateHost(
        endoFormulaIdentifier,
        leastAuthorityFormulaIdentifier,
        defaultHostWorkerFormulaIdentifier,
      );
    // If supported, ensure the web page bundler is incarnated and persisted.
    let webPageJsFormulaIdentifier;
    if (persistencePowers.getWebPageBundlerFormula !== undefined) {
      ({ formulaIdentifier: webPageJsFormulaIdentifier } =
        await incarnateBundler(
          defaultHostFormulaIdentifier,
          defaultHostWorkerFormulaIdentifier,
        ));
    }

    /** @type {import('./types.js').EndoFormula} */
    const formula = {
      type: 'endo',
      host: defaultHostFormulaIdentifier,
      leastAuthority: leastAuthorityFormulaIdentifier,
      webPageJs: webPageJsFormulaIdentifier,
    };
    return /** @type {Promise<{ formulaIdentifier: string, value: import('./types').EndoBootstrap }>} */ (
      provideValueForNumberedFormula(formula.type, formulaNumber, formula)
    );
  };

  const makeIdentifiedHost = makeHostMaker({
    provideValueForFormulaIdentifier,
    provideValueForFormula,
    provideValueForNumberedFormula,
    provideControllerForFormulaIdentifier,
    incarnateHost,
    incarnateGuest,
    incarnateEval,
    incarnateHandle,
    storeReaderRef,
    randomHex512,
    makeSha512,
    makeMailbox,
  });

  /**
   * Creates an inspector for the current party's pet store, used to create
   * inspectors for values therein. Notably, can provide references to otherwise
   * un-nameable values such as the `MAIN` worker. See `KnownEndoInspectors` for
   * more details.
   *
   * @param {string} petStoreFormulaIdentifier
   * @returns {Promise<import('./types').EndoInspector>}
   */
  const makePetStoreInspector = async petStoreFormulaIdentifier => {
    const petStore = /** @type {import('./types').PetStore} */ (
      await provideValueForFormulaIdentifier(petStoreFormulaIdentifier)
    );

    /**
     * @param {string} petName - The pet name to inspect.
     * @returns {Promise<import('./types').KnownEndoInspectors[string]>} An
     * inspector for the value of the given pet name.
     */
    const lookup = async petName => {
      const formulaIdentifier = petStore.identifyLocal(petName);
      if (formulaIdentifier === undefined) {
        throw new Error(`Unknown pet name ${petName}`);
      }
      const { type: formulaType, number: formulaNumber } =
        parseFormulaIdentifier(formulaIdentifier);
      if (
        ![
          'eval',
          'lookup',
          'make-unconfined',
          'make-bundle',
          'guest',
          'web-bundle',
        ].includes(formulaType)
      ) {
        return makeInspector(formulaType, formulaNumber, harden({}));
      }
      const formula = await persistencePowers.readFormula(
        formulaType,
        formulaNumber,
      );
      if (formula.type === 'eval') {
        return makeInspector(
          formula.type,
          formulaNumber,
          harden({
            endowments: Object.fromEntries(
              formula.names.map((name, index) => {
                return [
                  name,
                  provideValueForFormulaIdentifier(formula.values[index]),
                ];
              }),
            ),
            source: formula.source,
            worker: provideValueForFormulaIdentifier(formula.worker),
          }),
        );
      } else if (formula.type === 'lookup') {
        return makeInspector(
          formula.type,
          formulaNumber,
          harden({
            hub: provideValueForFormulaIdentifier(formula.hub),
            path: formula.path,
          }),
        );
      } else if (formula.type === 'guest') {
        return makeInspector(
          formula.type,
          formulaNumber,
          harden({
            host: provideValueForFormulaIdentifier(formula.host),
          }),
        );
      } else if (formula.type === 'make-bundle') {
        return makeInspector(
          formula.type,
          formulaNumber,
          harden({
            bundle: provideValueForFormulaIdentifier(formula.bundle),
            powers: provideValueForFormulaIdentifier(formula.powers),
            worker: provideValueForFormulaIdentifier(formula.worker),
          }),
        );
      } else if (formula.type === 'make-unconfined') {
        return makeInspector(
          formula.type,
          formulaNumber,
          harden({
            powers: provideValueForFormulaIdentifier(formula.powers),
            specifier: formula.type,
            worker: provideValueForFormulaIdentifier(formula.worker),
          }),
        );
      } else if (formula.type === 'web-bundle') {
        return makeInspector(
          formula.type,
          formulaNumber,
          harden({
            bundle: provideValueForFormulaIdentifier(formula.bundle),
            powers: provideValueForFormulaIdentifier(formula.powers),
          }),
        );
      }
      return makeInspector(formula.type, formulaNumber, harden({}));
    };

    /** @returns {string[]} The list of all names in the pet store. */
    const list = () => petStore.list();

    const info = Far('Endo inspector facet', {
      lookup,
      list,
    });

    return info;
  };

  const daemonCore = {
    provideValueForFormulaIdentifier,
    incarnateEndoBootstrap,
    incarnateHost,
    incarnateBundler,
  };
  return daemonCore;
};

/**
 * @param {import('./types.js').DaemonicPowers} powers
 * @param {Promise<number>} webletPortP
 * @param {object} args
 * @param {Promise<never>} args.cancelled
 * @param {(error: Error) => void} args.cancel
 * @param {number} args.gracePeriodMs
 * @param {Promise<never>} args.gracePeriodElapsed
 * @returns {Promise<import('./types.js').EndoBootstrap>}
 */
const provideEndoBootstrap = async (
  powers,
  webletPortP,
  { cancelled, cancel, gracePeriodMs, gracePeriodElapsed },
) => {
  const { persistence: persistencePowers } = powers;

  const daemonCore = await makeDaemonCore(powers, webletPortP, {
    cancelled,
    cancel,
    gracePeriodMs,
    gracePeriodElapsed,
  });

  const isInitialized = await persistencePowers.isRootInitialized();
  // Reading root nonce before isRootInitialized will cause isRootInitialized to be true.
  const endoFormulaNumber = await persistencePowers.provideRootNonce();
  if (isInitialized) {
    const endoFormulaIdentifier = `endo:${endoFormulaNumber}`;
    return /** @type {Promise<import('./types.js').EndoBootstrap>} */ (
      daemonCore.provideValueForFormulaIdentifier(endoFormulaIdentifier)
    );
  } else {
    const { value: endoBootstrap } = await daemonCore.incarnateEndoBootstrap(
      endoFormulaNumber,
    );
    return endoBootstrap;
  }
};

/**
 * @param {import('./types.js').DaemonicPowers} powers
 * @param {string} daemonLabel
 * @param {(error: Error) => void} cancel
 * @param {Promise<never>} cancelled
 */
export const makeDaemon = async (powers, daemonLabel, cancel, cancelled) => {
  const { promise: gracePeriodCancelled, reject: cancelGracePeriod } =
    /** @type {import('@endo/promise-kit').PromiseKit<never>} */ (
      makePromiseKit()
    );

  // TODO thread through command arguments.
  const gracePeriodMs = 100;

  /** @type {Promise<never>} */
  const gracePeriodElapsed = cancelled.catch(async error => {
    await delay(gracePeriodMs, gracePeriodCancelled);
    console.log(
      `Endo daemon grace period ${gracePeriodMs}ms elapsed for ${daemonLabel}`,
    );
    throw error;
  });

  const { promise: assignedWebletPortP, resolve: assignWebletPort } =
    /** @type {import('@endo/promise-kit').PromiseKit<number>} */ (
      makePromiseKit()
    );

  const endoBootstrap = await provideEndoBootstrap(
    powers,
    assignedWebletPortP,
    {
      cancelled,
      cancel,
      gracePeriodMs,
      gracePeriodElapsed,
    },
  );

  return { endoBootstrap, cancelGracePeriod, assignWebletPort };
};
