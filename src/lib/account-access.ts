import type { Session, User } from "@supabase/supabase-js";

export function verifiedPhotographer(user: User | null, expectedId: string): user is User {
  return Boolean(
    user && user.id === expectedId && !user.is_anonymous && user.email && user.email_confirmed_at,
  );
}

/** Verification never lets a late response resurrect a signed-out/different identity. */
export function verifiedSessionReceiver(
  verify: (token: string) => Promise<User | null>,
  receive: (user: User | null) => void,
  failure: () => void,
) {
  let generation = 0;
  let verifiedOwner: string | null = null;
  return {
    cancel: () => {
      generation++;
    },
    receive: (session: Session | null) => {
      const current = ++generation;
      if (!session) {
        verifiedOwner = null;
        receive(null);
        return;
      }
      if (verifiedOwner && verifiedOwner !== session.user.id) {
        verifiedOwner = null;
        receive(null);
      }
      // Do not call another Auth method inside Supabase's locked event callback.
      void Promise.resolve()
        .then(() => verify(session.access_token))
        .then((user) => {
          if (current !== generation) return;
          if (!verifiedPhotographer(user, session.user.id)) {
            verifiedOwner = null;
            receive(null);
            failure();
            return;
          }
          verifiedOwner = user.id;
          receive(user);
        })
        .catch(() => {
          if (current === generation) {
            verifiedOwner = null;
            receive(null);
            failure();
          }
        });
    },
  };
}
