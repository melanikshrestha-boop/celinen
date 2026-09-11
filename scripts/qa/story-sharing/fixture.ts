if (location.origin !== "http://127.0.0.1:8091") throw new Error("Isolated QA only");
export const qa = { signedIn: false, sends: [] as unknown[], errors: [] as string[] };
Object.assign(window, { __storyQA: qa });
window.addEventListener("error", (e) => qa.errors.push(e.message));
window.addEventListener("unhandledrejection", (e) => qa.errors.push(String(e.reason)));
export const useAccount = () => ({
  status: qa.signedIn ? "in" : "out",
  user: qa.signedIn ? { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } : null,
  registerLeaveGuard: () => () => {},
});
export const findPhotographers = async () => {
  throw new Error("Featured creator must not run a directory search");
};
export const sendPhotographerRequest = async ({ data }: { data: unknown }) => {
  qa.sends.push(data);
  return { id: "fixture" };
};
export const getNetwork = async () => {
  throw new Error("Outside QA scope");
};
export const persistPhotographer = getNetwork;
export const respondToRequest = getNetwork;
