import { useEffect, useRef, useState } from "react";
import type { PlaylistTrack } from "../api";
import styles from "../pages/Room.module.css";

interface Props {
  tracks: PlaylistTrack[];
}

type PlayMode = "sequential" | "shuffle" | "repeat";

// Локальный плеер для комнаты ожидания: каждый гость листает плейлист сам, без
// синхронизации с другими. Стартует по клику play (browsers блокируют autoplay
// без user gesture). Список треков раскрывается по клику на «бургер».
export function WaitingRoomPlayer({ tracks }: Props) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // Режим воспроизведения. Кликом по правой кнопке циклит:
  // sequential → shuffle → repeat → sequential.
  // sequential: по завершении трека → next, prev/next доступны.
  // shuffle:    по завершении → случайный трек, prev/next ЗАБЛОКИРОВАНЫ.
  // repeat:     по завершении → тот же трек, prev/next доступны.
  const [playMode, setPlayMode] = useState<PlayMode>("sequential");
  // Прогресс трека: 0..duration в секундах. Обновляется по timeupdate
  // из audio-элемента, на seek (клик/перетягивание) ставим audio.currentTime.
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // ref на `playing` — нужно useEffect'у смены трека, чтобы не зависеть от
  // `playing` в deps (иначе пауза/возобновление дёргали эффект и сбрасывали
  // currentTime в 0).
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const safeIndex = tracks.length > 0 ? Math.min(index, tracks.length - 1) : 0;
  const current = tracks[safeIndex];
  const currentAudioUrl = current?.audioUrl ?? "";

  // При смене SRC обнуляем currentTime и автоплейим, если уже играли.
  // Зависим ТОЛЬКО от currentAudioUrl — пауза/возобновление не должны
  // триггерить этот эффект (иначе он сбрасывает currentTime → песня
  // начинается сначала после паузы).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
    setDuration(0);
    if (playingRef.current) {
      audio.play().catch(() => setPlaying(false));
    }
  }, [currentAudioUrl]);

  const handleTimeUpdate = () => {
    const a = audioRef.current;
    if (a) setCurrentTime(a.currentTime);
  };
  const handleLoadedMetadata = () => {
    const a = audioRef.current;
    if (a && Number.isFinite(a.duration)) setDuration(a.duration);
  };
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const a = audioRef.current;
    const value = Number(e.target.value);
    if (a) {
      a.currentTime = value;
      setCurrentTime(value);
    }
  };

  // Если плейлист пустой — компонент не рендерится. Early return ПОСЛЕ всех
  // хуков, иначе порядок hooks между рендерами разъезжается.
  if (tracks.length === 0 || !current) return null;

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  // В shuffle prev/next прыгают на случайный трек (не блокируются).
  const pickRandomDifferent = () => {
    if (tracks.length <= 1) return index;
    let r = Math.floor(Math.random() * tracks.length);
    while (r === index) r = Math.floor(Math.random() * tracks.length);
    return r;
  };
  const prev = () => {
    if (playMode === "shuffle") {
      setIndex(pickRandomDifferent());
      return;
    }
    setIndex((i) => (i - 1 + tracks.length) % tracks.length);
  };
  const next = () => {
    if (playMode === "shuffle") {
      setIndex(pickRandomDifferent());
      return;
    }
    setIndex((i) => (i + 1) % tracks.length);
  };
  const pickTrack = (i: number) => {
    setIndex(i);
    setListOpen(false);
    if (!playing) setPlaying(true);
  };
  const cycleMode = () => {
    setPlayMode((m) =>
      m === "sequential" ? "shuffle" : m === "shuffle" ? "repeat" : "sequential",
    );
  };

  // Обработчик окончания трека — зависит от режима.
  const handleEnded = () => {
    if (playMode === "repeat") {
      // Тот же трек заново.
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = 0;
      audio.play().catch(() => setPlaying(false));
      return;
    }
    if (playMode === "shuffle") {
      if (tracks.length <= 1) return;
      let r = Math.floor(Math.random() * tracks.length);
      // не повторяем тот же индекс
      while (r === index) r = Math.floor(Math.random() * tracks.length);
      setIndex(r);
      return;
    }
    // sequential
    setIndex((i) => (i + 1) % tracks.length);
  };


  return (
    <div className={styles.waitingPlayer}>
      <audio
        ref={audioRef}
        src={current.audioUrl}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleLoadedMetadata}
        preload="metadata"
      />

      <div className={styles.waitingPlayerThumb}>
        {current.iconUrl ? <img src={current.iconUrl} alt="" /> : null}
      </div>

      <div className={styles.waitingPlayerMeta}>
        <div className={styles.waitingPlayerTitle}>{current.title}</div>
        <div className={styles.waitingPlayerAuthor}>{current.author ?? ""}</div>
      </div>

      <div className={styles.waitingPlayerControls}>
        <button
          type="button"
          className={styles.waitingPlayerControl}
          onClick={prev}
          aria-label="Предыдущий трек"
        >
          <PrevIcon />
        </button>
        <button
          type="button"
          className={styles.waitingPlayerPlay}
          onClick={togglePlay}
          aria-label={playing ? "Пауза" : "Играть"}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          className={styles.waitingPlayerControl}
          onClick={next}
          aria-label="Следующий трек"
        >
          <NextIcon />
        </button>
      </div>

      <button
        type="button"
        className={styles.waitingPlayerNext}
        onClick={cycleMode}
        aria-label={
          playMode === "sequential"
            ? "Режим: по порядку (клик — перемешать)"
            : playMode === "shuffle"
              ? "Режим: вперемешку (клик — повтор)"
              : "Режим: повтор (клик — по порядку)"
        }
        title={
          playMode === "sequential"
            ? "По порядку"
            : playMode === "shuffle"
              ? "Вперемешку"
              : "Повтор трека"
        }
      >
        {playMode === "sequential" ? (
          <ArrowRightIcon />
        ) : playMode === "shuffle" ? (
          <ShuffleIcon />
        ) : (
          <RepeatOneIcon />
        )}
      </button>

      <button
        type="button"
        className={styles.waitingPlayerList}
        onClick={() => setListOpen((v) => !v)}
        aria-label="Список треков"
        aria-expanded={listOpen}
      >
        <ListIcon />
      </button>

      {/* Тонкий progress-bar внизу плеера. Использует <input type="range">
       * чтобы получить нативные click+drag из коробки. Стилизация через
       * .waitingPlayerSeek в Room.module.css. */}
      <input
        type="range"
        className={styles.waitingPlayerSeek}
        min={0}
        max={duration || 1}
        step={0.01}
        value={Math.min(currentTime, duration || 0)}
        onChange={handleSeek}
        aria-label="Перемотка"
        style={
          {
            "--seek-progress": `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
          } as React.CSSProperties
        }
      />

      {listOpen && (
        <div className={styles.waitingPlayerListPopup}>
          {tracks.map((t, i) => (
            <button
              key={t.id}
              type="button"
              className={
                i === safeIndex
                  ? `${styles.waitingPlayerListItem} ${styles.waitingPlayerListItemActive}`
                  : styles.waitingPlayerListItem
              }
              onClick={() => pickTrack(i)}
            >
              <div className={styles.waitingPlayerListItemThumb}>
                {t.iconUrl ? <img src={t.iconUrl} alt="" /> : null}
              </div>
              <div className={styles.waitingPlayerListItemMeta}>
                <div className={styles.waitingPlayerListItemTitle}>{t.title}</div>
                <div className={styles.waitingPlayerListItemAuthor}>
                  {t.author ?? ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Skip-back: 7-px бар слева + треугольник остриём влево, без зазора между
// баром и вершиной (см. svg.txt:4-5). Триangle: (7,10) — острие, (23.5,0.47)
// и (23.5,19.53) — основание справа. Бар без скругления.
function PrevIcon() {
  return (
    <svg width="24" height="20" viewBox="0 0 23.5 20" fill="currentColor">
      <rect width="7" height="20" />
      <path d="M7 10L23.5 19.5263V0.4737L7 10Z" />
    </svg>
  );
}
// Skip-forward: зеркало (см. svg.txt:6-7). Triangle с вершиной справа,
// бар прижат справа.
function NextIcon() {
  return (
    <svg width="24" height="20" viewBox="0 0 23.5 20" fill="currentColor">
      <path d="M16.5 10L0 0.4737V19.5263L16.5 10Z" />
      <rect x="16.5" width="7" height="20" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  );
}
// «→» — stroke-style: горизонтальная линия + две короткие диагонали в острие
// (см. svg.txt:12-14: line M387 25 L411.528 25 + два штриха через matrix).
function ArrowRightIcon() {
  return (
    <svg
      width="26"
      height="14"
      viewBox="0 0 26 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
    >
      <path d="M0 7 H22" />
      <path d="M18 1 L24 7 L18 13" />
    </svg>
  );
}
// Shuffle: две стрелки, пересекающиеся X-крестом, оба острия направлены
// вправо. Верхняя идёт sleft→diag-down-right, нижняя — left→diag-up-right.
function ShuffleIcon() {
  return (
    <svg
      width="24"
      height="20"
      viewBox="0 0 24 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Верхняя стрелка: горизонталь slева → диагональ вниз-вправо */}
      <path d="M2 4 H8 L20 16" />
      {/* Острие верхней стрелки */}
      <path d="M16 16 H20 V12" />
      {/* Нижняя стрелка: горизонталь slева → диагональ вверх-вправо */}
      <path d="M2 16 H8 L20 4" />
      {/* Острие нижней стрелки */}
      <path d="M16 4 H20 V8" />
    </svg>
  );
}

// Repeat-one: вертикальная петля из двух полу-овалов + стрелки сверху/снизу.
// Координаты из svg.txt (20×26, fill+stroke #0077FF — заменён на currentColor).
function RepeatOneIcon() {
  return (
    <svg width="20" height="26" viewBox="0 0 20 26" fill="none">
      <path
        d="M12 5.05078C15.4503 5.93893 18 9.07132 18 12.7988V13.0205C17.9998 16.791 15.461 19.9661 12 20.9355V22.9961C16.5765 21.9814 19.9998 17.9024 20 13.0205V12.7988C20 7.96116 16.5642 3.92669 12 3V5.05078Z"
        fill="currentColor"
      />
      <path
        d="M8 5.05078C4.54966 5.93893 2 9.07132 2 12.7988V13.0205C2.00015 16.791 4.53904 19.9661 8 20.9355V22.9961C3.42345 21.9814 0.000156348 17.9024 0 13.0205V12.7988C0 7.96116 3.43576 3.92669 8 3V5.05078Z"
        fill="currentColor"
      />
      <line
        y1="-1"
        x2="5.8036"
        y2="-1"
        transform="matrix(0.52146 -0.853276 0.878235 0.478229 7.0708 8.81592)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        y1="-1"
        x2="5.8036"
        y2="-1"
        transform="matrix(-0.878235 -0.478229 0.52146 -0.853276 10.0972 3.86377)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        y1="-1"
        x2="5.8036"
        y2="-1"
        transform="matrix(-0.52146 0.853276 -0.878235 -0.478229 13.0615 17)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        y1="-1"
        x2="5.8036"
        y2="-1"
        transform="matrix(0.878235 0.478229 -0.52146 0.853276 10.0352 21.9521)"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

// «≡» — три stroke-линии одинаковой ширины 20px, шаг 7px по вертикали (см.
// svg.txt:9-11: M440 18 L460 18, ... y=25, y=32). Добавлен 1px-padding
// в viewBox, чтобы строки на краях не клипались, и butt-cap чтобы все три
// были визуально одной длины.
function ListIcon() {
  return (
    <svg
      width="22"
      height="16"
      viewBox="-1 -1 22 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="butt"
    >
      <path d="M0 0 H20" />
      <path d="M0 7 H20" />
      <path d="M0 14 H20" />
    </svg>
  );
}
