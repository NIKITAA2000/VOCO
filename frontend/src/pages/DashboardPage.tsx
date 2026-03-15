import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { VocoLogo } from "../components/VocoLogo";
import "./Dashboard.css";

interface Props {
  user: any;
  onLogout: () => void;
}

type ThemeMode = "light" | "dark" | "system";

type MenuIconProps = {
  viewBox: string;
  paths: string[];
};

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function MenuIcon({ viewBox, paths }: MenuIconProps) {
  return (
    <span className="menu-icon-stack" aria-hidden="true">
      <svg className="menu-icon-shadow" viewBox={viewBox} width="100" height="100">
        {paths.map((d) => (
          <path key={`shadow-${d}`} d={d} fill="currentColor" />
        ))}
      </svg>
      <svg className="menu-icon-face" viewBox={viewBox} width="100" height="100">
        {paths.map((d) => (
          <path key={`face-${d}`} d={d} fill="currentColor" />
        ))}
      </svg>
    </span>
  );
}

const CREATE_PATHS = [
  "M572 472C572 475.283 572.647 478.534 573.903 481.567C575.16 484.6 577.001 487.356 579.322 489.678C581.644 491.999 584.4 493.84 587.433 495.097C590.466 496.353 593.717 497 597 497V522C590.434 522 583.932 520.707 577.866 518.194C571.8 515.682 566.287 511.998 561.645 507.355C557.002 502.713 553.318 497.2 550.806 491.134C548.293 485.068 547 478.566 547 472H572Z",
  "M597 547C593.717 547 590.466 547.647 587.433 548.903C584.4 550.16 581.644 552.001 579.322 554.322C577.001 556.644 575.16 559.4 573.903 562.433C572.647 565.466 572 568.717 572 572H547C547 565.434 548.293 558.932 550.806 552.866C553.318 546.8 557.002 541.287 561.645 536.645C566.287 532.002 571.8 528.318 577.866 525.806C583.932 523.293 590.434 522 597 522V547Z",
  "M522 572C522 568.717 521.353 565.466 520.097 562.433C518.84 559.4 516.999 556.644 514.678 554.322C512.356 552.001 509.6 550.16 506.567 548.903C503.534 547.647 500.283 547 497 547V522C503.566 522 510.068 523.293 516.134 525.806C522.2 528.318 527.713 532.002 532.355 536.645C536.998 541.287 540.682 546.8 543.194 552.866C545.707 558.932 547 565.434 547 572H522Z",
  "M497 497C500.283 497 503.534 496.353 506.567 495.097C509.6 493.84 512.356 491.999 514.678 489.678C516.999 487.356 518.84 484.6 520.097 481.567C521.353 478.534 522 475.283 522 472H547C547 478.566 545.707 485.068 543.194 491.134C540.682 497.2 536.998 502.713 532.355 507.355C527.713 511.998 522.2 515.682 516.134 518.194C510.068 520.707 503.566 522 497 522V497Z",
];

const CONNECT_PATHS = [
  "M727 497C723.717 497 720.466 496.353 717.433 495.097C714.4 493.84 711.644 491.999 709.322 489.678C707.001 487.356 705.16 484.6 703.903 481.567C702.647 478.534 702 475.283 702 472H677C677 478.566 678.293 485.068 680.806 491.134C683.318 497.2 687.002 502.713 691.645 507.355C696.287 511.998 701.8 515.682 707.866 518.194C713.932 520.707 720.434 522 727 522V497Z",
  "M627 497C630.283 497 633.534 496.353 636.567 495.097C639.6 493.84 642.356 491.999 644.678 489.678C646.999 487.356 648.84 484.6 650.097 481.567C651.353 478.534 652 475.283 652 472H677C677 478.566 675.707 485.068 673.194 491.134C670.682 497.2 666.998 502.713 662.355 507.355C657.713 511.998 652.2 515.682 646.134 518.194C640.068 520.707 633.566 522 627 522V497Z",
  "M627 547C630.283 547 633.534 546.353 636.567 545.097C639.6 543.84 642.356 541.999 644.678 539.678C646.999 537.356 648.84 534.6 650.097 531.567C651.353 528.534 652 525.283 652 522H677C677 528.566 675.707 535.068 673.194 541.134C670.682 547.2 666.998 552.713 662.355 557.355C657.713 561.998 652.2 565.682 646.134 568.194C640.068 570.707 633.566 572 627 572V547Z",
  "M727 547C723.717 547 720.466 546.353 717.433 545.097C714.4 543.84 711.644 541.999 709.322 539.678C707.001 537.356 705.16 534.6 703.903 531.567C702.647 528.534 702 525.283 702 522H677C677 528.566 678.293 535.068 680.806 541.134C683.318 547.2 687.002 552.713 691.645 557.355C696.287 561.998 701.8 565.682 707.866 568.194C713.932 570.707 720.434 572 727 572V547Z",
];

