import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        // 需要把服务端 set-cookie 的 refresh_token 透传给浏览器
        cookieDomainRewrite: "",
      },
    },
  },
});
