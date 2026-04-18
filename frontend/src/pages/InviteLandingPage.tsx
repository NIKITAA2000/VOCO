import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LiveKitRoom } from "@livekit/components-react";
import "@livekit/components-styles";
import { api } from "../api";
import { ConferenceRoomContent } from "./RoomPage";
import styles from "./Room.module.css";

interface Props {
  user: any;
}

export function InviteLandingPage({ user }: Props) {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const isAuthed = !!api.getToken();

  const [token, setToken] = useState("");
  const [livekitUrl, setLivekitUrl] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomSlug, setRoomSlug] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(isAuthed);
  const [conferenceReady, setConferenceReady] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const leaveRequestedRef = useRef(false);

  useEffect(() => {
    if (!isAuthed || !code) return;
    let cancelled = false;
    (async () => {
      try {
        const savedName = localStorage.getItem("voco_room_display_name") || undefined;
        const displayName = savedName?.trim() || user?.username || user?.email || undefined;
        const data = await api.joinByInvite(code, displayName);
        if (cancelled) return;
        setToken(data.token);
        setLivekitUrl(data.livekitUrl);
        setRoomName(data.room.name);
        setRoomSlug(data.room.slug);
        setConferenceReady(true);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, isAuthed, user]);

  const handleGuestSubmit = useCallback(async () => {
    const name = guestName.trim();
    if (!name || !code) return;
    setSubmitting(true);
    setError("");
    try {
      const data = await api.joinByInviteAsGuest(code, name);
      setToken(data.token);
      setLivekitUrl(data.livekitUrl);
      setRoomName(data.room.name);
      setRoomSlug(data.room.slug);
      setConferenceReady(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }, [code, guestName]);

  const handleLeaveIntent = useCallback(() => {
    leaveRequestedRef.current = true;
  }, []);

  const handleDisconnected = useCallback(() => {
    if (!leaveRequestedRef.current) return;
    if (isAuthed && roomSlug) {
      api.leaveRoom(roomSlug).catch(() => undefined);
      navigate("/dashboard");
      return;
    }
    navigate("/login");
  }, [isAuthed, navigate, roomSlug]);

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Подключение по ссылке...</p>
      </div>
    );
  }

  if (!conferenceReady) {
    return (
      <div className={styles.waitingScreen}>
        <div className={styles.waitingStage}>
          <section className={styles.waitingPanel} aria-label="Вход по приглашению">
            <div className={styles.waitingHeader}>
              <h2>{isAuthed ? "Вход по приглашению" : "Вход гостем"}</h2>
              <button
                className={styles.waitingClose}
                type="button"
                onClick={() => navigate(isAuthed ? "/dashboard" : "/login")}
                aria-label="Закрыть"
              />
            </div>

            {!isAuthed ? (
              <>
                <label className={styles.waitingLabel} htmlFor="guest-display-name">
                  Ваше имя в конференции
                </label>
                <input
                  id="guest-display-name"
                  className={styles.waitingInput}
                  type="text"
                  value={guestName}
                  onChange={(event) => setGuestName(event.target.value)}
                  placeholder="Гость"
                />
              </>
            ) : null}

            <div
              className={`${styles.waitingError} ${error ? "" : styles.waitingErrorHidden}`}
              aria-live="polite"
            >
              {error ? `Ошибка: ${error}` : "\u00A0"}
            </div>

            {!isAuthed ? (
              <button
                className={styles.waitingSubmit}
                type="button"
                onClick={handleGuestSubmit}
                disabled={submitting || !guestName.trim()}
              >
                {submitting ? "Вход..." : "Войти гостем"}
              </button>
            ) : (
              <button
                className={styles.waitingSubmit}
                type="button"
                onClick={() => navigate("/dashboard")}
              >
                В личный кабинет
              </button>
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <LiveKitRoom
        serverUrl={livekitUrl}
        token={token}
        connect={true}
        onDisconnected={handleDisconnected}
        data-lk-theme="default"
        className={styles.livekitRoot}
      >
        <ConferenceRoomContent
          roomName={roomName}
          slug={roomSlug}
          onExitIntent={handleLeaveIntent}
        />
      </LiveKitRoom>
    </div>
  );
}
