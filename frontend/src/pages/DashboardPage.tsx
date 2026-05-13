import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { VocoLogo } from "../components/VocoLogo";
import { downloadRoomReportPdf, type RoomReport } from "../lib/roomReport";
import "./Dashboard.css";

interface Props {
  user: any;
  onLogout: () => void;
  onUserUpdate?: (user: any) => void;
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
  "M720 597C723.283 597 726.534 597.647 729.567 598.903C732.6 600.16 735.356 602.001 737.678 604.322C739.999 606.644 741.84 609.4 743.097 612.433C744.353 615.466 745 618.717 745 622H770C770 615.434 768.707 608.932 766.194 602.866C763.682 596.8 759.998 591.287 755.355 586.645C750.713 582.002 745.2 578.318 739.134 575.806C733.068 573.293 726.566 572 720 572V597Z",
  "M820 597C816.717 597 813.466 597.647 810.433 598.903C807.4 600.16 804.644 602.001 802.322 604.322C800.001 606.644 798.16 609.4 796.903 612.433C795.647 615.466 795 618.717 795 622H770C770 615.434 771.293 608.932 773.806 602.866C776.318 596.8 780.002 591.287 784.645 586.645C789.287 582.002 794.8 578.318 800.866 575.806C806.932 573.293 813.434 572 820 572V597Z",
  "M770 547C773.283 547 776.534 547.647 779.567 548.903C782.6 550.16 785.356 552.001 787.678 554.322C789.999 556.644 791.84 559.4 793.097 562.433C794.353 565.466 795 568.717 795 572H820C820 565.434 818.707 558.932 816.194 552.866C813.682 546.8 809.998 541.287 805.355 536.645C800.713 532.002 795.2 528.318 789.134 525.806C783.068 523.293 776.566 522 770 522V547Z",
  "M820 572C820 565.434 818.707 558.932 816.194 552.866C813.681 546.8 809.998 541.288 805.355 536.645C800.712 532.002 795.2 528.319 789.134 525.806C783.068 523.293 776.566 522 770 522C763.434 522 756.932 523.293 750.866 525.806C744.8 528.319 739.288 532.002 734.645 536.645C730.002 541.288 726.319 546.8 723.806 552.866C721.293 558.932 720 565.434 720 572L745 572C745 568.717 745.647 565.466 746.903 562.433C748.159 559.4 750.001 556.644 752.322 554.322C754.644 552.001 757.4 550.159 760.433 548.903C763.466 547.647 766.717 547 770 547C773.283 547 776.534 547.647 779.567 548.903C782.6 550.159 785.356 552.001 787.678 554.322C789.999 556.644 791.841 559.4 793.097 562.433C794.353 565.466 795 568.717 795 572H820Z",
];

const SETTINGS_PATHS = [
  "M857 547C860.283 547 863.534 547.647 866.567 548.903C869.6 550.16 872.356 552.001 874.678 554.322C876.999 556.644 878.84 559.4 880.097 562.433C881.353 565.466 882 568.717 882 572H907C907 565.434 905.707 558.932 903.194 552.866C900.682 546.8 896.998 541.287 892.355 536.645C887.713 532.002 882.2 528.318 876.134 525.806C870.068 523.293 863.566 522 857 522V547Z",
  "M907 547C910.283 547 913.534 546.353 916.567 545.097C919.6 543.84 922.356 541.999 924.678 539.678C926.999 537.356 928.84 534.6 930.097 531.567C931.353 528.534 932 525.283 932 522H957C957 528.566 955.707 535.068 953.194 541.134C950.682 547.2 946.998 552.713 942.355 557.355C937.713 561.998 932.2 565.682 926.134 568.194C920.068 570.707 913.566 572 907 572V547Z",
  "M907 497C903.717 497 900.466 497.647 897.433 498.903C894.4 500.16 891.644 502.001 889.322 504.322C887.001 506.644 885.16 509.4 883.903 512.433C882.647 515.466 882 518.717 882 522H857C857 515.434 858.293 508.932 860.806 502.866C863.318 496.8 867.002 491.287 871.645 486.645C876.287 482.002 881.8 478.318 887.866 475.806C893.932 473.293 900.434 472 907 472V497Z",
  "M957 497C953.717 497 950.466 496.353 947.433 495.097C944.4 493.84 941.644 491.999 939.322 489.678C937.001 487.356 935.16 484.6 933.903 481.567C932.647 478.534 932 475.283 932 472H907C907 478.566 908.293 485.068 910.806 491.134C913.318 497.2 917.002 502.713 921.645 507.355C926.287 511.998 931.8 515.682 937.866 518.194C943.932 520.707 950.434 522 957 522V497Z",
];

