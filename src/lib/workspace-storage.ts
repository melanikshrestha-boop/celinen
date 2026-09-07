/** Legacy data belongs to this device, never implicitly to the next signed-in user. */
export function workspaceStorageKey(base: string, scope = "device-local") {
  if (scope === "device-local") return base;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(scope))
    throw new Error("A valid account is required for workspace storage.");
  return `${base}:account:${scope.toLowerCase()}`;
}
