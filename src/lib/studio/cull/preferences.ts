/** What this photographer actually prefers.
 *
 * Every time they overrule the engine — a different frame of the burst, a
 * restored reject, a keeper they threw away — that is a labelled comparison
 * between two frames whose head values the engine already measured. Those
 * comparisons are the training data for everything learned later, so they are
 * written down from the first day, before any model exists to use them.
 *
 * Two pieces:
 *   1. an append-only log in its own IndexedDB database (never the cull store,
 *      so a session can be deleted without losing what it taught, and a bug in
 *      the cull store can never rewrite history);
 *   2. a tiny online pairwise ranker — logistic regression on the difference
 *      between two frames' head values — that can be trained from the log as it
 *      grows and scored in microseconds.
 *
 * Nothing here leaves the device. The log holds head values, ids and
 * timestamps: no pixels, no file names, no faces.
 */
import {
  CULL_HEADS,
  CULL_HEAD_HIGHER_IS_BETTER,
  type CullGenre,
  type CullHead,
  type CullHeadSet,
} from "./intel";

/** Why the photographer's choice disagreed with the engine. */
export type CullPreferenceKind =
  /** They picked a different frame of the burst than the engine did. */
  | "burst-pick"
  /** They kept a frame the engine suggested rejecting. */
  | "restored-reject"
  /** They rejected a frame the engine suggested keeping. */
  | "rejected-keep"
  /** They confirmed the engine's pick. Weak evidence, but real. */
  | "confirmed-pick";

/** One frame in a comparison: its id and the head values as measured when the
 * decision was made. The snapshot matters — heads change as the engine learns,
 * and a label has to stay attached to the evidence it was given. */
export type CullPreferenceFrame = {
  frameId: string;
  heads: CullHeadSet;
};

export type CullPreferenceEvent = {
  /** Sortable id: append time in milliseconds, then a random suffix. */
  id: string;
  at: number;
  kind: CullPreferenceKind;
  sessionId: string;
  /** The burst this happened in; null outside a burst. */
  burstId: number | null;
  genre: CullGenre;
  /** The frame the photographer chose. */
  chosen: CullPreferenceFrame;
  /** The frame the engine had put ahead of it, when there was one. */
  passedOver?: CullPreferenceFrame | undefined;
  /** Ids, kept for joining back to a session that still exists. */
  aiPickId?: string | null | undefined;
  photographerPickId?: string | null | undefined;
};

/** A new event, before the log gives it an id and a time. */
export type CullPreferenceDraft = Omit<CullPreferenceEvent, "id" | "at"> & {
  id?: string;
  at?: number;
};

const DATABASE_PREFIX = "celinen-cull-preferences";
const EVENTS = "events";
const VERSION = 1;

