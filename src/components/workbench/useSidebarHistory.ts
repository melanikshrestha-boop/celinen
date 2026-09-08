import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";

/** Keep this above the shoot-keyed chat session and responsive drawer. */
export function useSidebarHistory() {
  const { history } = useRouter();
  const [position, setPosition] = useState(() => {
    const index = history.location.state.__TSR_index ?? 0;
    return { index, furthest: index };
  });
  useEffect(
    () =>
      history.subscribe(({ location, action }) => {
        const index = location.state.__TSR_index ?? 0;
        setPosition((previous) => ({
          index,
          furthest: action.type === "PUSH" ? index : Math.max(previous.furthest, index),
        }));
      }),
    [history],
  );
  return {
    canGoBack: position.index > 0,
    canGoForward: position.index < position.furthest,
    back: () => history.back(),
    forward: () => history.forward(),
  };
}
