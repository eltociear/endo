import test from '@endo/ses-ava/prepare-endo.js';

// eslint-disable-next-line import/order
import { Far } from '@endo/pass-style';
import { makeHostLogMembraneKit } from '../src/host-log-membrane.js';
// import { makeReplayMembraneKit } from '../src/replay-membrane.js';

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
  const { hostProxy: hostSetState, revoke } = makeHostLogMembraneKit(
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
    ['doCall', hostSetState, undefined, [[88], hostOrchestra], 0],
    ['checkCall', hostOrchestra, 'getHostInPromise', [], 1],
    ['bindHostPromise', hostInP, 2],
    ['doReturn', 1, hostInP],
    ['bindGuestPromise', hostObjP, 4],
    ['checkReturn', 0, hostObjP],
    ['doFilfill', 2, 'wait for it'],
    ['checkFulfill', 4, hostObj],
    ['doCall', hostObj, '__getMethodNames__', [], 8],
    ['checkReturn', 8, ['__getMethodNames__', 'getGuestState']],
    ['doCall', hostObj, 'getGuestState', [], 10],
    ['checkReturn', 10, [88]],
  ]);
  t.deepEqual(hostLog, golden);

  // const { hostProxy: _hostSetState2, revoke: _revoke2 } =
  //   await makeReplayMembraneKit(guestSetState, golden);
});
