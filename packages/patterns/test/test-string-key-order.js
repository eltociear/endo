// modeled on test-string-rank-order.js

import { test } from './prepare-test-env-ava.js';

import { compareKeys } from '../src/keys/compareKeys.js';

/**
 * Essentially a ponyfill for Array.prototype.toSorted, for use before
 * we can always rely on the platform to provide it.
 *
 * @param {string[]} strings
 * @param {(
 *   left: string,
 *   right: string
 * ) => import('@endo/marshal').RankComparison} comp
 * @returns {string[]}
 */
const sorted = (strings, comp) => [...strings].sort(comp);

test('unicode code point order', t => {
  // Test case from
  // https://icu-project.org/docs/papers/utf16_code_point_order.html
  const str0 = '\u{ff61}';
  const str3 = '\u{d800}\u{dc02}';

  // str1 and str2 become impossible examples once we prohibit
  // non - well - formed strings.
  // See https://github.com/endojs/endo/pull/2002
  const str1 = '\u{d800}X';
  const str2 = '\u{d800}\u{ff61}';

  // harden to ensure it is not sorted in place, just for sanity
  const strs = harden([str0, str1, str2, str3]);

  /**
   * @param {string} left
   * @param {string} right
   * @returns {import('@endo/marshal').RankComparison}
   */
  const nativeComp = (left, right) =>
    // eslint-disable-next-line no-nested-ternary
    left < right ? -1 : left > right ? 1 : 0;

  const nativeSorted = sorted(strs, nativeComp);

  t.deepEqual(nativeSorted, [str1, str3, str2, str0]);

  // @ts-expect-error We know that for strings, `compareKeys` never returns
  // NaN because it never judges strings to be incomparable. Thus, the
  // KeyComparison it returns happens to also be a RankComparison we can
  // sort with.
  const keySorted = sorted(strs, compareKeys);

  t.deepEqual(keySorted, [str1, str2, str0, str3]);
});
