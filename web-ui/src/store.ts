import { create } from "zustand";
import type { ApiOpts } from "./lib/api";
import type { UpCtl, UpTask } from "./lib/up2k";

interface UiState {
  vpath: string;
  setVpath: (p: string) => void;
  query: string;
  setQuery: (q: string) => void;
  grid: boolean;
  toggleGrid: () => void;
  dots: boolean;
  toggleDots: () => void;
  /** solo transporte + dirKey; la sesión vive en cookie HttpOnly */
  auth: ApiOpts;
  setDirKey: (k?: string) => void;
  /** identidad del probe ?ls (acct=="*" = anónimo) */
  acct: string;
  perms: string[];
  setSession: (acct: string, perms: string[]) => void;
  loginOpen: boolean;
  setLoginOpen: (v: boolean) => void;
  sel: Set<string>;
  toggleSel: (href: string) => void;
  clearSel: () => void;
}

const params = new URLSearchParams(location.search);
const initialPath =
  location.hash.startsWith("#/")
    ? decodeURIComponent(location.hash.slice(1))
    : "/";

export const useUi = create<UiState>((set) => ({
  vpath: initialPath === "/" ? "/" : initialPath,
  setVpath: (vpath) => {
    history.replaceState(null, "", `#${vpath}`);
    set({ vpath, sel: new Set() });
  },
  query: "",
  setQuery: (query) => set({ query }),
  grid: params.get("grid") === "1",
  toggleGrid: () => set((s) => ({ grid: !s.grid })),
  dots: false,
  toggleDots: () => set((s) => ({ dots: !s.dots })),
  auth: {
    base: (import.meta as any).env?.VITE_CPR_BASE
      ? String((import.meta as any).env.VITE_CPR_BASE).replace(/\/$/, "")
      : "",
  },
  setDirKey: (dirKey) =>
    set((s) => ({ auth: { ...s.auth, dirKey } })),
  acct: "*",
  perms: [],
  setSession: (acct, perms) => set({ acct, perms }),
  loginOpen: false,
  setLoginOpen: (loginOpen) => set({ loginOpen }),
  sel: new Set<string>(),
  toggleSel: (href) =>
    set((s) => {
      const sel = new Set(s.sel);
      sel.has(href) ? sel.delete(href) : sel.add(href);
      return { sel };
    }),
  clearSel: () => set({ sel: new Set() }),
}));

interface UpsState {
  tasks: UpTask[];
  ctls: Map<number, UpCtl>;
  upsert: (t: UpTask) => void;
  attachCtl: (id: number, ctl: UpCtl) => void;
  cancel: (id: number) => void;
  clearFinished: () => void;
}

export const useUps = create<UpsState>((set) => ({
  tasks: [],
  ctls: new Map(),
  upsert: (t) =>
    set((s) => {
      const i = s.tasks.findIndex((x) => x.id === t.id);
      const tasks =
        i < 0 ? [...s.tasks, t] : s.tasks.map((x) => (x.id === t.id ? t : x));
      return { tasks };
    }),
  attachCtl: (id, ctl) =>
    set((s) => {
      const ctls = new Map(s.ctls);
      ctls.set(id, ctl);
      return { ctls };
    }),
  cancel: (id) =>
    set((s) => {
      s.ctls.get(id)?.cancel();
      return {};
    }),
  clearFinished: () =>
    set((s) => ({
      tasks: s.tasks.filter(
        (t) => t.phase !== "done" && t.phase !== "err" && t.phase !== "cancelled"
      ),
    })),
}));
