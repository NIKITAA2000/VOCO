import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import styles from "./RegisterPage.module.css";

interface Props {
  onRegister: (user: any) => void;
}

export function RegisterPage({ onRegister }: Props) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const usernameValid = /^[a-zA-Z0-9_]{3,30}$/.test(username.trim());
  const passwordValid = password.length >= 6;
  const isFormValid = emailValid && usernameValid && passwordValid;

  const handleGuestEnter = () => {
    onRegister({
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
      const data = await api.register(email, username, password);
      onRegister(data.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <section className={styles.frame} aria-label="Регистрация">
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

          <div className={`${styles.field} ${styles.fieldUsername}`}>
            <p className={styles.label}>Введите имя пользователя</p>
          <input
            className={styles.input}
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
            required
          />
          </div>

          <div className={`${styles.field} ${styles.fieldPassword}`}>
            <p className={styles.label}>Придумайте пароль (минимум 6 символов)</p>
          <input
            className={styles.input}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            minLength={6}
            required
            />
          </div>

          <div className={`${styles.error} ${error ? "" : styles.errorHidden}`} aria-live="polite">
            {error || "\u00A0"}
          </div>

          <button
            type="submit"
            className={`${styles.submit} ${isFormValid ? styles.submitActive : ""}`}
            disabled={loading || !isFormValid}
          >
            {loading ? "Создаём..." : "Зарегистрироваться"}
          </button>
        </form>

        <p className={styles.links}>
          <span>Уже есть аккаунт? </span>
          <button type="button" className={`${styles.linkButton} ${styles.linkLogin}`} onClick={() => navigate("/login")}>
            Войти
          </button>
          <span className={styles.break} />
          <span>Или зайдите </span>
          <button type="button" className={`${styles.linkButton} ${styles.linkGuest}`} onClick={handleGuestEnter}>
            гостем
          </button>
        </p>
      </section>
    </div>
  );
}
