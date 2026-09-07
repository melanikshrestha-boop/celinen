import { describe, expect, test } from "bun:test";
import {
  emptyShop,
  mergeImport,
  parsePrice,
  reputation,
  domainSchema,
  photographerSchema,
  shopSchema,
  inquirySchema,
  requireSameOwner,
} from "../src/lib/commerce/model";
import { parseCSV, previewShopify } from "../src/lib/commerce/shopify";
import { workbenchNavigation, workbenchTab } from "../src/lib/workbench";
const header = "Handle,Title,Body (HTML),Option1 Value,Variant SKU,Variant Price,Image Src";
const fixture = `${header}\r\nnight,"Night, games","<b>Keep this</b>",16x20,SPORT-1,85.50,https://cdn.shopify.com/one.jpg\r\nnight,,,24x30,SPORT-2,120.00,\r\nnight,,,,,,https://cdn.shopify.com/two.jpg`;
describe("Shopify import", () => {
  test("quoted delimiters, newlines, escaped quotes, CRLF, Unicode and BOM", () => {
    expect(parseCSV('\uFEFFa,b\r\n"one, two","say ""hello""\nनमस्ते"\r\n')).toEqual([
      ["a", "b"],
      ["one, two", 'say "hello"\nनमस्ते'],
    ]);
  });
  test("inherits product metadata for variants, skips image-only rows, keeps original prices", () => {
    const result = previewShopify(fixture, "USD");
    expect(result.errors).toEqual([]);
    expect(result.products).toHaveLength(2);
    expect(result.imageRows).toBe(1);
    expect(result.products.map((p) => p.priceMinor)).toEqual([8550, 12000]);
    expect(result.products[1]!.title).toBe("Night, games");
    expect(result.products[1]!.imageReference).toBe("https://cdn.shopify.com/one.jpg");
    expect(result.products.every((p) => p.fulfillment === "undecided")).toBe(true);
  });
  test("new Shopify column aliases and explicit JPY base currency", () => {
    const result = previewShopify(
      "URL handle,Title,Price,Option1 value,SKU,Product image URL\na,夜,1500,16x20,A,",
      "JPY",
    );
    expect(result.errors).toHaveLength(0);
    expect(result.products[0]!.priceMinor).toBe(1500);
  });
  test("variant images take priority over a general product image regardless of column order", () => {
    const result = previewShopify(
      "Handle,Title,Variant Price,Image Src,Variant Image\na,Print,12,https://cdn.shopify.com/general.jpg,https://cdn.shopify.com/variant.jpg",
      "USD",
    );
    expect(result.products[0]!.imageReference).toBe("https://cdn.shopify.com/variant.jpg");
  });
  test.each([
    'a,"unterminated',
    'a,"b"garbage',
    'a,b"quote',
    "a,".repeat(151),
    "a\n".repeat(2003),
    "é".repeat(1_000_001),
  ])("rejects malformed/bounded input %#", (csv) => expect(() => parseCSV(csv)).toThrow());
  test.each(["", "Name,Email\nP,private@example.com", "Handle,Title,Title,Variant Price\na,b,c,5"])(
    "rejects wrong exports %#",
    (csv) => expect(() => previewShopify(csv, "USD")).toThrow(),
  );
  test.each(["", "-1", "NaN", "Infinity", "1e3", "1,000", "0", "12.345", "=SUM(1+1)"])(
    "never accepts invalid price %s",
    (price) => {
      const result = previewShopify(`Handle,Title,Variant Price\na,Name,"${price}"`, "USD");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.products).toHaveLength(0);
    },
  );
  test("duplicate variants and orphan variants block the import", () => {
    expect(previewShopify("Handle,Title,Variant Price\na,Name,1\na,,2", "USD").errors).toHaveLength(
      1,
    );
    expect(previewShopify("Handle,Title,Variant Price\na,,1", "USD").errors).toHaveLength(1);
  });
  test("import preserves saved edits, archived entries and original ids without mutating source", () => {
    const products = previewShopify(fixture, "USD").products;
    const prior = {
      ...emptyShop(),
      products: [{ ...products[0]!, title: "Edited", archived: true }],
    };
    const copy = structuredClone(prior);
    const first = mergeImport(prior, products);
    expect(first.added).toBe(1);
    expect(first.skipped).toBe(1);
    expect(prior).toEqual(copy);
    expect(first.shop.products[0]).toEqual(copy.products[0]);
    expect(mergeImport(first.shop, previewShopify(fixture, "USD").products).added).toBe(0);
  });
  test("catalog limits and duplicate ids fail closed", () => {
    const p = previewShopify(fixture, "USD").products[0]!;
    expect(() => shopSchema.parse({ ...emptyShop(), products: [p, p] })).toThrow();
    expect(() =>
      shopSchema.parse({
        ...emptyShop(),
        products: Array.from({ length: 501 }, (_, i) => ({
          ...p,
          id: crypto.randomUUID(),
          sourceKey: `${i}`,
        })),
      }),
    ).toThrow();
  });
  test("dangerous external references are retained as inert text; no network fetch", () => {
    const result = previewShopify(
      "Handle,Title,Variant Price,Image Src\na,=HYPERLINK(123),20,http://127.0.0.1/private",
      "USD",
    );
    expect(result.products[0]!.title).toBe("=HYPERLINK(123)");
    expect(result.products[0]!.imageReference).toBe("http://127.0.0.1/private");
  });
});
describe("commerce trust boundaries", () => {
  test("account switches cannot redirect an in-flight mutation", () => {
    expect(() => requireSameOwner("second", "first")).toThrow("account changed");
    expect(() => requireSameOwner("", "")).toThrow();
    expect(() => requireSameOwner("first", "first")).not.toThrow();
  });
  test("currency decimal handling is exact", () => {
    expect(parsePrice("0.29", "USD")).toBe(29);
    expect(parsePrice("1500", "JPY")).toBe(1500);
    expect(() => parsePrice("1500.20", "JPY")).toThrow();
    expect(() => parsePrice("1000001.00", "USD")).toThrow();
  });
  test("domain choices cannot contain redirects, paths, credentials, ports or local addresses", () => {
    expect(domainSchema.parse("  MyStudio.COM ")).toBe("mystudio.com");
    for (const invalid of [
      "http://studio.com",
      "studio.com/path",
      "user@studio.com",
      "studio.com:443",
      "127.0.0.1",
      "localhost",
      "-a.com",
      "a..com",
      "a.com\nother.com",
      "*.com",
    ])
      expect(domainSchema.safeParse(invalid).success).toBe(false);
  });
  test("profile schema never accepts ratings, owner ids or private account fields", () => {
    const profile = {
      displayName: "写真 Studio",
      bio: "",
      city: "東京",
      country: "日本",
      specialties: ["Sports"],
      languages: "日本語",
      visible: false,
      available: true,
    };
    expect(photographerSchema.parse(profile).displayName).toBe(profile.displayName);
    for (const patch of [
      { rating: 5 },
      { owner: crypto.randomUUID() },
      { email: "private@example.com" },
      { specialties: [] },
      { displayName: "" },
    ])
      expect(photographerSchema.safeParse({ ...profile, ...patch }).success).toBe(false);
    expect(
      inquirySchema.safeParse({
        id: crypto.randomUUID(),
        recipient: crypto.randomUUID(),
        kind: "booking",
        message: "Hi",
        sender: crypto.randomUUID(),
      }).success,
    ).toBe(false);
  });
  test("reputation is review-backed, ignores invalid data and discounts tiny samples", () => {
    expect(reputation([])).toEqual({ reviewCount: 0, rating: null, score: 0 });
    expect(reputation([0, 6, NaN, Infinity, 4.5])).toEqual(reputation([]));
    expect(reputation([5]).score).toBeLessThan(reputation(Array(50).fill(4)).score);
    expect(reputation([1, 2, 3, 4, 5]).rating).toBe(3);
  });
  test("new business tools reuse workspace tabs and explicit navigation commands", () => {
    expect(workbenchTab("/shop")?.label).toBe("Print shop");
    expect(workbenchNavigation("open domains")).toBe("/shop");
    expect(workbenchNavigation("open marketplace")).toBe("/network");
    expect(workbenchNavigation("buy a domain")).toBeNull();
  });
});
