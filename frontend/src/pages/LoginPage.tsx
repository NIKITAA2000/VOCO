import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import styles from "./LoginPage.module.css";

interface Props {
  onLogin: (user: any) => void;
}

export function LoginPage({ onLogin }: Props) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordValid = password.length >= 1;
  const isFormValid = emailValid && passwordValid;

  const handleGuestEnter = () => {
    onLogin({
      id: "guest",
      username: "Гость",
      email: "guest@local",
    });
    navigate("/dashboard");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;
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
      <section className={styles.frame} aria-label="Вход">
        <div className={styles.logo}>
          <img className={`${styles.logoImage} ${styles.logoImageDark}`} src="/voco-logo-white.svg" alt="VOCO" />
          <img className={`${styles.logoImage} ${styles.logoImageLight}`} src="/voco-logo.svg" alt="VOCO" />
        </div>
        <p className={styles.tagline}>Видеоконференции без границ</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={`${styles.field} ${styles.fieldEmail}`}>
            <p className={styles.label}>Введите почту</p>
            <input
              className={styles.input}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.ru"
              required
            />
          </div>

          <div className={`${styles.field} ${styles.fieldPassword}`}>
            <p className={styles.label}>Введите пароль</p>
            <input
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
              required
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <button
            type="submit"
            className={`${styles.submit} ${isFormValid ? styles.submitActive : ""}`}
            disabled={loading || !isFormValid}
          >
            {loading ? "Входим..." : "Войти"}
          </button>
        </form>

        <p className={styles.links}>
          <span>Нет аккаунта? </span>
          <button
            type="button"
            className={`${styles.linkButton} ${styles.linkRegister}`}
            onClick={() => navigate("/register")}
          >
            Зарегистрироваться
          </button>
          <span className={styles.break} />
          <span>Или зайдите </span>
          <button
            type="button"
            className={`${styles.linkButton} ${styles.linkGuest}`}
            onClick={handleGuestEnter}
          >
            гостем
          </button>
        </p>
      </section>
    </div>
  );
}
