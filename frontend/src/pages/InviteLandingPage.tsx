import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LiveKitRoom } from "@livekit/components-react";
import "@livekit/components-styles";
import { DisconnectReason } from "livekit-client";
import { api } from "../api";
import { ConferenceRoomContent, PendingWatcher } from "./RoomPage";
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
  const [conferenceReady, setConferenceReady] = useState(false);
  const [inQueue, setInQueue] = useState(false);
  const [rejectionToast, setRejectionToast] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const defaultAuthedName =
    (typeof localStorage !== "undefined" && localStorage.getItem("voco_room_display_name")) ||
    user?.username ||
    user?.email ||
    "";
  const [authedName, setAuthedName] = useState<string>(defaultAuthedName);
  const [submitting, setSubmitting] = useState(false);
  const [guestsDenied, setGuestsDenied] = useState(false);
  const leaveRequestedRef = useRef(false);

  const handleAuthedSubmit = useCallback(async () => {
    if (!code) return;
    const name = authedName.trim();
    setSubmitting(true);
    setError("");
    try {
      const data = await api.joinByInvite(code, name || undefined);
      if (name) localStorage.setItem("voco_room_display_name", name);
      setToken(data.token);
      setLivekitUrl(data.livekitUrl);
      setRoomName(data.room.name);
      setRoomSlug(data.room.slug);
      if (data.pending) {
        setInQueue(true);
      } else {
        setConferenceReady(true);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }, [code, authedName]);

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
      if (data.pending) {
        setInQueue(true);
      } else {
        setConferenceReady(true);
      }
    } catch (err: any) {
      const message: string = err?.message ?? "";
      if (/гост/i.test(message)) {
        setGuestsDenied(true);
        setError("");
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }, [code, guestName]);

  const goToRegister = useCallback(() => {
    if (code) {
      try {
        sessionStorage.setItem("voco_pending_invite", code);
      } catch {
        // noop
      }
    }
    navigate("/register");
  }, [code, navigate]);

  const goToLogin = useCallback(() => {
    if (code) {
      try {
        sessionStorage.setItem("voco_pending_invite", code);
      } catch {
        // noop
      }
    }
    navigate("/login");
  }, [code, navigate]);

  const handleLeaveIntent = useCallback(() => {
    leaveRequestedRef.current = true;
  }, []);

  const handleDisconnected = useCallback(
    (reason?: DisconnectReason) => {
      if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
        setInQueue(false);
        setConferenceReady(false);
        setRejectionToast("Модератор отклонил ваш запрос на вход");
        window.setTimeout(() => {
          navigate(isAuthed ? "/dashboard" : "/login");
        }, 2200);
        return;
      }
      if (!leaveRequestedRef.current) return;
      if (isAuthed && roomSlug) {
        api.leaveRoom(roomSlug).catch(() => undefined);
        navigate("/dashboard");
        return;
      }
      navigate("/login");
    },
    [isAuthed, navigate, roomSlug],
  );

  const handlePendingApproved = useCallback(() => {
    setInQueue(false);
    leaveRequestedRef.current = false;
    setConferenceReady(true);
  }, []);

  useEffect(() => {
    if (!code) setError("Ссылка недействительна");
  }, [code]);

  const headerTitle = guestsDenied
    ? "Требуется регистрация"
    : isAuthed
      ? "Присоединение по ссылке"
      : "Вход гостем";

  const liveKitConnection =
    token && livekitUrl && (inQueue || conferenceReady) ? (
      <div style={conferenceReady ? undefined : { display: "none" }}>
        <LiveKitRoom
          serverUrl={livekitUrl}
          token={token}
          connect={true}
          onDisconnected={handleDisconnected}
          data-lk-theme="default"
          className={conferenceReady ? styles.livekitRoot : undefined}
        >
          {!conferenceReady && <PendingWatcher onApproved={handlePendingApproved} />}
          {conferenceReady && (
            <ConferenceRoomContent
              roomName={roomName}
              slug={roomSlug}
              onExitIntent={handleLeaveIntent}
              currentUserAvatarUrl={user?.avatarUrl ?? null}
            />
          )}
        </LiveKitRoom>
      </div>
    ) : null;

  return (
    <div className={conferenceReady ? styles.container : styles.waitingScreen}>
      {rejectionToast && !conferenceReady ? (
        <div className={styles.rejectionToast} role="status" aria-live="assertive">
          {rejectionToast}
        </div>
      ) : null}
      {liveKitConnection}
      {!conferenceReady ? (
        <div className={styles.waitingStage}>
          <section
            className={`${styles.waitingPanel} ${guestsDenied ? styles.waitingPanelTall : ""}`}
            aria-label="Вход по приглашению"
          >
            <div className={styles.waitingHeader}>
              <h2>{headerTitle}</h2>
              <button
                className={styles.waitingClose}
                type="button"
                onClick={() => navigate(isAuthed ? "/dashboard" : "/login")}
                aria-label="Закрыть"
              />
            </div>

            {guestsDenied ? (
              <p className={styles.waitingHint}>
                Владелец комнаты отключил гостевой вход. Зарегистрируйтесь или войдите,
                чтобы присоединиться.
              </p>
            ) : isAuthed ? (
              <>
                <label className={styles.waitingLabel} htmlFor="authed-display-name">
                  Ваше имя в конференции
                </label>
                <input
                  id="authed-display-name"
                  className={styles.waitingInput}
                  type="text"
                  value={authedName}
                  onChange={(event) => setAuthedName(event.target.value)}
                  placeholder={user?.username || "Участник"}
                />
              </>
            ) : (
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
            )}

            <div
              className={`${styles.waitingError} ${error ? "" : styles.waitingErrorHidden}`}
              aria-live="polite"
            >
              {error ? `Ошибка: ${error}` : "\u00A0"}
            </div>

            {guestsDenied ? (
              <div className={styles.waitingActions}>
                <button
                  className={styles.waitingSubmit}
                  type="button"
                  onClick={goToRegister}
                >
                  Зарегистрироваться
                </button>
                <button
                  className={styles.waitingSecondary}
                  type="button"
                  onClick={goToLogin}
                >
                  Войти
                </button>
              </div>
            ) : isAuthed ? (
              <button
                className={styles.waitingSubmit}
                type="button"
                onClick={handleAuthedSubmit}
                disabled={submitting || inQueue}
              >
                {inQueue ? (
                  <>
                    Ожидание в очереди
                    <span className={styles.queueDots} aria-hidden="true" />
                  </>
                ) : submitting ? (
                  "Подключение..."
                ) : (
                  "Войти в комнату"
                )}
              </button>
            ) : (
              <button
                className={styles.waitingSubmit}
                type="button"
                onClick={handleGuestSubmit}
                disabled={submitting || !guestName.trim() || inQueue}
              >
                {inQueue ? (
                  <>
                    Ожидание в очереди
                    <span className={styles.queueDots} aria-hidden="true" />
                  </>
                ) : submitting ? (
                  "Вход..."
                ) : (
                  "Войти гостем"
                )}
              </button>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
