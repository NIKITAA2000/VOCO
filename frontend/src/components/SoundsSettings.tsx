import { useCallback, useEffect, useRef, useState } from "react";
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

// Минимальный набор инлайн-иконок под 22×22 «слот».
function PlayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M5 3v16l14-8z" fill="currentColor" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="5" y="3" width="4" height="16" fill="currentColor" />
      <rect x="13" y="3" width="4" height="16" fill="currentColor" />
    </svg>
  );
}
function CrossIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <line x1="4" y1="4" x2="18" y2="18" stroke="currentColor" strokeWidth="2" />
      <line x1="18" y1="4" x2="4" y2="18" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <line x1="11" y1="2" x2="11" y2="20" stroke="currentColor" strokeWidth="2" />
      <line x1="2" y1="11" x2="20" y2="11" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function DragHandleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <line x1="2" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="2" />
      <line x1="2" y1="11" x2="20" y2="11" stroke="currentColor" strokeWidth="2" />
      <line x1="2" y1="16" x2="20" y2="16" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

interface Props {
  slug: string;
  playlist: PlaylistTrack[];
  sounds: RoomSounds;
  onChanged: () => void | Promise<void>;
}

// Owner-only вкладка «Звуки»: плейлист комнаты ожидания + 3 одиночных звука
// (прикольный / поднятая рука / запрос). Layout по дизайну: ряды треков ▶/✕/☰,
// форма добавления с лейблами и отдельными pill-кнопками для аудио и обложки,
// внизу три однотипных pill'а одиночных звуков.
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
      <PlaylistSection slug={slug} playlist={playlist} onChanged={onChanged} />

      <SingleSoundRow
        slug={slug}
        type="fun"
        label="Звук кнопки"
        currentUrl={sounds.fun}
        defaultUrl={null}
        onChanged={onChanged}
      />
      <SingleSoundRow
        slug={slug}
        type="hand"
        label="Звук поднятой руки"
        currentUrl={sounds.hand}
        defaultUrl="/sounds/hand.mp3"
        onChanged={onChanged}
      />
      <SingleSoundRow
        slug={slug}
        type="join"
        label="Звук запроса"
        currentUrl={sounds.join}
        defaultUrl="/sounds/join.mp3"
        onChanged={onChanged}
      />
    </div>
  );
}

function PlaylistSection({
  slug,
  playlist,
  onChanged,
}: {
  slug: string;
  playlist: PlaylistTrack[];
  onChanged: () => void | Promise<void>;
}) {
  // Источник для drag-reorder. Храним индекс перетаскиваемого ряда в ref —
  // нельзя через DataTransfer (Firefox в onDragOver не отдаёт payload).
  const dragFromRef = useRef<number | null>(null);

  const handleReorder = useCallback(
    async (from: number, to: number) => {
      if (from === to) return;
      const ids = playlist.map((t) => t.id);
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      try {
        await api.reorderPlaylist(slug, ids);
        await onChanged();
      } catch (e) {
        console.error(e);
      }
    },
    [playlist, slug, onChanged],
  );

  return (
    <>
      <h4 className={styles.soundsPlaylistTitle}>Плейлист комнаты ожидания</h4>
      <div className={styles.soundsTrackCount}>{playlist.length}/10 треков</div>

      {playlist.length > 0 ? (
        <div className={styles.soundsTrackList}>
          {playlist.map((track, idx) => (
            <PlaylistRow
              key={track.id}
              slug={slug}
              track={track}
              index={idx}
              dragFromRef={dragFromRef}
              onReorder={handleReorder}
              onChanged={onChanged}
            />
          ))}
        </div>
      ) : null}

      <AddTrackForm
        slug={slug}
        disabled={playlist.length >= 10}
        onChanged={onChanged}
      />
    </>
  );
}

