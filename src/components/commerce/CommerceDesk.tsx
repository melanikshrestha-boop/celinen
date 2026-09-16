import { useEffect, useRef, useState } from "react";
import { ArrowRight, Globe2, ImagePlus, Upload } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shell } from "@/components/lensos/Shell";
import { useAccount } from "@/components/account/AccountProvider";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import { getShop, persistShop } from "@/lib/commerce/functions";
import {
  currencySchema,
  domainSchema,
  emptyShop,
  mergeImport,
  money,
  parsePrice,
  shopSchema,
  type Currency,
  type Shop,
} from "@/lib/commerce/model";
import { previewShopify, type ImportPreview } from "@/lib/commerce/shopify";
import "./commerce.css";

const defaultAPI = { getShop, persistShop };
export function CommerceDesk({ api = defaultAPI }: { api?: typeof defaultAPI }) {
  const account = useAccount();
  const [editing, setEditing] = useState<string | null>(null);
  const productForm = useRef<HTMLFormElement>(null);
  const [shop, setShop] = useState<Shop>(emptyShop),
    [baseline, setBaseline] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [domain, setDomain] = useState(""),
    [title, setTitle] = useState(""),
    [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD"),
    [variant, setVariant] = useState("");
  const [fulfillment, setFulfillment] = useState<"self" | "lab" | "undecided">("undecided");
  const [csv, setCSV] = useState(""),
    [filename, setFilename] = useState(""),
    [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importCurrency, setImportCurrency] = useState<Currency>("USD");
  const importCurrencyNow = useRef<Currency>("USD");
  const locked = useRef(false),
    alive = useRef(true),
    fileGeneration = useRef(0);
  const dirty = JSON.stringify(shop) !== (baseline || JSON.stringify(emptyShop()));
  useToolLeaveGuard(
    busy
      ? "A shop operation is running."
      : dirty || title || domain || csv
        ? "Your print shop has unsaved work."
        : null,
  );
  async function load() {
    if (locked.current) return;
    if (dirty && !window.confirm("Reload the saved shop and discard these unsaved changes?"))
      return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api.getShop();
      if (alive.current) {
        setShop(result);
        setBaseline(JSON.stringify(result));
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Could not load your shop.");
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
    // Mount-only load: re-running on draft edits would overwrite unsaved work. Account switches remount this tool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function save() {
    if (locked.current || !baseline) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api.persistShop({
        data: { expectedOwner: account?.user?.id ?? "", state: shopSchema.parse(shop) },
      });
      if (alive.current) {
        setShop(result);
        setBaseline(JSON.stringify(result));
        setNotice("Shop saved privately. Nothing was published or purchased.");
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Could not save. Your draft is preserved.");
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function addProduct(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const id = editing ?? crypto.randomUUID();
      const prior = shop.products.find((p) => p.id === editing);
      const next = {
        id,
        sourceKey: `manual:${id}`,
        description: "",
        sku: "",
        imageReference: "",
        archived: false,
        ...prior,
        title,
        variant,
        currency,
        priceMinor: parsePrice(price, currency),
        fulfillment,
      };
      setShop(
        shopSchema.parse({
          ...shop,
          products: editing
            ? shop.products.map((p) => (p.id === editing ? next : p))
            : [...shop.products, next],
        }),
      );
      setTitle("");
      setPrice("");
      setVariant("");
      setEditing(null);
      setNotice(
        editing
          ? "Print updated in your draft. Save the shop to keep it."
          : "Print added to your draft. Save the shop to keep it.",
      );
    } catch {
      setError("Check the print title and price. The shop supports up to 500 variants.");
    }
  }
  function analyze(source = csv, selectedCurrency = importCurrency) {
    try {
      setPreview(previewShopify(source, selectedCurrency));
      setError("");
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Could not read CSV.");
    }
  }
  const active = shop.products.filter((p) => !p.archived);
  return (
    <Shell hideEventHeader>
      <main className="commerce-desk">
        <header className="commerce-heading">
          <div>
            <p className="commerce-eyebrow">Your business, in one place</p>
            <h1>Print shop</h1>
            <p>Make room for the work people want to keep.</p>
          </div>
          <button
            className="commerce-primary"
            disabled={busy || !dirty || !baseline}
            onClick={() => void save()}
          >
            {busy ? "Working…" : "Save shop"}
            <ArrowRight size={16} />
          </button>
        </header>
        {error && (
          <div className="commerce-feedback" role="alert">
            <p>{error}</p>
            <button onClick={() => void load()} disabled={busy}>
              Reload saved data
            </button>
          </div>
        )}
        {notice && (
          <p role="status" className="commerce-notice">
            {notice}
          </p>
        )}
        <Tabs defaultValue="prints">
          <TabsList className="commerce-tabs" aria-label="Shop tools">
            <TabsTrigger value="prints">Prints</TabsTrigger>
            <TabsTrigger value="domains">Domains</TabsTrigger>
            <TabsTrigger value="import">Shopify import</TabsTrigger>
          </TabsList>
          <TabsContent value="prints" forceMount className="commerce-panel">
            <label className="commerce-label">
              Shop name
              <input
                maxLength={100}
                value={shop.name}
                onChange={(e) => setShop({ ...shop, name: e.target.value })}
                disabled={busy}
              />
            </label>
            <p className="commerce-caption">
              Private catalog · {active.length} variants · checkout not activated
            </p>
            <section aria-label="Print catalog" className="commerce-catalog">
              {active.map((p) => (
                <article className="commerce-product" key={p.id}>
                  <ImagePlus size={24} aria-hidden="true" />
                  <div>
                    <h3>
                      <button
                        disabled={busy}
                        aria-label={`Edit ${p.title}`}
                        onClick={() => {
                          setEditing(p.id);
                          setTitle(p.title);
                          setPrice(String(p.priceMinor / (p.currency === "JPY" ? 1 : 100)));
                          setCurrency(p.currency);
                          setVariant(p.variant);
                          setFulfillment(p.fulfillment);
                          productForm.current?.scrollIntoView({ block: "start" });
                          productForm.current?.querySelector("input")?.focus();
                        }}
                      >
                        {p.title}
                      </button>
                    </h3>
                    <p>
                      {p.variant || "One size"} ·{" "}
                      {p.fulfillment === "undecided"
                        ? "Choose fulfillment"
                        : p.fulfillment === "self"
                          ? "Photographer fulfilled"
                          : "Print lab — not mapped yet"}
                    </p>
                    {p.imageReference && (
                      <small>Shopify image reference retained; artwork not uploaded.</small>
                    )}
                  </div>
                  <strong>{money(p.priceMinor, p.currency)}</strong>
                  <button
                    aria-label={`Archive ${p.title}`}
                    disabled={busy}
                    onClick={() =>
                      setShop({
                        ...shop,
                        products: shop.products.map((item) =>
                          item.id === p.id ? { ...item, archived: true } : item,
                        ),
                      })
                    }
                  >
                    Archive
                  </button>
                </article>
              ))}
              {!active.length && (
                <p className="commerce-empty">
                  Start with one print, or bring your Shopify catalog.
                </p>
              )}
            </section>
            {shop.products.some((p) => p.archived) && (
              <details>
                <summary>Archived prints</summary>
                {shop.products
                  .filter((p) => p.archived)
                  .map((p) => (
                    <p className="commerce-row" key={p.id}>
                      {p.title}
                      <button
                        disabled={busy}
                        onClick={() =>
                          setShop({
                            ...shop,
                            products: shop.products.map((item) =>
                              item.id === p.id ? { ...item, archived: false } : item,
                            ),
                          })
                        }
                      >
                        Restore
                      </button>
                    </p>
                  ))}
              </details>
            )}
            <form onSubmit={addProduct} className="commerce-form" ref={productForm}>
              <h2>{editing ? "Edit print" : "Add a print"}</h2>
              <fieldset disabled={busy}>
                <label>
                  Title
                  <input
                    required
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="After the final whistle"
                  />
                </label>
                <div className="commerce-fields">
                  <label>
                    Size or edition
                    <input
                      maxLength={300}
                      value={variant}
                      onChange={(e) => setVariant(e.target.value)}
                      placeholder="16 × 20 in · unframed"
                    />
                  </label>
                  <label>
                    Fulfillment
                    <select
                      value={fulfillment}
                      onChange={(e) => setFulfillment(e.target.value as typeof fulfillment)}
                    >
                      <option value="undecided">Decide later</option>
                      <option value="self">I produce and ship it</option>
                      <option value="lab">A print lab ships it</option>
                    </select>
                  </label>
                </div>
                <div className="commerce-fields">
                  <label>
                    Price
                    <input
                      required
                      inputMode="decimal"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="85.00"
                    />
                  </label>
                  <label>
                    Currency
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value as Currency)}
                    >
                      {currencySchema.options.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="submit" className="commerce-primary">
                  {editing ? "Update draft" : "Add to draft"}
                </button>
                {editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setTitle("");
                      setPrice("");
                      setVariant("");
                    }}
                  >
                    Cancel edit
                  </button>
                )}
              </fieldset>
            </form>
            <p className="commerce-caption">
              Before sales open: print-ready artwork, seller payments, shipping, taxes, returns and
              lab mapping must be verified. This catalog cannot charge customers yet.
            </p>
          </TabsContent>
          <TabsContent value="domains" forceMount className="commerce-panel">
            <Globe2 size={24} />
            <h2>Your name on the door.</h2>
            <p>
              Keep your domain choices with your shop. A saved name is not a reservation or a
              purchase.
            </p>
            <form
              className="commerce-form"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  const value = domainSchema.parse(domain);
                  setShop(
                    shopSchema.parse({ ...shop, domains: [...new Set([...shop.domains, value])] }),
                  );
                  setDomain("");
                  setError("");
                  setNotice("Domain added to your draft. Availability has not been checked.");
                } catch {
                  setError("Enter a domain such as yourstudio.com. Keep at most 20 choices.");
                }
              }}
            >
              <label>
                Domain
                <input
                  required
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  disabled={busy}
                  placeholder="yourstudio.com"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </label>
              <button className="commerce-primary" disabled={busy}>
                Save a domain choice
              </button>
            </form>
            {shop.domains.map((d) => (
              <div className="commerce-row" key={d}>
                <div>
                  <strong>{d}</strong>
                  <p>Not checked · not registered</p>
                </div>
                <button
                  disabled={busy}
                  onClick={() => setShop({ ...shop, domains: shop.domains.filter((v) => v !== d) })}
                >
                  Remove choice
                </button>
              </div>
            ))}
            <section className="commerce-prose">
              <h3>Buying inside Celinen</h3>
              <p>
                Embedded registration is planned through Entri. Domain checkout is not active yet.
                It needs a registrar partner and verified custom-domain hosting before anyone is
                charged.
              </p>
              <p>
                The purchase flow must show registration and renewal prices, ownership details and
                renewal choices. A successful payment alone will never be labeled “site live.”
              </p>
            </section>
          </TabsContent>
          <TabsContent value="import" forceMount className="commerce-panel">
            <Upload size={24} />
            <h2>Bring your shop with you.</h2>
            <p>
              Import a Shopify product CSV into private Celinen print drafts. Your Shopify store
              stays untouched.
            </p>
            <div className="commerce-form">
              <label>
                Shopify product export
                <input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={busy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const generation = ++fileGeneration.current;
                    setPreview(null);
                    setCSV("");
                    setFilename("");
                    if (file.size > 2_000_000) {
                      setError("Use a CSV under 2 MB.");
                      return;
                    }
                    try {
                      const source = await file.text();
                      if (!alive.current || generation !== fileGeneration.current) return;
                      setCSV(source);
                      setFilename(file.name);
                      analyze(source, importCurrencyNow.current);
                    } catch {
                      if (alive.current) setError("Could not read this file.");
                    }
                  }}
                />
              </label>
              <label>
                Original shop currency
                <select
                  value={importCurrency}
                  disabled={busy}
                  onChange={(e) => {
                    const next = e.target.value as Currency;
                    importCurrencyNow.current = next;
                    setImportCurrency(next);
                    if (csv) analyze(csv, next);
                  }}
                >
                  {currencySchema.options.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <p className="commerce-caption">
                Choose the export’s base currency. No currency conversion is performed.
                Multi-currency markets are not imported.
              </p>
            </div>
            {preview && (
              <section aria-label="Import preview">
                <h3>
                  {filename} · {preview.products.length} variants
                </h3>
                {preview.errors.length > 0 && (
                  <div role="alert">
                    <p>
                      Fix {preview.errors.length} issues before importing. Nothing has been added.
                    </p>
                    <ul>
                      {preview.errors.slice(0, 20).map((message, i) => (
                        <li key={i}>{message}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {preview.warnings.map((w) => (
                  <p className="commerce-caption" key={w}>
                    {w}
                  </p>
                ))}
                {preview.imageRows > 0 && (
                  <p className="commerce-caption">
                    {preview.imageRows} additional image rows skipped; they are not print variants.
                  </p>
                )}
                <div className="commerce-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Print</th>
                        <th>Variant</th>
                        <th>Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.products.slice(0, 20).map((p) => (
                        <tr key={p.id}>
                          <td>{p.title}</td>
                          <td>{p.variant || "Default"}</td>
                          <td>{money(p.priceMinor, p.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.products.length > 20 && (
                  <p>Showing the first 20 of {preview.products.length} variants.</p>
                )}
                <button
                  className="commerce-primary"
                  disabled={busy || !!preview.errors.length || !preview.products.length}
                  onClick={() => {
                    try {
                      const result = mergeImport(shop, preview.products);
                      setShop(result.shop);
                      setNotice(
                        `${result.added} variants added to your draft; ${result.skipped} existing variants left untouched. Save the shop to keep them.`,
                      );
                      setPreview(null);
                      setCSV("");
                      setFilename("");
                    } catch {
                      setError(
                        "This import exceeds the 500-variant catalog limit. No products were replaced.",
                      );
                    }
                  }}
                >
                  Add reviewed variants to draft
                </button>
              </section>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </Shell>
  );
}
