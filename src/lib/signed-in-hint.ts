/** Survives the auth restore so marketing never paints Sign In for a remembered session. */
export const SIGNED_IN_HINT_KEY = "celinen.signed-in";
export const SIGNED_IN_COOKIE = "celinen_in";

export const SIGNED_IN_HINT_SCRIPT = `(function(){try{if(localStorage.getItem("${SIGNED_IN_HINT_KEY}")==="1"||document.cookie.indexOf("${SIGNED_IN_COOKIE}=1")!==-1)document.documentElement.setAttribute("data-entry","in");}catch(e){}})();`;

export function rememberSignedIn(signedIn: boolean) {
  if (typeof document === "undefined") return;
  try {
    if (signedIn) {
      localStorage.setItem(SIGNED_IN_HINT_KEY, "1");
      document.cookie = `${SIGNED_IN_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax`;
      document.documentElement.setAttribute("data-entry", "in");
    } else {
      localStorage.removeItem(SIGNED_IN_HINT_KEY);
      document.cookie = `${SIGNED_IN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
      document.documentElement.removeAttribute("data-entry");
    }
  } catch {
    /* Private mode can block storage; the live session still wins after restore. */
  }
}

export function readSignedInHint(): boolean {
  if (typeof document === "undefined") return false;
  try {
    if (localStorage.getItem(SIGNED_IN_HINT_KEY) === "1") return true;
    return document.cookie.split(";").some((part) => part.trim() === `${SIGNED_IN_COOKIE}=1`);
  } catch {
    return false;
  }
}
