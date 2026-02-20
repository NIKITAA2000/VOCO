import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { api } from "./api";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { DashboardPage } from "./pages/DashboardPage";
import { RoomPage } from "./pages/RoomPage";
import "./index.css";

function App() {
  const [isAuth, setIsAuth] = useState<boolean>(!!api.getToken());
  const [user, setUser] = useState<any>(() => {
    const stored = localStorage.getItem("voco_user");
    return stored ? JSON.parse(stored) : null;
  });

  const handleLogin = (userData: any) => {
    setIsAuth(true);
    setUser(userData);
  };

  const handleLogout = () => {
    api.clearToken();
    setIsAuth(false);
    setUser(null);
  };

  useEffect(() => {
    if (api.getToken() && !user) {
      api.getMe().then((data) => setUser(data.user)).catch(() => handleLogout());
    }
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            isAuth ? <Navigate to="/dashboard" /> : <Navigate to="/login" />
          }
        />
        <Route
          path="/login"
          element={
            isAuth ? (
              <Navigate to="/dashboard" />
            ) : (
              <LoginPage onLogin={handleLogin} />
            )
          }
        />
        <Route
          path="/register"
          element={
            isAuth ? (
              <Navigate to="/dashboard" />
            ) : (
              <RegisterPage onRegister={handleLogin} />
            )
          }
        />
        <Route
          path="/dashboard"
          element={
            isAuth ? (
              <DashboardPage user={user} onLogout={handleLogout} />
            ) : (
              <Navigate to="/login" />
            )
          }
        />
        <Route
          path="/room/:slug"
          element={
            isAuth ? (
              <RoomPage user={user} />
            ) : (
              <Navigate to="/login" />
            )
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
