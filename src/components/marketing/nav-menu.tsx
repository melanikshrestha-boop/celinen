import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

export type NavMenuId = "features" | "use-cases";

const NavMenuContext = createContext<{
  open: NavMenuId | null;
  setOpen: Dispatch<SetStateAction<NavMenuId | null>>;
} | null>(null);

export function NavMenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<NavMenuId | null>(null);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <NavMenuContext.Provider value={value}>{children}</NavMenuContext.Provider>;
}

/** One landing dropdown at a time. Uncontrolled if no provider (isolated tests). */
export function useNavMenu(id: NavMenuId) {
  const ctx = useContext(NavMenuContext);
  if (!ctx) return {};
  return {
    open: ctx.open === id,
    onOpenChange: (next: boolean) => {
      ctx.setOpen((current) => {
        if (next) return id;
        return current === id ? null : current;
      });
    },
  };
}
