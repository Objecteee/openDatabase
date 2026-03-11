/**
 * App 根组件：路由配置
 * 路由懒加载，减少首屏 bundle，避免进入页面长时间转圈
 */

import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { useAuthStore } from "./stores/authStore.js";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

const ChatPage = lazy(() => import("./pages/ChatPage.js").then((m) => ({ default: m.ChatPage })));
const DocumentsPage = lazy(() => import("./pages/DocumentsPage.js").then((m) => ({ default: m.DocumentsPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage.js").then((m) => ({ default: m.DashboardPage })));
const LoginPage = lazy(() => import("./pages/LoginPage.js").then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import("./pages/RegisterPage.js").then((m) => ({ default: m.RegisterPage })));

function RequireLogin({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const initialized = useAuthStore((s) => s.initialized);
  const initializing = useAuthStore((s) => s.initializing);
  const { t } = useTranslation();

  // 启动恢复登录态期间，不做跳转，避免刷新页面瞬间被踢到 /login
  if (!initialized || initializing) {
    return (
      <div style={{ minHeight: "calc(100vh - 56px)", display: "grid", placeItems: "center" }}>
        <div style={{ color: "var(--color-text-600)", fontSize: 14 }}>{t("auth.restore")}</div>
      </div>
    );
  }

  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function App() {
  const initAuth = useAuthStore((s) => s.initAuth);
  useTranslation(); // ensure i18n context ready before rendering routes

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
            <div style={{ color: "var(--color-text-600)", fontSize: 14 }}>Loading…</div>
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route
              index
              element={
                <RequireLogin>
                  <ChatPage />
                </RequireLogin>
              }
            />
            <Route
              path="documents"
              element={
                <RequireLogin>
                  <DocumentsPage />
                </RequireLogin>
              }
            />
            <Route
              path="dashboard"
              element={
                <RequireLogin>
                  <DashboardPage />
                </RequireLogin>
              }
            />
            <Route path="login" element={<LoginPage />} />
            <Route path="register" element={<RegisterPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
