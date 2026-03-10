/**
 * App 根组件：路由配置
 * 路由懒加载，减少首屏 bundle，避免进入页面长时间转圈
 */

import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout.js";

const ChatPage = lazy(() => import("./pages/ChatPage.js").then((m) => ({ default: m.ChatPage })));
const DocumentsPage = lazy(() => import("./pages/DocumentsPage.js").then((m) => ({ default: m.DocumentsPage })));

function App() {
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
            <Route index element={<ChatPage />} />
            <Route path="documents" element={<DocumentsPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