/** Its own database, never the cull session store. */
export function cullPreferencesDatabaseName(scope: string): string {
  return `${DATABASE_PREFIX}:${scope.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Preference storage request failed."));
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Preference write was interrupted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Preference write failed."));
  });
}

let counter = 0;
function nextId(at: number) {
  // Sortable and unique inside a millisecond: two decisions in one animation
  // frame must not collide, and the order they were made in is the order they
  // read back in.
  counter = (counter + 1) % 0x10000;
  return `${at.toString().padStart(14, "0")}-${counter.toString(16).padStart(4, "0")}-${Math.floor(
    Math.random() * 0x10000,
  )
    .toString(16)
    .padStart(4, "0")}`;
}

export type CullPreferenceLog = {
  /** Appends events. Ids already in the log are left exactly as they were: this
   * log is written once and never rewritten. Returns the events as stored. */
  append(events: readonly CullPreferenceDraft[]): Promise<CullPreferenceEvent[]>;
  /** In append order. `after` continues from an id already seen. */
  read(options?: { after?: string; limit?: number }): Promise<CullPreferenceEvent[]>;
  count(): Promise<number>;
  /** The only way to remove anything: the photographer asking to forget. */
  erase(): Promise<void>;
  close(): void;
};

export async function openCullPreferenceLog(
  scope: string,
  factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB,
): Promise<CullPreferenceLog> {
  if (!factory) throw new Error("This browser cannot remember culling preferences on this device.");
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(cullPreferencesDatabaseName(scope), VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EVENTS)) db.createObjectStore(EVENTS, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Preference storage could not be opened."));
    request.onblocked = () => reject(new Error("Preference storage is open in another tab."));
  });

  return {
    async append(drafts) {
      if (!drafts.length) return [];
      const at = Date.now();
      const events: CullPreferenceEvent[] = drafts.map((draft) => ({
        ...draft,
        at: draft.at ?? at,
        id: draft.id ?? nextId(draft.at ?? at),
      }));
      const transaction = database.transaction(EVENTS, "readwrite");
      const store = transaction.objectStore(EVENTS);
      // add(), not put(): an id that already exists is a replay, not an edit.
      for (const event of events)
        store.add(structuredClone(event)).onerror = (failure) => {
          failure.preventDefault();
          failure.stopPropagation();
        };
      await done(transaction);
      return events;
    },

    async read(options = {}) {
      const transaction = database.transaction(EVENTS, "readonly");
      const store = transaction.objectStore(EVENTS);
      // IDBKeyRange is global in a browser, but a bundled or test environment
      // can hand over a factory without one; then the range is applied here.
      const bounded =
        options.after && typeof IDBKeyRange !== "undefined"
          ? IDBKeyRange.lowerBound(options.after, true)
          : undefined;
      const rows = (await result(
        store.getAll(bounded, bounded || !options.after ? options.limit : undefined),
      )) as CullPreferenceEvent[];
      if (bounded || !options.after) return rows;
      const after = options.after;
      const rest = rows.filter((event) => event.id > after);
      return options.limit ? rest.slice(0, options.limit) : rest;
    },

    count: () => result(database.transaction(EVENTS, "readonly").objectStore(EVENTS).count()),

    async erase() {
      const transaction = database.transaction(EVENTS, "readwrite");
      transaction.objectStore(EVENTS).clear();
      await done(transaction);
    },

    close: () => database.close(),
  };
}

/** Turns a decision into the comparison it implies. Null when there is nothing
 * to learn (the photographer agreed, or there was no alternative). */
export function preferenceFromDecision(decision: {
  kind: CullPreferenceKind;
  sessionId: string;
  burstId?: number | null;
  genre: CullGenre;
  chosen: CullPreferenceFrame;
  passedOver?: CullPreferenceFrame | undefined;
  aiPickId?: string | null;
}): CullPreferenceDraft | null {
  if (!decision.passedOver || decision.passedOver.frameId === decision.chosen.frameId) return null;
  return {
    kind: decision.kind,
    sessionId: decision.sessionId,
    burstId: decision.burstId ?? null,
    genre: decision.genre,
    chosen: decision.chosen,
    passedOver: decision.passedOver,
    aiPickId: decision.aiPickId ?? decision.passedOver.frameId,
    photographerPickId: decision.chosen.frameId,
  };
}

// ---------------------------------------------------------------- ranker --

/** A head's value turned so higher is better, pulled toward neutral by its own
 * confidence, exactly as the engine's profiles do it. Absent heads are neutral,
 * so a missing detector never looks like a bad score. */
export function headFeature(heads: CullHeadSet, head: CullHead): number {
  const value = heads[head];
  if (!value) return 0.5;
  const oriented = CULL_HEAD_HIGHER_IS_BETTER[head] ? value.value : 1 - value.value;
  return 0.5 + value.confidence * (oriented - 0.5);
}

export type CullRankerWeights = Partial<Record<CullHead, number>>;

export type CullRankerOptions = {
  /** Step size. Small: one disagreement should nudge, not rewrite, the model. */
  learningRate?: number;
  /** L2 pull toward zero, so rare heads cannot run away. */
  regularization?: number;
  weights?: CullRankerWeights;
};

export type CullPairwiseRanker = {
  /** The learned preference score of one frame. Only differences mean anything. */
  score(heads: CullHeadSet): number;
  /** How likely this photographer is to prefer `a` over `b`, 0..1. */
  probability(a: CullHeadSet, b: CullHeadSet): number;
  /** One labelled comparison: `chosen` was preferred to `passedOver`.
   * Returns the loss before the update, so training can be watched. */
  learn(chosen: CullHeadSet, passedOver: CullHeadSet, weight?: number): number;
  /** Trains on a log in order. Events without an alternative teach nothing. */
  learnFromEvents(events: readonly CullPreferenceEvent[], options?: { passes?: number }): number;
  /** Share of comparisons the ranker gets right, for held-out events. */
  accuracy(events: readonly CullPreferenceEvent[]): number;
  weights(): CullRankerWeights;
  toJSON(): { weights: CullRankerWeights; learningRate: number; regularization: number };
};

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Confirming the engine's own pick is weaker evidence than overruling it. */
const KIND_WEIGHT: Record<CullPreferenceKind, number> = {
  "burst-pick": 1,
  "restored-reject": 1,
  "rejected-keep": 1,
  "confirmed-pick": 0.25,
};

export function createPairwiseRanker(options: CullRankerOptions = {}): CullPairwiseRanker {
  const learningRate = options.learningRate ?? 0.15;
  const regularization = options.regularization ?? 0.002;
  if (!(learningRate > 0) || !(regularization >= 0))
    throw new Error("A ranker needs a positive learning rate and a non-negative regularization.");
  const weights = new Float64Array(CULL_HEADS.length);
  CULL_HEADS.forEach((head, index) => {
    weights[index] = options.weights?.[head] ?? 0;
  });

  const features = (heads: CullHeadSet) => CULL_HEADS.map((head) => headFeature(heads, head));
  const score = (heads: CullHeadSet) =>
    features(heads).reduce((total, value, index) => total + value * weights[index]!, 0);

  const learn = (chosen: CullHeadSet, passedOver: CullHeadSet, weight = 1) => {
    const a = features(chosen);
    const b = features(passedOver);
    let margin = 0;
    for (let i = 0; i < weights.length; i++) margin += (a[i]! - b[i]!) * weights[i]!;
    const probability = sigmoid(margin);
    const loss = -Math.log(Math.max(probability, 1e-12));
    // Logistic gradient on the difference vector, plus the L2 pull.
    for (let i = 0; i < weights.length; i++)
      weights[i] =
        weights[i]! +
        learningRate *
          (weight * (1 - probability) * (a[i]! - b[i]!) - regularization * weights[i]!);
    return loss;
  };

  const pairs = (events: readonly CullPreferenceEvent[]) =>
    events.filter((event) => event.passedOver).map((event) => event);

  return {
    score,
    probability: (a, b) => sigmoid(score(a) - score(b)),
    learn,
    learnFromEvents(events, { passes = 1 } = {}) {
      let loss = 0;
      let seen = 0;
      for (let pass = 0; pass < passes; pass++)
        for (const event of pairs(events)) {
          loss += learn(event.chosen.heads, event.passedOver!.heads, KIND_WEIGHT[event.kind]);
          seen++;
        }
      return seen ? loss / seen : 0;
    },
    accuracy(events) {
      const set = pairs(events);
      if (!set.length) return 0;
      let right = 0;
      for (const event of set)
        right += score(event.chosen.heads) > score(event.passedOver!.heads) ? 1 : 0;
      return right / set.length;
    },
    weights() {
      const out: CullRankerWeights = {};
      CULL_HEADS.forEach((head, index) => {
        if (weights[index]) out[head] = weights[index]!;
      });
      return out;
    },
    toJSON: () => ({
      weights: CULL_HEADS.reduce<CullRankerWeights>((out, head, index) => {
        out[head] = weights[index]!;
        return out;
      }, {}),
      learningRate,
      regularization,
    }),
  };
}

// ------------------------------------------------------------------ taste --

/** How far the learned ranker is trusted once it has seen `count` decisions.
 *
 * Three clicks must not swing a shoot. A photographer who has culled a season
 * should see the engine follow her. So trust rises with the square-root-ish
 * shape of a running mean — fast at first in absolute terms, never fast enough
 * to matter early — and stops well short of 1, because the engine's own
 * measurements are evidence too and no amount of agreement makes focus
 * optional.
 */
export const CULL_TASTE_HALF_LIFE = 60;
export const CULL_TASTE_MAX_TRUST = 0.6;

export function trustFromEvents(count: number): number {
  if (!(count > 0)) return 0;
  return (CULL_TASTE_MAX_TRUST * count) / (count + CULL_TASTE_HALF_LIFE);
}

/** The learned half of the culler, as the ranking and the screen see it. */
export type CullTaste = {
  /** How many overrides the ranker learned from. */
  events: number;
  /** How far its opinion is being trusted right now, 0..CULL_TASTE_MAX_TRUST. */
  trust: number;
  /** This photographer's preference score for one frame. Only differences
   * mean anything; the ranking turns them into a position in the shoot. */
  score(heads: CullHeadSet): number;
  /** How selective she is: the share of her own overrides that added a keeper
   * rather than removed one. 0.55 before she has said anything. */
  keepBias: number;
  /** Share of held-out comparisons the ranker gets right. */
  accuracy(events: readonly CullPreferenceEvent[]): number;
  weights(): CullRankerWeights;
};

/** A taste that has learned nothing: the engine's own ranking, untouched. */
export const COLD_TASTE: CullTaste = {
  events: 0,
  trust: 0,
  score: () => 0,
  keepBias: 0.55,
  accuracy: () => 0,
  weights: () => ({}),
};

/** Trains the ranker on everything this account has taught it.
 *
 * The log is the single source of truth and the weights are never stored: a
 * few thousand events over eighteen features is a millisecond of arithmetic,
 * and a cached model that disagrees with the log is a bug waiting for a
 * photographer to find. Two passes, because one pass over a short log leaves
 * the earliest comparisons barely used.
 */
export function tasteFromEvents(events: readonly CullPreferenceEvent[]): CullTaste {
  const pairs = events.filter((event) => event.passedOver);
  if (!pairs.length) return COLD_TASTE;
  const ranker = createPairwiseRanker();
  ranker.learnFromEvents(pairs, { passes: 2 });
  let restored = 0;
  let removed = 0;
  for (const event of pairs) {
    if (event.kind === "restored-reject") restored++;
    else if (event.kind === "rejected-keep") removed++;
  }
  // Below about six decisions the ratio is noise, so the divisor holds the
  // bias near neutral until there is something to read.
  const lean = (restored - removed) / Math.max(6, restored + removed);
  return {
    events: pairs.length,
    trust: trustFromEvents(pairs.length),
    score: (heads) => ranker.score(heads),
    keepBias: Math.min(0.78, Math.max(0.28, 0.55 + 0.25 * lean)),
    accuracy: (held) => ranker.accuracy(held),
    weights: () => ranker.weights(),
  };
}

/** Everything this account has taught the culler, trained and ready to rank.
 * A browser that cannot open the log culls with the engine's own eye. */
export async function loadCullTaste(
  scope: string,
  factory?: IDBFactory | undefined,
): Promise<CullTaste> {
  let log: CullPreferenceLog | null = null;
  try {
    log = await openCullPreferenceLog(scope, factory);
    return tasteFromEvents(await log.read());
  } catch {
    return COLD_TASTE;
  } finally {
    log?.close();
  }
}

/** Writes overrides down. Returns how many the log now holds. */
export async function recordCullPreferences(
  scope: string,
  drafts: readonly CullPreferenceDraft[],
  factory?: IDBFactory | undefined,
): Promise<number> {
  if (!drafts.length) return 0;
  let log: CullPreferenceLog | null = null;
  try {
    log = await openCullPreferenceLog(scope, factory);
    await log.append(drafts);
    return await log.count();
  } catch {
    // Losing one recorded preference is a worse day for the model than for the
    // photographer; the cull itself must not fail because of it.
    return 0;
  } finally {
    log?.close();
  }
}

/** The photographer asking the culler to forget what it learned from her. */
export async function forgetCullPreferences(
  scope: string,
  factory?: IDBFactory | undefined,
): Promise<void> {
  const log = await openCullPreferenceLog(scope, factory);
  try {
    await log.erase();
  } finally {
    log.close();
  }
}

/** Where a frame sits in a shoot once the photographer's own taste is mixed
 * into the engine's score.
 *
 * The engine's quality is calibrated against the shoot's own range and the
 * learned score is not calibrated against anything, so the two are mixed as
 * positions rather than as numbers: the learned opinion moves a frame through
 * the shoot, it does not overwrite what the frame measured. At zero trust the
 * engine's own quality is returned unchanged, so a photographer who has taught
 * the culler nothing gets exactly the cull she got yesterday.
 */
export function blendQuality(
  quality: number,
  learnedPercentile: number,
  trust: number,
): number {
  if (!(trust > 0)) return quality;
  const blended = quality * (1 - trust) + 99 * learnedPercentile * trust;
  return Math.min(99, Math.max(1, blended));
}

/** Each frame's position in the learned ranking, 0 (last) .. 1 (first).
 * Ties share a position, so frames the ranker cannot tell apart are not
 * reordered by the accident of their input order. */
export function learnedPercentiles(scores: readonly number[]): number[] {
  const out = new Array<number>(scores.length).fill(0.5);
  if (scores.length < 2) return out;
  const order = scores.map((score, index) => ({ score, index }));
  order.sort((a, b) => a.score - b.score);
  const last = scores.length - 1;
  for (let at = 0; at < order.length; ) {
    let end = at;
    while (end + 1 < order.length && order[end + 1]!.score === order[at]!.score) end++;
    // The middle of the run of equal scores, so a tie is one shared position.
    const position = (at + end) / 2 / last;
    for (let i = at; i <= end; i++) out[order[i]!.index] = position;
    at = end + 1;
  }
  return out;
}
