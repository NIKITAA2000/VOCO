import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LiveKitRoom } from "@livekit/components-react";
import "@livekit/components-styles";
import { DisconnectReason } from "livekit-client";
import { api, type PlaylistTrack, type RoomSounds } from "../api";
import { ConferenceRoomContent, PendingWatcher } from "./RoomPage";
import { WaitingRoomPlayer } from "../components/WaitingRoomPlayer";
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
  const [ownerName, setOwnerName] = useState("");
  const [initialPins, setInitialPins] = useState<any[]>([]);
  const [initialChat, setInitialChat] = useState<any[]>([]);
  const [initialPolls, setInitialPolls] = useState<any[]>([]);
  const [initialPlaylist, setInitialPlaylist] = useState<PlaylistTrack[]>([]);
  const [initialSounds, setInitialSounds] = useState<RoomSounds>({
    fun: null,
    hand: null,
    join: null,
  });
  const [error, setError] = useState("");
  const [conferenceReady, setConferenceReady] = useState(false);
  const [inQueue, setInQueue] = useState(false);
  const [rejectionToast, setRejectionToast] = useState<string | null>(null);
  const defaultName =
    (typeof localStorage !== "undefined" && localStorage.getItem("voco_room_display_name")) ||
    (isAuthed ? user?.username || user?.email || "" : "");
  const [displayName, setDisplayName] = useState<string>(defaultName);
  const [submitting, setSubmitting] = useState(false);
  const [guestsDenied, setGuestsDenied] = useState(false);
  const leaveRequestedRef = useRef(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const waitingDate = now.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const waitingTime = now.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  useEffect(() => {
    if (!code) {
      setError("Ссылка недействительна");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const info: any = await api.getInviteInfo(code);
        if (cancelled) return;
        setRoomName(info?.room?.name ?? "");
        setRoomSlug(info?.room?.slug ?? "");
        setOwnerName(info?.owner?.username ?? "");
        if (Array.isArray(info?.playlist)) {
          setInitialPlaylist(info.playlist as PlaylistTrack[]);
        }
        if (info?.sounds && typeof info.sounds === "object") {
          setInitialSounds({
            fun: info.sounds.fun ?? null,
            hand: info.sounds.hand ?? null,
            join: info.sounds.join ?? null,
          });
        }
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || "Ссылка недействительна");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const handleAuthedSubmit = useCallback(async () => {
    if (!code) return;
    const name = displayName.trim();
    setSubmitting(true);
    setError("");
    try {
      const data = await api.joinByInvite(code, name || undefined);
      if (name) localStorage.setItem("voco_room_display_name", name);
      setToken(data.token);
      setLivekitUrl(data.livekitUrl);
      setRoomName(data.room.name);
      setRoomSlug(data.room.slug);
      setInitialPins(Array.isArray(data.pinnedMessages) ? data.pinnedMessages : []);
      setInitialChat(Array.isArray(data.chatHistory) ? data.chatHistory : []);
      setInitialPolls(Array.isArray(data.polls) ? data.polls : []);
      if (Array.isArray(data.playlist)) {
        setInitialPlaylist(data.playlist as PlaylistTrack[]);
      }
      if (data.sounds) {
        setInitialSounds({
          fun: data.sounds.fun ?? null,
          hand: data.sounds.hand ?? null,
          join: data.sounds.join ?? null,
        });
      }
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
  }, [code, displayName]);

  const handleGuestSubmit = useCallback(async () => {
    const name = displayName.trim();
    if (!name || !code) return;
    setSubmitting(true);
    setError("");
    try {
      const data = await api.joinByInviteAsGuest(code, name);
      localStorage.setItem("voco_room_display_name", name);
      setToken(data.token);
      setLivekitUrl(data.livekitUrl);
      setRoomName(data.room.name);
      setRoomSlug(data.room.slug);
      setInitialPins(Array.isArray(data.pinnedMessages) ? data.pinnedMessages : []);
      setInitialChat(Array.isArray(data.chatHistory) ? data.chatHistory : []);
      setInitialPolls(Array.isArray(data.polls) ? data.polls : []);
      if (Array.isArray(data.playlist)) {
        setInitialPlaylist(data.playlist as PlaylistTrack[]);
      }
      if (data.sounds) {
        setInitialSounds({
          fun: data.sounds.fun ?? null,
          hand: data.sounds.hand ?? null,
          join: data.sounds.join ?? null,
        });
      }
      if (data.pending) {
        setInQueue(true);
      } else {
        setConferenceReady(true);
      }
    } catch (err: any) {
      const message: string = err?.message ?? "";
      if (/гост/i.test(message)) {
        setGuestsDenied(true);
        setError("Для входа в эту комнату нужен аккаунт");
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }, [code, displayName]);

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

  const handleWaitingLeave = useCallback(() => {
    navigate(isAuthed ? "/dashboard" : "/login");
  }, [isAuthed, navigate]);

  const handleLeaveIntent = useCallback(() => {
    leaveRequestedRef.current = true;
  }, []);

  const handleDisconnected = useCallback(
    (reason?: DisconnectReason) => {
      if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
        const wasInConference = conferenceReady;
        setInQueue(false);
        setConferenceReady(false);
        setRejectionToast(
          wasInConference
            ? "Вы были забанены модератором встречи"
            : "Модератор отклонил ваш запрос на вход",
        );
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
    [conferenceReady, isAuthed, navigate, roomSlug],
  );

  const handlePendingApproved = useCallback(() => {
    setInQueue(false);
    leaveRequestedRef.current = false;
    setConferenceReady(true);
  }, []);

  const canSubmit =
    !guestsDenied && !submitting && !inQueue && displayName.trim().length > 0;

  const handleEntrySubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (guestsDenied) {
      goToRegister();
      return;
    }
    if (!canSubmit) return;
    if (isAuthed) void handleAuthedSubmit();
    else void handleGuestSubmit();
  };

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
              initialPinnedMessages={initialPins}
              initialChatHistory={initialChat}
              initialPolls={initialPolls}
              initialPlaylist={initialPlaylist}
              initialSounds={initialSounds}
              livekitToken={token}
            />
          )}
        </LiveKitRoom>
      </div>
    ) : null;

  const inputLabel = guestsDenied
    ? "Гостям сюда нельзя"
    : "Имя в конференции";

  const inputPlaceholder = isAuthed
    ? user?.username || "your@email.com"
    : "Гость";

  const submitLabel = guestsDenied
    ? "Зарегистрироваться"
    : inQueue
      ? "Ожидание в очереди"
      : submitting
        ? "Вход..."
        : "Войти";

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
          <div className={styles.waitingBackdrop} aria-hidden="true">
            <div className={`${styles.waitingCircle} ${styles.waitingCircle1}`} />
            <div className={`${styles.waitingCircle} ${styles.waitingCircle2}`} />
            <div className={`${styles.waitingCircle} ${styles.waitingCircle3}`} />
            <div className={`${styles.waitingCircle} ${styles.waitingCircle4}`} />
            <div className={`${styles.waitingCircle} ${styles.waitingCircle5}`} />
            <div className={`${styles.waitingCircle} ${styles.waitingCircle6}`} />
            <div className={`${styles.waitingCircle} ${styles.waitingCircle7}`} />
            <div className={`${styles.waitingCircle} ${styles.waitingCircle8}`} />
            <div className={`${styles.waitingCircle} ${styles.waitingCircle9}`} />
            <div className={`${styles.waitingCircle} ${styles.waitingCircle10}`} />
          </div>

          <div className={styles.waitingClock} aria-hidden="true">
            <div className={styles.waitingClockDate}>{waitingDate}</div>
            <div className={styles.waitingClockTime}>{waitingTime}</div>
          </div>

          <form
            className={styles.waitingPanel}
            aria-label="Вход по приглашению"
            onSubmit={handleEntrySubmit}
          >
            <div className={styles.waitingHeader}>
              <h2>Комната ожидания</h2>
              <button
                className={styles.waitingClose}
                type="button"
                onClick={handleWaitingLeave}
                aria-label={isAuthed ? "Вернуться в дашборд" : "Вернуться на главную"}
              />
            </div>

            <label className={styles.waitingLabel} htmlFor="invite-display-name">
              {inputLabel}
            </label>

            <input
              id="invite-display-name"
              className={styles.waitingInput}
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={inputPlaceholder}
              disabled={guestsDenied}
              autoFocus={!guestsDenied}
            />

            <div
              className={`${styles.waitingError} ${error ? "" : styles.waitingErrorHidden}`}
              aria-live="polite"
            >
              {error ? `Ошибка: ${error}` : " "}
            </div>

            <button
              className={styles.waitingSubmit}
              type="submit"
              disabled={!canSubmit && !guestsDenied}
            >
              {inQueue ? (
                <>
                  {submitLabel}
                  <span className={styles.queueDots} aria-hidden="true" />
                </>
              ) : (
                submitLabel
              )}
            </button>

            <WaitingRoomPlayer tracks={initialPlaylist} />
          </form>

          {(roomName || ownerName) && (
            <div className={styles.waitingMeta} aria-hidden="true">
              {roomName && <div className={styles.waitingMetaName}>{roomName}</div>}
              {ownerName && <div className={styles.waitingMetaOwner}>{ownerName}</div>}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
