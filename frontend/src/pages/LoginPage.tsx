import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import styles from "./Auth.module.css";

interface Props {
  onLogin: (user: any) => void;
}

export function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await api.login(email, password);
      onLogin(data.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.glowOrb} />
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoText}>VOCO</span>
          <p className={styles.tagline}>Видеоконференции без границ</p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              required
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Входим..." : "Войти"}
          </button>
        </form>

        <p className={styles.switch}>
          Нет аккаунта? <Link to="/register">Создать</Link>
        </p>
      </div>
    </div>
  );
}
