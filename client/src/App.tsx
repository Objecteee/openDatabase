/**
 * App 根组件：路由配置
 */

import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { ChatPage } from "./pages/ChatPage.js";
import { DocumentsPage } from "./pages/DocumentsPage.js";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<ChatPage />} />
          <Route path="documents" element={<DocumentsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
