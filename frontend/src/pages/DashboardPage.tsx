import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import styles from "./Dashboard.module.css";

interface Props {
  user: any;
  onLogout: () => void;
}

export function DashboardPage({ user, onLogout }: Props) {
  const [rooms, setRooms] = useState<any[]>([]);
  const [newRoomName, setNewRoomName] = useState("");
  const [joinSlug, setJoinSlug] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const loadRooms = async () => {
    try {
      const data = await api.getRooms();
      setRooms(data.rooms);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadRooms();
  }, []);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    setError("");
    setLoading(true);

    try {
      const data = await api.createRoom(newRoomName.trim());
      setNewRoomName("");
      navigate(`/room/${data.room.slug}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinBySlug = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinSlug.trim()) return;
    navigate(`/room/${joinSlug.trim()}`);
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <span className={styles.logoSmall}>VOCO</span>
        <div className={styles.userInfo}>
          <span className={styles.username}>{user?.username}</span>
          <button className="btn btn-secondary" onClick={onLogout} style={{ padding: "8px 16px", fontSize: "0.85rem" }}>
            Выйти
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className={styles.main}>
        <div className={styles.hero}>
          <h1 className={styles.title}>Добро пожаловать</h1>
          <p className={styles.subtitle}>Создайте комнату или присоединитесь по коду</p>
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          {/* Create room */}
          <form onSubmit={handleCreateRoom} className={styles.actionCard}>
            <div className={styles.actionIcon}>✦</div>
            <h3 className={styles.actionTitle}>Новая комната</h3>
            <input
              type="text"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="Название комнаты"
            />
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: "100%" }}>
              {loading ? "Создаём..." : "Создать"}
            </button>
          </form>

          {/* Join room */}
          <form onSubmit={handleJoinBySlug} className={styles.actionCard}>
            <div className={styles.actionIcon}>→</div>
            <h3 className={styles.actionTitle}>Присоединиться</h3>
            <input
              type="text"
              value={joinSlug}
              onChange={(e) => setJoinSlug(e.target.value)}
              placeholder="Код комнаты"
            />
            <button type="submit" className="btn btn-secondary" style={{ width: "100%" }}>
              Войти
            </button>
          </form>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {/* Room list */}
        {rooms.length > 0 && (
          <div className={styles.roomList}>
            <h2 className={styles.sectionTitle}>Мои комнаты</h2>
            <div className={styles.rooms}>
              {rooms.map((room) => (
                <div
                  key={room.id}
                  className={styles.roomCard}
                  onClick={() => navigate(`/room/${room.slug}`)}
                >
                  <div className={styles.roomInfo}>
                    <h4 className={styles.roomName}>{room.name}</h4>
                    <span className={styles.roomSlug}>{room.slug}</span>
                  </div>
                  <div className={styles.roomMeta}>
                    <span className={room.isActive ? styles.statusActive : styles.statusClosed}>
                      {room.isActive ? "Активна" : "Закрыта"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
