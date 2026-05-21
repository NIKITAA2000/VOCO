import { useEffect, useRef, useState } from "react";
import {
  api,
  type PlaylistTrack,
  type RoomSounds,
  type RoomSoundType,
} from "../api";
import { soundManager } from "../lib/soundManager";
import styles from "../pages/Room.module.css";

// Хук: реактивно подписывается на статус «играет / не играет» по key из
// soundManager. Кнопки preview используют его, чтобы рендерить ▶/⏸.
function useSoundPlaying(key: string): boolean {
  const [playing, setPlaying] = useState(() => soundManager.isPlaying(key));
  useEffect(() => {
    setPlaying(soundManager.isPlaying(key));
    return soundManager.subscribe(key, setPlaying);
  }, [key]);
  return playing;
}

interface Props {
  slug: string;
  playlist: PlaylistTrack[];
  sounds: RoomSounds;
  onChanged: () => void | Promise<void>;
}

// Owner-only вкладка «Звуки»: плейлист комнаты ожидания + 3 одиночных звука
// (прикольный / поднятая рука / запрос на подключение). Все правки идут через
// api.*, после успешного запроса дёргаем onChanged() — родитель перечитает
// данные комнаты и пропы обновятся.
export function SoundsSettings({ slug, playlist, sounds, onChanged }: Props) {
  // При закрытии вкладки/панели — глушим все превью, иначе остаются играть
  // в фоне без UI, через который их можно остановить.
  useEffect(() => {
    return () => {
      soundManager.stopAll();
    };
  }, []);

  return (
    <div className={styles.soundsBody}>
      <PlaylistEditor slug={slug} playlist={playlist} onChanged={onChanged} />
      <SingleSoundEditor
        slug={slug}
        type="fun"
        label="Прикольный звук (кнопка в конфе)"
        currentUrl={sounds.fun}
        defaultUrl="/sounds/fun.mp3"
        defaultLabel="дефолтный 'трам-там'"
        onChanged={onChanged}
      />
      <SingleSoundEditor
        slug={slug}
        type="hand"
        label="Звук поднятой руки (для модераторов)"
        currentUrl={sounds.hand}
        defaultUrl="/sounds/hand.mp3"
        defaultLabel="дефолтный 'дзынь'"
        onChanged={onChanged}
      />
      <SingleSoundEditor
        slug={slug}
        type="join"
        label="Звук запроса на подключение (для модераторов)"
        currentUrl={sounds.join}
        defaultUrl="/sounds/join.mp3"
        defaultLabel="дефолтное приветствие"
        onChanged={onChanged}
      />
    </div>
  );
}

function PlaylistEditor({
  slug,
  playlist,
  onChanged,
}: {
  slug: string;
  playlist: PlaylistTrack[];
  onChanged: () => void | Promise<void>;
}) {
  return (
    <div className={styles.soundsSection}>
      <h4 className={styles.soundsSectionTitle}>Плейлист комнаты ожидания</h4>
      <p className={styles.soundsSectionHint}>
        До 10 треков. mp3/ogg/wav до 10 МБ. Иконка опциональна (jpg/png/webp до 2 МБ).
      </p>

      {playlist.length === 0 ? (
        <div className={styles.soundsSectionHint}>Треков пока нет.</div>
      ) : (
        playlist.map((track, idx) => (
          <PlaylistRow
            key={track.id}
            slug={slug}
            track={track}
            isFirst={idx === 0}
            isLast={idx === playlist.length - 1}
            playlist={playlist}
            onChanged={onChanged}
          />
        ))
      )}

      {playlist.length < 10 ? (
        <AddTrackForm slug={slug} onChanged={onChanged} />
      ) : null}
    </div>
  );
}

