// Run after develop-ui.browser.js, a real browser reload, and Develop hydration.
return await (async () => {
  const expected = JSON.parse(sessionStorage.getItem('foto-develop-qa-reload') || 'null');
  if (!expected || expected.route !== location.href || !/^eeaf3000-1111-4222-8333-0000000000/.test(new URL(location.href).searchParams.get('shoot') || '')) throw new Error('A completed disposable UI test is required');
  const root = () => document.querySelector('.foto-develop');
  const wait = async (condition) => {
    const until = Date.now() + 18000;
    while (Date.now() < until) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 80)); }
    throw new Error('Reload did not restore the Develop library');
  };
  await wait(() => root()?.querySelectorAll('.develop-filmstrip-items button').length >= 2);
  const photo = [...root().querySelectorAll('.develop-filmstrip-items button')].find(button => button.getAttribute('aria-label') === expected.name);
  if (!photo) throw new Error('Saved photograph is missing');
  photo.click();
  await wait(() => photo.classList.contains('is-active') && root().querySelector('input[aria-label="Temp value"]')?.value === expected.temperature);
  const text = root().textContent;
  const checks = [
    ['per-photo recipe survives a full browser reload', root().querySelector('input[aria-label="Temp value"]').value === expected.temperature],
    ['custom preset survives browser reload', text.includes(expected.preset)],
    ['named snapshot survives browser reload', text.includes(expected.snapshot)],
    ['rating survives browser reload', root().querySelector('[aria-label="Rate 4 stars"]').getAttribute('aria-pressed') === expected.rating],
  ];
  for (const [label, passed] of checks) if (!passed) throw new Error(label);
  return {passed:checks.length, checks:checks.map(([label]) => label)};
})()