const PROFILE_PATHS = [
  "M742 547C745.283 547 748.534 547.647 751.567 548.903C754.6 550.16 757.356 552.001 759.678 554.322C761.999 556.644 763.84 559.4 765.097 562.433C766.353 565.466 767 568.717 767 572H792C792 565.434 790.707 558.932 788.194 552.866C785.682 546.8 781.998 541.287 777.355 536.645C772.713 532.002 767.2 528.318 761.134 525.806C755.068 523.293 748.566 522 742 522V547Z",
  "M842 547C838.717 547 835.466 547.647 832.433 548.903C829.4 550.16 826.644 552.001 824.322 554.322C822.001 556.644 820.16 559.4 818.903 562.433C817.647 565.466 817 568.717 817 572H792C792 565.434 793.293 558.932 795.806 552.866C798.318 546.8 802.002 541.287 806.645 536.645C811.287 532.002 816.8 528.318 822.866 525.806C828.932 523.293 835.434 522 842 522V547Z",
  "M792 497C795.283 497 798.534 497.647 801.567 498.903C804.6 500.16 807.356 502.001 809.678 504.322C811.999 506.644 813.84 509.4 815.097 512.433C816.353 515.466 817 518.717 817 522H842C842 515.434 840.707 508.932 838.194 502.866C835.682 496.8 831.998 491.287 827.355 486.645C822.713 482.002 817.2 478.318 811.134 475.806C805.068 473.293 798.566 472 792 472V497Z",
  "M792 497C788.717 497 785.466 497.647 782.433 498.903C779.4 500.16 776.644 502.001 774.322 504.322C772.001 506.644 770.16 509.4 768.903 512.433C767.647 515.466 767 518.717 767 522H742C742 515.434 743.293 508.932 745.806 502.866C748.318 496.8 752.002 491.287 756.645 486.645C761.287 482.002 766.8 478.318 772.866 475.806C778.932 473.293 785.434 472 792 472V497Z",
];

const SETTINGS_PATHS = [
  "M857 547C860.283 547 863.534 547.647 866.567 548.903C869.6 550.16 872.356 552.001 874.678 554.322C876.999 556.644 878.84 559.4 880.097 562.433C881.353 565.466 882 568.717 882 572H907C907 565.434 905.707 558.932 903.194 552.866C900.682 546.8 896.998 541.287 892.355 536.645C887.713 532.002 882.2 528.318 876.134 525.806C870.068 523.293 863.566 522 857 522V547Z",
  "M907 547C910.283 547 913.534 546.353 916.567 545.097C919.6 543.84 922.356 541.999 924.678 539.678C926.999 537.356 928.84 534.6 930.097 531.567C931.353 528.534 932 525.283 932 522H957C957 528.566 955.707 535.068 953.194 541.134C950.682 547.2 946.998 552.713 942.355 557.355C937.713 561.998 932.2 565.682 926.134 568.194C920.068 570.707 913.566 572 907 572V547Z",
  "M907 497C903.717 497 900.466 497.647 897.433 498.903C894.4 500.16 891.644 502.001 889.322 504.322C887.001 506.644 885.16 509.4 883.903 512.433C882.647 515.466 882 518.717 882 522H857C857 515.434 858.293 508.932 860.806 502.866C863.318 496.8 867.002 491.287 871.645 486.645C876.287 482.002 881.8 478.318 887.866 475.806C893.932 473.293 900.434 472 907 472V497Z",
  "M957 497C953.717 497 950.466 496.353 947.433 495.097C944.4 493.84 941.644 491.999 939.322 489.678C937.001 487.356 935.16 484.6 933.903 481.567C932.647 478.534 932 475.283 932 472H907C907 478.566 908.293 485.068 910.806 491.134C913.318 497.2 917.002 502.713 921.645 507.355C926.287 511.998 931.8 515.682 937.866 518.194C943.932 520.707 950.434 522 957 522V497Z",
];

