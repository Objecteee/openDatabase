/**
 * App 根组件：路由配置
 * 路由懒加载，减少首屏 bundle，避免进入页面长时间转圈
 */

import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { useAuthStore } from "./stores/authStore.js";
import { Navigate } from "react-router-dom";

const ChatPage = lazy(() => import("./pages/ChatPage.js").then((m) => ({ default: m.ChatPage })));
const DocumentsPage = lazy(() => import("./pages/DocumentsPage.js").then((m) => ({ default: m.DocumentsPage })));
const LoginPage = lazy(() => import("./pages/LoginPage.js").then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import("./pages/RegisterPage.js").then((m) => ({ default: m.RegisterPage })));

function RequireLogin({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const initialized = useAuthStore((s) => s.initialized);
  const initializing = useAuthStore((s) => s.initializing);

  // 启动恢复登录态期间，不做跳转，避免刷新页面瞬间被踢到 /login
  if (!initialized || initializing) {
    return (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center bg-slate-50">
        <div className="text-slate-500 text-sm">正在恢复登录态…</div>
      </div>
    );
  }

  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function App() {
  const initAuth = useAuthStore((s) => s.initAuth);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center bg-slate-50">
            <div className="text-slate-500 text-sm">加载中…</div>
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
            <Route path="login" element={<LoginPage />} />
            <Route path="register" element={<RegisterPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
