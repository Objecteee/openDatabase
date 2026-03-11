import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";
import jaJP from "./locales/ja-JP.json";

export type AppLanguage = "zh-CN" | "en-US" | "ja-JP";

const STORAGE_KEY = "lang";

function getInitialLanguage(): AppLanguage {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh-CN" || saved === "en-US" || saved === "ja-JP") return saved;
  } catch {
    // ignore
  }

  const nav = navigator.language || "zh-CN";
  if (nav.toLowerCase().startsWith("ja")) return "ja-JP";
  if (nav.toLowerCase().startsWith("en")) return "en-US";
  return "zh-CN";
}

export function setLanguage(lang: AppLanguage) {
  i18n.changeLanguage(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }
}

export function initI18n() {
  if (i18n.isInitialized) return i18n;

  i18n.use(initReactI18next).init({
    resources: {
      "zh-CN": { translation: zhCN },
      "en-US": { translation: enUS },
      "ja-JP": { translation: jaJP },
    },
    lng: getInitialLanguage(),
    fallbackLng: "en-US",
    interpolation: { escapeValue: false },
  });

  return i18n;
}