export function DashboardPage({ user, onLogout }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [roomNameInput, setRoomNameInput] = useState("");
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileUsernameInput, setProfileUsernameInput] = useState("");
  const [profileEmailInput, setProfileEmailInput] = useState("");
  const [profilePasswordInput, setProfilePasswordInput] = useState("");
  const [profileInitialUsername, setProfileInitialUsername] = useState("");
  const [profileInitialEmail, setProfileInitialEmail] = useState("");
  const [activeRooms, setActiveRooms] = useState<any[]>([]);
  const [activeRoomsLoading, setActiveRoomsLoading] = useState(false);
  const getInitialThemeMode = (): ThemeMode => {
    const saved = localStorage.getItem("voco_theme_mode");
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
    return "system";
  };
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => {
    const mode = getInitialThemeMode();
    return mode === "system" ? getSystemTheme() : mode;
  });
  const navigate = useNavigate();
  const isGuestUser = user?.id === "guest" || user?.email === "guest@local";

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      if (themeMode === "system") {
        setResolvedTheme(media.matches ? "dark" : "light");
        return;
      }
      setResolvedTheme(themeMode);
    };

    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themeMode]);

  useEffect(() => {
    localStorage.setItem("voco_theme_mode", themeMode);
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    if (!joinOpen) return;

    let cancelled = false;
    const loadRooms = async () => {
      try {
        setActiveRoomsLoading(true);
        const data = await api.getRooms();
        if (!cancelled) {
          setActiveRooms(Array.isArray(data?.rooms) ? data.rooms : []);
        }
      } catch {
        if (!cancelled) {
          setActiveRooms([]);
        }
      } finally {
        if (!cancelled) {
          setActiveRoomsLoading(false);
        }
      }
    };

    loadRooms();
    return () => {
      cancelled = true;
    };
  }, [joinOpen]);

  const handleCreateRoom = () => {
    setRoomNameInput("");
    setJoinOpen(false);
    setCreateOpen(true);
  };

  const handleCreateRoomSubmit = async () => {
    if (!roomNameInput.trim()) return;
    setError("");
    setLoading(true);

    try {
      const data = await api.createRoom(roomNameInput.trim());
      setCreateOpen(false);
      navigate(`/room/${data.room.slug}`);
    } catch (err: any) {
      setError(err?.message || "Не удалось создать комнату");
    } finally {
      setLoading(false);
    }
  };

  const handleJoinBySlug = () => {
    setJoinCodeInput("");
    setCreateOpen(false);
    setJoinOpen(true);
  };

  const handleJoinSubmit = () => {
    if (!joinCodeInput.trim()) return;
    navigate(`/room/${joinCodeInput.trim()}`);
    setJoinOpen(false);
  };

  const handleProfile = () => {
    if (isGuestUser) {
      onLogout();
      navigate("/register");
      return;
    }
    setCreateOpen(false);
    setJoinOpen(false);
    setSettingsOpen(false);
    const initialUsername = user?.username || "";
    const initialEmail = user?.email || "";
    setProfileInitialUsername(initialUsername);
    setProfileInitialEmail(initialEmail);
    setProfileUsernameInput(initialUsername);
    setProfileEmailInput(initialEmail);
    setProfilePasswordInput("");
    setProfileOpen(true);
  };

  const handleSettings = () => {
    setSettingsOpen(true);
  };

  const handleProfileSave = () => {
    const current = localStorage.getItem("voco_user");
    const parsed = current ? JSON.parse(current) : {};
    const updatedUser = {
      ...parsed,
      ...user,
      username: profileUsernameInput.trim() || parsed?.username || user?.username || "",
      email: profileEmailInput.trim() || parsed?.email || user?.email || "",
    };
    localStorage.setItem("voco_user", JSON.stringify(updatedUser));
    setProfilePasswordInput("");
    setProfileOpen(false);
  };

  const profileName = profileUsernameInput.trim() || user?.username || "Иван Иванов";
  const profileInitials = profileName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]?.toUpperCase() || "")
    .join("") || "ИИ";
  const profileHasChanges =
    profileUsernameInput.trim() !== profileInitialUsername.trim() ||
    profileEmailInput.trim() !== profileInitialEmail.trim() ||
    profilePasswordInput.trim().length > 0;

  const isStaging = window.location.hostname === "voco.su";

  return (
    <main className={`screen ${resolvedTheme === "dark" ? "theme-dark" : "theme-light"}`}>
      {isStaging && (
        <div className="staging-banner">
          ТЕСТОВЫЙ СЕРВЕР — стабильная версия проекта на{" "}
          <a href="https://voco-meet.ru" target="_blank" rel="noopener noreferrer">
            voco-meet.ru
          </a>
        </div>
      )}
      {error && <div className="menu-error">{error}</div>}

      <section className="content" aria-label="Главная зона">
        <div className="menu-core" aria-label="VOCO core menu">
          <img
            className="menu-core-source menu-core-source--light"
            src="/voco-main-clean.svg"
            alt=""
            aria-hidden="true"
            width={1440}
            height={900}
          />
          <img
            className="menu-core-source menu-core-source--dark"
            src="/voco-main-black.svg"
            alt=""
            aria-hidden="true"
            width={1440}
            height={900}
          />
          <img
            className="menu-core-source menu-core-source--dark-mobile"
            src="/voco-main-stage-dark-mobile.svg"
            alt=""
            aria-hidden="true"
            width={370}
            height={744}
          />

          <div className="menu-brand" aria-hidden="true">
            <div className="menu-brand-logo menu-brand-logo--light">
              <VocoLogo tone="light" />
            </div>
            <div className="menu-brand-logo menu-brand-logo--dark">
              <VocoLogo tone="dark" />
            </div>
          </div>

          <div className="menu-mobile-brand" aria-hidden="true">
            <div className="menu-mobile-brand-logo menu-mobile-brand-logo--light">
              <VocoLogo tone="light" size="mobile" />
            </div>
            <div className="menu-mobile-brand-logo menu-mobile-brand-logo--dark">
              <VocoLogo tone="dark" size="mobile" />
            </div>
          </div>

          <div className="menu-core-stripes" aria-hidden="true">
            <div className="menu-stripe-zone menu-stripe-zone--top">
              <div className="menu-stripe mask" />
              <div className="menu-stripe menu-stripe-create" />
              <div className="menu-stripe menu-stripe-connect" />
              <div className="menu-stripe menu-stripe-profile" />
              <div className="menu-stripe menu-stripe-settings" />
            </div>
            <div className="menu-stripe-zone menu-stripe-zone--bottom">
              <div className="menu-stripe mask" />
              <div className="menu-stripe menu-stripe-create" />
              <div className="menu-stripe menu-stripe-connect" />
              <div className="menu-stripe menu-stripe-profile" />
              <div className="menu-stripe menu-stripe-settings" />
            </div>
          </div>

          <div className="menu-buttons" aria-label="Главное меню">
            <button
              className="menu-button menu-button--3d button-create"
              type="button"
              aria-label="Создать конференцию"
              onClick={handleCreateRoom}
              disabled={loading}
            >
              <MenuIcon viewBox="497 472 100 100" paths={CREATE_PATHS} />
              <span className="menu-button-text" data-text="Создать конференцию">
                Создать
                <br />
                конференцию
              </span>
            </button>

            <button
              className="menu-button menu-button--3d button-connect"
              type="button"
              aria-label="Подключиться"
              onClick={handleJoinBySlug}
            >
              <MenuIcon viewBox="627 472 100 100" paths={CONNECT_PATHS} />
              <span className="menu-button-text" data-text="Подключиться">
                Подключиться
              </span>
            </button>

            <button
              className="menu-button menu-button--3d button-profile"
              type="button"
              aria-label="Профиль"
              onClick={handleProfile}
            >
              <MenuIcon viewBox="742 472 100 100" paths={PROFILE_PATHS} />
              <span className="menu-button-text" data-text="Профиль">
                Профиль
              </span>
            </button>

            <button
              className="menu-button menu-button--3d button-settings"
              type="button"
              aria-label="Настройки"
              onClick={handleSettings}
            >
              <MenuIcon viewBox="857 472 100 100" paths={SETTINGS_PATHS} />
              <span className="menu-button-text" data-text="Настройки">
                Настройки
              </span>
            </button>
          </div>
        </div>
      </section>
      {settingsOpen && (
        <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Настройки">
          <div className="settings-bg-icons" aria-hidden="true" />
          <section className="settings-panel">
            <div className="settings-header">
              <h2>Настройки</h2>
              <button
                className="settings-close"
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Закрыть настройки"
              />
            </div>

            <p className="settings-label">Тема</p>

            <div className="theme-buttons">
              <button
                type="button"
                className={`theme-button ${themeMode === "light" ? "is-active" : ""}`}
                onClick={() => setThemeMode("light")}
              >
                Светлая
              </button>
              <button
                type="button"
                className={`theme-button ${themeMode === "dark" ? "is-active" : ""}`}
                onClick={() => setThemeMode("dark")}
              >
                Тёмная
              </button>
              <button
                type="button"
                className={`theme-button ${themeMode === "system" ? "is-active" : ""}`}
                onClick={() => setThemeMode("system")}
              >
                Системная
              </button>
            </div>
          </section>
        </div>
      )}
      {createOpen && (
        <div className="create-overlay" role="dialog" aria-modal="true" aria-label="Новая комната">
          <div className="create-bg-icons" aria-hidden="true" />
          <section className="create-panel">
            <div className="create-header">
              <h2>Новая комната</h2>
              <button
                className="create-close"
                type="button"
                onClick={() => setCreateOpen(false)}
                aria-label="Закрыть создание комнаты"
              />
            </div>

            <label className="create-label" htmlFor="new-room-name">
              Название комнаты
            </label>
            <input
              id="new-room-name"
              className="create-input"
              value={roomNameInput}
              onChange={(e) => setRoomNameInput(e.target.value)}
              placeholder="my room"
              maxLength={100}
              autoFocus
            />

            <button
              className="create-submit"
              type="button"
              onClick={handleCreateRoomSubmit}
              disabled={loading || !roomNameInput.trim()}
            >
              Создать
            </button>
          </section>
        </div>
      )}
      {joinOpen && (
        <div className="join-overlay" role="dialog" aria-modal="true" aria-label="Присоединиться">
          <div className="join-bg-icons" aria-hidden="true" />
          <section className="join-panel">
            <div className="join-header">
              <h2>Присоединиться</h2>
              <button
                className="join-close"
                type="button"
                onClick={() => setJoinOpen(false)}
                aria-label="Закрыть присоединение"
              />
            </div>

            <label className="join-label" htmlFor="join-room-code">
              Код комнаты
            </label>
            <input
              id="join-room-code"
              className="join-input"
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value)}
              placeholder="ABC123"
              maxLength={120}
              autoFocus
            />

            <button
              className="join-submit"
              type="button"
              onClick={handleJoinSubmit}
              disabled={!joinCodeInput.trim()}
            >
              Войти
            </button>

            <p className="join-active-label">Недавние комнаты</p>
            <section className="join-active-rooms" aria-label="Недавние комнаты">
              {activeRoomsLoading && <p className="join-rooms-hint">Загрузка комнат...</p>}
              {!activeRoomsLoading && activeRooms.length === 0 && (
                <p className="join-rooms-hint">Нет недавних комнат</p>
              )}
              {!activeRoomsLoading && activeRooms.length > 0 && (
                <ul className="join-rooms-list">
                  {activeRooms.slice(0, 4).map((room) => (
                    <li key={room.id} className="join-room-item">
                      <button
                        type="button"
                        className="join-room-link"
                        onClick={() => navigate(`/room/${room.slug}`)}
                      >
                        <span className="join-room-name">{room.name}</span>
                        <span className="join-room-code">{room.slug}</span>
                        <span className="join-room-count">{room?._count?.participants ?? 0}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </section>
        </div>
      )}
      {profileOpen && (
        <div className="profile-overlay" role="dialog" aria-modal="true" aria-label="Профиль">
          <div className="profile-bg-icons" aria-hidden="true" />
          <section className="profile-panel">
            <div className="profile-header">
              <h2 className="profile-title">Профиль</h2>
              <button
                className="profile-close"
                type="button"
                onClick={() => setProfileOpen(false)}
                aria-label="Закрыть профиль"
              />
            </div>

            <div className="profile-avatar" aria-hidden="true">
              {profileInitials}
            </div>
            <p className="profile-name">{profileName}</p>

            <p className="profile-edit-title">Редактирование профиля</p>

            <label className="profile-label profile-label-username" htmlFor="profile-username">
              Имя пользователя
            </label>
            <input
              id="profile-username"
              className="profile-input profile-input-username"
              value={profileUsernameInput}
              onChange={(e) => setProfileUsernameInput(e.target.value)}
              placeholder="yourusername"
              maxLength={120}
            />

            <label className="profile-label profile-label-email" htmlFor="profile-email">
              Почта
            </label>
            <input
              id="profile-email"
              type="email"
              className="profile-input profile-input-email"
              value={profileEmailInput}
              onChange={(e) => setProfileEmailInput(e.target.value)}
              placeholder="your@email.com"
              maxLength={180}
            />

            <label className="profile-label profile-label-password" htmlFor="profile-password">
              Пароль
            </label>
            <input
              id="profile-password"
              type="password"
              className="profile-input profile-input-password"
              value={profilePasswordInput}
              onChange={(e) => setProfilePasswordInput(e.target.value)}
              placeholder="yourpassword"
              maxLength={120}
            />

            <button
              className="profile-save"
              type="button"
              onClick={handleProfileSave}
              disabled={!profileHasChanges}
            >
              Сохранить
            </button>

            <button className="profile-logout" type="button" onClick={onLogout}>
              Выйти
            </button>
          </section>
        </div>
      )}
      <footer className="footer" aria-label="Подвал" />
    </main>
  );
}



