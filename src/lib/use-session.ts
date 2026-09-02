import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SessionState = "loading" | "in" | "out";

export function useSessionState(): SessionState {
  const [state, setState] = useState<SessionState>("loading");

  useEffect(() => {
    let alive = true;
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      if (alive) setState(session ? "in" : "out");
    });
    supabase.auth.getSession().then(({ data: d }) => {
      if (alive) setState(d.session ? "in" : "out");
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return state;
}
