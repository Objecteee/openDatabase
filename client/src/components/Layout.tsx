/**
 * 布局：Header 导航 + 子路由
 */

import { useState, useEffect, useRef } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { api } from "../lib/apiClient.js";
import { useAuthStore } from "../stores/authStore.js";
import { useThemeStore } from "../stores/themeStore.js";
import { useTranslation } from "react-i18next";
import { setLanguage, type AppLanguage } from "../i18n/index.js";
import { Select } from "../ui/Select.js";
import styles from "./Layout.module.scss";

export function Layout() {
  const nav = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logoutLocal = useAuthStore((s) => s.logoutLocal);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const { t, i18n } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 路由变化时关闭菜单
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // 点击菜单外部关闭
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const onLogout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore
    } finally {
      logoutLocal();
      nav("/login");
    }
  };

  const lang = (i18n.language as AppLanguage) || "zh-CN";

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <nav className={styles.nav}>
          <div className={styles.left}>
            <div className={styles.brand} role="banner" aria-label={t("app.title")}>
              <div className={styles.logo} aria-hidden="true" />
              <div className={styles.brandText}>{t("app.title")}</div>
            </div>

            <div className={styles.links} aria-label="Primary">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `${styles.link} ${isActive ? styles.linkActive : ""}`
                }
              >
                {t("app.nav.chat")}
              </NavLink>
              <NavLink
                to="/documents"
                className={({ isActive }) =>
                  `${styles.link} ${isActive ? styles.linkActive : ""}`
                }
              >
                {t("app.nav.documents")}
              </NavLink>
              <NavLink
                to="/dashboard"
                className={({ isActive }) =>
                  `${styles.link} ${isActive ? styles.linkActive : ""}`
                }
              >
                {t("app.nav.dashboard")}
              </NavLink>
            </div>
          </div>

          <div className={styles.right}>
            <Select
              value={lang}
              onChange={(v) => setLanguage(v as AppLanguage)}
              ariaLabel="language"
            >
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
              <option value="ja-JP">日本語</option>
            </Select>

            <button
              type="button"
              className={styles.iconBtn}
              onClick={toggleTheme}
              aria-label="theme"
              title={theme === "dark" ? "Light" : "Dark"}
            >
              {theme === "dark" ? "☀︎" : "☾"}
            </button>

            {user ? (
              <div className={styles.user}>
                <span className={styles.userName}>{user.username ?? user.email ?? user.id}</span>
                <button
                  type="button"
                  onClick={onLogout}
                  className={styles.iconBtn}
                >
                  {t("app.nav.logout")}
                </button>
              </div>
            ) : (
              <div className={styles.user}>
                <NavLink
                  to="/login"
                  className={({ isActive }) =>
                    `${styles.link} ${isActive ? styles.linkActive : ""}`
                  }
                >
                  {t("app.nav.login")}
                </NavLink>
                <NavLink
                  to="/register"
                  className={({ isActive }) =>
                    `${styles.link} ${isActive ? styles.linkActive : ""}`
                  }
                >
                  {t("app.nav.register")}
                </NavLink>
              </div>
            )}

            {/* 汉堡按钮：仅移动端显示 */}
            <div className={styles.menuWrap} ref={menuRef}>
              <button
                type="button"
                className={`${styles.iconBtn} ${styles.hamburger}`}
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={menuOpen ? t("app.nav.closeMenu") : t("app.nav.menu")}
                aria-expanded={menuOpen}
              >
                {menuOpen ? "✕" : "☰"}
              </button>

              {menuOpen && (
                <div className={styles.mobileMenu} role="menu">
                  <NavLink
                    to="/"
                    end
                    role="menuitem"
                    className={({ isActive }) =>
                      `${styles.mobileMenuItem} ${isActive ? styles.mobileMenuItemActive : ""}`
                    }
                  >
                    {t("app.nav.chat")}
                  </NavLink>
                  <NavLink
                    to="/documents"
                    role="menuitem"
                    className={({ isActive }) =>
                      `${styles.mobileMenuItem} ${isActive ? styles.mobileMenuItemActive : ""}`
                    }
                  >
                    {t("app.nav.documents")}
                  </NavLink>
                  <NavLink
                    to="/dashboard"
                    role="menuitem"
                    className={({ isActive }) =>
                      `${styles.mobileMenuItem} ${isActive ? styles.mobileMenuItemActive : ""}`
                    }
                  >
                    {t("app.nav.dashboard")}
                  </NavLink>
                  {user && (
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.mobileMenuItemBtn}
                      onClick={onLogout}
                    >
                      {t("app.nav.logout")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </nav>
      </header>

      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  );
}
