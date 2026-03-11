import { create } from "zustand";

export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "theme";

function getSystemTheme(): ThemeMode {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readThemeFromStorage(): ThemeMode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark") return raw;
    return null;
  } catch {
    return null;
  }
}

export function applyThemeToDom(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
}

export function initThemeFromStorage() {
  const theme = readThemeFromStorage() ?? getSystemTheme();
  applyThemeToDom(theme);
  return theme;
}

interface ThemeState {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: typeof window !== "undefined" ? initThemeFromStorage() : "light",
  setTheme: (t) => {
    applyThemeToDom(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // ignore
    }
    set({ theme: t });
  },
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    get().setTheme(next);
  },
}));

