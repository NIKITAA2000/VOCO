import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { api } from "../api";
import styles from "./Room.module.css";

interface Props {
  user: any;
}

export function RoomPage({ user }: Props) {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [livekitUrl, setLivekitUrl] = useState("");
  const [roomName, setRoomName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;

    const joinRoom = async () => {
      try {
        const data = await api.joinRoom(slug);
        setToken(data.token);
        setLivekitUrl(data.livekitUrl);
        setRoomName(data.room.name);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    joinRoom();
  }, [slug]);

  const handleDisconnect = useCallback(async () => {
    if (slug) {
      try {
        await api.leaveRoom(slug);
      } catch {
        // ignore
      }
    }
    navigate("/dashboard");
  }, [slug, navigate]);

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Подключение к комнате...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.loading}>
        <div className={styles.errorBox}>
          <h3>Ошибка подключения</h3>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => navigate("/dashboard")}>
            Назад
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.roomHeader}>
        <span className={styles.roomName}>{roomName}</span>
        <span className={styles.roomSlug}>Код: {slug}</span>
      </div>

      <div className={styles.videoArea}>
        <LiveKitRoom
          serverUrl={livekitUrl}
          token={token}
          connect={true}
          onDisconnected={handleDisconnect}
          data-lk-theme="default"
          style={{ height: "100%" }}
        >
          <VideoConference />
          <RoomAudioRenderer />
        </LiveKitRoom>
      </div>
    </div>
  );
}
