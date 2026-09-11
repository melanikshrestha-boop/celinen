/** Progressive enhancement only. Server HTML and unsupported browsers remain readable. */
function revealEdge(top: number | undefined, viewportHeight: number): "up" | "down" {
  if (typeof top !== "number") return "down";
  return top < viewportHeight * 0.35 ? "up" : "down";
}

export function observeMarketingReveals(root: HTMLElement): () => void {
  const view = root.ownerDocument.defaultView;
  if (
    !view ||
    typeof view.matchMedia !== "function" ||
    typeof view.IntersectionObserver !== "function"
  )
    return () => {};
  const preference = view.matchMedia("(prefers-reduced-motion: reduce)");
  const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
  let observer: IntersectionObserver | undefined;
  let disposed = false;
  let generation = 0;
  const restore = () =>
    targets.forEach((target) => {
      target.removeAttribute("data-reveal-state");
      target.removeAttribute("data-reveal-from");
    });
  const showFocused = (event: Event) => {
    const focused = event.target as Node | null;
    for (const target of targets)
      if (focused && target.contains(focused)) target.dataset["revealState"] = "visible";
  };
  const showAnchor = () => {
    let id: string;
    try {
      id = decodeURIComponent(view.location.hash.slice(1));
    } catch {
      return;
    }
    const anchor = id ? root.ownerDocument.getElementById(id) : null;
    if (anchor && root.contains(anchor))
      for (const target of targets)
        if (anchor.contains(target) || target.contains(anchor))
          target.dataset["revealState"] = "visible";
  };
  const configure = () => {
    const current = ++generation;
    observer?.disconnect();
    observer = undefined;
    restore();
    if (disposed || preference.matches) return;
    try {
      observer = new view.IntersectionObserver(
        (entries) => {
          if (disposed || current !== generation || preference.matches) return;
          for (const entry of entries) {
            const target = entry.target as HTMLElement;
            const focused = target.contains(root.ownerDocument.activeElement);
            target.dataset["revealFrom"] = revealEdge(
              entry.boundingClientRect?.top,
              view.innerHeight,
            );
            target.dataset["revealState"] =
              entry.isIntersecting || focused ? "visible" : "outside";
          }
        },
        { threshold: 0, rootMargin: "0px 0px -8% 0px" },
      );
      for (const target of targets) {
        const rect = target.getBoundingClientRect();
        // Do not hide already-visible content while hydration catches up.
        target.dataset["revealFrom"] = revealEdge(rect.top, view.innerHeight);
        target.dataset["revealState"] =
          rect.bottom > 0 && rect.top < view.innerHeight ? "visible" : "outside";
        observer.observe(target);
      }
      showAnchor();
    } catch {
      // Disconnect does not discard entries already queued for delivery.
      generation++;
      observer?.disconnect();
      observer = undefined;
      restore();
    }
  };
  configure();
  preference.addEventListener?.("change", configure);
  root.addEventListener("focusin", showFocused);
  view.addEventListener("hashchange", configure);
  view.addEventListener("pageshow", configure);
  return () => {
    disposed = true;
    generation++;
    observer?.disconnect();
    preference.removeEventListener?.("change", configure);
    root.removeEventListener("focusin", showFocused);
    view.removeEventListener("hashchange", configure);
    view.removeEventListener("pageshow", configure);
    restore();
  };
}
