/** The heart is the photographer's "post this" mark. It has to survive a reload,
 * a Cull round-trip and a document stored before hearts existed, and the
 * Hearted filter has to mean hearted rather than falling through to another branch.
 */
import { describe, expect, test } from "bun:test";
import {
  createDevelopDocument,
  createDevelopStore,
  developDocumentSchema,
  developInitialStateFromShot,
  developPhotoFromFile,
} from "@/lib/develop/store";
import { defaultDevelopSettings } from "@/lib/develop/contract";
import { developViewFilter } from "@/lib/develop/cull-view";
import {
  DEVELOP_FILTERS,
  developFilterMatches,
  filteredDevelopSelection,
} from "@/components/develop/develop-state";
import { developIdbDouble } from "./fixtures/develop-idb-double";

const photo = (name: string) => developPhotoFromFile(new File([`synthetic ${name}`], name));

describe("Hearts persist with the photo", () => {
  test("a hearted photo is still hearted after the library is read back", async () => {
    const db = developIdbDouble();
    const options = {
      scope: `hearts-${crypto.randomUUID()}`,
      libraryId: "shoot",
      factory: db.factory,
    };
    const writer = createDevelopStore(options);
    const reader = createDevelopStore(options);
    const [a, b] = await Promise.all([photo("a.jpg"), photo("b.jpg")]);
    const added = await writer.addPhotosWithDocuments([a!, b!]);

    const first = added.documents[a!.id]!;
    expect(first.metadata.hearted).toBe(false);
    await writer.saveDocument({
      ...first,
      metadata: { ...first.metadata, hearted: true },
    });

    const library = await reader.loadLibrary();
    expect(library.documents[a!.id]!.metadata.hearted).toBe(true);
    // Hearting one photo must not heart the rest of the shoot.
    expect(library.documents[b!.id]!.metadata.hearted).toBe(false);
  });

  test("un-hearting is saved too, rather than only the first heart sticking", async () => {
    const db = developIdbDouble();
    const options = {
      scope: `hearts-${crypto.randomUUID()}`,
      libraryId: "shoot",
      factory: db.factory,
    };
    const store = createDevelopStore(options);
    const a = await photo("a.jpg");
    const added = await store.addPhotosWithDocuments([a!]);
    const saved = await store.saveDocument({
      ...added.documents[a!.id]!,
      metadata: { ...added.documents[a!.id]!.metadata, hearted: true },
    });
    await store.saveDocument({ ...saved, metadata: { ...saved.metadata, hearted: false } });
    expect((await store.loadLibrary()).documents[a!.id]!.metadata.hearted).toBe(false);
  });

  test("a document stored before hearts existed loads as not hearted instead of throwing", () => {
    const before = createDevelopDocument("photo-1", defaultDevelopSettings()) as unknown as {
      metadata: Record<string, unknown>;
    };
    delete before.metadata["hearted"];
    expect(before.metadata["hearted"]).toBeUndefined();

    const parsed = developDocumentSchema.parse(before);
    expect(parsed.metadata.hearted).toBe(false);
    // and the rest of the photographer's marks are untouched by the defaulting.
    expect(parsed.metadata.rating).toBe(0);
    expect(parsed.metadata.flag).toBeNull();
  });

  test("a new document and a Studio import both start un-hearted", () => {
    expect(createDevelopDocument("photo-2", defaultDevelopSettings()).metadata.hearted).toBe(false);
    const fromShot = developInitialStateFromShot({
      id: "studio:one",
      name: "one.jpg",
      width: 100,
      height: 100,
      verdict: "keep",
    } as Parameters<typeof developInitialStateFromShot>[0]);
    expect(fromShot.metadata.hearted).toBe(false);
    // A Cull keeper is a pick, which is a separate mark from a heart.
    expect(fromShot.metadata.flag).toBe("pick");
  });
});

describe("The Hearted filter", () => {
  const hearted = { rating: 0, flag: null, colorLabel: null, hearted: true } as const;
  const plain = { rating: 0, flag: null, colorLabel: null, hearted: false } as const;

  test("Hearted shows hearted photos and nothing else", () => {
    expect(developFilterMatches("hearted", hearted)).toBe(true);
    expect(developFilterMatches("hearted", plain)).toBe(false);
    expect(developFilterMatches("hearted", { ...plain, flag: "pick" })).toBe(false);
    expect(developFilterMatches("hearted", { ...plain, rating: 5 })).toBe(false);
    expect(developFilterMatches("hearted", undefined)).toBe(false);
  });

  test("the other filters still mean what they meant", () => {
    expect(developFilterMatches("all", plain)).toBe(true);
    expect(developFilterMatches("picks", { ...plain, flag: "pick" })).toBe(true);
    expect(developFilterMatches("picks", hearted)).toBe(false);
    expect(developFilterMatches("rated", { ...plain, rating: 3 })).toBe(true);
    expect(developFilterMatches("rated", { ...plain, rating: 2 })).toBe(false);
    expect(developFilterMatches("not-rejected", { ...plain, flag: "reject" })).toBe(false);
    expect(developFilterMatches("not-rejected", hearted)).toBe(true);
  });

  test("an unknown filter shows everything rather than falling through to not-rejected", () => {
    // The old nested ternary sent anything unrecognised to the last branch.
    expect(developFilterMatches("nonsense", { ...plain, flag: "reject" })).toBe(true);
  });

  test("Hearted survives a reload instead of reverting to All", () => {
    expect(developViewFilter("hearted")).toBe("hearted");
    for (const filter of DEVELOP_FILTERS)
      if (filter !== "all") expect(developViewFilter(filter)).toBe(filter);
    expect(developViewFilter("keepers")).toBe("picks");
    expect(developViewFilter("invented")).toBe("all");
  });

  test("filtering to Hearted re-homes the active photo onto a hearted one", () => {
    const filtered = filteredDevelopSelection(["b"], "a", new Set(["a", "b"]));
    expect(filtered.activeId).toBe("b");
    expect([...filtered.selectedIds]).toEqual(["b"]);
  });
});
