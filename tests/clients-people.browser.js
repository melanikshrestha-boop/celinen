/* Run after customer-receipt.browser.js in the same isolated QA tab at /clients.
 * Uses actual React handlers. Does not send email/SMS or activate provider integrations. */
return await (async () => {
  const qaKey = "foto:qa:customer-infrastructure";
  const meta = JSON.parse(sessionStorage.getItem(qaKey) ?? "null");
  if (
    location.origin !== "http://127.0.0.1:8085" ||
    location.pathname !== "/clients" ||
    !meta ||
    meta.shootId !== "eeaf3000-1111-4222-8333-000000000071"
  )
    throw new Error("Use isolated customer QA fixture.");
  if (
    localStorage.getItem(meta.clientKey) !== null ||
    localStorage.getItem(meta.financeKey) !== meta.fixture
  )
    throw new Error("Refusing to alter existing client or changed finance state.");
  const checks = [];
  const check = (label, value) => {
    if (!value) throw new Error(label);
    checks.push(label);
  };
  const tick = () => new Promise((r) => setTimeout(r, 40));
  const until = async (label, test) => {
    const end = performance.now() + 7000;
    while (performance.now() < end) {
      if (test()) return;
      await tick();
    }
    throw new Error(`Timed out: ${label}`);
  };
  const page = () => document.querySelector(".clients-sheet");
  const click = async (text) => {
    const b = [...page().querySelectorAll("button")].find(
      (n) => n.textContent.trim() === text || n.querySelector("strong")?.textContent === text,
    );
    if (!b) throw new Error(`Missing ${text}`);
    b.click();
    await tick();
  };
  const fill = async (label, value) => {
    const wrapper = [...page().querySelectorAll(".clients-editor label")].find(
      (n) => n.firstChild?.textContent === label,
    );
    const field = wrapper?.querySelector("input,textarea,select");
    if (!field) throw new Error(`Missing field ${label}`);
    const proto =
      field instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(field, value);
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
    await tick();
  };
  const stored = () => JSON.parse(localStorage.getItem(meta.clientKey) ?? "null");
  const remember = () => {
    const state = stored();
    if (state.clients.some((c) => !c.name.startsWith("QA ")))
      throw new Error("Unexpected non-QA contact; refusing cleanup bookkeeping.");
    meta.clients = localStorage.getItem(meta.clientKey);
    meta.clientIds = state.clients.map((c) => c.id);
    sessionStorage.setItem(qaKey, JSON.stringify(meta));
    return state;
  };
  await until("empty CRM ready", () => page()?.textContent.includes("0 contacts"));
  check("opening CRM does not create demo clients", localStorage.getItem(meta.clientKey) === null);
  check("Clients route stays independent", location.pathname === "/clients" && !location.search);
  check("neutral black CRM", getComputedStyle(page()).backgroundColor === "rgb(0, 0, 0)");
  const today = new Date();
  const due = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await click("New client");
  await fill("Name", "QA Jordan Ellis");
  await fill("Organization", "QA Portrait Club");
  await fill("Email", "qa.jordan@example.com");
  await fill("Phone", "+1 (415) 555-0171");
  await fill("Next follow-up", due);
  await fill("Brief / notes", "QA Preserve this brief and all linked records.");
  await click("Save");
  await until("first client saved", () => document.querySelector(".clients-detail"));
  const original = remember().clients[0];
  check(
    "client saved exact entered contact",
    original.email === "qa.jordan@example.com" && original.phone === "+1 (415) 555-0171",
  );
  check(
    "follow-up is a real date",
    original.followUpOn === due && page().textContent.includes("Today"),
  );
  await click("Add booking");
  await fill("Booking name", "QA Portrait Session");
  await fill("Date", due);
  await fill("Location", "QA Studio");
  await fill("Status", "confirmed");
  await click("Save");
  await until("booking persisted", () => stored()?.clients[0]?.bookings.length === 1);
  const booked = remember().clients[0];
  check(
    "booking attached to same client",
    booked.id === original.id && booked.bookings[0].status === "confirmed",
  );
  await until("detail restored", () => document.querySelector(".clients-detail"));
  await click("← All clients");
  await click("New client");
  await fill("Name", "QA Morgan Lee");
  await fill("Email", "qa.morgan@example.com");
  await click("Save");
  await until("second client saved", () => stored()?.clients.length === 2);
  let state = remember();
  const untouched = JSON.stringify(state.clients.find((c) => c.id !== original.id));
  await until("second detail", () => document.querySelector(".clients-detail"));
  await click("← All clients");
  const search = page().querySelector('[type="search"]');
  const searchFor = async (value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(search, value);
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
  };
  await searchFor("4155550171");
  check(
    "formatted phone search finds one client",
    page().querySelectorAll(".clients-people tbody tr").length === 1 &&
      page().textContent.includes("QA Jordan Ellis"),
  );
  await searchFor("qa.morgan@example.com");
  check(
    "email search finds one client",
    page().querySelectorAll(".clients-people tbody tr").length === 1 &&
      page().textContent.includes("QA Morgan Lee"),
  );
  await searchFor("");
  await click("Follow-ups");
  check(
    "follow-ups show only scheduled clients",
    page().querySelectorAll(".clients-people tbody tr").length === 1 &&
      page().textContent.includes("QA Jordan Ellis"),
  );
  await click("Board");
  check("all canonical stages shown", page().querySelectorAll(".clients-board-col").length === 6);
  const stage = page().querySelector('[aria-label="Stage for QA Jordan Ellis"]');
  stage.value = "booked";
  stage.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    "stage persisted",
    () => stored()?.clients.find((c) => c.id === original.id)?.stage === "booked",
  );
  state = remember();
  check(
    "stage update preserves the other contact byte-for-byte",
    JSON.stringify(state.clients.find((c) => c.id !== original.id)) === untouched,
  );
  check(
    "stage update preserves client booking IDs",
    JSON.stringify(state.clients.find((c) => c.id === original.id).bookings) ===
      JSON.stringify(booked.bookings),
  );
  await click("People");
  await click("QA Jordan Ellis");
  await click("Edit contact");
  await fill("Phone", "+1 (415) 555-0172");
  await click("Save");
  await until(
    "edited phone saved",
    () => stored()?.clients.find((c) => c.id === original.id)?.phone === "+1 (415) 555-0172",
  );
  state = remember();
  const edited = state.clients.find((c) => c.id === original.id);
  check(
    "contact editing preserves identity and creation date",
    edited.id === original.id && edited.createdAt === original.createdAt,
  );
  check(
    "contact edit preserves bookings, notes and links",
    JSON.stringify(edited.bookings) === JSON.stringify(booked.bookings) &&
      edited.brief === original.brief &&
      JSON.stringify(edited.galleryIds) === JSON.stringify(original.galleryIds) &&
      JSON.stringify(edited.invoiceIds) === JSON.stringify(original.invoiceIds),
  );
  await until("contact detail restored", () => document.querySelector(".clients-detail"));
  await click("← All clients");
  await click("All fields");
  check(
    "legacy sheet fields retained",
    page().textContent.includes("Alias") &&
      page().textContent.includes("Client pw") &&
      page().textContent.includes("GPS"),
  );
  await click("People");
  check(
    "CRM never alters financial history",
    localStorage.getItem(meta.financeKey) === meta.fixture,
  );
  meta.checks = checks;
  sessionStorage.setItem(qaKey, JSON.stringify(meta));
  return {
    count: checks.length,
    checks,
    externalMessagesSent: 0,
    next: "Reload /clients and compare saved clients to QA metadata; then run cleanup.",
  };
})();