const PROFILE_AVATAR_OPTIONS = [
  "._.",
  ":)",
  ":(",
  "=)",
  "=(",
  ";)",
  ":D",
  "XD",
  ":P",
  ":O",
  ":/",
  ":|",
  "^_^",
  "-_-",
  "o_O",
  "o_o",
  "O_O",
  "x_x",
  ">_<",
  ":3",
  "<3",
] as const;

export function DashboardPage({ user, onLogout, onUserUpdate }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [roomNameInput, setRoomNameInput] = useState("");
  const [maxUsersInput, setMaxUsersInput] = useState("");
  const [allowGuests, setAllowGuests] = useState(true);
  const [requireApproval, setRequireRequest] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [closedRoomActionLoading, setClosedRoomActionLoading] = useState("");
  const [closedRoomMenuOpen, setClosedRoomMenuOpen] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileUsernameInput, setProfileUsernameInput] = useState("");
  const [profileEmailInput, setProfileEmailInput] = useState("");
  const [profilePasswordInput, setProfilePasswordInput] = useState("");
  const [profileAvatarInput, setProfileAvatarInput] = useState("");
  const [profileInitialUsername, setProfileInitialUsername] = useState("");
  const [profileInitialEmail, setProfileInitialEmail] = useState("");
  const [profileInitialAvatar, setProfileInitialAvatar] = useState("");
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [activeRooms, setActiveRooms] = useState<any[]>([]);
  const [activeRoomsLoading, setActiveRoomsLoading] = useState(false);
  const [showHiddenRooms, setShowHiddenRooms] = useState(false);
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
  const [isTabletViewport, setIsTabletViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 768px) and (max-width: 1220px)").matches;
  });
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });
  const createIconSrc = isMobileViewport
    ? resolvedTheme === "dark"
      ? "/create-page-mobile-dark.svg"
      : "/create-page-mobile-light.svg"
    : isTabletViewport
      ? resolvedTheme === "dark"
        ? "/create-page-tablet-dark.svg"
        : "/create-page-tablet-light.svg"
      : resolvedTheme === "dark"
        ? "/create-page-dark.svg"
        : "/create-page-light.svg";
  const joinTopIconSrc =
    resolvedTheme === "dark" ? "/join-icons-top-dark.svg" : "/join-icons-top.svg";
  const joinBottomIconSrc =
    resolvedTheme === "dark" ? "/join-icons-bottom-dark.svg" : "/join-icons-bottom.svg";
  const joinMobileIconSrc =
    resolvedTheme === "dark" ? "/join-icons-mobile-dark.svg" : "/join-icons-mobile-light.svg";
  const joinTabletIconSrc =
    resolvedTheme === "dark" ? "/join-icons-tablet-dark.svg" : "/join-icons-tablet-light.svg";
  const joinPageIconSrc =
    !isMobileViewport && !isTabletViewport && resolvedTheme === "light"
      ? "/join-page-light.svg"
      : "";
  const profileTopIconSrc = isMobileViewport
    ? resolvedTheme === "dark"
      ? "/profile-icons-mobile-top-dark.svg"
      : "/profile-icons-mobile-top-light.svg"
    : isTabletViewport
      ? "/profile-icons-tablet.svg"
      : resolvedTheme === "dark"
        ? "/profile-icons-top-dark.svg"
        : "/profile-icons-top.svg";
  const profileBottomIconSrc = isMobileViewport
    ? resolvedTheme === "dark"
      ? "/profile-icons-mobile-bottom-dark.svg"
      : "/profile-icons-mobile-bottom-light.svg"
    : isTabletViewport
      ? "/profile-icons-tablet.svg"
      : resolvedTheme === "dark"
        ? "/profile-icons-bottom-dark.svg"
        : "/profile-icons-bottom.svg";
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
    const media = window.matchMedia("(min-width: 768px) and (max-width: 1220px)");
    const apply = () => setIsTabletViewport(media.matches);

    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobileViewport(media.matches);

    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    localStorage.setItem("voco_theme_mode", themeMode);
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    if (!joinOpen) {
      setClosedRoomMenuOpen("");
      setShowHiddenRooms(false);
      return;
    }

    let cancelled = false;
    const loadRooms = async () => {
      try {
        setActiveRoomsLoading(true);
        const data = await api.getRooms({ includeHidden: showHiddenRooms });
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
  }, [joinOpen, showHiddenRooms]);

  const handleCreateRoom = () => {
    setRoomNameInput("");
    setMaxUsersInput("");
    setAllowGuests(true);
    setRequireRequest(false);
    setJoinOpen(false);
    setCreateOpen(true);
  };

  const handleCreateRoomSubmit = async () => {
    if (!roomNameInput.trim()) return;
    setError("");
    setLoading(true);

    const parsedMax = Number.parseInt(maxUsersInput.trim(), 10);
    const options: { maxUsers?: number; allowGuests?: boolean; requireApproval?: boolean } = {
      allowGuests,
      requireApproval,
    };
    if (Number.isFinite(parsedMax) && parsedMax >= 2) {
      options.maxUsers = parsedMax;
    }

    try {
      const data: any = await api.createRoom(roomNameInput.trim(), options);
      setCreateOpen(false);
      navigate(`/room/${data.room.slug}`);
    } catch (err: any) {
      setError(err?.message || "Не удалось создать комнату");
    } finally {
      setLoading(false);
    }
  };

  const handleJoinBySlug = () => {
    setJoinError("");
    setJoinCodeInput("");
    setCreateOpen(false);
    setJoinOpen(true);
  };

  const handleJoinSubmit = async () => {
    if (!joinCodeInput.trim()) return;
    setJoinError("");
    setJoinLoading(true);

    try {
      const slug = joinCodeInput.trim();
      await api.getRoom(slug);
      navigate(`/room/${slug}`);
      setJoinOpen(false);
    } catch (err: any) {
      setJoinError(err?.message || "Ошибка входа");
    } finally {
      setJoinLoading(false);
    }
  };

  const recentRooms = activeRooms;

  const handleClosedRoomVideo = (room: any) => {
    setJoinError(`Видеозапись комнаты «${room?.name ?? "Комната"}» недоступна`);
  };

  const handleClosedRoomReport = async (room: any) => {
    if (!room?.slug || closedRoomActionLoading) return;
    setJoinError("");
    setClosedRoomActionLoading(`report:${room.slug}`);
    try {
      const data: any = await api.getRoomReport(room.slug);
      await downloadRoomReportPdf(data.report as RoomReport);
    } catch (err: any) {
      setJoinError(err?.message || "Не удалось скачать отчёт");
    } finally {
      setClosedRoomActionLoading("");
    }
  };

  const handleClosedRoomDelete = async (room: any) => {
    if (!room?.slug || closedRoomActionLoading) return;
    setJoinError("");
    setClosedRoomMenuOpen("");
    setClosedRoomActionLoading(`delete:${room.slug}`);
    try {
      await api.deleteRoom(room.slug);
      setActiveRooms((rooms) => rooms.filter((item) => item.id !== room.id));
    } catch (err: any) {
      setJoinError(err?.message || "Не удалось удалить комнату");
    } finally {
      setClosedRoomActionLoading("");
    }
  };

  const handleActiveRoomClose = async (room: any) => {
    if (!room?.slug || closedRoomActionLoading) return;
    setJoinError("");
    setClosedRoomMenuOpen("");
    setClosedRoomActionLoading(`close:${room.slug}`);
    try {
      await api.deleteRoom(room.slug);
      // комната становится закрытой; обновим её локально, чтобы UI поменялся без повторного запроса
      setActiveRooms((rooms) =>
        rooms.map((item) =>
          item.id === room.id
            ? { ...item, isActive: false, closedAt: new Date().toISOString() }
            : item,
        ),
      );
    } catch (err: any) {
      setJoinError(err?.message || "Не удалось закрыть комнату");
    } finally {
      setClosedRoomActionLoading("");
    }
  };

  const handleHideRoom = async (room: any) => {
    if (!room?.slug || closedRoomActionLoading) return;
    setJoinError("");
    setClosedRoomActionLoading(`hide:${room.slug}`);
    try {
      await api.hideRoom(room.slug);
      if (showHiddenRooms) {
        // в режиме «показать скрытые» оставляем строку, помечая её скрытой
        setActiveRooms((rooms) =>
          rooms.map((item) => (item.id === room.id ? { ...item, hidden: true } : item)),
        );
      } else {
        setActiveRooms((rooms) => rooms.filter((item) => item.id !== room.id));
      }
    } catch (err: any) {
      setJoinError(err?.message || "Не удалось скрыть комнату");
    } finally {
      setClosedRoomActionLoading("");
    }
  };

  const handleUnhideRoom = async (room: any) => {
    if (!room?.slug || closedRoomActionLoading) return;
    setJoinError("");
    setClosedRoomActionLoading(`hide:${room.slug}`);
    try {
      await api.unhideRoom(room.slug);
      setActiveRooms((rooms) =>
        rooms.map((item) => (item.id === room.id ? { ...item, hidden: false } : item)),
      );
    } catch (err: any) {
      setJoinError(err?.message || "Не удалось вернуть комнату");
    } finally {
      setClosedRoomActionLoading("");
    }
  };

  const handleClosedRoomRestore = async (room: any) => {
    if (!room?.slug || closedRoomActionLoading) return;
    setJoinError("");
    setClosedRoomMenuOpen("");
    setClosedRoomActionLoading(`restore:${room.slug}`);
    try {
      const data: any = await api.restoreRoom(room.slug);
      setActiveRooms((rooms) =>
        rooms.map((item) =>
          item.id === room.id
            ? { ...item, ...(data?.room ?? {}), isActive: true, closedAt: null }
            : item,
        ),
      );
    } catch (err: any) {
      setJoinError(err?.message || "Не удалось восстановить комнату");
    } finally {
      setClosedRoomActionLoading("");
    }
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
    const initialAvatar =
      typeof user?.avatarUrl === "string" &&
      PROFILE_AVATAR_OPTIONS.includes(user.avatarUrl as (typeof PROFILE_AVATAR_OPTIONS)[number])
        ? user.avatarUrl
        : "";
    setProfileInitialUsername(initialUsername);
    setProfileInitialEmail(initialEmail);
    setProfileInitialAvatar(initialAvatar);
    setProfileUsernameInput(initialUsername);
    setProfileEmailInput(initialEmail);
    setProfilePasswordInput("");
    setProfileAvatarInput(initialAvatar);
    setAvatarPickerOpen(false);
    setProfileOpen(true);
  };

  const handleSettings = () => {
    setSettingsOpen(true);
  };

  const handleProfileSave = async () => {
    const trimmedUsername = profileUsernameInput.trim();
    const trimmedEmail = profileEmailInput.trim();
    const trimmedPassword = profilePasswordInput.trim();

    const payload: {
      username?: string;
      email?: string;
      password?: string;
      avatarUrl?: string | null;
    } = {};
    if (trimmedUsername && trimmedUsername !== profileInitialUsername.trim()) {
      payload.username = trimmedUsername;
    }
    if (trimmedEmail && trimmedEmail !== profileInitialEmail.trim()) {
      payload.email = trimmedEmail;
    }
    if (trimmedPassword) {
      payload.password = trimmedPassword;
    }
    const avatarChanged =
      profileAvatarInput !== profileInitialAvatar &&
      (profileAvatarInput === "" ||
        PROFILE_AVATAR_OPTIONS.includes(profileAvatarInput as (typeof PROFILE_AVATAR_OPTIONS)[number]));
    if (avatarChanged) {
      payload.avatarUrl = profileAvatarInput || null;
    }

    if (Object.keys(payload).length === 0) {
      setProfileOpen(false);
      return;
    }

    setError("");
    setProfileSaving(true);
    try {
      const data: any = await api.updateProfile(payload);
      if (data?.user) {
        onUserUpdate?.(data.user);
      }
      setProfilePasswordInput("");
      setAvatarPickerOpen(false);
      setProfileOpen(false);
    } catch (err: any) {
      setError(err?.message || "Не удалось сохранить профиль");
    } finally {
      setProfileSaving(false);
    }
  };

  const profileName = profileUsernameInput.trim() || user?.username || "Иван Иванов";
  const profileNameParts = profileName.split(/\s+/).filter(Boolean);
  const profileInitials = (() => {
    if (profileNameParts.length >= 2) {
      return (profileNameParts[0][0] + profileNameParts[1][0]).toUpperCase();
    }
    if (profileNameParts.length === 1) {
      return profileNameParts[0].slice(0, 2).toUpperCase();
    }
    return "ИИ";
  })();
  const profileAvatarText = PROFILE_AVATAR_OPTIONS.includes(
    profileAvatarInput as (typeof PROFILE_AVATAR_OPTIONS)[number],
  )
    ? profileAvatarInput
    : profileInitials;
  const profileAvatarPickerOptions = ["", ...PROFILE_AVATAR_OPTIONS] as const;
  const profileHasChanges =
    profileUsernameInput.trim() !== profileInitialUsername.trim() ||
    profileEmailInput.trim() !== profileInitialEmail.trim() ||
    profileAvatarInput.trim() !== profileInitialAvatar.trim() ||
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
              <MenuIcon viewBox="720 522 100 100" paths={PROFILE_PATHS} />
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
          <div className="settings-stage">
            <div className="settings-icons" aria-hidden="true" />
            <div className="settings-icons-bottom" aria-hidden="true" />
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

              <div className="settings-theme-group">
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
              </div>
            </section>
          </div>
        </div>
      )}
      {createOpen && (
        <div className="create-overlay" role="dialog" aria-modal="true" aria-label="Новая комната">
          <div className="create-stage">
            <img
              className="create-bg-icons"
              src={createIconSrc}
              alt=""
              aria-hidden="true"
            />
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

              <label className="create-label create-label-name" htmlFor="new-room-name">
                Название комнаты
              </label>
              <input
                id="new-room-name"
                className="create-input create-input-name"
                value={roomNameInput}
                onChange={(e) => setRoomNameInput(e.target.value)}
                placeholder="Название"
                maxLength={100}
                autoFocus
              />

              <label className="create-label create-label-max" htmlFor="new-room-max">
                Максимальное количество участников
              </label>
              <input
                id="new-room-max"
                className="create-input create-input-max"
                type="number"
                min={2}
                max={50}
                value={maxUsersInput}
                onChange={(e) => setMaxUsersInput(e.target.value)}
                placeholder="Количество"
              />

              <button
                type="button"
                className={`create-toggle-row create-toggle-guests ${allowGuests ? "is-on" : "is-off"}`}
                onClick={() => setAllowGuests((v) => !v)}
                aria-pressed={allowGuests}
              >
                <span className="create-toggle-text">Разрешить вход гостям</span>
                <span className="create-toggle-dot" aria-hidden="true" />
              </button>

              <button
                type="button"
                className={`create-toggle-row create-toggle-request ${requireApproval ? "is-on" : "is-off"}`}
                onClick={() => setRequireRequest((v) => !v)}
                aria-pressed={requireApproval}
              >
                <span className="create-toggle-text">Вход по запросу</span>
                <span className="create-toggle-dot" aria-hidden="true" />
              </button>

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
        </div>
      )}
      {joinOpen && (
        <div className="join-overlay" role="dialog" aria-modal="true" aria-label="Присоединиться">
          <div className="join-stage">
              <div className="join-bg-wrapper" aria-hidden="true">
                <img className="join-bg-icons join-bg-icons--mobile" src={joinMobileIconSrc} alt="" />
                <img className="join-bg-icons join-bg-icons--tablet" src={joinTabletIconSrc} alt="" />
                <img className="join-bg-icons join-bg-icons--top" src={joinTopIconSrc} alt="" />
                <img className="join-bg-icons join-bg-icons--center" src="/join-icons.svg" alt="" />
                <img className="join-bg-icons join-bg-icons--bottom" src={joinBottomIconSrc} alt="" />
                {joinPageIconSrc && (
                  <img className="join-bg-icons join-bg-icons--page" src={joinPageIconSrc} alt="" />
                )}
              </div>
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
                onChange={(e) => {
                  setJoinCodeInput(e.target.value);
                  if (joinError) setJoinError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && joinCodeInput.trim()) {
                    handleJoinSubmit();
                  }
                }}
                placeholder="Ab12CdEf34"
                maxLength={120}
                autoFocus
              />

              <div className={`join-error ${joinError ? "" : "join-error-hidden"}`} aria-live="polite">
                {joinError || "\u00A0"}
              </div>

              <button
                className="join-submit"
                type="button"
                onClick={handleJoinSubmit}
                disabled={joinLoading || !joinCodeInput.trim()}
              >
                {joinLoading ? "Входим..." : "Войти"}
              </button>

              <p className="join-active-label">Недавние комнаты</p>
              <section className="join-active-rooms" aria-label="Недавние комнаты">
                {activeRoomsLoading && <p className="join-rooms-hint">Загрузка комнат...</p>}
                {!activeRoomsLoading && (
                  <ul className="join-rooms-list">
                    {recentRooms.length === 0 ? (
                      <li className="join-room-item join-room-item--empty">
                        <span className="join-room-empty">Нет недавних комнат</span>
                      </li>
                    ) : (
                      recentRooms.map((room) => {
                        const isClosed = room?.isActive === false;
                        const isMine = Boolean(room?.owner?.id && user?.id && room.owner.id === user.id);
                        const isHidden = room?.hidden === true;
                        const canManageActive = isMine || room?.myRole === "MODERATOR";
                        const hideButton = (
                          <button
                            type="button"
                            className={`join-room-action ${isHidden ? "join-room-action--unhide" : "join-room-action--hide"}`}
                            aria-label={isHidden ? "Вернуть комнату в список" : "Скрыть комнату из списка"}
                            title={isHidden ? "Вернуть" : "Скрыть"}
                            disabled={closedRoomActionLoading === `hide:${room.slug}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (isHidden) void handleUnhideRoom(room);
                              else void handleHideRoom(room);
                            }}
                          />
                        );
                        const activeRoomManageActions = (
                          <span className="join-room-actions join-room-actions--single" aria-label="Действия комнаты">
                            <button
                              type="button"
                              className="join-room-action join-room-action--settings"
                              aria-label="Настройки комнаты"
                              aria-expanded={closedRoomMenuOpen === room.slug}
                              disabled={closedRoomActionLoading.startsWith(`close:${room.slug}`) || closedRoomActionLoading.startsWith(`hide:${room.slug}`)}
                              onClick={(event) => {
                                event.stopPropagation();
                                setClosedRoomMenuOpen((current) =>
                                  current === room.slug ? "" : room.slug,
                                );
                              }}
                            />
                            {closedRoomMenuOpen === room.slug && (
                              <span className="join-room-closed-menu" role="menu">
                                <button
                                  type="button"
                                  className={`join-room-closed-menu-button ${isHidden ? "join-room-closed-menu-button--unhide" : "join-room-closed-menu-button--hide"}`}
                                  role="menuitem"
                                  aria-label={isHidden ? "Вернуть комнату в список" : "Скрыть комнату из списка"}
                                  disabled={closedRoomActionLoading === `hide:${room.slug}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setClosedRoomMenuOpen("");
                                    if (isHidden) void handleUnhideRoom(room);
                                    else void handleHideRoom(room);
                                  }}
                                />
                                <button
                                  type="button"
                                  className="join-room-closed-menu-button join-room-closed-menu-button--close"
                                  role="menuitem"
                                  aria-label="Закрыть комнату"
                                  disabled={closedRoomActionLoading === `close:${room.slug}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleActiveRoomClose(room);
                                  }}
                                />
                              </span>
                            )}
                          </span>
                        );
                        const closedRoomActions = isClosed && isMine ? (
                          <span className="join-room-actions" aria-label="Действия закрытой комнаты">
                            <button
                              type="button"
                              className="join-room-action join-room-action--video"
                              aria-label="Видеозапись"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleClosedRoomVideo(room);
                              }}
                            />
                            <button
                              type="button"
                              className="join-room-action join-room-action--report"
                              aria-label="Скачать отчёт"
                              disabled={closedRoomActionLoading === `report:${room.slug}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleClosedRoomReport(room);
                              }}
                            />
                            <button
                              type="button"
                              className="join-room-action join-room-action--settings"
                              aria-label="Настройки закрытой комнаты"
                              aria-expanded={closedRoomMenuOpen === room.slug}
                              disabled={closedRoomActionLoading.startsWith(`restore:${room.slug}`) || closedRoomActionLoading.startsWith(`delete:${room.slug}`)}
                              onClick={(event) => {
                                event.stopPropagation();
                                setClosedRoomMenuOpen((current) =>
                                  current === room.slug ? "" : room.slug,
                                );
                              }}
                            />
                            {closedRoomMenuOpen === room.slug && (
                              <span className="join-room-closed-menu" role="menu">
                                <button
                                  type="button"
                                  className="join-room-closed-menu-button join-room-closed-menu-button--restore"
                                  role="menuitem"
                                  aria-label="Восстановить комнату"
                                  disabled={closedRoomActionLoading === `restore:${room.slug}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleClosedRoomRestore(room);
                                  }}
                                />
                                <button
                                  type="button"
                                  className="join-room-closed-menu-button join-room-closed-menu-button--delete"
                                  role="menuitem"
                                  aria-label="Удалить комнату"
                                  disabled={closedRoomActionLoading === `delete:${room.slug}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleClosedRoomDelete(room);
                                  }}
                                />
                              </span>
                            )}
                          </span>
                        ) : null;
                        return (
                          <li
                            key={room.id}
                            className={`join-room-item${isClosed ? " join-room-item--closed" : ""}${isHidden ? " join-room-item--hidden" : ""}`}
                          >
                            {isClosed ? (
                              <div className="join-room-link is-closed">
                                <span className="join-room-name">{room.name}</span>
                                {isMine ? closedRoomActions : (
                                  <span className="join-room-actions join-room-actions--hide-only" aria-label="Действия комнаты">
                                    {hideButton}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="join-room-link"
                                  onClick={() => {
                                    navigate(`/room/${room.slug}`);
                                    setJoinOpen(false);
                                  }}
                                >
                                  <span className="join-room-name">{room.name}</span>
                                  <span className="join-room-code">{room.slug}</span>
                                </button>
                                {canManageActive ? activeRoomManageActions : (
                                  <span className="join-room-actions join-room-actions--hide-only" aria-label="Действия комнаты">
                                    {hideButton}
                                  </span>
                                )}
                              </>
                            )}
                          </li>
                        );
                      })
                    )}
                  </ul>
                )}
                <button
                  type="button"
                  className="join-hidden-toggle"
                  onClick={() => setShowHiddenRooms((v) => !v)}
                >
                  {showHiddenRooms ? "Скрыть скрытые" : "Показать скрытые"}
                </button>
              </section>
            </section>
          </div>
        </div>
      )}
      {profileOpen && (
        <div className="profile-overlay" role="dialog" aria-modal="true" aria-label="Профиль">
          <div className="profile-stage">
            <section className="profile-panel">
              <img
                className="profile-bg-icons profile-bg-icons-top"
                src={profileTopIconSrc}
                alt=""
                aria-hidden="true"
              />
              <img
                className="profile-bg-icons profile-bg-icons-bottom"
                src={profileBottomIconSrc}
                alt=""
                aria-hidden="true"
              />
              <div className="profile-header">
                <h2 className="profile-title">Профиль</h2>
                <button
                  className="profile-close"
                  type="button"
                  onClick={() => setProfileOpen(false)}
                  aria-label="Закрыть профиль"
                />
              </div>

              <button
                className="profile-avatar"
                type="button"
                aria-label="Выбрать аватарку"
                aria-haspopup="listbox"
                aria-expanded={avatarPickerOpen}
                onClick={() => setAvatarPickerOpen((current) => !current)}
              >
                {profileAvatarText}
              </button>
              {avatarPickerOpen && (
                <div className="profile-avatar-picker" role="listbox" aria-label="Аватарки">
                  {profileAvatarPickerOptions.map((avatar) => (
                    <button
                      key={avatar || "initials"}
                      className={`profile-avatar-option${avatar === profileAvatarInput ? " is-selected" : ""}`}
                      type="button"
                      role="option"
                      aria-selected={avatar === profileAvatarInput}
                      aria-label={avatar ? `Выбрать аватарку ${avatar}` : "Использовать инициалы"}
                      onClick={() => {
                        setProfileAvatarInput(avatar);
                        setAvatarPickerOpen(false);
                      }}
                    >
                      {avatar || profileInitials}
                    </button>
                  ))}
                </div>
              )}
              <p className="profile-name">
                {profileNameParts.length >= 2 ? (
                  <>
                    {profileNameParts[0]}
                    <br />
                    {profileNameParts.slice(1).join(" ")}
                  </>
                ) : (
                  profileName
                )}
              </p>

                            <p className="profile-edit-title">Редактирование</p>

              <label className="profile-label profile-label-username" htmlFor="profile-username">
                Имя пользователя
              </label>
              <input
                id="profile-username"
                className="profile-input profile-input-username"
                value={profileUsernameInput}
                onChange={(e) => setProfileUsernameInput(e.target.value)}
                placeholder="Иван Иванов"
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
                placeholder="ivanivanov@email.com"
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
                placeholder="qwerty1234"
                maxLength={120}
              />

              <button
                className="profile-save"
                type="button"
                onClick={handleProfileSave}
                disabled={!profileHasChanges || profileSaving}
              >
                {profileSaving ? "Сохраняем..." : "Сохранить"}
              </button>

              <button className="profile-logout" type="button" onClick={onLogout}>
                Выйти
              </button>
            </section>
          </div>
        </div>
      )}
      <footer className="footer" aria-label="Подвал">
        <div className="footer-content">
          <img
            className="footer-image footer-image--light"
            src="/voco-footer-light.svg"
            alt="VOCO. Видеоконференции без границ. Разработчики: Ворожцов М.С., Горшков Н.В., Мельникова Д.А., Толмачев М.Р. © 2026 VOCO | help@voco-meet-support.ru"
          />
          <img
            className="footer-image footer-image--light-mobile"
            src="/voco-footer-light-mobile.svg"
            alt=""
            aria-hidden="true"
          />
          <img
            className="footer-image footer-image--dark"
            src="/voco-footer-dark.svg"
            alt=""
            aria-hidden="true"
          />
          <img
            className="footer-image footer-image--dark-mobile"
            src="/voco-footer-dark-mobile.svg"
            alt=""
            aria-hidden="true"
          />
        </div>
      </footer>
    </main>
  );
}