function PlaylistRow({
  slug,
  track,
  isFirst,
  isLast,
  playlist,
  onChanged,
}: {
  slug: string;
  track: PlaylistTrack;
  isFirst: boolean;
  isLast: boolean;
  playlist: PlaylistTrack[];
  onChanged: () => void | Promise<void>;
}) {
  const [editTitle, setEditTitle] = useState(track.title);
  const [editAuthor, setEditAuthor] = useState(track.author ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const previewKey = `preview:${track.id}`;
  const previewPlaying = useSoundPlaying(previewKey);
  const togglePreview = () => {
    if (previewPlaying) soundManager.stop(previewKey);
    else soundManager.play(track.audioUrl, { key: previewKey });
  };

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.updatePlaylistTrack(slug, track.id, {
        title: editTitle.trim(),
        author: editAuthor.trim() || null,
      });
      await onChanged();
      setEditing(false);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.deletePlaylistTrack(slug, track.id);
      await onChanged();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const handleMove = async (direction: -1 | 1) => {
    if (busy) return;
    const ids = playlist.map((t) => t.id);
    const idx = ids.indexOf(track.id);
    const swap = idx + direction;
    if (swap < 0 || swap >= ids.length) return;
    [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
    setBusy(true);
    try {
      await api.reorderPlaylist(slug, ids);
      await onChanged();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.soundsTrackRow}>
      <div className={styles.soundsReorderButtons}>
        <button
          type="button"
          className={styles.soundsReorderButton}
          onClick={() => handleMove(-1)}
          disabled={isFirst || busy}
          aria-label="Вверх"
        >
          ▲
        </button>
        <button
          type="button"
          className={styles.soundsReorderButton}
          onClick={() => handleMove(1)}
          disabled={isLast || busy}
          aria-label="Вниз"
        >
          ▼
        </button>
      </div>

      <div className={styles.soundsTrackThumb}>
        {track.iconUrl ? <img src={track.iconUrl} alt="" /> : null}
      </div>

      <div className={styles.soundsTrackMeta}>
        {editing ? (
          <>
            <input
              type="text"
              className={styles.soundsTitleEdit}
              value={editTitle}
              maxLength={120}
              placeholder="Название"
              onChange={(e) => setEditTitle(e.target.value)}
            />
            <input
              type="text"
              className={styles.soundsTitleEdit}
              value={editAuthor}
              maxLength={120}
              placeholder="Автор (опционально)"
              onChange={(e) => setEditAuthor(e.target.value)}
            />
          </>
        ) : (
          <>
            <div className={styles.soundsTrackTitle}>{track.title}</div>
            <div className={styles.soundsTrackAuthor}>{track.author ?? ""}</div>
          </>
        )}
      </div>

      <div className={styles.soundsTrackActions}>
        <button
          type="button"
          className={styles.soundsActionButton}
          onClick={togglePreview}
          aria-label={previewPlaying ? "Остановить" : "Прослушать"}
        >
          {previewPlaying ? "⏸" : "▶"}
        </button>
        {editing ? (
          <>
            <button
              type="button"
              className={styles.soundsActionButton}
              onClick={() => void handleSave()}
              disabled={busy || editTitle.trim().length === 0}
              aria-label="Сохранить"
            >
              ✓
            </button>
            <button
              type="button"
              className={styles.soundsActionButton}
              onClick={() => {
                setEditing(false);
                setEditTitle(track.title);
                setEditAuthor(track.author ?? "");
              }}
              aria-label="Отменить"
            >
              ✕
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.soundsActionButton}
            onClick={() => setEditing(true)}
            aria-label="Переименовать"
          >
            ✎
          </button>
        )}
        <button
          type="button"
          className={styles.soundsActionButton}
          data-danger="true"
          onClick={() => void handleDelete()}
          disabled={busy}
          aria-label="Удалить"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function AddTrackForm({
  slug,
  onChanged,
}: {
  slug: string;
  onChanged: () => void | Promise<void>;
}) {
  const audioRef = useRef<HTMLInputElement>(null);
  const iconRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setAuthor("");
    setError(null);
    if (audioRef.current) audioRef.current.value = "";
    if (iconRef.current) iconRef.current.value = "";
  };

  const handleSubmit = async () => {
    const audio = audioRef.current?.files?.[0];
    if (!audio) {
      setError("Выберите аудио-файл");
      return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Введите название");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.uploadPlaylistTrack(slug, {
        audio,
        icon: iconRef.current?.files?.[0] ?? null,
        title: trimmed,
        author: author.trim() || undefined,
      });
      reset();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить трек");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.soundsAddBlock}>
      <div className={styles.soundsAddFields}>
        <input
          type="text"
          placeholder="Название"
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          type="text"
          placeholder="Автор (опционально)"
          maxLength={120}
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
        />
      </div>
      <div className={styles.soundsAddFileRow}>
        <span>Аудио:</span>
        <input ref={audioRef} type="file" accept="audio/mpeg,audio/ogg,audio/wav" />
      </div>
      <div className={styles.soundsAddFileRow}>
        <span>Иконка:</span>
        <input ref={iconRef} type="file" accept="image/jpeg,image/png,image/webp" />
      </div>
      {error ? <div className={styles.soundsAddError}>{error}</div> : null}
      <button
        type="button"
        className={styles.soundsAddSubmit}
        onClick={() => void handleSubmit()}
        disabled={busy}
      >
        {busy ? "Загрузка..." : "Добавить трек"}
      </button>
    </div>
  );
}

function SingleSoundEditor({
  slug,
  type,
  label,
  currentUrl,
  defaultUrl,
  defaultLabel,
  onChanged,
}: {
  slug: string;
  type: RoomSoundType;
  label: string;
  currentUrl: string | null;
  defaultUrl: string;
  defaultLabel: string;
  onChanged: () => void | Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Выберите файл");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.uploadRoomSound(slug, type, file);
      if (fileRef.current) fileRef.current.value = "";
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.resetRoomSound(slug, type);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сбросить");
    } finally {
      setBusy(false);
    }
  };

  const playable = currentUrl ?? defaultUrl;
  const previewKey = `single:${type}`;
  const previewPlaying = useSoundPlaying(previewKey);
  const togglePreview = () => {
    if (previewPlaying) soundManager.stop(previewKey);
    else soundManager.play(playable, { key: previewKey });
  };

  return (
    <div className={styles.soundsSection}>
      <h4 className={styles.soundsSectionTitle}>{label}</h4>
      <div className={styles.soundsSingleCard}>
        <button
          type="button"
          className={styles.soundsActionButton}
          onClick={togglePreview}
          aria-label={previewPlaying ? "Остановить" : "Прослушать"}
        >
          {previewPlaying ? "⏸" : "▶"}
        </button>
        <span className={styles.soundsSingleLabel}>
          {currentUrl ? "Свой файл" : `Используется ${defaultLabel}`}
        </span>
        <div className={styles.soundsTrackActions}>
          <label
            className={styles.soundsActionButton}
            aria-label="Заменить файл"
            title="Заменить файл"
          >
            ⤴
            <input
              ref={fileRef}
              type="file"
              accept="audio/mpeg,audio/ogg,audio/wav"
              style={{ display: "none" }}
              onChange={() => void handleUpload()}
              disabled={busy}
            />
          </label>
          {currentUrl ? (
            <button
              type="button"
              className={styles.soundsActionButton}
              data-danger="true"
              onClick={() => void handleReset()}
              disabled={busy}
              aria-label="Вернуть дефолт"
              title="Вернуть дефолт"
            >
              ↺
            </button>
          ) : null}
        </div>
      </div>
      <p className={styles.soundsSectionHint}>До 1 МБ. mp3, ogg или wav.</p>
      {error ? <div className={styles.soundsAddError}>{error}</div> : null}
    </div>
  );
}
