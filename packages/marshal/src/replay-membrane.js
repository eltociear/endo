/* eslint-disable no-use-before-define */
/// <reference types="ses"/>

import { E } from '@endo/eventual-send';
import { getMethodNames } from '@endo/eventual-send/utils.js';
import {
  isObject,
  getInterfaceOf,
  passStyleOf,
  Remotable,
} from '@endo/pass-style';
import { Fail } from '@endo/errors';
import { makeMarshal } from './marshal.js';

const { fromEntries, defineProperties } = Object;

/**
 * @param {import('@endo/pass-style').Passable} guestTarget
 * @param {any[]} hostLog
 */
export const makeReplayMembraneKit = async (guestTarget, hostLog) => {
  /** @type {WeakMap<any,any> | undefined} */
  let memoH2G = new WeakMap();
  /** @type {WeakMap<any,any> | undefined} */
  let memoG2H = new WeakMap();
  let optReasonString;
  const revoke = reasonString => {
    assert.typeof(reasonString, 'string');
    memoH2G = undefined;
    memoG2H = undefined;
    optReasonString = reasonString;
  };

  const promiseBindings = new Map();

  const doHostLog = entry => {};
  const checkHostLog = entry => {};
  const nestInterpreter = callIndex => {};
  const unnestInterpreter = callIndex => {};

  // eslint-disable-next-line no-unused-vars
  const dispatch = harden({
    bindHostPromise(hostP, promiseIndex) {
      let guestResolve;
      let guestReject;
      const guestP = harden(
        new Promise((res, rej) => {
          guestResolve = res;
          guestReject = rej;
        }),
      );
      doHostLog(['bindHostPromise', hostP, promiseIndex]);
      const hostResolve = hostFulfillment =>
        guestResolve(hostToGuest(hostFulfillment));
      const hostReject = hostReason => guestReject(hostToGuest(hostReason));
      promiseBindings.set(promiseIndex, { hostResolve, hostReject });
      return guestP;
    },

    doFulfill(promiseIndex, hostFulfillment) {
      doHostLog(['doFulfill', hostFulfillment]);
      promiseBindings.get(promiseIndex).hostResolve(hostFulfillment);
    },

    doReject(promiseIndex, hostReason) {
      doHostLog(['doReject', hostReason]);
      promiseBindings.get(promiseIndex).hostReject(hostReason);
    },

    checkCall(guestCap, optVerb, guestArgs, callIndex) {
      checkHostLog([
        'checkCall',
        guestToHost(guestCap),
        optVerb,
        guestToHost(guestArgs),
        callIndex,
      ]);
      return nestInterpreter(callIndex);
    },

    doReturn(callIndex, hostResult) {
      doHostLog(['doReturn', hostResult]);
      unnestInterpreter(callIndex);
      return hostToGuest(hostResult);
    },

    doThrow(callIndex, hostReason) {
      doHostLog(['doThrow', hostReason]);
      unnestInterpreter(callIndex);
      throw hostToGuest(hostReason);
    },

    // /////////////////////////////////////////////////////////////////////////

    bindGuestPromise(guestP, promiseIndex) {
      const hostP = guestToHost(guestP);
      doHostLog(['bindGuestPromise', hostP, promiseIndex]);
      return hostP;
    },

    checkFulfill(promiseIndex, guestFulfillment) {
      const hostFulfillment = guestToHost(guestFulfillment);
      checkHostLog(['checkFulfill', promiseIndex, hostFulfillment]);
    },

    checkReject(promiseIndex, guestReason) {
      const hostReason = guestToHost(guestReason);
      checkHostLog(['checkReject', promiseIndex, hostReason]);
    },

    doCall(hostCap, optVerb, hostArgs, callIndex) {
      // /
    },

    checkReturn(callIndex, guestResult) {
      // /
    },

    checkThrow(callIndex, guestReason) {
      // /
    },
  });

  const convertCapH2G = (hostCap, _optIface = undefined) => {
    if (memoH2G === undefined) {
      throw harden(ReferenceError(`Revoked: ${optReasonString}`));
    }
    assert(memoG2H !== undefined);
    if (memoH2G.has(hostCap)) {
      return memoH2G.get(hostCap);
    }
    let guestCap;
    const passStyle = passStyleOf(hostCap);
    switch (passStyle) {
      case 'promise': {
        let guestResolve;
        let guestReject;
        guestCap = harden(
          new Promise((res, rej) => {
            guestResolve = res;
            guestReject = rej;
          }),
        );
        const promiseLogIndex = hostLog.length;
        hostLog.push(['bind host promise', hostCap, promiseLogIndex]);
        const hostResolve = hostFulfillment => {
          hostLog.push(['do filfill', promiseLogIndex, hostFulfillment]);
          guestResolve(hostToGuest(hostFulfillment));
        };
        const hostReject = hostReason => {
          hostLog.push(['do reject', promiseLogIndex, hostReason]);
          guestReject(hostToGuest(hostReason));
        };
        E.when(
          hostCap,
          hostFulfillment => hostResolve(hostFulfillment),
          hostReason => hostReject(hostReason),
        )
          .catch(metaReason =>
            // This can happen if hostFulfillment or hostReason is not
            // Passable.
            // TODO verify that metaReason must be host-side-safe, or rather,
            // that the passing of it is guest-side-safe.
            hostReject(metaReason),
          )
          .catch(metaMetaReason =>
            // In case metaReason itself doesn't hostToGuest
            guestReject(metaMetaReason),
          );
        break;
      }
      case 'remotable': {
        /** @param {PropertyKey} [optVerb] */
        const makeGuestMethod = (optVerb = undefined) => {
          const guestMethod = (...guestArgs) => {
            // We use hostCapIf rather than hostCap so that hostCap is
            // not accessible
            // after revocation. This gives the correct error behavior,
            // but may not actually enable hostCap to be gc'ed, depending on
            // the JS engine.
            // TODO Could rewrite to keep scopes more separate, so post-revoke
            // gc works more often.
            const hostCapIf = guestToHost(guestCap);

            assert(!isObject(optVerb));
            const hostArgs = guestToHost(harden(guestArgs));
            let hostResult;

            const callLogIndex = hostLog.length;
            hostLog.push([
              'check call',
              hostCap,
              optVerb,
              hostArgs,
              callLogIndex,
            ]);

            try {
              hostResult = optVerb
                ? hostCapIf[optVerb](...hostArgs)
                : hostCapIf(...hostArgs);
            } catch (hostReason) {
              const guestReason = hostToGuest(harden(hostReason));
              hostLog.push(['do throw', callLogIndex, hostReason]);
              throw guestReason;
            }
            const guestResult = hostToGuest(harden(hostResult));
            hostLog.push(['do return', callLogIndex, hostResult]);
            return guestResult;
          };
          if (optVerb) {
            defineProperties(guestMethod, {
              name: { value: String(optVerb) },
              length: { value: Number(hostCap[optVerb].length || 0) },
            });
          } else {
            defineProperties(guestMethod, {
              name: { value: String(hostCap.name || 'anon') },
              length: { value: Number(hostCap.length || 0) },
            });
          }
          return guestMethod;
        };
        const iface = String(getInterfaceOf(hostCap) || 'unlabeled remotable');
        if (typeof hostCap === 'function') {
          // NOTE: Assumes that a far function has no "static" methods. This
          // is the current marshal design, but revisit this if we change our
          // minds.
          guestCap = Remotable(iface, undefined, makeGuestMethod());
        } else {
          const methodNames = getMethodNames(hostCap);
          const guestMethods = methodNames.map(name => [
            name,
            makeGuestMethod(name),
          ]);
          guestCap = Remotable(iface, undefined, fromEntries(guestMethods));
        }
        break;
      }
      default: {
        Fail`internal: Unrecognized passStyle ${passStyle}`;
      }
    }
    memoH2G.set(hostCap, guestCap);
    memoG2H.set(guestCap, hostCap);
    return guestCap;
  };

  const { toCapData: hostToHostCapData, fromCapData: guestFromHostCapData } =
    makeMarshal(
      undefined, // undefined is identity
      convertCapH2G, // convert a host slot to a guest value
      {
        serializeBodyFormat: 'smallcaps',
      },
    );

  const hostToGuest = hostVal => {
    const hostCapData = hostToHostCapData(hostVal);
    const guestVal = guestFromHostCapData(hostCapData);
    return guestVal;
  };

  // ///////////////////////// Mirror image ////////////////////////////////////

  const convertCapG2H = (guestCap, _optIface = undefined) => {
    if (memoG2H === undefined) {
      throw harden(ReferenceError(`Revoked: ${optReasonString}`));
    }
    assert(memoH2G !== undefined);
    if (memoG2H.has(guestCap)) {
      return memoG2H.get(guestCap);
    }
    let hostCap;
    const passStyle = passStyleOf(guestCap);
    switch (passStyle) {
      case 'promise': {
        let hostResolve;
        let hostReject;
        hostCap = harden(
          new Promise((res, rej) => {
            hostResolve = res;
            hostReject = rej;
          }),
        );
        const promiseLogIndex = hostLog.length;
        hostLog.push(['bind guest promise', hostCap, promiseLogIndex]);
        const guestResolve = guestFulfillment => {
          const hostFulfillment = guestToHost(guestFulfillment);
          hostLog.push(['check fulfill', promiseLogIndex, hostFulfillment]);
          hostResolve(hostFulfillment);
        };
        const guestReject = guestReason => {
          const hostReason = guestToHost(guestReason);
          hostLog.push(['check reject', promiseLogIndex, hostReason]);
          hostReject(hostReason);
        };
        E.when(
          guestCap,
          guestFulfillment => guestResolve(guestFulfillment),
          guestReason => guestReject(guestReason),
        )
          .catch(metaReason =>
            // This can happen if guestFulfillment or guestReason is not
            // passable.
            // TODO verify that metaReason must be guest-side-safe, or rather,
            // that the passing of it is host-side-safe.
            guestReject(metaReason),
          )
          .catch(metaMetaReason =>
            // In case metaReason itself doesn't guestToHost
            hostReject(metaMetaReason),
          );
        break;
      }
      case 'remotable': {
        /** @param {PropertyKey} [optVerb] */
        const makeHostMethod = (optVerb = undefined) => {
          const hostMethod = (...hostArgs) => {
            // We use guestCapIf rather than guestCap so that guestCap is
            // not accessible
            // after revocation. This gives the correct error behavior,
            // but may not actually enable guestCap to be gc'ed, depending on
            // the JS engine.
            // TODO Could rewrite to keep scopes more separate, so post-revoke
            // gc works more often.
            const guestCapIf = hostToGuest(hostCap);

            assert(!isObject(optVerb));
            const guestArgs = hostToGuest(harden(hostArgs));
            let guestResult;

            const callLogIndex = hostLog.length;
            hostLog.push(['do call', hostCap, optVerb, hostArgs, callLogIndex]);

            try {
              guestResult = optVerb
                ? guestCapIf[optVerb](...guestArgs)
                : guestCapIf(...guestArgs);
            } catch (guestReason) {
              const yourReason = guestToHost(harden(guestReason));
              hostLog.push(['check throw', callLogIndex, yourReason]);
              throw yourReason;
            }
            const yourResult = guestToHost(harden(guestResult));
            hostLog.push(['check return', callLogIndex, yourResult]);
            return yourResult;
          };
          if (optVerb) {
            defineProperties(hostMethod, {
              name: { value: String(optVerb) },
              length: { value: Number(guestCap[optVerb].length || 0) },
            });
          } else {
            defineProperties(hostMethod, {
              name: { value: String(guestCap.name || 'anon') },
              length: { value: Number(guestCap.length || 0) },
            });
          }
          return hostMethod;
        };
        const iface = String(getInterfaceOf(guestCap) || 'unlabeled remotable');
        if (typeof guestCap === 'function') {
          // NOTE: Assumes that a far function has no "static" methods. This
          // is the current marshal design, but revisit this if we change our
          // minds.
          hostCap = Remotable(iface, undefined, makeHostMethod());
        } else {
          const methodNames = getMethodNames(guestCap);
          const hostMethods = methodNames.map(name => [
            name,
            makeHostMethod(name),
          ]);
          hostCap = Remotable(iface, undefined, fromEntries(hostMethods));
        }
        break;
      }
      default: {
        Fail`internal: Unrecognized passStyle ${passStyle}`;
      }
    }
    memoG2H.set(guestCap, hostCap);
    memoH2G.set(hostCap, guestCap);
    return hostCap;
  };

  const { toCapData: guestToHostCapData, fromCapData: hostFromHostCapData } =
    makeMarshal(
      // convert from my value to a yellow slot. undefined is identity.
      convertCapG2H, // convert a guest value to a host slot
      undefined, // undefined is identity
      {
        serializeBodyFormat: 'smallcaps',
      },
    );

  const guestToHost = guestVal => {
    const hostCapData = guestToHostCapData(guestVal);
    const hostVal = hostFromHostCapData(hostCapData);
    return hostVal;
  };

  return harden({
    hostProxy: guestToHost(guestTarget),
    revoke,
  });
};
harden(makeReplayMembraneKit);
