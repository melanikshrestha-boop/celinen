// Run with gstack browse eval, on the isolated fixture only. Never on a real account.
if (location.origin !== "http://127.0.0.1:8083" || !window.__accountQA)
  throw new Error("QA fixture only");
const qa = window.__accountQA;
const passed = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, label) => {
  if (!value) throw new Error(label);
  passed.push(label);
};
const visible = (el) => el && el.getClientRects().length > 0;
const wait = async (fn) => {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await sleep(20);
  }
  throw new Error("UI did not settle");
};
const fill = async (selector, value) => {
  const el = document.querySelector(selector);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(30);
};
const button = (text) =>
  [...document.querySelectorAll("button")].find(
    (el) => visible(el) && el.textContent.trim() === text,
  );
const choose = async (label, text) => {
  const el = document.querySelector(`[role=combobox][aria-label="${label}"]`);
  el.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerType: "mouse",
      ctrlKey: false,
    }),
  );
  await wait(() =>
    [...document.querySelectorAll("[role=option]")].some((el) => el.textContent === text),
  );
  [...document.querySelectorAll("[role=option]")].find((el) => el.textContent === text).click();
  await sleep(60);
};
const section = async (name) => {
  const nav = [...document.querySelectorAll(".settings-nav button")].find(
    (el) => el.textContent.trim() === name,
  );
  if (visible(nav)) {
    nav.click();
    await sleep(50);
  } else await choose("Settings section", name);
};
const overflow = () =>
  [
    ...document.querySelectorAll(
      ".settings-detail input, .settings-detail button, .settings-profile, .settings-row, .settings-section-picker",
    ),
  ]
    .filter(visible)
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left < -1 || r.right > innerWidth + 1;
    })
    .map((el) => el.outerHTML.slice(0, 100));

await section("Account");
const oldName = document.querySelector("#profile-display-name").value;
const newName = `QA Vincent ${qa.saves + 1}`;
await fill("#profile-display-name", newName);
await section("Appearance");
await section("Account");
assert(
  document.querySelector("#profile-display-name").value === newName,
  "Profile draft survives switching settings sections",
);
qa.failNext = true;
button("Save changes").click();
await wait(() => document.querySelector(".settings-form-error"));
assert(
  document.querySelector("#profile-display-name").value === newName,
  "Failed save keeps typed profile",
);
assert(
  document.querySelector(".settings-profile strong").textContent === oldName,
  "Failed save does not falsely update account",
);
qa.delay = 120;
const startingSaves = qa.saves;
button("Save changes").click();
await sleep(20);
assert(button("Saving…")?.disabled, "Pending save disables resubmission");
document
  .querySelector(".settings-profile-form")
  .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
await wait(() => document.querySelector(".settings-profile strong").textContent === newName);
assert(qa.saves === startingSaves + 1, "Duplicate submission sends only one request");
const mobileMenu = !document.querySelector(".account-trigger");
if (mobileMenu) {
  button("Toggle Sidebar").click();
  await wait(() => document.querySelector(".account-trigger"));
}
assert(
  document.querySelector(".account-trigger").textContent.includes(newName),
  "Successful profile save updates account menu",
);
if (mobileMenu) {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(() => !document.querySelector(".account-trigger"));
}
qa.delay = 0;
await fill("#profile-display-name", "Unsaved name");
button("Cancel").click();
await sleep(50);
assert(
  document.querySelector("#profile-display-name").value === newName,
  "Cancel restores saved profile",
);
await section("Appearance");
await choose("Theme", "Light");
assert(!document.documentElement.classList.contains("dark"), "Light applies immediately");
assert(
  getComputedStyle(document.querySelector(".photo-workbench")).backgroundColor ===
    "rgb(255, 255, 255)",
  "Light canvas is white",
);
await choose("Theme", "Black");
assert(
  getComputedStyle(document.querySelector(".photo-workbench")).backgroundColor === "rgb(0, 0, 0)",
  "Black canvas is true black",
);
await choose("Chat text size", "Large");
assert(document.documentElement.dataset.chatText === "large", "Text size reaches chat styling");
const motion = document.querySelector('[role=switch][aria-label="Reduce motion"]');
if (motion.getAttribute("aria-checked") !== "true") {
  motion.click();
  await sleep(50);
}
assert(
  document.documentElement.dataset.reduceMotion === "true",
  "Reduced motion reaches workspace styling",
);
await section("Chat");
await choose("Send a message", "⌘ / Ctrl + Enter");
assert(
  document.querySelector('[aria-label="Send a message"]').textContent.includes("Ctrl"),
  "Message shortcut is changeable",
);
await section("Connections");
assert(button("Connect")?.disabled, "Unconfigured Gmail cannot pretend to connect");
for (const [title, path] of [
  ["Open search", "/research"],
  ["Open Adobe", "/adobe"],
  ["Open publishing", "/publish"],
]) {
  button(title).click();
  await sleep(20);
  assert(qa.paths.at(-1) === path, `${title} opens the correct tool`);
}
await section("Data & privacy");
await wait(() => document.body.textContent.includes("used"));
assert(
  document.body.textContent.includes("Browser-reported capacity"),
  "Storage information comes from the browser",
);
await section("Keyboard shortcuts");
await fill('[aria-label="Search keyboard shortcuts"]', "undo");
assert(
  document.querySelectorAll(".settings-shortcuts > div").length === 1,
  "Shortcut search filters results",
);
await fill('[aria-label="Search keyboard shortcuts"]', "");
for (const name of [
  "Account",
  "Appearance",
  "Chat",
  "Connections",
  "Data & privacy",
  "Keyboard shortcuts",
]) {
  await section(name);
  assert(overflow().length === 0, `${name} controls fit at ${innerWidth}px`);
}
assert(document.documentElement.scrollWidth === innerWidth, "No page-level horizontal overflow");
await section("Account");
return { width: innerWidth, passed, count: passed.length };
