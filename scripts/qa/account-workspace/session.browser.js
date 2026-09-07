if (location.origin !== "http://127.0.0.1:8083" || !window.__accountQA)
  throw new Error("QA fixture only");
const qa = window.__accountQA,
  passed = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, label) => {
  if (!value) throw new Error(label);
  passed.push(label);
};
const wait = async (fn) => {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await sleep(20);
  }
  throw new Error("UI did not settle");
};
const fill = async (id, value) => {
  const el = document.getElementById(id);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(30);
};
const submit = () => document.querySelector(".settings-profile-form button[type=submit]").click();
await fill("profile-display-name", "Must not enter second account");
qa.delay = 180;
submit();
await sleep(25);
qa.swap();
await wait(() => document.querySelector(".account-setup"));
await sleep(220);
assert(
  document.getElementById("profile-display-name").value === "Second QA account",
  "Account switch fences an in-flight old profile save",
);
assert(
  document.getElementById("profile-workspace-name").value === "Personal workspace",
  "New account does not inherit another workspace name",
);
assert(
  document.documentElement.dataset.chatText === "default",
  "Device preferences remain account-scoped",
);
assert(!document.querySelector(".account-settings"), "First-use setup precedes private settings");
qa.delay = 0;
qa.failNext = true;
await fill("profile-workspace-name", "QA Sports Studio");
submit();
await wait(() => document.querySelector(".settings-form-error"));
assert(
  document.querySelector(".account-setup"),
  "Failed onboarding save cannot falsely mark setup complete",
);
assert(
  document.getElementById("profile-workspace-name").value === "QA Sports Studio",
  "Failed setup keeps typed workspace name",
);
qa.verifyDelay = 180;
qa.refresh();
await sleep(25);
submit();
await wait(() => document.querySelector(".account-settings"));
await sleep(220);
qa.verifyDelay = 0;
assert(
  !document.querySelector(".account-setup"),
  "Late session verification cannot reopen completed setup",
);
assert(
  document.querySelector(".settings-profile strong").textContent === "Second QA account",
  "Successful setup opens the correct account",
);
assert(qa.errors.length === 0, "No uncaught runtime errors during session tests");
return { passed, count: passed.length };