function PlaylistRow({
  slug,
  track,
  index,
  dragFromRef,
  onReorder,
  onChanged,
}: {
  slug: string;
  track: PlaylistTrack;
  index: number;
  dragFromRef: React.RefObject<number | null>;
  onReorder: (from: number, to: number) => Promise<void>;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const previewKey = `preview:${track.id}`;
  const previewPlaying = useSoundPlaying(previewKey);

  const togglePreview = () => {
    if (previewPlaying) soundManager.stop(previewKey);
    else soundManager.play(track.audioUrl, { key: previewKey });
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

  return (
    <div
      className={styles.soundsTrackRow}
      draggable
      onDragStart={(e) => {
        dragFromRef.current = index;
        e.dataTransfer.effectAllowed = "move";
        // Без setData Safari в некоторых версиях не запускает drag.
        try {
          e.dataTransfer.setData("text/plain", String(index));
        } catch {
          // ignore
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const from = dragFromRef.current;
        dragFromRef.current = null;
        if (from === null || from === index) return;
        void onReorder(from, index);
      }}
      onDragEnd={() => {
        dragFromRef.current = null;
      }}
    >
      <div className={styles.soundsTrackThumb}>
        {track.iconUrl ? <img src={track.iconUrl} alt="" /> : null}
      </div>
      <div className={styles.soundsTrackName}>{track.title}</div>
      <button
        type="button"
        className={styles.soundsActionButton}
        onClick={togglePreview}
        aria-label={previewPlaying ? "Остановить" : "Прослушать"}
      >
        {previewPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button
        type="button"
        className={styles.soundsActionButton}
        onClick={() => void handleDelete()}
        disabled={busy}
        aria-label="Удалить трек"
      >
        <CrossIcon />
      </button>
      <button
        type="button"
        className={styles.soundsActionButton}
        aria-label="Перетащить для изменения порядка"
        title="Перетащить"
        style={{ cursor: "grab" }}
        // На самой кнопке onDragStart срабатывает, но row тоже draggable —
        // не блокируем, чтобы порядок инициирования был стабилен.
      >
        <DragHandleIcon />
      </button>
    </div>
  );
}

function AddTrackForm({
  slug,
  disabled,
  onChanged,
}: {
  slug: string;
  disabled: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const audioRef = useRef<HTMLInputElement>(null);
  const iconRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setAuthor("");
    setAudioFile(null);
    setIconFile(null);
    setError(null);
    if (audioRef.current) audioRef.current.value = "";
    if (iconRef.current) iconRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!audioFile) {
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
        audio: audioFile,
        icon: iconFile,
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
    <>
      <label className={styles.settingsField}>
        <span>Название трека</span>
        <input
          type="text"
          placeholder="Название"
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <label className={styles.settingsField}>
        <span>Автор трека (опционально)</span>
        <input
          type="text"
          placeholder="Автор"
          maxLength={120}
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
        />
      </label>

      <div className={styles.soundsAddFiles}>
        <div className={styles.soundsField}>
          <div className={styles.soundsPill}>
            <span className={styles.soundsPillLabel}>
              {audioFile ? audioFile.name : "Аудио"}
            </span>
            <label
              className={styles.soundsPillIconButton}
              aria-label="Выбрать аудио-файл"
              title="Выбрать аудио-файл"
            >
              <PlusIcon />
              <input
                ref={audioRef}
                type="file"
                accept="audio/mpeg,audio/ogg,audio/wav"
                style={{ display: "none" }}
                onChange={(e) => {
                  setError(null);
                  setAudioFile(e.target.files?.[0] ?? null);
                }}
                disabled={busy}
              />
            </label>
          </div>
          <div className={styles.soundsPillHint}>mp3/ogg/wav до 10 МБ</div>
        </div>

        <div className={styles.soundsField}>
          <div className={styles.soundsPill}>
            <span className={styles.soundsPillLabel}>
              {iconFile ? iconFile.name : "Обложка (опционально)"}
            </span>
            <label
              className={styles.soundsPillIconButton}
              aria-label="Выбрать обложку"
              title="Выбрать обложку"
            >
              <PlusIcon />
              <input
                ref={iconRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: "none" }}
                onChange={(e) => setIconFile(e.target.files?.[0] ?? null)}
                disabled={busy}
              />
            </label>
          </div>
          <div className={styles.soundsPillHint}>jpg/png/webp до 2 МБ</div>
        </div>
      </div>

      {error ? <div className={styles.soundsAddError}>{error}</div> : null}

      <button
        type="button"
        className={styles.soundsAddSubmit}
        onClick={() => void handleSubmit()}
        disabled={busy || disabled}
      >
        {disabled
          ? "Лимит 10 треков"
          : busy
            ? "Загрузка..."
            : "Добавить трек"}
      </button>
    </>
  );
}

function SingleSoundRow({
  slug,
  type,
  label,
  currentUrl,
  defaultUrl,
  onChanged,
}: {
  slug: string;
  type: RoomSoundType;
  label: string;
  currentUrl: string | null;
  // null = у звука нет дефолта (актуально только для fun — без owner-загрузки
  // кнопка просто скрыта). Для hand/join всегда есть дефолт в public/sounds/.
  defaultUrl: string | null;
  onChanged: () => void | Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playable = currentUrl ?? defaultUrl;
  const previewKey = `single:${type}`;
  const previewPlaying = useSoundPlaying(previewKey);

  const togglePreview = () => {
    if (!playable) return;
    if (previewPlaying) soundManager.stop(previewKey);
    else soundManager.play(playable, { key: previewKey });
  };

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
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

  return (
    <div className={styles.soundsField}>
      <div className={styles.soundsPill}>
        <span className={styles.soundsPillLabel}>{label}</span>
        <button
          type="button"
          className={styles.soundsPillIconButton}
          onClick={togglePreview}
          disabled={!playable}
          aria-label={previewPlaying ? "Остановить" : "Прослушать"}
        >
          {previewPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <label
          className={styles.soundsPillIconButton}
          aria-label={currentUrl ? "Заменить файл" : "Загрузить файл"}
          title={currentUrl ? "Заменить файл" : "Загрузить файл"}
        >
          <PlusIcon />
          <input
            ref={fileRef}
            type="file"
            accept="audio/mpeg,audio/ogg,audio/wav"
            style={{ display: "none" }}
            onChange={() => void handleUpload()}
            disabled={busy}
          />
        </label>
      </div>
      <div className={styles.soundsPillHint}>mp3/ogg/wav до 1 МБ</div>
      {error ? <div className={styles.soundsAddError}>{error}</div> : null}
    </div>
  );
}
