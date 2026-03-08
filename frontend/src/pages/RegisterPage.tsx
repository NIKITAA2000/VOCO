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
      <div className={styles.canvas}>
        <section className={styles.welcome} aria-label="Регистрация">
          <div className={styles.logo}>
            <img className={styles.logoImage} src="/voco-logo-white.svg" alt="VOCO" />
          </div>
          <p className={styles.tagline}>
            <img className={styles.taglineImage} src="/voco-tagline-white.svg" alt="Видеоконференции без границ" />
          </p>

          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={`${styles.field} ${styles.fieldEmail}`}>
              <p className={styles.label}>Введите почту</p>
              <input
                className={styles.input}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
              />
            </div>

            <div className={`${styles.field} ${styles.fieldUsername}`}>
              <p className={styles.label}>Введите имя пользователя</p>
              <input
                className={styles.input}
                type="text"
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="yourpassword"
                minLength={6}
                required
              />
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <button
              type="submit"
              className={`${styles.submit} ${isFormValid ? styles.submitActive : ""}`}
              disabled={loading || !isFormValid}
            >
              {loading ? "Создаём..." : "Зарегистрироваться"}
            </button>
          </form>

          <p className={styles.links}>
            <img
              className={styles.linksImage}
              src="/voco-register-links-white.svg"
              alt="Уже есть аккаунт? Войти. Или зайдите гостем"
            />
            <button
              type="button"
              className={styles.loginHotspot}
              onClick={() => navigate("/login")}
              aria-label="Перейти на страницу входа"
            />
            <button
              type="button"
              className={styles.guestHotspot}
              onClick={handleGuestEnter}
              aria-label="Войти гостем"
            />
          </p>
        </section>
      </div>
    </div>
  );
}
