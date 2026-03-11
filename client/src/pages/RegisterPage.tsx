import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../lib/apiClient.js";
import { useAuthStore } from "../stores/authStore.js";
import { useTranslation } from "react-i18next";
import styles from "./AuthPage.module.scss";

export function RegisterPage() {
  const nav = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post("/auth/register", { username, email, password });
      const data = res.data as { user: { id: string; username: string; email: string }; access_token: string };
      setAuth(data.user, data.access_token);
      nav("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <form onSubmit={onSubmit} className={styles.card}>
        <div className={styles.header}>
          <h1 className={styles.title}>{t("auth.register.title")}</h1>
          <p className={styles.subtitle}>{t("auth.register.subtitle")}</p>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <label className={styles.field}>
          <span className={styles.label}>{t("auth.register.username")}</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            maxLength={30}
            pattern="^[a-zA-Z0-9_]+$"
            className={styles.input}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>{t("auth.register.email")}</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            className={styles.input}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>{t("auth.register.password")}</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            minLength={8}
            maxLength={72}
            className={styles.input}
          />
          <div className={styles.hint}>至少 8 位</div>
        </label>

        <button type="submit" disabled={loading} className={styles.submit}>
          {loading ? t("auth.register.submitting") : t("auth.register.submit")}
        </button>

        <p className={styles.footer}>
          <Link className={styles.link} to="/login">
            {t("auth.register.toLogin")}
          </Link>
        </p>
      </form>
    </div>
  );
}

