import test from '@endo/ses-ava/prepare-endo.js';

// eslint-disable-next-line import/order
import { Far } from '@endo/pass-style';
import { makeReplayMembraneKit } from '../src/replay-membrane.js';

test('test replay-membrane basics', async t => {
  /** @type {any} */
  let guestState;
  const guestSetState = Far(
    'guestSetState',
    async (newGuestState, guestOrchestra) => {
      guestState = newGuestState;
      const guestInP = guestOrchestra.getHostInPromise();
      await guestInP;
      return Far('guestObj', {
        getGuestState() {
          return guestState;
        },
      });
    },
  );
  const hostLog = [];
  const { hostProxy: hostSetState, revoke } = makeReplayMembraneKit(
    guestSetState,
    hostLog,
  );
  t.not(guestSetState, hostSetState);
  const host88 = [88];
  const host99 = [99];
  const hostInP = Promise.resolve('wait for it');
  const hostOrchestra = Far('hostOrchestra', {
    getHostInPromise() {
      return hostInP;
    },
  });
  const hostObjP = hostSetState(host88, hostOrchestra);
  assert(guestState);
  t.is(guestState[0], 88);
  t.not(guestState, host88);
  const hostObj = await hostObjP;
  // eslint-disable-next-line no-underscore-dangle
  const methodNames = hostObj.__getMethodNames__();
  const hostState = hostObj.getGuestState();
  t.is(hostState[0], 88);
  revoke('Halt!');
  t.throws(() => hostSetState(host99), {
    message: /Revoked: Halt!/,
  });
  t.throws(() => hostObj.getGuestState(), {
    message: /Revoked: Halt!/,
  });

  t.is(guestState[0], 88);
  t.deepEqual(methodNames, ['__getMethodNames__', 'getGuestState']);

  const golden = harden([
    ['do call', hostSetState, undefined, [[88], hostOrchestra], 0],
    ['check call', hostOrchestra, 'getHostInPromise', [], 1],
    ['bind host promise', hostInP, 2],
    ['do return', 1, hostInP],
    ['bind guest promise', hostObjP, 4],
    ['check return', 0, hostObjP],
    ['do filfill', 2, 'wait for it'],
    ['check fulfill', 4, hostObj],
    ['do call', hostObj, '__getMethodNames__', [], 8],
    ['check return', 8, ['__getMethodNames__', 'getGuestState']],
    ['do call', hostObj, 'getGuestState', [], 10],
    ['check return', 10, [88]],
  ]);
  t.deepEqual(hostLog, golden);
});
