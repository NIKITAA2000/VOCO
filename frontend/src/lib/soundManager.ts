// Audio runtime для коротких звуков (event-сигналы, превью в настройках).
// Хранит активные Audio-объекты по `key`, чтобы их можно было остановить —
// иначе превью в настройках играло бы до конца файла без возможности паузы.
//
// `key` делит пространство кулдаунов И активных проигрываний. Один и тот же
// key → повторный play() заменяет (останавливает старый).
//
// Подписчики (subscribe) нужны React-компонентам, которые показывают play/stop
// иконку и должны обновляться, когда трек заканчивается сам.

type Listener = (playing: boolean) => void;

class SoundManager {
  private cooldownUntil: Record<string, number> = {};
  private active: Map<string, HTMLAudioElement> = new Map();
  private listeners: Map<string, Set<Listener>> = new Map();

  play(
    url: string | null | undefined,
    opts?: { cooldownMs?: number; key?: string; volume?: number },
  ): void {
    if (!url) return;
    const key = opts?.key ?? url;
    const now = Date.now();
    if ((this.cooldownUntil[key] ?? 0) > now) return;
    this.cooldownUntil[key] = now + (opts?.cooldownMs ?? 0);

    // Останавливаем предыдущий play() с тем же key — иначе они накладываются.
    this.stop(key);

    try {
      const audio = new Audio(url);
      audio.volume = Math.max(0, Math.min(1, opts?.volume ?? 1));
      this.active.set(key, audio);
      this.notify(key, true);
      const cleanup = () => {
        if (this.active.get(key) === audio) {
          this.active.delete(key);
          this.notify(key, false);
        }
      };
      audio.addEventListener("ended", cleanup);
      audio.addEventListener("error", cleanup);
      void audio.play().catch(() => {
        cleanup();
      });
    } catch {
      // SSR-окружение или браузер без Audio API
    }
  }

  stop(key: string): void {
    const audio = this.active.get(key);
    if (!audio) return;
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // ignore
    }
    this.active.delete(key);
    this.notify(key, false);
  }

  stopAll(): void {
    for (const key of Array.from(this.active.keys())) this.stop(key);
  }

  isPlaying(key: string): boolean {
    return this.active.has(key);
  }

  subscribe(key: string, fn: Listener): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
  }

  private notify(key: string, playing: boolean) {
    this.listeners.get(key)?.forEach((fn) => fn(playing));
  }
}

export const soundManager = new SoundManager();
