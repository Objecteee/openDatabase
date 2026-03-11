import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../lib/apiClient.js";
import { useAuthStore } from "../stores/authStore.js";

export function LoginPage() {
  const nav = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post("/auth/login", { email, password });
      const data = res.data as { user: { id: string; username: string; email: string }; access_token: string };
      setAuth(data.user, data.access_token);
      nav("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-56px)] flex items-center justify-center p-6 bg-slate-50">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">登录</h1>
          <p className="text-sm text-slate-500">使用邮箱和密码登录</p>
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{error}</div>}

        <label className="block text-sm text-slate-600">
          邮箱
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>

        <label className="block text-sm text-slate-600">
          密码
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            minLength={8}
            className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? "登录中…" : "登录"}
        </button>

        <p className="text-sm text-slate-500">
          没有账号？<Link className="text-indigo-600 hover:underline" to="/register">去注册</Link>
        </p>
      </form>
    </div>
  );
}

