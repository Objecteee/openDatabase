/**
 * 布局：Header 导航 + 子路由
 */

import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { api } from "../lib/apiClient.js";
import { useAuthStore } from "../stores/authStore.js";

export function Layout() {
  const nav = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logoutLocal = useAuthStore((s) => s.logoutLocal);

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

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="flex-shrink-0 border-b border-slate-200 bg-white">
        <nav className="flex items-center justify-between gap-6 px-4 py-3">
          <div className="flex gap-6">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `font-medium ${isActive ? "text-indigo-600" : "text-slate-600 hover:text-indigo-600"}`
              }
            >
              对话
            </NavLink>
            <NavLink
              to="/documents"
              className={({ isActive }) =>
                `font-medium ${isActive ? "text-indigo-600" : "text-slate-600 hover:text-indigo-600"}`
              }
            >
              文档库
            </NavLink>
          </div>

          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span className="text-sm text-slate-500">{user.username ?? user.email ?? user.id}</span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="text-sm text-slate-600 hover:text-indigo-600"
                >
                  退出
                </button>
              </>
            ) : (
              <>
                <NavLink
                  to="/login"
                  className={({ isActive }) =>
                    `text-sm ${isActive ? "text-indigo-600" : "text-slate-600 hover:text-indigo-600"}`
                  }
                >
                  登录
                </NavLink>
                <NavLink
                  to="/register"
                  className={({ isActive }) =>
                    `text-sm ${isActive ? "text-indigo-600" : "text-slate-600 hover:text-indigo-600"}`
                  }
                >
                  注册
                </NavLink>
              </>
            )}
          </div>
        </nav>
      </header>

      <div className="flex-1 flex flex-col min-h-0">
        <Outlet />
      </div>
    </div>
  );
}
