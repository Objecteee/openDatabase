import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../lib/apiClient.js";
import { useAuthStore } from "../stores/authStore.js";
import { useTranslation } from "react-i18next";
import styles from "./AuthPage.module.scss";

export function LoginPage() {
  const nav = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const { t } = useTranslation();
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
    <div className={styles.page}>
      <form onSubmit={onSubmit} className={styles.card}>
        <div className={styles.header}>
          <h1 className={styles.title}>{t("auth.login.title")}</h1>
          <p className={styles.subtitle}>{t("auth.login.subtitle")}</p>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <label className={styles.field}>
          <span className={styles.label}>{t("auth.login.email")}</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            className={styles.input}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>{t("auth.login.password")}</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            minLength={8}
            className={styles.input}
          />
        </label>

        <button type="submit" disabled={loading} className={styles.submit}>
          {loading ? t("auth.login.submitting") : t("auth.login.submit")}
        </button>

        <p className={styles.footer}>
          <Link className={styles.link} to="/register">
            {t("auth.login.toRegister")}
          </Link>
        </p>
      </form>
    </div>
  );
}

