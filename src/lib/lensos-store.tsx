import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  CLIENTS,
  SEED_EVENTS,
  type Client,
  type EventJob,
  type Money,
  type Package,
  type PackageState,
} from "@/lib/lensos";

interface Ctx {
  events: EventJob[];
  clients: Client[];
  activeId: string;
  active: EventJob;
  setActiveId: (id: string) => void;
  createEvent: (draft: Partial<EventJob> & { name: string; clientId: string }) => void;
  updateEvent: (id: string, fn: (e: EventJob) => EventJob) => void;
  attachSource: (label: string) => void;
  setField: (pickId: string, key: string, value: string) => void;
  resolveSuggestion: (pickId: string, field: string, accept: boolean) => void;
  approvePicks: (ids: string[]) => void;
  applyTemplate: (ids: string[], template: string) => void;
  assignPicks: (ids: string[], packageId: string | null) => void;
  setPackageState: (packageId: string, state: PackageState) => void;
  createPackage: (pkg: Omit<Package, "id" | "state">) => void;
  handoff: () => void;
  importReturns: () => void;
  deliver: (packageId: string, files: number) => void;
  setMoney: (patch: Partial<Money>) => void;
  createGallery: (pin: string | null) => void;
}

const LensCtx = createContext<Ctx | null>(null);

export function LensProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<EventJob[]>(SEED_EVENTS);
  const [clients] = useState<Client[]>(CLIENTS);
  const [activeId, setActiveId] = useState<string>(SEED_EVENTS[0]!.id);

  const value = useMemo<Ctx>(() => {
    const active = events.find((e) => e.id === activeId) ?? events[0]!;
    const updateEvent = (id: string, fn: (e: EventJob) => EventJob) =>
      setEvents((prev) => prev.map((e) => (e.id === id ? fn(e) : e)));
    const patchActive = (fn: (e: EventJob) => EventJob) => updateEvent(active.id, fn);

    return {
      events,
      clients,
      activeId: active.id,
      active,
      setActiveId,
      createEvent: (draft) => {
        const id = `e-${Math.random().toString(36).slice(2, 8)}`;
        const next: EventJob = {
          id,
          name: draft.name,
          genre: draft.genre ?? "Unassigned",
          venue: draft.venue ?? "TBD",
          start: draft.start ?? "TBD",
          clientId: draft.clientId,
          status: "draft",
          deadlines: draft.deadlines ?? [],
          sources: [],
          packages: [],
          picks: [],
          pickQueue: { reviewed: 0, total: 0, selects: 0, rejects: 0 },
          lightroom: { handoff: false, returns: 0, conflicts: 0 },
          receipts: [],
          offline: false,
          metrics: { ingested: 0, reviewed: 0, workMinutes: 0 },
          money: {
            agreedRevenue: null,
            invoiced: null,
            collected: null,
            estimatedCosts: null,
            actualCosts: null,
            source: null,
          },
          gallery: { link: null, pin: null, favorites: 0 },
        };
        setEvents((prev) => [...prev, next]);
        setActiveId(id);
      },
      updateEvent,
      attachSource: (label) =>
        patchActive((e) => ({
          ...e,
          sources: [
            ...e.sources,
            {
              id: `s-${e.sources.length + 1}-${Math.random().toString(36).slice(2, 6)}`,
              label,
              kind: "folder",
              state: "enumerating",
              files: 0,
              previews: 0,
              duplicates: 0,
              unsupported: 0,
              lowDisk: false,
              verifying: true,
            },
          ],
        })),
      setField: (pickId, key, value) =>
        patchActive((e) => ({
          ...e,
          picks: e.picks.map((p) =>
            p.id !== pickId
              ? p
              : {
                  ...p,
                  approved: key === "caption" ? false : p.approved,
                  fields: { ...p.fields, [key]: { value, source: "manual" } },
                },
          ),
        })),
      resolveSuggestion: (pickId, field, accept) =>
        patchActive((e) => ({
          ...e,
          picks: e.picks.map((p) => {
            if (p.id !== pickId) return p;
            const s = p.suggestions.find((x) => x.field === field);
            return {
              ...p,
              fields:
                accept && s
                  ? { ...p.fields, [field]: { value: s.value, source: "accepted" } }
                  : p.fields,
              suggestions: p.suggestions.map((x) =>
                x.field === field ? { ...x, status: accept ? "accepted" : "rejected" } : x,
              ),
            };
          }),
        })),
      approvePicks: (ids) =>
        patchActive((e) => ({
          ...e,
          picks: e.picks.map((p) => (ids.includes(p.id) ? { ...p, approved: true } : p)),
        })),
      applyTemplate: (ids, template) =>
        patchActive((e) => ({
          ...e,
          picks: e.picks.map((p) =>
            ids.includes(p.id)
              ? {
                  ...p,
                  approved: false,
                  fields: {
                    ...p.fields,
                    iptc: { value: template, source: "template" },
                    copyright: { value: p.fields['copyright']?.value ?? "", source: "template" },
                  },
                }
              : p,
          ),
        })),
      assignPicks: (ids, packageId) =>
        patchActive((e) => ({
          ...e,
          picks: e.picks.map((p) => (ids.includes(p.id) ? { ...p, packageId } : p)),
        })),
      setPackageState: (packageId, state) =>
        patchActive((e) => ({
          ...e,
          packages: e.packages.map((p) => (p.id === packageId ? { ...p, state } : p)),
        })),
      createPackage: (pkg) =>
        patchActive((e) => ({
          ...e,
          packages: [
            ...e.packages,
            { ...pkg, id: `pkg-${Math.random().toString(36).slice(2, 7)}`, state: "planned" },
          ],
        })),
      handoff: () =>
        patchActive((e) => ({
          ...e,
          lightroom: { ...e.lightroom, handoff: true },
          packages: e.packages.map((p) =>
            p.state === "selects ready" ? { ...p, state: "in Lightroom" } : p,
          ),
        })),
      importReturns: () =>
        patchActive((e) => ({
          ...e,
          lightroom: {
            ...e.lightroom,
            returns: e.picks.filter((p) => p.packageId).length,
            conflicts: 2,
          },
          packages: e.packages.map((p) =>
            p.state === "in Lightroom" ? { ...p, state: "edits returning" } : p,
          ),
        })),
      deliver: (packageId, files) =>
        patchActive((e) => {
          const prior = e.receipts.filter((r) => r.packageId === packageId).length;
          const pkg = e.packages.find((p) => p.id === packageId);
          return {
            ...e,
            packages: e.packages.map((p) =>
              p.id === packageId ? { ...p, state: "delivered" } : p,
            ),
            receipts: [
              ...e.receipts,
              {
                id: `r-${Math.random().toString(36).slice(2, 7)}`,
                packageId,
                revision: prior + 1,
                at: new Date().toLocaleString(),
                recipient: pkg?.recipient ?? "—",
                destination: pkg?.destination ?? "—",
                files,
                preset: pkg?.preset ?? "—",
              },
            ],
          };
        }),
      setMoney: (patch) =>
        patchActive((e) => ({ ...e, money: { ...e.money, ...patch, source: "manual" } })),
      createGallery: (pin) =>
        patchActive((e) => ({
          ...e,
          gallery: {
            link: `lens.link/${e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`,
            pin,
            favorites: e.gallery.favorites,
          },
        })),
    };
  }, [events, clients, activeId]);

  return <LensCtx.Provider value={value}>{children}</LensCtx.Provider>;
}

export function useLens() {
  const ctx = useContext(LensCtx);
  if (!ctx) throw new Error("useLens must be used inside LensProvider");
  return ctx;
}
