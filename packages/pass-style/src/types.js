/* eslint-disable no-unused-vars */
import { PASS_STYLE } from './passStyle-helpers.js';

export {};

/**
 * @typedef { 'undefined' | 'null' |
 *   'boolean' | 'number' | 'bigint' | 'string' | 'symbol'
 * } PrimitiveStyle
 */

/** @typedef {'copyRecord' | 'copyArray' | 'tagged'} ContainerStyle */

/**
 * @typedef { PrimitiveStyle |
 *   ContainerStyle |
 *   'remotable' |
 *   'error' | 'promise'
 * } PassStyle
 */

/**
 * @template {string} S style
 * @typedef {{ [PASS_STYLE]: S }} PassStyled
 */

/**
 * @template {PassStyled<any>} P
 * @typedef {P[typeof PASS_STYLE]} ExtractStyle
 */

/** @typedef {import('type-fest').Primitive | CopyArray | CopyRecord | CopyTagged } PassByCopy */
/** @typedef {RemotableObject | Promise<RemotableObject> | Promise<PassByCopy> } PassByRef */

/**
 * @typedef {PassByCopy | PassByRef} Passable
 *
 * A Passable is acyclic data that can be marshalled. It must be hardened to
 * remain
 * stable (even if some components are proxies; see PureData restriction below),
 * and is classified by PassStyle:
 *   * Atomic primitive values have a PrimitiveStyle (PassStyle
 *     'undefined' | 'null' | 'boolean' | 'number' | 'bigint'
 *     | 'string' | 'symbol').
 *   * Containers aggregate other Passables into
 *     * sequences as CopyArrays (PassStyle 'copyArray'), or
 *     * string-keyed dictionaries as CopyRecords (PassStyle 'copyRecord'), or
 *     * higher-level types as CopyTaggeds (PassStyle 'tagged').
 *   * PassableCaps (PassStyle 'remotable' | 'promise') expose local values to
 *     remote interaction.
 *   * As a special case to support system observability, error objects are
 *     Passable (PassStyle 'error').
 *
 * A Passable is essentially a pass-by-copy superstructure with a
 * pass-by-reference
 * exit point at the site of each PassableCap (which marshalling represents
 * using 'slots').
 */

// Cases match in sequence. The final case 'remotable' is for a Passable that isn't one of the others.
/**
 * @typedef {{
 * (p: undefined): 'undefined';
 * (p: string): 'string';
 * (p: boolean): 'boolean';
 * (p: number): 'number';
 * (p: bigint): 'bigint';
 * (p: symbol): 'symbol';
 * (p: null): 'null';
 * (p: Promise): 'promise';
 * (p: Error): 'error';
 * (p: CopyTagged): 'tagged';
 * (p: Array): 'copyArray';
 * (p: Iterable): 'remotable';
 * (p: Iterator): 'remotable';
 * <T extends PassStyled<any>>(p: T): ExtractStyle<T>
 * (p: {[key: string]: any}): 'copyRecord';
 * (p: any): unknown;
 * }} PassStyleOf
 */

/**
 * @typedef {Passable} PureData
 *
 * A Passable is PureData when its entire data structure is free of PassableCaps
 * (remotables and promises) and error objects.
 * PureData is an arbitrary composition of primitive values into CopyArray
 * and/or
 * CopyRecord and/or CopyTagged containers (or a single primitive value with no
 * container), and is fully pass-by-copy.
 *
 * This restriction assures absence of side effects and interleaving risks *given*
 * that none of the containers can be a Proxy instance.
 * TODO SECURITY BUG we plan to enforce this, giving PureData the same security
 * properties as the proposed
 * [Records and Tuples](https://github.com/tc39/proposal-record-tuple).
 *
 * Given this (currently counter-factual) assumption, a PureData value cannot
 * be used as a communications channel,
 * and can therefore be safely shared with subgraphs that should not be able
 * to communicate with each other.
 * Without that assumption, such a guarantee requires a marshal-unmarshal round
 * trip (as exists between vats) to produce data structures disconnected from
 * any potential proxies.
 */

/**
 * @template {string} S pass style
 * @template {InterfaceSpec} I interface tag
 * @typedef {PassStyled<S> & {[Symbol.toStringTag]: I}} TaggedRecord
 */

/**
 * @template {InterfaceSpec} [I=string]
 * @typedef {TaggedRecord<'remotable', I>} RemotableObject
 *
 * An object marked as remotely accessible using the `Far` or `Remotable`
 * functions, or a local presence representing such a remote object.
 */

/**
 * @typedef {Promise | RemotableObject} PassableCap
 *
 * The authority-bearing leaves of a Passable's pass-by-copy superstructure.
 */

/**
 * @template {Passable} [T=object]
 * @typedef {T[]} CopyArray
 *
 * A Passable sequence of Passable values.
 */

/**
 * @template {Passable} [T=object]
 * @typedef {Record<string, T>} CopyRecord
 *
 * A Passable dictionary in which each key is a string and each value is Passable.
 */

/**
 * @template {InterfaceSpec} [Tag=string]
 * @template {Passable} [Payload=any]
 * @typedef {TaggedRecord<'tagged', Tag> & {
 *   payload: Payload,
 * }} CopyTagged
 *
 * A Passable "tagged record" with semantics specific to the tag identified in
 * the `[Symbol.toStringTag]` property (such as 'copySet', 'copyBag',
 * or 'copyMap').
 * It must have a property with key equal to the `PASS_STYLE` export and
 * value 'tagged'
 * and no other properties except `[Symbol.toStringTag]` and `payload`.
 */

/**
 * @typedef {string} InterfaceSpec
 * This is an interface specification.
 * For now, it is just a string, but will eventually be `PureData`. Either
 * way, it must remain pure, so that it can be safely shared by subgraphs that
 * are not supposed to be able to communicate.
 */

/**
 * @callback Checker
 * Internal to a useful pattern for writing checking logic
 * (a "checkFoo" function) that can be used to implement a predicate
 * (an "isFoo" function) or a validator (an "assertFoo" function).
 *
 *    * A predicate ideally only returns `true` or `false` and rarely throws.
 *    * A validator throws an informative diagnostic when the predicate
 *      would have returned `false`, and simply returns `undefined` normally
 *      when the predicate would have returned `true`.
 *    * The internal checking function that they share is parameterized by a
 *      `Checker` that determines how to proceed with a failure condition.
 *      Predicates pass in an identity function as checker. Validators
 *      pass in `assertChecker` which is a trivial wrapper around `assert`.
 *
 * See the various uses for good examples.
 * @param {boolean} cond
 * @param {import('ses').Details} [details]
 * @returns {boolean}
 */
