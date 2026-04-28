import {
  useState,
  useEffect,
  useCallback,
  useId,
  useRef,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  DisconnectButton,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  TrackToggle,
  useChat,
  useLocalParticipant,
  useMediaDeviceSelect,
  useParticipants,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track } from "livekit-client";
import { api } from "../api";
import { downloadRoomReportPdf, type RoomReport } from "../lib/roomReport";
import styles from "./Room.module.css";

const STAGE_WIDTH = 1440;
const STAGE_HEIGHT = 1024;
const TABLET_WIDTH = 768;
const MOBILE_WIDTH = 390;
const ROOM_BAR_HEIGHT = 100;
const ROOM_TILE_PAGE_SIZE = 4;
const DESKTOP_TILE_COLUMN_WIDTH = 293;
const DESKTOP_TILE_GRID_WIDTH = DESKTOP_TILE_COLUMN_WIDTH * 2;
const DESKTOP_TILE_GRID_LEFT = (STAGE_WIDTH - DESKTOP_TILE_GRID_WIDTH) / 2;
const DESKTOP_EXPANDED_MEDIA_TOP = 107;
const DESKTOP_EXPANDED_MEDIA_HEIGHT = 810;
const TABLET_ROOM_LAYOUT_MEDIA_QUERY =
  "(min-width: 641px) and (max-width: 900px) and (min-height: 900px) and (orientation: portrait)";
const COMPACT_ROOM_LAYOUT_MEDIA_QUERY = "(max-width: 640px)";
const CHAT_EMOJI_OPTIONS = [
  "😀",
  "😃",
  "😄",
  "😁",
  "😆",
  "😅",
  "😂",
  "🤣",
  "😊",
  "😇",
  "🙂",
  "😉",
  "😍",
  "😘",
  "😎",
  "🤔",
  "😢",
  "😭",
  "😡",
  "👍",
  "👎",
  "👏",
  "🙌",
  "🙏",
  "🤝",
  "💪",
  "🔥",
  "✨",
  "🎉",
  "🎊",
  "❤️",
  "💜",
  "💙",
  "✅",
  "❌",
  "⭐",
  "💬",
  "👀",
  "🚀",
  "💡",
  "📌",
  "📎",
  "⏰",
  "☕",
  "🎧",
  "📷",
  "📝",
  "🔒",
];

interface Props {
  user: any;
}

interface ConferenceRoomContentProps {
  roomName: string;
  slug?: string;
  onExitIntent: () => void;
  onEndRoomIntent?: () => void;
  isOwner?: boolean;
  canEndRoom?: boolean;
  currentUserAvatarUrl?: string | null;
}

type RoomRole = "OWNER" | "MODERATOR" | "PARTICIPANT";

interface RoomParticipantMeta {
  id: string;
  role: RoomRole;
  user: {
    id: string;
    username: string;
    avatarUrl?: string | null;
  };
}

function toStagePercent(value: number, max: number) {
  return `${(value / max) * 100}%`;
}

function stageRect(left: number, top: number, width: number, height: number): CSSProperties {
  return {
    left: toStagePercent(left, STAGE_WIDTH),
    top: toStagePercent(top, STAGE_HEIGHT),
    width: toStagePercent(width, STAGE_WIDTH),
    height: toStagePercent(height, STAGE_HEIGHT),
  };
}

function contentRect(left: number, width: number, totalWidth: number, row: number, rows: number, rowSpan = 1): CSSProperties {
  const rowHeightVh = 100 / rows;
  const rowHeightPx = (ROOM_BAR_HEIGHT * 2) / rows;
  const heightVh = rowHeightVh * rowSpan;
  const heightPx = rowHeightPx * rowSpan;
  const offsetVh = rowHeightVh * row;
  const offsetPx = rowHeightPx * row;

  return {
    left: toStagePercent(left, totalWidth),
    top: row === 0 ? `${ROOM_BAR_HEIGHT}px` : `calc(${ROOM_BAR_HEIGHT}px + ${offsetVh}vh - ${offsetPx}px)`,
    width: toStagePercent(width, totalWidth),
    height: rowSpan === rows ? `calc(100vh - ${ROOM_BAR_HEIGHT * 2}px)` : `calc(${heightVh}vh - ${heightPx}px)`,
  };
}

function tabletContentRect(left: number, width: number, row: number, rows: number, rowSpan = 1): CSSProperties {
  return contentRect(left, width, TABLET_WIDTH, row, rows, rowSpan);
}

function mobileContentRect(row: number, rows: number, rowSpan = 1): CSSProperties {
  return contentRect(0, MOBILE_WIDTH, MOBILE_WIDTH, row, rows, rowSpan);
}

function getStageTileFrames(count: number, gridLeft = DESKTOP_TILE_GRID_LEFT, expandSingleTile = false) {
  const normalizedCount = Math.max(1, Math.min(count, 4));

  if (normalizedCount === 1) {
    if (expandSingleTile) {
      return [
        {
          id: "tile-1",
          accent: true,
          style: stageRect(0, DESKTOP_EXPANDED_MEDIA_TOP, STAGE_WIDTH, DESKTOP_EXPANDED_MEDIA_HEIGHT),
        },
      ];
    }

    return [
      {
        id: "tile-1",
        accent: true,
        style: stageRect(gridLeft, 100, DESKTOP_TILE_GRID_WIDTH, 824),
      },
    ];
  }

  if (normalizedCount === 2) {
    return [
      {
        id: "tile-1",
        accent: true,
        style: stageRect(gridLeft, 100, DESKTOP_TILE_COLUMN_WIDTH, 824),
      },
      {
        id: "tile-2",
        accent: false,
        style: stageRect(
          gridLeft + DESKTOP_TILE_COLUMN_WIDTH,
          100,
          DESKTOP_TILE_COLUMN_WIDTH,
          824,
        ),
      },
    ];
  }

  if (normalizedCount === 3) {
    return [
      {
        id: "tile-1",
        accent: true,
        style: stageRect(gridLeft, 100, DESKTOP_TILE_GRID_WIDTH, 412),
      },
      {
        id: "tile-2",
        accent: false,
        style: stageRect(gridLeft, 512, DESKTOP_TILE_COLUMN_WIDTH, 412),
      },
      {
        id: "tile-3",
        accent: false,
        style: stageRect(
          gridLeft + DESKTOP_TILE_COLUMN_WIDTH,
          512,
          DESKTOP_TILE_COLUMN_WIDTH,
          412,
        ),
      },
    ];
  }

  return [
    {
      id: "tile-1",
      accent: true,
      style: stageRect(gridLeft, 100, DESKTOP_TILE_COLUMN_WIDTH, 412),
    },
    {
      id: "tile-2",
      accent: false,
      style: stageRect(
        gridLeft + DESKTOP_TILE_COLUMN_WIDTH,
        100,
        DESKTOP_TILE_COLUMN_WIDTH,
        412,
      ),
    },
    {
      id: "tile-3",
      accent: false,
      style: stageRect(gridLeft, 512, DESKTOP_TILE_COLUMN_WIDTH, 412),
    },
    {
      id: "tile-4",
      accent: false,
      style: stageRect(
        gridLeft + DESKTOP_TILE_COLUMN_WIDTH,
        512,
        DESKTOP_TILE_COLUMN_WIDTH,
        412,
      ),
    },
  ];
}

function getTabletTileFrames(count: number) {
  const normalizedCount = Math.max(1, Math.min(count, 4));

  if (normalizedCount === 1) {
    return [{ id: "tablet-tile-1", accent: true, style: tabletContentRect(0, 768, 0, 1) }];
  }

  if (normalizedCount === 2) {
    return [
      { id: "tablet-tile-1", accent: true, style: tabletContentRect(0, 384, 0, 1) },
      { id: "tablet-tile-2", accent: false, style: tabletContentRect(384, 384, 0, 1) },
    ];
  }

  if (normalizedCount === 3) {
    return [
      { id: "tablet-tile-1", accent: true, style: tabletContentRect(0, 768, 0, 2) },
      { id: "tablet-tile-2", accent: false, style: tabletContentRect(0, 384, 1, 2) },
      { id: "tablet-tile-3", accent: false, style: tabletContentRect(384, 384, 1, 2) },
    ];
  }

  return [
    { id: "tablet-tile-1", accent: true, style: tabletContentRect(0, 384, 0, 2) },
    { id: "tablet-tile-2", accent: false, style: tabletContentRect(384, 384, 0, 2) },
    { id: "tablet-tile-3", accent: false, style: tabletContentRect(0, 384, 1, 2) },
    { id: "tablet-tile-4", accent: false, style: tabletContentRect(384, 384, 1, 2) },
  ];
}

function getMobileTileFrames(count: number) {
  const normalizedCount = Math.max(1, Math.min(count, 4));

  return Array.from({ length: normalizedCount }, (_, index) => ({
    id: `mobile-tile-${index + 1}`,
    accent: index === 0,
    style: mobileContentRect(index, normalizedCount),
  }));
}

function formatParticipantName(name: string, isLocal: boolean) {
  return isLocal ? `${name} (Вы)` : name;
}

function formatMessageTime(timestamp: number) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function getParticipantDisplayName(participant: any, localIdentity?: string) {
  const baseName = participant?.name || participant?.identity || "Участник";
  return formatParticipantName(baseName, participant?.identity === localIdentity);
}

function getTrackDisplayName(trackRef: any, localIdentity?: string) {
  const participant = trackRef?.participant;
  if (!participant) {
    return "";
  }
  return getParticipantDisplayName(participant, localIdentity);
}

function getTrackMicEnabled(trackRef: any) {
  return Boolean(trackRef?.participant?.isMicrophoneEnabled);
}

function getTrackSource(trackRef: any) {
  return trackRef?.publication?.source ?? trackRef?.source;
}

function isTrackSpeaking(trackRef: any) {
  return (
    getTrackSource(trackRef) !== Track.Source.ScreenShare &&
    Boolean(trackRef?.participant?.isSpeaking)
  );
}

function hasExpandedVideoMedia(trackRef: any) {
  const source = getTrackSource(trackRef);

  if (source === Track.Source.ScreenShare) {
    return true;
  }

  return source === Track.Source.Camera && Boolean(trackRef?.participant?.isCameraEnabled);
}

function getInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "УЧ";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function useCompactRoomLayout() {
  const [isCompactLayout, setIsCompactLayout] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(COMPACT_ROOM_LAYOUT_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia(COMPACT_ROOM_LAYOUT_MEDIA_QUERY);
    const handleChange = () => setIsCompactLayout(mediaQuery.matches);

    handleChange();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  return isCompactLayout;
}

function useTabletRoomLayout() {
  const [isCompactLayout, setIsCompactLayout] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(TABLET_ROOM_LAYOUT_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia(TABLET_ROOM_LAYOUT_MEDIA_QUERY);
    const handleChange = () => setIsCompactLayout(mediaQuery.matches);

    handleChange();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  return isCompactLayout;
}

function iconClassName(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

function ExitArrowIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.exitArrowSvg, className)}
      viewBox="0 0 27 14"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <line
        y1="-1"
        x2="10.2591"
        y2="-1"
        transform="matrix(0.731055 -0.682318 0.731055 0.682318 19 14)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        y1="-1"
        x2="10.2591"
        y2="-1"
        transform="matrix(-0.731055 -0.682318 0.731055 -0.682318 26.5 7)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M0 7L25 7" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function ChevronDownIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.chevronDownSvg, className)}
      viewBox="0 0 14 9"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <line
        y1="-1"
        x2="10.2591"
        y2="-1"
        transform="matrix(0.682318 0.731055 -0.682318 0.731055 0 1)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        y1="-1"
        x2="10.2591"
        y2="-1"
        transform="matrix(0.682318 -0.731055 0.682318 0.731055 7 8.5)"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function MicIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.micSvg, className)}
      viewBox="0 0 18 25"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <rect x="5" y="0" width="8" height="16" rx="4" stroke="currentColor" strokeWidth="2" />
      <path d="M4 24H14" stroke="currentColor" strokeWidth="2" />
      <path d="M9 19V23" stroke="currentColor" strokeWidth="2" />
      <path
        d="M18 12C18 16.9706 13.9706 21 9 21C4.02944 21 0 16.9706 0 12H2C2 15.866 5.13401 19 9 19C12.866 19 16 15.866 16 12H18Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SpeakerIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  const maskId = useId();

  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.speakerSvg, className)}
      viewBox="0 0 22 20"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <mask id={maskId} fill="white">
        <path d="M10 20L0 10L10 0V20Z" />
      </mask>
      <path
        d="M10 20L8.58579 21.4142L12 24.8284V20H10ZM0 10L-1.41421 8.58579L-2.82843 10L-1.41421 11.4142L0 10ZM10 0H12V-4.82843L8.58579 -1.41421L10 0ZM10 20L11.4142 18.5858L1.41421 8.58579L0 10L-1.41421 11.4142L8.58579 21.4142L10 20ZM0 10L1.41421 11.4142L11.4142 1.41421L10 0L8.58579 -1.41421L-1.41421 8.58579L0 10ZM10 0H8V20H10H12V0H10Z"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
      <path
        d="M12 4C15.3137 4 18 6.68629 18 10C18 13.3137 15.3137 16 12 16V14C14.2091 14 16 12.2091 16 10C16 7.79086 14.2091 6 12 6V4Z"
        fill="currentColor"
      />
      <path
        d="M12 0C17.5228 0 22 4.47715 22 10C22 15.5228 17.5228 20 12 20V18C16.4183 18 20 14.4183 20 10C20 5.58172 16.4183 2 12 2V0Z"
        fill="currentColor"
      />
      <path d="M12 8C13.1046 8 14 8.89543 14 10C14 11.1046 13.1046 12 12 12V8Z" fill="currentColor" />
    </svg>
  );
}

function CameraIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  const maskId = useId();

  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.cameraSvg, className)}
      viewBox="0 0 30 20"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <rect x="1" y="3" width="16" height="14" rx="7" stroke="currentColor" strokeWidth="2" />
      <mask id={maskId} fill="white">
        <path d="M26 20L16 10L26 0V20Z" />
      </mask>
      <path
        d="M26 20L24.5858 21.4142L28 24.8284V20H26ZM16 10L14.5858 8.58579L13.1716 10L14.5858 11.4142L16 10ZM26 0H28V-4.82843L24.5858 -1.41421L26 0ZM26 20L27.4142 18.5858L17.4142 8.58579L16 10L14.5858 11.4142L24.5858 21.4142L26 20ZM16 10L17.4142 11.4142L27.4142 1.41421L26 0L24.5858 -1.41421L14.5858 8.58579L16 10ZM26 0H24V20H26H28V0H26Z"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}

function ScreenIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.screenSvg, className)}
      viewBox="0 0 30 20"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <rect x="5" y="1" width="20" height="14" stroke="currentColor" strokeWidth="2" />
      <path d="M15 15V19" stroke="currentColor" strokeWidth="2" />
      <path d="M8 19H22" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function UserIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.userSvg, className)}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M10.4922 10.0117C11.6373 10.0681 12.7657 10.3211 13.8271 10.7607C15.0404 11.2633 16.1427 12.0002 17.0713 12.9287C17.9998 13.8573 18.7367 14.9596 19.2393 16.1729C19.7418 17.3861 20 18.6868 20 20H10V18H17.7451C17.6519 17.6392 17.5339 17.2843 17.3906 16.9385C16.9886 15.9679 16.4 15.0856 15.6572 14.3428C14.9144 13.6 14.0321 13.0114 13.0615 12.6094C12.0909 12.2073 11.0506 12 10 12C8.94942 12 7.90914 12.2073 6.93848 12.6094C5.96787 13.0114 5.08559 13.6 4.34277 14.3428C3.60001 15.0856 3.01138 15.9679 2.60938 16.9385C2.4661 17.2843 2.34808 17.6392 2.25488 18H10V20H0C0 18.6868 0.258185 17.3861 0.760742 16.1729C1.2633 14.9596 2.00018 13.8573 2.92871 12.9287C3.85727 12.0002 4.95963 11.2633 6.17285 10.7607C7.38611 10.2582 8.68678 10 10 10L10.4922 10.0117Z"
        fill="currentColor"
      />
      <circle cx="10" cy="6" r="5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function ChatIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.chatSvg, className)}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path d="M10 1C14.9706 1 19 5.02944 19 10V19H10C5.02944 19 1 14.9706 1 10C1 5.02944 5.02944 1 10 1Z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function RecordingIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.recordingSvg, className)}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="2" />
      <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function RaisedHandIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.raisedHandSvg, className)}
      viewBox="0 0 20 25"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path d="M1 13C1 14.2222 1 14.1111 1 15" stroke="currentColor" strokeWidth="2" />
      <path d="M5 5C5 11.1111 5 10.5556 5 15" stroke="currentColor" strokeWidth="2" />
      <path d="M5 5C5 2.6 7 2 8 2" stroke="currentColor" strokeWidth="2" />
      <path d="M10.997 3C10.999 10.3333 10.998 7.6667 11 13" stroke="currentColor" strokeWidth="2" />
      <path d="M15 5C15 9.8889 15 9.4444 15 13" stroke="currentColor" strokeWidth="2" />
      <path d="M19 10C19 13.0556 19 12.7778 19 15" stroke="currentColor" strokeWidth="2" />
      <path d="M11 3C11 0.6 9 0 8 0" stroke="currentColor" strokeWidth="2" />
      <path d="M15 5C15 2.6 13 2 12 2" stroke="currentColor" strokeWidth="2" />
      <path d="M19 10C19 7.6 17 7 16 7" stroke="currentColor" strokeWidth="2" />
      <path d="M3 15C3 12.6 1 12 0 12" stroke="currentColor" strokeWidth="2" />
      <path d="M2 15C2 19.4183 5.5817 23 10 23V25C4.4772 25 0 20.5228 0 15H2Z" fill="currentColor" />
      <path d="M20 25H10V23H18V13H20V25Z" fill="currentColor" />
    </svg>
  );
}

function PlusIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.plusSvg, className)}
      viewBox="0 0 50 50"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path d="M14 25L36 25" stroke="currentColor" strokeWidth="2" />
      <path d="M25 14L25 36" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function SmileIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.smileSvg, className)}
      viewBox="0 0 30 30"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M25 16C25 21.5228 20.5228 26 15 26C9.47715 26 5 21.5228 5 16H7C7 20.4183 10.5817 24 15 24C19.4183 24 23 20.4183 23 16H25Z"
        fill="currentColor"
      />
      <path d="M12 4V14" stroke="currentColor" strokeWidth="2" />
      <path d="M18 4V14" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function SendIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.sendSvg, className)}
      viewBox="0 0 27 14"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <line
        y1="-1"
        x2="10.2591"
        y2="-1"
        transform="matrix(0.731055 -0.682318 0.731055 0.682318 19 14)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        y1="-1"
        x2="10.2591"
        y2="-1"
        transform="matrix(-0.731055 -0.682318 0.731055 -0.682318 26.5 7)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M0 7L25 7" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

type DeviceMenuKey = "mic" | "speaker" | "cam";
type DeviceKind = "audioinput" | "audiooutput" | "videoinput";
type RoomPanelKey = "participants" | "chat";

function DeviceCheckIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, className)}
      viewBox="0 0 30 30"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path d="M7 14.6667L12.714 20L22 0" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function DeviceSelectDropdown({
  kind,
  className,
  onSelect,
}: {
  kind: DeviceKind;
  className: string;
  onSelect: () => void;
}) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind });
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [scrollThumbTop, setScrollThumbTop] = useState(7);
  const [deviceTooltip, setDeviceTooltip] = useState<{ label: string; top: number } | null>(
    null,
  );

  const updateScrollThumb = useCallback(() => {
    const list = listRef.current;
    if (!list) return;

    const maxScroll = list.scrollHeight - list.clientHeight;
    const thumbTop = maxScroll > 0 ? 7 + (list.scrollTop / maxScroll) * 77 : 7;
    setScrollThumbTop(thumbTop);
  }, []);

  const showDeviceTooltip = useCallback((label: string, target: HTMLElement) => {
    const dropdown = dropdownRef.current;
    if (!dropdown) return;

    const dropdownRect = dropdown.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    setDeviceTooltip({
      label,
      top: targetRect.top - dropdownRect.top + targetRect.height + 4,
    });
  }, []);

  useEffect(() => {
    updateScrollThumb();
  }, [devices.length, updateScrollThumb]);

  return (
    <div
      ref={dropdownRef}
      className={className}
      style={{ "--device-scroll-thumb-top": `${scrollThumbTop}px` } as CSSProperties}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseLeave={() => setDeviceTooltip(null)}
    >
      <ul
        ref={listRef}
        className={styles.deviceDropdownList}
        role="menu"
        onScroll={() => {
          updateScrollThumb();
          setDeviceTooltip(null);
        }}
      >
        {devices.length === 0 ? (
          <li className={styles.deviceDropdownEmpty}>Устройства не найдены</li>
        ) : (
          devices.map((device, index) => {
            const label = device.label || `Устройство ${index + 1}`;
            const isActive = device.deviceId === activeDeviceId;
            return (
              <li key={device.deviceId || `device-${index}`} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  className={`${styles.deviceDropdownItem} ${
                    isActive ? styles.deviceDropdownItemActive : ""
                  }`}
                  onMouseEnter={(event) => showDeviceTooltip(label, event.currentTarget)}
                  onFocus={(event) => showDeviceTooltip(label, event.currentTarget)}
                  onMouseLeave={() => setDeviceTooltip(null)}
                  onBlur={() => setDeviceTooltip(null)}
                  onClick={() => {
                    void setActiveMediaDevice(device.deviceId);
                    onSelect();
                  }}
                >
                  <span className={styles.deviceDropdownItemLabel}>{label}</span>
                  <span className={styles.deviceDropdownCheck} aria-hidden="true">
                    {isActive && <DeviceCheckIcon />}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
      {deviceTooltip && (
        <div
          className={styles.deviceDropdownTooltip}
          style={{ top: deviceTooltip.top }}
          aria-hidden="true"
        >
          {deviceTooltip.label}
        </div>
      )}
    </div>
  );
}

function DeviceControlContent({
  label,
  active,
  icon,
  hideMenu,
}: {
  label: string;
  active: boolean;
  icon: ReactNode;
  hideMenu?: boolean;
}) {
  return (
    <>
      <span
        className={`${styles.deviceStatus} ${active ? styles.deviceStatusOn : styles.deviceStatusOff}`}
        aria-hidden="true"
      />
      <span className={styles.deviceIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.deviceLabel}>{label}</span>
      {hideMenu ? null : (
        <span className={styles.deviceMenu} aria-hidden="true">
          <ChevronDownIcon />
        </span>
      )}
    </>
  );
}

function TabletDeviceControlContent({
  active,
  icon,
  hideMenu,
}: {
  active: boolean;
  icon: ReactNode;
  hideMenu?: boolean;
}) {
  return (
    <>
      <span
        className={`${styles.tabletDeviceStatus} ${
          active ? styles.tabletDeviceStatusOn : styles.tabletDeviceStatusOff
        }`}
        aria-hidden="true"
      />
      <span className={styles.tabletDeviceIcon} aria-hidden="true">
        {icon}
      </span>
      {hideMenu ? null : (
        <span className={styles.tabletDeviceMenu} aria-hidden="true">
          <ChevronDownIcon />
        </span>
      )}
    </>
  );
}

function MobileToolbarControlContent({
  active,
  icon,
}: {
  active: boolean;
  icon: ReactNode;
}) {
  return (
    <>
      <span
        className={`${styles.mobileToolbarStatus} ${
          active ? styles.mobileToolbarStatusOn : styles.mobileToolbarStatusOff
        }`}
        aria-hidden="true"
      />
      <span className={styles.mobileToolbarIcon} aria-hidden="true">
        {icon}
      </span>
    </>
  );
}

function TileSignal({ active }: { active: boolean }) {
  return (
    <span
      className={`${styles.tileSignal} ${active ? styles.tileSignalOn : styles.tileSignalOff}`}
      aria-hidden="true"
    >
      {active ? (
        <svg viewBox="0 0 16 20" fill="none">
          <path d="M15 0L15 20" stroke="currentColor" strokeWidth="2" />
          <path d="M8 5L8 20" stroke="currentColor" strokeWidth="2" />
          <path d="M1 10L1 20" stroke="currentColor" strokeWidth="2" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 20" fill="none">
          <path d="M15 0L15 20" stroke="currentColor" strokeWidth="2" />
          <path d="M8 5L8 20" stroke="currentColor" strokeWidth="2" />
          <path d="M1 10L1 20" stroke="var(--tile-signal-accent, #FF3333)" strokeWidth="2" />
        </svg>
      )}
    </span>
  );
}

function getIndicatorPages(pageCount: number, currentPage: number) {
  const maxVisiblePages = 7;
  const safePageCount = Math.max(1, pageCount);

  if (safePageCount <= maxVisiblePages) {
    return Array.from({ length: safePageCount }, (_, index) => index);
  }

  const start = Math.min(Math.max(currentPage - 3, 0), safePageCount - maxVisiblePages);
  return Array.from({ length: maxVisiblePages }, (_, index) => start + index);
}

function ViewIndicator({
  pageCount,
  currentPage,
  className,
  onPageChange,
}: {
  pageCount: number;
  currentPage: number;
  className?: string;
  onPageChange: (page: number) => void;
}) {
  const safePageCount = Math.max(1, pageCount);
  const safeCurrentPage = Math.min(Math.max(currentPage, 0), safePageCount - 1);
  const pages = getIndicatorPages(safePageCount, safeCurrentPage);

  return (
    <div className={`${styles.viewIndicator} ${className ?? ""}`} aria-label="Текущий экран">
      {pages.map((page) => {
        const distance = Math.min(Math.abs(page - safeCurrentPage), 3);
        const isCurrent = page === safeCurrentPage;

        return (
          <button
            key={page}
            type="button"
            className={styles.viewIndicatorDot}
            data-distance={distance}
            aria-label={`Экран ${page + 1} из ${safePageCount}`}
            aria-current={isCurrent ? "true" : undefined}
            onClick={() => onPageChange(page)}
            disabled={isCurrent || safePageCount === 1}
          />
        );
      })}
    </div>
  );
}

function PlaceholderLogo() {
  return (
    <svg className={styles.placeholderLogo} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M0 75C3.28305 75 6.53424 75.647 9.56738 76.9033C12.6004 78.1597 15.3564 80.0009 17.6777 82.3223C19.9991 84.6436 21.8403 87.3996 23.0967 90.4326C24.353 93.4658 25 96.717 25 100H50C50 93.4341 48.7069 86.9324 46.1943 80.8662C43.6816 74.7999 39.9984 69.2875 35.3555 64.6445C30.7125 60.0016 25.2001 56.3184 19.1338 53.8057C13.0676 51.2931 6.56593 50 0 50V75Z" fill="currentColor" />
      <path d="M100 75C96.717 75 93.4658 75.647 90.4326 76.9033C87.3996 78.1597 84.6436 80.0009 82.3223 82.3223C80.0009 84.6436 78.1597 87.3996 76.9033 90.4326C75.647 93.4658 75 96.717 75 100H50C50 93.4341 51.2931 86.9324 53.8057 80.8662C56.3184 74.7999 60.0016 69.2875 64.6445 64.6445C69.2875 60.0016 74.7999 56.3184 80.8662 53.8057C86.9324 51.2931 93.4341 50 100 50V75Z" fill="currentColor" />
      <path d="M50 25C53.283 25 56.5342 25.647 59.5674 26.9033C62.6004 28.1597 65.3564 30.0009 67.6777 32.3223C69.9991 34.6436 71.8403 37.3996 73.0967 40.4326C74.353 43.4658 75 46.717 75 50H100C100 43.4341 98.7069 36.9324 96.1943 30.8662C93.6816 24.7999 89.9984 19.2875 85.3555 14.6445C80.7125 10.0016 75.2001 6.3184 69.1338 3.80566C63.0676 1.29305 56.5659 0 50 0V25Z" fill="currentColor" />
      <path d="M100 50C100 43.4339 98.7067 36.9321 96.194 30.8658C93.6812 24.7995 89.9983 19.2876 85.3553 14.6447C80.7124 10.0017 75.2005 6.31876 69.1342 3.80602C63.0679 1.29329 56.5661 -2.08713e-07 50 0C43.4339 2.08713e-07 36.9321 1.29329 30.8658 3.80602C24.7995 6.31876 19.2876 10.0017 14.6447 14.6447C10.0017 19.2876 6.31876 24.7996 3.80602 30.8658C1.29329 36.9321 0 43.4339 0 50L25 50C25 46.717 25.6466 43.4661 26.903 40.4329C28.1594 37.3998 30.0009 34.6438 32.3223 32.3223C34.6438 30.0009 37.3998 28.1594 40.4329 26.903C43.4661 25.6466 46.717 25 50 25C53.283 25 56.5339 25.6466 59.5671 26.903C62.6002 28.1594 65.3562 30.0009 67.6777 32.3223C69.9991 34.6438 71.8406 37.3998 73.097 40.4329C74.3534 43.4661 75 46.717 75 50L100 50Z" fill="currentColor" />
    </svg>
  );
}

type ExpiryPreset = "none" | "1d" | "1w" | "1y" | "custom";

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

function formatDateTimeLocal(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`;
}

function InviteManagerModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>("none");
  const [customExpiresAt, setCustomExpiresAt] = useState(() => formatDateTimeLocal(new Date()));
  const [maxUses, setMaxUses] = useState("");
  const [allowGuests, setAllowGuests] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const nowLocal = formatDateTimeLocal(new Date());

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.listInvites(slug);
      const activeOnly = (data.invites ?? []).filter((invite: any) => invite.isActive);
      setInvites(activeOnly);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const resolveExpiresAt = (): Date | null => {
    const now = new Date();
    if (expiryPreset === "none") return null;
    if (expiryPreset === "1d") {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      return d;
    }
    if (expiryPreset === "1w") {
      const d = new Date(now);
      d.setDate(d.getDate() + 7);
      return d;
    }
    if (expiryPreset === "1y") {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() + 1);
      return d;
    }
    if (!customExpiresAt) return null;
    const parsed = new Date(customExpiresAt);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const expiresDate = resolveExpiresAt();
    if (expiryPreset === "custom") {
      if (!expiresDate) {
        setError("Укажите корректную дату истечения");
        return;
      }
      if (expiresDate.getTime() <= Date.now()) {
        setError("Дата истечения не может быть в прошлом");
        return;
      }
      if (expiresDate.getFullYear() > 9999) {
        setError("Год должен содержать не более 4 цифр");
        return;
      }
    }

    setCreating(true);
    try {
      const options: { expiresAt?: string; maxUses?: number; allowGuests?: boolean } = {
        allowGuests,
      };
      if (expiresDate) {
        options.expiresAt = expiresDate.toISOString();
      }
      if (maxUses) {
        const parsedUses = parseInt(maxUses, 10);
        if (Number.isFinite(parsedUses) && parsedUses >= 1) {
          options.maxUses = parsedUses;
        }
      }
      await api.createInvite(slug, options);
      setExpiryPreset("none");
      setCustomExpiresAt(formatDateTimeLocal(new Date()));
      setMaxUses("");
      setAllowGuests(true);
      await reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDeactivate = async (code: string) => {
    setError("");
    try {
      await api.deactivateInvite(slug, code);
      setInvites((current) => current.filter((invite: any) => invite.code !== code));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const copyUrl = async (code: string) => {
    const url = `${window.location.origin}/invite/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(code);
      setTimeout(() => setCopied((current) => (current === code ? null : current)), 1500);
    } catch {
      setError("Не удалось скопировать ссылку");
    }
  };

  return (
    <div
      className={styles.inviteOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-modal-title"
      onClick={onClose}
    >
      <div className={styles.inviteModal} onClick={(event) => event.stopPropagation()}>
        <header className={styles.inviteHeader}>
          <h2 id="invite-modal-title">Ссылки-приглашения</h2>
          <button
            type="button"
            className={styles.inviteClose}
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </header>

        <form className={styles.inviteForm} onSubmit={handleCreate}>
          <label className={styles.inviteField}>
            <span>Максимум использований</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={maxUses}
              onChange={(event) => setMaxUses(event.target.value)}
              placeholder="Без лимита"
            />
          </label>

          <label className={styles.inviteField}>
            <span>Истекает</span>
            <div className={styles.inviteSelectWrapper}>
              <select
                className={styles.inviteSelect}
                value={expiryPreset}
                onChange={(event) => setExpiryPreset(event.target.value as ExpiryPreset)}
              >
                <option value="none">Без лимита</option>
                <option value="1d">1 день</option>
                <option value="1w">1 неделя</option>
                <option value="1y">1 год</option>
                <option value="custom">Своё время</option>
              </select>
              <span className={styles.inviteSelectChevron} aria-hidden="true">
                <ChevronDownIcon />
              </span>
            </div>
          </label>

          {expiryPreset === "custom" ? (
            <label className={styles.inviteField}>
              <span>Дата истечения</span>
              <input
                type="datetime-local"
                value={customExpiresAt}
                min={nowLocal}
                max="9999-12-31T23:59"
                onChange={(event) => setCustomExpiresAt(event.target.value)}
              />
            </label>
          ) : null}

          <label className={styles.inviteCheckbox}>
            <input
              type="checkbox"
              checked={allowGuests}
              onChange={(event) => setAllowGuests(event.target.checked)}
            />
            <span>Разрешить вход гостям</span>
          </label>

          <button type="submit" className={styles.inviteCreate} disabled={creating}>
            {creating ? "Создание..." : "Создать ссылку"}
          </button>
        </form>

        {error ? <div className={styles.inviteError}>{error}</div> : null}

        <div className={styles.inviteList}>
          {loading ? (
            <div className={styles.inviteEmpty}>Загрузка...</div>
          ) : invites.length === 0 ? (
            <div className={styles.inviteEmpty}>Ссылок ещё нет</div>
          ) : (
            invites.map((invite: any) => {
              const url = `${window.location.origin}/invite/${invite.code}`;
              const usesLabel = invite.maxUses
                ? `${invite.usesCount}/${invite.maxUses}`
                : `${invite.usesCount}/∞`;
              return (
                <div key={invite.id} className={styles.inviteItem}>
                  <div className={styles.inviteItemUrl} title={url}>
                    {url}
                  </div>
                  <div className={styles.inviteItemMeta}>
                    <span>Использований: {usesLabel}</span>
                    {invite.expiresAt ? (
                      <span>До: {new Date(invite.expiresAt).toLocaleString("ru-RU")}</span>
                    ) : (
                      <span>Бессрочно</span>
                    )}
                    <span>{invite.allowGuests ? "Гости: да" : "Гости: нет"}</span>
                  </div>
                  <div className={styles.inviteItemActions}>
                    <button type="button" onClick={() => copyUrl(invite.code)}>
                      {copied === invite.code ? "Скопировано" : "Копировать"}
                    </button>
                    <button type="button" onClick={() => handleDeactivate(invite.code)}>
                      Отключить
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function InviteIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.inviteSvg, className)}
      viewBox="0 0 50 50"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M23.0332 18L16.8256 24.1026C11.8599 28.9846 18.067 35.0872 23.0329 30.2052L29 24.1026"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M26.9668 32L33.1744 25.8974C38.1401 21.0154 31.933 14.9128 26.9671 19.7948L21 25.8974"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function MoreVerticalIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.moreVerticalSvg, className)}
      viewBox="0 0 6 26"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <circle cx="3" cy="3" r="2" stroke="currentColor" strokeWidth="2" />
      <circle cx="3" cy="13" r="2" stroke="currentColor" strokeWidth="2" />
      <circle cx="3" cy="23" r="2" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function ParticipantAvatar({
  name,
  avatarUrl,
  className,
  square,
}: {
  name: string;
  avatarUrl?: string | null;
  className?: string;
  square?: boolean;
}) {
  const avatarLabel = typeof avatarUrl === "string" && avatarUrl.trim() ? avatarUrl : null;

  return (
    <span className={`${styles.participantAvatar} ${square ? styles.participantAvatarSquare : ""} ${className ?? ""}`}>
      {avatarLabel ?? getInitials(name)}
    </span>
  );
}

export function ConferenceRoomContent({
  roomName,
  slug,
  onExitIntent,
  onEndRoomIntent,
  isOwner,
  canEndRoom,
  currentUserAvatarUrl,
}: ConferenceRoomContentProps) {
  const participants = useParticipants();
  const {
    localParticipant,
    isMicrophoneEnabled,
    isCameraEnabled,
    isScreenShareEnabled,
  } = useLocalParticipant();
  const { chatMessages, send, isSending } = useChat();
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const emojiListRef = useRef<HTMLDivElement>(null);
  const participantsSectionRef = useRef<HTMLElement>(null);
  const chatSectionRef = useRef<HTMLElement>(null);
  const [message, setMessage] = useState("");
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiScrollThumbTop, setEmojiScrollThumbTop] = useState(10);
  const [outputEnabled, setOutputEnabled] = useState(true);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [openDeviceMenu, setOpenDeviceMenu] = useState<DeviceMenuKey | null>(null);
  const [inviteManagerOpen, setInviteManagerOpen] = useState(false);
  const [exitMenuOpen, setExitMenuOpen] = useState(false);
  const [visiblePanels, setVisiblePanels] = useState<Record<RoomPanelKey, boolean>>({
    participants: false,
    chat: false,
  });
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [openParticipantMenu, setOpenParticipantMenu] = useState<string | null>(null);
  const [roomParticipants, setRoomParticipants] = useState<RoomParticipantMeta[]>([]);
  const [roomRole, setRoomRole] = useState<RoomRole | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingNow, setRecordingNow] = useState(Date.now());
  const [codeCopyStatus, setCodeCopyStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [tilePage, setTilePage] = useState(0);
  const codeCopyResetRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (codeCopyResetRef.current) {
        window.clearTimeout(codeCopyResetRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!exitMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(`.${styles.exitMenuDropdown}`)) return;
      if (target.closest(`.${styles.exitMenuTrigger}`)) return;
      setExitMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [exitMenuOpen]);

  const refreshRoomState = useCallback(async () => {
    if (!slug) return;

    try {
      const data = await api.getRoom(slug);
      setRoomParticipants(data.room?.participants ?? []);
      const nextRole = (data.room?.myRole ?? null) as RoomRole | null;
      setRoomRole(nextRole);
    } catch {
      // Room metadata is optional for the visual controls; LiveKit participants remain the source of truth.
    }
  }, [slug]);

  useEffect(() => {
    void refreshRoomState();
    const timer = window.setInterval(() => {
      void refreshRoomState();
    }, 10000);

    return () => window.clearInterval(timer);
  }, [refreshRoomState]);

  useEffect(() => {
    if (!openParticipantMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-participant-menu-root]")) return;
      setOpenParticipantMenu(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenParticipantMenu(null);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [openParticipantMenu]);

  useEffect(() => {
    if (!emojiPickerOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-chat-emoji-root]")) return;
      setEmojiPickerOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEmojiPickerOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [emojiPickerOpen]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => setRecordingNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  const handleExitMenuLeave = useCallback(() => {
    setExitMenuOpen(false);
    onExitIntent();
  }, [onExitIntent]);

  const handleExitMenuEnd = useCallback(() => {
    setExitMenuOpen(false);
    if (onEndRoomIntent) {
      void onEndRoomIntent();
    } else {
      onExitIntent();
    }
  }, [onEndRoomIntent, onExitIntent]);

  const renderExitMenu = (position?: CSSProperties, className?: string) =>
    exitMenuOpen && canEndRoom ? (
      <div className={`${styles.exitMenuDropdown} ${className ?? ""}`} style={position} role="menu">
        <button type="button" role="menuitem" onClick={handleExitMenuLeave}>
          Выйти
        </button>
        <button
          type="button"
          role="menuitem"
          className={styles.exitMenuDanger}
          onClick={handleExitMenuEnd}
        >
          Выйти и завершить конференцию
        </button>
      </div>
    ) : null;

  const renderExitMenuTrigger = (className: string, style?: CSSProperties) =>
    canEndRoom ? (
      <button
        type="button"
        className={`${styles.exitMenuTrigger} ${className}`}
        style={style}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          setExitMenuOpen((current) => !current);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        aria-haspopup="menu"
        aria-expanded={exitMenuOpen}
        aria-label="Меню выхода"
      />
    ) : null;

  const handleCopyRoomCode = useCallback(async () => {
    if (!slug || !isOwner || codeCopyStatus === "copying") return;
    setCodeCopyStatus("copying");
    try {
      const data = await api.createInvite(slug, { maxUses: 1 });
      const url = `${window.location.origin}/invite/${data.invite.code}`;
      await navigator.clipboard.writeText(url);
      setCodeCopyStatus("copied");
    } catch {
      setCodeCopyStatus("error");
    } finally {
      if (codeCopyResetRef.current) {
        window.clearTimeout(codeCopyResetRef.current);
      }
      codeCopyResetRef.current = window.setTimeout(() => {
        setCodeCopyStatus("idle");
        codeCopyResetRef.current = null;
      }, 1800);
    }
  }, [slug, isOwner, codeCopyStatus]);

  const closeDeviceMenu = useCallback(() => setOpenDeviceMenu(null), []);
  const toggleDeviceMenu = useCallback(
    (key: DeviceMenuKey) => setOpenDeviceMenu((current) => (current === key ? null : key)),
    [],
  );

  useEffect(() => {
    if (!openDeviceMenu) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-device-menu-root]")) {
        setOpenDeviceMenu(null);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenDeviceMenu(null);
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [openDeviceMenu]);

  useEffect(() => {
    if (!mobileMoreOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-mobile-more-root]")) return;
      setMobileMoreOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMoreOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [mobileMoreOpen]);
  const localIdentity = localParticipant?.identity;
  const isTabletLayout = useTabletRoomLayout();
  const isCompactLayout = useCompactRoomLayout();

  const tracks = [...(useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]) as any[])].sort((left, right) => {
    const leftScreen = left?.publication?.source === Track.Source.ScreenShare ? -1 : 0;
    const rightScreen = right?.publication?.source === Track.Source.ScreenShare ? -1 : 0;
    if (leftScreen !== rightScreen) return leftScreen - rightScreen;

    const leftLocal = left?.participant?.identity === localIdentity ? -1 : 0;
    const rightLocal = right?.participant?.identity === localIdentity ? -1 : 0;
    if (leftLocal !== rightLocal) return leftLocal - rightLocal;

    return (left?.participant?.name || left?.participant?.identity || "").localeCompare(
      right?.participant?.name || right?.participant?.identity || "",
      "ru",
    );
  });

  const orderedParticipants = [...participants].sort((left: any, right: any) => {
    if (left.identity === localIdentity) return -1;
    if (right.identity === localIdentity) return 1;
    return (left.name || left.identity || "").localeCompare(right.name || right.identity || "", "ru");
  });
  const participantMetaByUserId = new Map(
    roomParticipants.map((participant) => [participant.user.id, participant] as const),
  );
  const localParticipantRole = participantMetaByUserId.get(localIdentity ?? "")?.role;
  const canModerateParticipants = Boolean(
    canEndRoom || localParticipantRole === "OWNER" || localParticipantRole === "MODERATOR" || roomRole === "OWNER" || roomRole === "MODERATOR",
  );
  const recordingSeconds =
    isRecording && recordingStartedAt ? Math.floor((recordingNow - recordingStartedAt) / 1000) : 0;
  const recordingLabel = isRecording ? `Идёт запись ${formatDuration(recordingSeconds)}` : "Запись";

  const allTracks = tracks.length > 0 ? tracks : [null];
  const hasScreenShare =
    allTracks[0]?.publication?.source === Track.Source.ScreenShare;
  const tilePageCount = hasScreenShare ? 1 : Math.max(1, Math.ceil(allTracks.length / ROOM_TILE_PAGE_SIZE));
  const currentTilePage = hasScreenShare ? 0 : Math.min(tilePage, tilePageCount - 1);
  const visibleTracks = hasScreenShare
    ? [allTracks[0]]
    : allTracks.slice(currentTilePage * ROOM_TILE_PAGE_SIZE, (currentTilePage + 1) * ROOM_TILE_PAGE_SIZE);
  const isParticipantsPanelOpen = visiblePanels.participants;
  const isChatPanelOpen = visiblePanels.chat;
  const tileFrames = getStageTileFrames(
    visibleTracks.length,
    DESKTOP_TILE_GRID_LEFT,
    visibleTracks.length === 1 && hasExpandedVideoMedia(visibleTracks[0]),
  );
  const tabletTileFrames = getTabletTileFrames(visibleTracks.length);
  const mobileVisibleTracks = visibleTracks.slice(0, 4);
  const mobileTileFrames = getMobileTileFrames(mobileVisibleTracks.length);

  useEffect(() => {
    setTilePage((current) => Math.min(current, tilePageCount - 1));
  }, [tilePageCount]);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chatMessages]);

  useEffect(() => {
    if (!isChatPanelOpen) setEmojiPickerOpen(false);
  }, [isChatPanelOpen]);

  const handleChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedMessage = message.trim();
    if (!normalizedMessage) return;

    try {
      await send(normalizedMessage);
      setMessage("");
      setEmojiPickerOpen(false);
    } catch {
      // Keep the current value so the user can retry.
    }
  };

  const currentDate = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
  const roomTitle = roomName || "Название конференции";
  const roomCodeBase = slug ? `Код комнаты: ${slug}` : "Код комнаты";
  const roomCodeLabel =
    codeCopyStatus === "copied"
      ? "Ссылка скопирована"
      : codeCopyStatus === "copying"
        ? "Создаём ссылку..."
        : codeCopyStatus === "error"
          ? "Не удалось скопировать"
          : roomCodeBase;
  const roomCodeTitle = isOwner && slug ? "Скопировать одноразовую ссылку" : undefined;

  const renderOwnerCopyButton = (className: string, style?: CSSProperties) => (
    <button
      type="button"
      className={`${className} ${styles.roomCodeCopy}`}
      style={style}
      onClick={handleCopyRoomCode}
      disabled={codeCopyStatus === "copying"}
      title={roomCodeTitle}
      data-copy-status={codeCopyStatus}
    >
      <span className={styles.roomCodeCopyLabel}>{roomCodeLabel}</span>
      <span className={styles.roomCodeCopyHint}>Скопировать одноразовую ссылку</span>
    </button>
  );

  const focusChatInput = useCallback(() => chatInputRef.current?.focus(), []);
  const updateEmojiScrollThumb = useCallback(() => {
    const list = emojiListRef.current;
    if (!list) return;

    const maxScroll = list.scrollHeight - list.clientHeight;
    const thumbTop = maxScroll > 0 ? 10 + (list.scrollTop / maxScroll) * 160 : 10;
    setEmojiScrollThumbTop(thumbTop);
  }, []);

  const insertChatEmoji = useCallback(
    (emoji: string) => {
      const input = chatInputRef.current;
      const selectionStart = input?.selectionStart ?? message.length;
      const selectionEnd = input?.selectionEnd ?? message.length;
      const nextMessage = `${message.slice(0, selectionStart)}${emoji}${message.slice(selectionEnd)}`;
      const nextCursorPosition = selectionStart + emoji.length;

      setMessage(nextMessage);
      window.requestAnimationFrame(() => {
        chatInputRef.current?.focus();
        chatInputRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
      });
    },
    [message],
  );

  const renderChatComposer = (className?: string) => (
    <form
      className={`${styles.chatComposer}${className ? ` ${className}` : ""}`}
      onSubmit={handleChatSubmit}
    >
      <button
        className={`${styles.chatIconButton} ${styles.chatAttachButton}`}
        type="button"
        aria-label="Добавить вложение"
        onClick={focusChatInput}
      >
        <PlusIcon />
      </button>

      <button
        className={`${styles.chatIconButton} ${styles.chatEmojiButton}`}
        type="button"
        aria-label={emojiPickerOpen ? "Закрыть смайлики" : "Открыть смайлики"}
        aria-haspopup="menu"
        aria-expanded={emojiPickerOpen}
        onClick={() => {
          setEmojiScrollThumbTop(10);
          setEmojiPickerOpen((current) => !current);
          focusChatInput();
        }}
        data-chat-emoji-root
      >
        <SmileIcon />
      </button>

      {emojiPickerOpen ? (
        <div
          className={styles.chatEmojiPicker}
          style={{ "--chat-emoji-scroll-thumb-top": `${emojiScrollThumbTop}px` } as CSSProperties}
          role="menu"
          aria-label="Смайлики"
          data-chat-emoji-root
        >
          <div
            ref={emojiListRef}
            className={styles.chatEmojiList}
            onScroll={updateEmojiScrollThumb}
          >
            {CHAT_EMOJI_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                className={styles.chatEmojiOption}
                type="button"
                role="menuitem"
                aria-label={`Вставить ${emoji}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertChatEmoji(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <input
        ref={chatInputRef}
        className={styles.chatInput}
        type="text"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Сообщение..."
      />

      <button
        className={`${styles.chatIconButton} ${styles.chatSendButton}`}
        type="submit"
        aria-label="Отправить сообщение"
        disabled={isSending || !message.trim()}
      >
        <SendIcon />
      </button>
    </form>
  );

  const toggleRoomPanel = useCallback((panel: RoomPanelKey) => {
    setVisiblePanels((current) => {
      if (isCompactLayout) {
        return {
          participants: panel === "participants" ? !current.participants : false,
          chat: panel === "chat" ? !current.chat : false,
        };
      }

      return {
        ...current,
        [panel]: !current[panel],
      };
    });
  }, [isCompactLayout]);
  const toggleRaisedHand = () => setIsHandRaised((current) => !current);
  const toggleRecording = () => {
    setIsRecording((current) => {
      const next = !current;
      if (next) {
        const now = Date.now();
        setRecordingStartedAt(now);
        setRecordingNow(now);
      } else {
        setRecordingStartedAt(null);
      }
      return next;
    });
  };
  const scrollToParticipants = useCallback(() => toggleRoomPanel("participants"), [toggleRoomPanel]);
  const scrollToChat = useCallback(() => {
    toggleRoomPanel("chat");
  }, [toggleRoomPanel]);

  useEffect(() => {
    if (!isParticipantsPanelOpen || !isCompactLayout) return;
    const frame = window.requestAnimationFrame(() => {
      participantsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isParticipantsPanelOpen, isCompactLayout]);

  useEffect(() => {
    if (!isChatPanelOpen) return;
    const frame = window.requestAnimationFrame(() => {
      if (isCompactLayout) {
        chatSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      focusChatInput();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusChatInput, isChatPanelOpen, isCompactLayout]);

  const getParticipantMeta = (participant: any) =>
    participantMetaByUserId.get(participant?.identity) ??
    ({
      id: participant?.identity ?? "",
      role: participant?.identity === localIdentity && isOwner ? "OWNER" : "PARTICIPANT",
      user: {
        id: participant?.identity ?? "",
        username: participant?.name || participant?.identity || "Участник",
        avatarUrl: participant?.identity === localIdentity ? currentUserAvatarUrl ?? null : null,
      },
    } satisfies RoomParticipantMeta);

  const canManageTarget = (meta: RoomParticipantMeta, isLocal: boolean) => {
    if (!canModerateParticipants || isLocal || !meta.user.id) return false;
    if (meta.role === "OWNER") return false;
    if (!(isOwner || roomRole === "OWNER") && meta.role === "MODERATOR") return false;
    return true;
  };

  const renderTrackMedia = (trackRef: any) =>
    trackRef ? (
      <ParticipantTile className={styles.livekitTile} trackRef={trackRef} />
    ) : (
      <div className={styles.placeholderTile}>
        <PlaceholderLogo />
      </div>
    );

  const renderParticipantMenu = (meta: RoomParticipantMeta, isLocal: boolean) => {
    const isOpen = openParticipantMenu === meta.user.id;
    const canManage = canManageTarget(meta, isLocal);
    const canChangeRole = Boolean((isOwner || roomRole === "OWNER") && canManage && meta.role !== "OWNER");

    if (!canManage && !canChangeRole) {
      return null;
    }

    return (
      <div className={styles.participantMenuRoot} data-participant-menu-root>
        <button
          type="button"
          className={styles.participantMoreButton}
          aria-label={`Действия для ${meta.user.username}`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={(event) => {
            event.stopPropagation();
            setOpenParticipantMenu((current) => (current === meta.user.id ? null : meta.user.id));
          }}
        >
          <MoreVerticalIcon />
        </button>

        {isOpen ? (
          <div className={styles.participantActionMenu} role="menu">
            {canChangeRole ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => setOpenParticipantMenu(null)}
              >
                {meta.role === "MODERATOR" ? "Снять права модера" : "Выдать права модера"}
              </button>
            ) : null}
            {canManage ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setOpenParticipantMenu(null)}
                >
                  Замутить
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setOpenParticipantMenu(null)}
                >
                  Кикнуть
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.participantDangerAction}
                  onClick={() => setOpenParticipantMenu(null)}
                >
                  Забанить
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const renderStageParticipantRows = () =>
    orderedParticipants.map((participant: any) => {
      const isLocal = participant.identity === localIdentity;
      const meta = getParticipantMeta(participant);
      const displayName = getParticipantDisplayName(participant, localIdentity);
      const shouldShowRaisedHand = isLocal && isHandRaised;
      const canManage = canManageTarget(meta, isLocal);

      return (
        <div
          className={`${styles.stageParticipantRow} ${isLocal ? styles.participantRowLocal : ""} ${
            meta.role === "MODERATOR" && !isLocal ? styles.participantRowModerator : ""
          } ${canManage ? styles.participantRowManaged : ""}`}
          key={participant.identity}
        >
          <ParticipantAvatar
            name={displayName}
            avatarUrl={meta.user.avatarUrl}
            square={isLocal || meta.role === "MODERATOR"}
          />
          <span className={styles.stageParticipantText}>
            {displayName}
          </span>

          {shouldShowRaisedHand ? (
            <span className={`${styles.stageParticipantStatus} ${styles.stageParticipantStatusOn}`} aria-hidden="true">
              <RaisedHandIcon />
            </span>
          ) : null}
          {renderParticipantMenu(meta, isLocal)}
        </div>
      );
    });

  const renderChatMessages = (emptyClass?: string) =>
    chatMessages.length === 0 ? (
      <div className={emptyClass ?? styles.chatEmpty}>Сообщений пока нет</div>
    ) : (
      chatMessages.map((entry) => {
        const isLocal = entry.from?.identity === localIdentity;
        const authorName = entry.from?.name || entry.from?.identity || "Система";
        const authorMeta = participantMetaByUserId.get(entry.from?.identity ?? "");
        return (
          <div
            className={`${styles.chatMessageRow} ${isLocal ? styles.chatMessageOwn : styles.chatMessageRemote}`}
            key={`${entry.timestamp}-${entry.from?.identity ?? "system"}`}
          >
            {!isLocal ? (
              <ParticipantAvatar
                name={authorName}
                avatarUrl={authorMeta?.user.avatarUrl}
                className={styles.chatAvatar}
              />
            ) : null}
            <article
              className={`${styles.chatBubble} ${isLocal ? styles.chatBubbleOwn : styles.chatBubbleRemote}`}
            >
              {!isLocal ? <div className={styles.chatAuthor}>{authorName}</div> : null}
              <div className={styles.chatBody}>{entry.message}</div>
              <div className={styles.chatTime}>{formatMessageTime(entry.timestamp)}</div>
            </article>
          </div>
        );
      })
    );

  const sharedLiveKitUi = (
    <>
      <RoomAudioRenderer muted={!outputEnabled} />
      {isOwner && slug && inviteManagerOpen ? (
        <InviteManagerModal slug={slug} onClose={() => setInviteManagerOpen(false)} />
      ) : null}
    </>
  );

  const renderRecordingIndicator = (style?: CSSProperties, className?: string) =>
    isRecording ? (
      <div
        className={`${styles.recordingIndicator} ${className ?? ""}`}
        style={style}
        aria-label={recordingLabel}
        title={recordingLabel}
      >
        <span className={styles.recordingGlow} aria-hidden="true" />
        <span className={styles.recordingIcon} aria-hidden="true">
          <RecordingIcon />
        </span>
        <span className={styles.recordingLabel}>{recordingLabel}</span>
      </div>
    ) : null;

  const renderHeaderInviteButton = (style?: CSSProperties, compact = false, className?: string) =>
    isOwner && slug ? (
      <button
        type="button"
        className={
          compact
            ? styles.compactHeaderInviteButton
            : `${styles.headerInviteButton} ${className ?? ""}`
        }
        style={style}
        onClick={() => setInviteManagerOpen(true)}
        aria-label="Пригласить"
      >
        <InviteIcon />
      </button>
    ) : null;

  const renderViewIndicator = (className: string) => (
    <ViewIndicator
      pageCount={tilePageCount}
      currentPage={currentTilePage}
      className={className}
      onPageChange={setTilePage}
    />
  );

  if (isTabletLayout) {
    return (
      <div className={styles.tabletViewport}>
        <div className={styles.tabletStage}>
          <div className={styles.topBar} />
          <div className={styles.bottomBar} />
          {renderViewIndicator(styles.tabletToolbarHandle)}

          {tabletTileFrames.map((frame, index) => {
            const trackRef = visibleTracks[index];
            const micEnabled = getTrackMicEnabled(trackRef);
            const displayName = getTrackDisplayName(trackRef, localIdentity);
            const speaking = isTrackSpeaking(trackRef);

            return (
              <article
                className={`${styles.tileCard} ${styles.tabletTileCard} ${
                  frame.accent ? styles.tileCardAccent : ""
                } ${speaking ? styles.tileSpeaking : ""}`}
                style={frame.style}
                key={frame.id}
              >
                <div className={styles.tileMedia}>{renderTrackMedia(trackRef)}</div>

                <div className={styles.tileFooter}>
                  <span className={styles.tileFooterName}>{displayName || "Ожидание подключения"}</span>
                  <TileSignal active={micEnabled} />
                </div>
              </article>
            );
          })}

          {isParticipantsPanelOpen ? (
            <aside
              className={`${styles.sidePanel} ${styles.participantsPanel} ${styles.tabletSidePanel} ${styles.tabletParticipantsPanel}`}
              style={tabletContentRect(0, 384, 0, 1)}
            >
              <div className={styles.sideHeaderFade} />
              <div className={styles.sideTitle}>Участники</div>
              <div className={styles.participantsScroll}>
                {renderStageParticipantRows()}
              </div>
              <div className={styles.sideFooterFade} />
              <div className={styles.sideFooterText}>Всего участников: {orderedParticipants.length}</div>
            </aside>
          ) : null}

          {isChatPanelOpen ? (
            <aside
              className={`${styles.sidePanel} ${styles.chatPanel} ${styles.tabletSidePanel} ${styles.tabletChatPanel}`}
              style={tabletContentRect(384, 384, 0, 1)}
            >
              <div className={styles.sideHeaderFade} />
              <div className={styles.chatTitle}>Чат</div>

              <div className={`${styles.chatScroll} ${styles.tabletChatScroll}`} ref={chatScrollRef}>
                {chatMessages.length > 0 ? <div className={styles.tabletChatDate}>{currentDate}</div> : null}
                {renderChatMessages()}
              </div>

              {renderChatComposer()}
            </aside>
          ) : null}

          {renderHeaderInviteButton(undefined, false, styles.tabletHeaderInviteButton)}

          <h1 className={`${styles.stageConferenceName} ${styles.tabletConferenceName}`}>
            {roomTitle}
          </h1>
          {isOwner && slug ? (
            renderOwnerCopyButton(`${styles.stageRoomCode} ${styles.tabletRoomCode}`)
          ) : (
            <div className={`${styles.stageRoomCode} ${styles.tabletRoomCode}`}>
              {roomCodeLabel}
            </div>
          )}
          {renderRecordingIndicator(undefined, styles.tabletRecordingIndicator)}

          <DisconnectButton
            className={`${styles.tabletExitButton} ${styles.tabletHeaderExitButton}`}
            aria-label="Выйти"
            onClick={onExitIntent}
          >
            <span className={styles.exitGlow} aria-hidden="true" />
            <span className={styles.tabletExitIcon} aria-hidden="true">
              <ExitArrowIcon />
            </span>
            <span className={styles.tabletExitMenu} aria-hidden="true">
              <ChevronDownIcon />
            </span>
          </DisconnectButton>
          {renderExitMenuTrigger(`${styles.exitMenuTriggerTablet} ${styles.tabletHeaderExitMenuTrigger}`)}
          {renderExitMenu(undefined, styles.tabletHeaderExitDropdown)}

          <div
            className={`${styles.deviceSlot} ${styles.tabletBottomDeviceSlot} ${styles.tabletMicrophoneSlot}`}
            data-device-menu-root
          >
            <TrackToggle
              className={`${styles.tabletDeviceButton} ${styles.deviceButtonFill}`}
              source={Track.Source.Microphone}
              showIcon={false}
            >
              <TabletDeviceControlContent active={isMicrophoneEnabled} icon={<MicIcon />} />
            </TrackToggle>
            <button
              type="button"
              className={styles.deviceMenuTrigger}
              aria-label="Выбрать микрофон"
              aria-expanded={openDeviceMenu === "mic"}
              onClick={() => toggleDeviceMenu("mic")}
            />
            {openDeviceMenu === "mic" && (
              <DeviceSelectDropdown
                kind="audioinput"
                className={`${styles.deviceDropdown} ${styles.deviceDropdownUp}`}
                onSelect={closeDeviceMenu}
              />
            )}
          </div>

          <div
            className={`${styles.deviceSlot} ${styles.tabletBottomDeviceSlot} ${styles.tabletSpeakerSlot}`}
            data-device-menu-root
          >
            <button
              className={`${styles.tabletDeviceButton} ${styles.deviceButtonFill}`}
              type="button"
              onClick={() => setOutputEnabled((current) => !current)}
              aria-label="Звук"
              aria-pressed={outputEnabled}
            >
              <TabletDeviceControlContent active={outputEnabled} icon={<SpeakerIcon />} />
            </button>
            <button
              type="button"
              className={styles.deviceMenuTrigger}
              aria-label="Выбрать устройство звука"
              aria-expanded={openDeviceMenu === "speaker"}
              onClick={() => toggleDeviceMenu("speaker")}
            />
            {openDeviceMenu === "speaker" && (
              <DeviceSelectDropdown
                kind="audiooutput"
                className={`${styles.deviceDropdown} ${styles.deviceDropdownUp}`}
                onSelect={closeDeviceMenu}
              />
            )}
          </div>

          <div
            className={`${styles.deviceSlot} ${styles.tabletBottomDeviceSlot} ${styles.tabletCameraSlot}`}
            data-device-menu-root
          >
            <TrackToggle
              className={`${styles.tabletDeviceButton} ${styles.deviceButtonFill}`}
              source={Track.Source.Camera}
              showIcon={false}
            >
              <TabletDeviceControlContent active={isCameraEnabled} icon={<CameraIcon />} />
            </TrackToggle>
            <button
              type="button"
              className={styles.deviceMenuTrigger}
              aria-label="Выбрать камеру"
              aria-expanded={openDeviceMenu === "cam"}
              onClick={() => toggleDeviceMenu("cam")}
            />
            {openDeviceMenu === "cam" && (
              <DeviceSelectDropdown
                kind="videoinput"
                className={`${styles.deviceDropdown} ${styles.deviceDropdownUp}`}
                onSelect={closeDeviceMenu}
              />
            )}
          </div>

          <TrackToggle
            className={`${styles.tabletDeviceButton} ${styles.tabletScreenShareButton}`}
            source={Track.Source.ScreenShare}
            showIcon={false}
          >
            <TabletDeviceControlContent active={isScreenShareEnabled} icon={<ScreenIcon />} />
          </TrackToggle>

          <div className={`${styles.utilityGroup} ${styles.tabletUtilityGroup}`}>
            <button
              className={`${styles.utilityButton} ${isParticipantsPanelOpen ? styles.utilityButtonActive : ""}`}
              type="button"
              aria-label="Участники"
              aria-pressed={isParticipantsPanelOpen}
              onClick={scrollToParticipants}
            >
              <UserIcon />
            </button>
            <button
              className={`${styles.utilityButton} ${isChatPanelOpen ? styles.utilityButtonActive : ""}`}
              type="button"
              aria-label="Чат"
              aria-pressed={isChatPanelOpen}
              onClick={scrollToChat}
            >
              <ChatIcon />
            </button>
            <button
              className={styles.utilityButton}
              type="button"
              aria-label="Поднять руку"
              aria-pressed={isHandRaised}
              onClick={toggleRaisedHand}
            >
              <RaisedHandIcon />
            </button>
            <button
              className={`${styles.utilityButton} ${isRecording ? styles.utilityButtonActive : ""}`}
              type="button"
              aria-label={isRecording ? "Остановить запись" : "Начать запись"}
              aria-pressed={isRecording}
              onClick={toggleRecording}
            >
              <RecordingIcon />
            </button>
          </div>

          {sharedLiveKitUi}
        </div>
      </div>
    );
  }

  if (isCompactLayout) {
    const mobileExitContent = (
      <>
        <span className={styles.mobileExitGlow} aria-hidden="true" />
        <span className={styles.mobileExitIcon} aria-hidden="true">
          <ExitArrowIcon />
        </span>
      </>
    );

    return (
      <div className={styles.mobileViewport}>
        <div className={styles.mobileStage}>
          <div className={styles.mobileTopBar} />
          <div className={styles.mobileBottomBar} />
          {renderViewIndicator(styles.mobileToolbarHandle)}

          {mobileTileFrames.map((frame, index) => {
            const trackRef = mobileVisibleTracks[index];
            const micEnabled = getTrackMicEnabled(trackRef);
            const displayName = getTrackDisplayName(trackRef, localIdentity);
            const speaking = isTrackSpeaking(trackRef);

            return (
              <article
                className={`${styles.tileCard} ${styles.mobileTileCard} ${
                  frame.accent ? styles.tileCardAccent : ""
                } ${speaking ? styles.tileSpeaking : ""}`}
                style={frame.style}
                key={frame.id}
              >
                <div className={styles.tileMedia}>{renderTrackMedia(trackRef)}</div>

                <div className={styles.tileFooter}>
                  <span className={styles.tileFooterName}>{displayName || "Ожидание подключения"}</span>
                  <TileSignal active={micEnabled} />
                </div>
              </article>
            );
          })}

          {isParticipantsPanelOpen ? (
            <aside
              className={`${styles.sidePanel} ${styles.participantsPanel} ${styles.mobileParticipantsPanel}`}
              style={mobileContentRect(0, 1)}
            >
              <div className={styles.sideHeaderFade} />
              <div className={styles.sideTitle}>Участники</div>
              <div className={styles.participantsScroll}>
                {renderStageParticipantRows()}
              </div>
              <div className={styles.sideFooterFade} />
              <div className={styles.sideFooterText}>Всего участников: {orderedParticipants.length}</div>
            </aside>
          ) : null}

          {isChatPanelOpen ? (
            <aside
              className={`${styles.sidePanel} ${styles.chatPanel} ${styles.mobileChatPanel}`}
              style={mobileContentRect(0, 1)}
            >
              <div className={styles.sideHeaderFade} />
              <div className={styles.chatTitle}>Чат</div>

              <div className={`${styles.chatScroll} ${styles.mobileChatScroll}`} ref={chatScrollRef}>
                {chatMessages.length > 0 ? <div className={styles.mobileChatDate}>{currentDate}</div> : null}
                {renderChatMessages()}
              </div>

              {renderChatComposer(styles.mobileChatComposer)}
            </aside>
          ) : null}

          <h1 className={`${styles.stageConferenceName} ${styles.mobileConferenceName}`}>
            {roomTitle}
          </h1>
          {isOwner && slug ? (
            renderOwnerCopyButton(`${styles.stageRoomCode} ${styles.mobileRoomCode}`)
          ) : (
            <div className={`${styles.stageRoomCode} ${styles.mobileRoomCode}`}>
              {roomCodeLabel}
            </div>
          )}

          {renderHeaderInviteButton(undefined, false, styles.mobileHeaderInviteButton)}

          {canEndRoom ? (
            <button
              type="button"
              className={`${styles.mobileExitButton} ${styles.mobileHeaderExitButton}`}
              aria-label="Выйти"
              aria-haspopup="menu"
              aria-expanded={exitMenuOpen}
              onClick={(event) => {
                event.stopPropagation();
                setExitMenuOpen((current) => !current);
              }}
            >
              {mobileExitContent}
            </button>
          ) : (
            <DisconnectButton
              className={`${styles.mobileExitButton} ${styles.mobileHeaderExitButton}`}
              aria-label="Выйти"
              onClick={onExitIntent}
            >
              {mobileExitContent}
            </DisconnectButton>
          )}
          {renderExitMenu(undefined, styles.mobileHeaderExitDropdown)}

          <div className={styles.mobileToolbar} data-mobile-more-root>
            <TrackToggle
              className={styles.mobileToolbarButton}
              source={Track.Source.Microphone}
              showIcon={false}
            >
              <MobileToolbarControlContent active={isMicrophoneEnabled} icon={<MicIcon />} />
            </TrackToggle>

            <button
              className={styles.mobileToolbarButton}
              type="button"
              onClick={() => setOutputEnabled((current) => !current)}
              aria-label="Звук"
              aria-pressed={outputEnabled}
            >
              <MobileToolbarControlContent active={outputEnabled} icon={<SpeakerIcon />} />
            </button>

            <TrackToggle
              className={styles.mobileToolbarButton}
              source={Track.Source.Camera}
              showIcon={false}
            >
              <MobileToolbarControlContent active={isCameraEnabled} icon={<CameraIcon />} />
            </TrackToggle>

            <TrackToggle
              className={styles.mobileToolbarButton}
              source={Track.Source.ScreenShare}
              showIcon={false}
            >
              <MobileToolbarControlContent active={isScreenShareEnabled} icon={<ScreenIcon />} />
            </TrackToggle>

            <button
              className={`${styles.mobileToolbarButton} ${
                isParticipantsPanelOpen ? styles.mobileToolbarParticipantsActive : ""
              }`}
              type="button"
              aria-label="Участники"
              aria-pressed={isParticipantsPanelOpen}
              onClick={scrollToParticipants}
            >
              <UserIcon />
            </button>

            <button
              className={`${styles.mobileToolbarButton} ${isChatPanelOpen ? styles.mobileToolbarChatActive : ""}`}
              type="button"
              aria-label="Чат"
              aria-pressed={isChatPanelOpen}
              onClick={scrollToChat}
            >
              <ChatIcon />
            </button>

            <button
              className={`${styles.mobileToolbarButton} ${mobileMoreOpen ? styles.mobileToolbarMoreActive : ""}`}
              type="button"
              aria-label="Ещё"
              aria-haspopup="menu"
              aria-expanded={mobileMoreOpen}
              onClick={() => setMobileMoreOpen((current) => !current)}
            >
              <MoreVerticalIcon />
            </button>

            {mobileMoreOpen ? (
              <div className={styles.mobileMoreMenu} role="menu">
                {isOwner && slug ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setInviteManagerOpen(true);
                      setMobileMoreOpen(false);
                    }}
                  >
                    Пригласить
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    toggleRaisedHand();
                    setMobileMoreOpen(false);
                  }}
                >
                  {isHandRaised ? "Опустить руку" : "Поднять руку"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    toggleRecording();
                    setMobileMoreOpen(false);
                  }}
                >
                  {isRecording ? `Запись ${formatDuration(recordingSeconds)}` : "Начать запись"}
                </button>
              </div>
            ) : null}
          </div>

          {sharedLiveKitUi}
        </div>
      </div>
    );
  }
  return (
    <div className={styles.stageViewport}>
      <div className={styles.stage}>
        <div className={styles.topBar} />
        <div className={styles.bottomBar} />
        {renderViewIndicator(styles.desktopToolbarIndicator)}

        {isParticipantsPanelOpen ? (
          <aside className={`${styles.sidePanel} ${styles.participantsPanel} ${styles.desktopParticipantsPanel}`}>
            <div className={styles.sideHeaderFade} />
            <div className={styles.sideTitle}>Участники</div>
            <div className={styles.participantsScroll}>
              {renderStageParticipantRows()}
            </div>
            <div className={styles.sideFooterFade} />
            <div className={styles.sideFooterText}>Всего участников: {orderedParticipants.length}</div>
          </aside>
        ) : null}

        {isChatPanelOpen ? (
          <aside className={`${styles.sidePanel} ${styles.chatPanel} ${styles.desktopChatPanel}`}>
            <div className={styles.sideHeaderFade} />
            <div className={styles.chatTitle}>Чат</div>
            <div className={styles.chatDate}>{currentDate}</div>

            <div className={styles.chatScroll} ref={chatScrollRef}>
              {renderChatMessages()}
            </div>

            {renderChatComposer()}
          </aside>
        ) : null}

        {tileFrames.map((frame, index) => {
          const trackRef = visibleTracks[index];
          const micEnabled = getTrackMicEnabled(trackRef);
          const displayName = getTrackDisplayName(trackRef, localIdentity);
          const speaking = isTrackSpeaking(trackRef);

          return (
            <article
              className={`${styles.tileCard} ${frame.accent ? styles.tileCardAccent : ""} ${
                speaking ? styles.tileSpeaking : ""
              }`}
              style={frame.style}
              key={frame.id}
            >
              <div className={styles.tileMedia}>{renderTrackMedia(trackRef)}</div>

              <div className={styles.tileFooter}>
                <span className={styles.tileFooterName}>{displayName || "Ожидание подключения"}</span>
                <TileSignal active={micEnabled} />
              </div>
            </article>
          );
        })}

        {renderHeaderInviteButton(undefined, false, styles.desktopHeaderInviteButton)}

        <h1 className={`${styles.stageConferenceName} ${styles.desktopConferenceName}`}>
          {roomTitle}
        </h1>
        {isOwner && slug ? (
          renderOwnerCopyButton(`${styles.stageRoomCode} ${styles.desktopRoomCode}`)
        ) : (
          <div className={`${styles.stageRoomCode} ${styles.desktopRoomCode}`}>
            {roomCodeLabel}
          </div>
        )}
        {renderRecordingIndicator(undefined, styles.desktopRecordingIndicator)}

        <DisconnectButton
          className={`${styles.exitButton} ${styles.desktopHeaderExitButton}`}
          aria-label="Выйти"
          onClick={onExitIntent}
        >
          <span className={styles.exitGlow} aria-hidden="true" />
          <span className={styles.exitIcon} aria-hidden="true">
            <ExitArrowIcon />
          </span>
          <span className={styles.exitLabel}>Выйти</span>
          <span className={styles.exitMenu} aria-hidden="true">
            <ChevronDownIcon />
          </span>
        </DisconnectButton>
        {renderExitMenuTrigger(`${styles.exitMenuTriggerStage} ${styles.desktopHeaderExitMenuTrigger}`)}
        {renderExitMenu(undefined, styles.desktopHeaderExitDropdown)}

        <div
          className={`${styles.deviceSlot} ${styles.desktopDeviceSlot} ${styles.desktopMicrophoneSlot}`}
          data-device-menu-root
        >
          <TrackToggle
            className={`${styles.deviceButton} ${styles.deviceButtonFill}`}
            source={Track.Source.Microphone}
            showIcon={false}
          >
            <DeviceControlContent label="Микрофон" active={isMicrophoneEnabled} icon={<MicIcon />} />
          </TrackToggle>
          <button
            type="button"
            className={styles.deviceMenuTrigger}
            aria-label="Выбрать микрофон"
            aria-expanded={openDeviceMenu === "mic"}
            onClick={() => toggleDeviceMenu("mic")}
          />
          {openDeviceMenu === "mic" && (
            <DeviceSelectDropdown
              kind="audioinput"
              className={`${styles.deviceDropdown} ${styles.deviceDropdownUp}`}
              onSelect={closeDeviceMenu}
            />
          )}
        </div>

        <div
          className={`${styles.deviceSlot} ${styles.desktopDeviceSlot} ${styles.desktopSpeakerSlot}`}
          data-device-menu-root
        >
          <button
            className={`${styles.deviceButton} ${styles.deviceButtonFill}`}
            type="button"
            onClick={() => setOutputEnabled((current) => !current)}
            aria-pressed={outputEnabled}
          >
            <DeviceControlContent label="Звук" active={outputEnabled} icon={<SpeakerIcon />} />
          </button>
          <button
            type="button"
            className={styles.deviceMenuTrigger}
            aria-label="Выбрать устройство звука"
            aria-expanded={openDeviceMenu === "speaker"}
            onClick={() => toggleDeviceMenu("speaker")}
          />
          {openDeviceMenu === "speaker" && (
            <DeviceSelectDropdown
              kind="audiooutput"
              className={`${styles.deviceDropdown} ${styles.deviceDropdownUp}`}
              onSelect={closeDeviceMenu}
            />
          )}
        </div>

        <div
          className={`${styles.deviceSlot} ${styles.desktopDeviceSlot} ${styles.desktopCameraSlot}`}
          data-device-menu-root
        >
          <TrackToggle
            className={`${styles.deviceButton} ${styles.deviceButtonFill}`}
            source={Track.Source.Camera}
            showIcon={false}
          >
            <DeviceControlContent label="Камера" active={isCameraEnabled} icon={<CameraIcon />} />
          </TrackToggle>
          <button
            type="button"
            className={styles.deviceMenuTrigger}
            aria-label="Выбрать камеру"
            aria-expanded={openDeviceMenu === "cam"}
            onClick={() => toggleDeviceMenu("cam")}
          />
          {openDeviceMenu === "cam" && (
            <DeviceSelectDropdown
              kind="videoinput"
              className={`${styles.deviceDropdown} ${styles.deviceDropdownUp}`}
              onSelect={closeDeviceMenu}
            />
          )}
        </div>

        <TrackToggle
          className={`${styles.deviceButton} ${styles.desktopScreenShareButton}`}
          source={Track.Source.ScreenShare}
          showIcon={false}
        >
          <DeviceControlContent label="Демонстрация" active={isScreenShareEnabled} icon={<ScreenIcon />} />
        </TrackToggle>

        <div className={`${styles.utilityGroup} ${styles.desktopUtilityGroup}`}>
          <button
            className={`${styles.utilityButton} ${isParticipantsPanelOpen ? styles.utilityButtonActive : ""}`}
            type="button"
            aria-label="Участники"
            aria-pressed={isParticipantsPanelOpen}
            onClick={scrollToParticipants}
          >
            <UserIcon />
          </button>
          <button
            className={`${styles.utilityButton} ${isChatPanelOpen ? styles.utilityButtonActive : ""}`}
            type="button"
            aria-label="Чат"
            aria-pressed={isChatPanelOpen}
            onClick={scrollToChat}
          >
            <ChatIcon />
          </button>
          <button
            className={styles.utilityButton}
            type="button"
            aria-label="Поднять руку"
            aria-pressed={isHandRaised}
            onClick={toggleRaisedHand}
          >
            <RaisedHandIcon />
          </button>
          <button
            className={`${styles.utilityButton} ${isRecording ? styles.utilityButtonActive : ""}`}
            type="button"
            aria-label={isRecording ? "Остановить запись" : "Начать запись"}
            aria-pressed={isRecording}
            onClick={toggleRecording}
          >
            <RecordingIcon />
          </button>
        </div>

        {sharedLiveKitUi}
      </div>
    </div>
  );
}

export function RoomPage({ user }: Props) {
    const { slug } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const [token, setToken] = useState("");
    const [livekitUrl, setLivekitUrl] = useState("");
    const [roomName, setRoomName] = useState("");
    const [ownerName, setOwnerName] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [conferenceReady, setConferenceReady] = useState(false);
    const [isOwner, setIsOwner] = useState(false);
    const [myRole, setMyRole] = useState<string | null>(null);
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);
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
    // LiveKit emits `disconnected` on cleanup/unmount as well, so only finalize leave after an explicit exit action.
    const leaveRequestedRef = useRef(false);
    const [displayName, setDisplayName] = useState(() => {
        const saved = localStorage.getItem("voco_room_display_name");
        if (saved && saved.trim()) return saved;
        return user?.username || user?.email || "";
    });

    useEffect(() => {
        if (!slug) return;

        const joinRoom = async () => {
            try {
                const data = await api.joinRoom(slug);
                setToken(data.token);
                setLivekitUrl(data.livekitUrl);
                setRoomName(data.room.name);
                try {
                    const details = await api.getRoom(slug);
                    setIsOwner(details.room?.owner?.id === user?.id);
                    setMyRole(details.room?.myRole ?? null);
                    setOwnerName(details.room?.owner?.username ?? "");
                } catch {
                    // ignore — не критично для входа
                }
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        joinRoom();
    }, [slug, user?.id]);

    const leaveRoomAndNavigate = useCallback(async () => {
        leaveRequestedRef.current = false;

        if (slug) {
            try {
                await api.leaveRoom(slug);
            } catch {
                // ignore
            }
        }
        navigate("/dashboard");
    }, [slug, navigate]);

    const handleWaitingLeave = useCallback(() => {
        void leaveRoomAndNavigate();
    }, [leaveRoomAndNavigate]);

    const handleConferenceLeaveIntent = useCallback(() => {
        leaveRequestedRef.current = true;
    }, []);

    const [reportModalOpen, setReportModalOpen] = useState(false);
    const [reportData, setReportData] = useState<RoomReport | null>(null);
    const [reportLoading, setReportLoading] = useState(false);
    const [reportError, setReportError] = useState<string | null>(null);

    const handleEndRoomIntent = useCallback(async () => {
        if (!slug) return;
        setReportLoading(true);
        setReportError(null);
        setReportModalOpen(true);
        try {
            await api.deleteRoom(slug);
        } catch {
            // ignore — даже если не получилось закрыть, показываем отчёт
        }
        try {
            const data = await api.getRoomReport(slug);
            setReportData(data.report as RoomReport);
        } catch (err: any) {
            setReportError(err?.message || "Не удалось загрузить отчёт");
        } finally {
            setReportLoading(false);
        }
    }, [slug]);

    const [downloadingReport, setDownloadingReport] = useState(false);
    const handleDownloadReport = useCallback(async () => {
        if (!reportData || downloadingReport) return;
        setDownloadingReport(true);
        try {
            await downloadRoomReportPdf(reportData);
        } catch (err) {
            console.error("Ошибка при формировании PDF-отчёта:", err);
        } finally {
            setDownloadingReport(false);
        }
    }, [reportData, downloadingReport]);

    const handleReportModalExit = useCallback(() => {
        setReportModalOpen(false);
        leaveRequestedRef.current = true;
        void leaveRoomAndNavigate();
    }, [leaveRoomAndNavigate]);

    const handleConferenceDisconnected = useCallback(() => {
        if (!leaveRequestedRef.current) {
            return;
        }

        void leaveRoomAndNavigate();
    }, [leaveRoomAndNavigate]);

    const [entering, setEntering] = useState(false);

    const handleEnterConference = useCallback(async () => {
        if (!slug || !token || !livekitUrl || error || entering) return;

        const normalizedName = displayName.trim() || user?.username || user?.email || "";
        if (normalizedName) {
            localStorage.setItem("voco_room_display_name", normalizedName);
            setDisplayName(normalizedName);
        }

        setEntering(true);
        try {
            const fallbackName = user?.username || user?.email || "";
            if (normalizedName && normalizedName !== fallbackName) {
                const data = await api.joinRoom(slug, normalizedName);
                setToken(data.token);
                setLivekitUrl(data.livekitUrl);
                setRoomName(data.room.name);
            }
            leaveRequestedRef.current = false;
            setConferenceReady(true);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setEntering(false);
        }
    }, [displayName, entering, error, livekitUrl, slug, token, user]);

    if (loading) {
        return (
            <div className={styles.loading}>
                <div className={styles.spinner} />
                <p>Подключение к комнате...</p>
            </div>
        );
    }

    if (!conferenceReady) {
        return (
            <div className={styles.waitingScreen}>
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

                    <section className={styles.waitingPanel} aria-label="Комната ожидания">
                        <div className={styles.waitingHeader}>
                            <h2>Комната ожидания</h2>
                            <button
                                className={styles.waitingClose}
                                type="button"
                                onClick={handleWaitingLeave}
                                aria-label="Вернуться на главную"
                            />
                        </div>

                        <label className={styles.waitingLabel} htmlFor="waiting-display-name">
                            Имя в конференции (или войдите с текущим)
                        </label>

                        <input
                            id="waiting-display-name"
                            className={styles.waitingInput}
                            type="text"
                            value={displayName}
                            onChange={(event) => setDisplayName(event.target.value)}
                            placeholder="your@email.com"
                        />

                        <div
                            className={`${styles.waitingError} ${error ? "" : styles.waitingErrorHidden}`}
                            aria-live="polite"
                        >
                            {error ? `Ошибка входа: ${error}` : "\u00A0"}
                        </div>

                        <button
                            className={styles.waitingSubmit}
                            type="button"
                            onClick={handleEnterConference}
                            disabled={!token || !livekitUrl || !!error || entering}
                        >
                            {entering ? "Вход..." : "Войти"}
                        </button>
                    </section>

                    {(roomName || ownerName) && (
                        <div className={styles.waitingMeta} aria-hidden="true">
                            {roomName && <div className={styles.waitingMetaName}>{roomName}</div>}
                            {ownerName && <div className={styles.waitingMetaOwner}>{ownerName}</div>}
                        </div>
                    )}
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
                onDisconnected={handleConferenceDisconnected}
                data-lk-theme="default"
                className={styles.livekitRoot}
            >
                <ConferenceRoomContent
                    roomName={roomName}
                    slug={slug}
                    onExitIntent={handleConferenceLeaveIntent}
                    onEndRoomIntent={handleEndRoomIntent}
                    isOwner={isOwner}
                    canEndRoom={isOwner || myRole === "MODERATOR"}
                    currentUserAvatarUrl={user?.avatarUrl ?? null}
                />
            </LiveKitRoom>

            {reportModalOpen ? (
                <div
                    className={styles.reportModalOverlay}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="report-modal-title"
                >
                    <div className={styles.reportModal}>
                        <h2 id="report-modal-title">Комната завершена</h2>
                        {reportLoading ? (
                            <p className={styles.reportModalText}>Готовим отчёт о конференции…</p>
                        ) : reportError ? (
                            <p className={styles.reportModalText}>Не удалось загрузить отчёт: {reportError}</p>
                        ) : (
                            <p className={styles.reportModalText}>
                                Можно скачать PDF-отчёт о прошедшей конференции: участники, длительность, пик
                                одновременных.
                            </p>
                        )}
                        <div className={styles.reportModalActions}>
                            <button
                                type="button"
                                className={styles.reportModalPrimary}
                                onClick={handleDownloadReport}
                                disabled={!reportData || reportLoading || downloadingReport}
                            >
                                {downloadingReport ? "Формируем PDF…" : "Скачать PDF"}
                            </button>
                            <button
                                type="button"
                                className={styles.reportModalGhost}
                                onClick={handleReportModalExit}
                            >
                                Выйти
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
