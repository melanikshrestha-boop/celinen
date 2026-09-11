// Real sensor-render cancellation, on the reserved public RAW fixture only.
return await (async () => {
  if (location.hostname !== '127.0.0.1' || location.port !== '8085' ||
      new URL(location.href).searchParams.get('shoot') !== 'eeaf3000-1111-4222-8333-000000000009')
    throw new Error('Use the isolated RAW proof test project');
  const root = () => document.querySelector('.foto-develop');
  const buttons = () => [...root().querySelectorAll('button')];
  const button = (name) => buttons().find(b => b.getAttribute('aria-label') === name) || buttons().find(b => b.textContent.trim() === name);
  const checks = [];
  const check = (name, condition) => { if (!condition) throw new Error(name); checks.push(name); };
  const wait = async (fn, message) => {
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline) { if (fn()) return; await new Promise(r => setTimeout(r, 50)); }
    throw new Error(message);
  };
  const click = (name) => { const b = button(name); if (!b || b.matches(':disabled')) throw new Error(`Unavailable ${name}`); b.click(); };
  await wait(() => button('Export') && !button('Export').disabled, 'Editor not ready');
  click('Export');
  await wait(() => button('Preview export'), 'Export dialog absent');
  click('Preview export');
  await wait(() => button('Stop preview'), 'Preview did not enter cancellable busy state');
  check('source, size and quality controls are locked while rendering', [...root().querySelectorAll('.develop-export-settings select,.develop-export-settings input')].every(el => el.matches(':disabled')));
  check('background editing remains inert during proof rendering', root().querySelector('.develop-workspace').inert);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Escape cannot detach a running proof', Boolean(root().querySelector('[role=dialog]')));
  click('Stop preview');
  await wait(() => root().querySelector('[role=dialog] [role=alert]')?.textContent.includes('cancelled'), 'Cancellation did not finish');
  check('cancelled rendering leaves no downloadable proof', !root().querySelector('.develop-export-proof img') && !button('Preview export').matches(':disabled'));
  click('Preview export');
  await wait(() => { const img = root().querySelector('.develop-export-proof img'); return img?.complete && img.naturalWidth > 0 && !button('Export JPEG').disabled; }, 'Retry after cancellation failed');
  check('a new sensor proof can complete after cancellation', root().querySelector('.develop-export-proof figcaption').textContent.includes('Sensor RAW'));
  click('Cancel');
  await wait(() => !root().querySelector('[role=dialog]'), 'Dialog did not close');
  check('closing a completed preview leaves the editor usable', !root().querySelector('.develop-workspace').inert && !button('Export').disabled);
  return { passed: checks.length, checks, note: 'Real local native sensor render cancelled, retried and inspected; no download or customer edits.' };
})();
