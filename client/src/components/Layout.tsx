/**
 * 布局：Header 导航 + 子路由
 */

import { Outlet, NavLink } from "react-router-dom";

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="flex-shrink-0 border-b border-slate-200 bg-white">
        <nav className="flex gap-6 px-4 py-3">
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
        </nav>
      </header>

      <div className="flex-1 flex flex-col min-h-0">
        <Outlet />
      </div>
    </div>
  );
}
