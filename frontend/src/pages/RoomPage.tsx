import {
  useState,
  useEffect,
  useCallback,
  useId,
  useMemo,
  useRef,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import {
  DisconnectButton,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  TrackToggle,
  useChat,
  useIsMuted,
  useLocalParticipant,
  useMediaDeviceSelect,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { ConnectionQuality, DisconnectReason, RoomEvent, Track } from "livekit-client";
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
const DESKTOP_PARTICIPANTS_PANEL_WIDTH = 470;
const DESKTOP_CHAT_PANEL_WIDTH = 420;
const TILE_FOOTER_HEIGHT = 50;
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
  initialPinnedMessages?: PinnedMessage[];
  initialChatHistory?: ChatHistoryEntry[];
  initialPolls?: Poll[];
  // LiveKit-токен для гостей. У зарегистрированных не нужен — берётся наш Bearer.
  livekitToken?: string;
}

interface PinnedMessage {
  id: string;
  message: string;
  authorIdentity?: string | null;
  authorName?: string | null;
  originalExternalId?: string | null;
  originalTimestamp?: number | null;
  attachments?: ChatAttachment[] | null;
  pinnedBy?: string | null;
  pinnedAt?: string | null;
}

interface ChatAttachment {
  url: string;
  name: string;
  kind: "image" | "video" | "document";
  size: number;
  mime: string;
}

interface ChatHistoryEntry {
  id?: string;
  externalId?: string | null;
  authorIdentity: string;
  authorName?: string | null;
  message: string;
  sentAt: number;
  isGuest?: boolean;
  attachments?: ChatAttachment[] | null;
}

interface PollVoter {
  identity: string;
  name: string | null;
  userId: string | null;
  votedAt: number; // epoch ms
}

interface PollOption {
  id: string;
  text: string;
  position: number;
  voteCount: number;
  voters: PollVoter[];
}

interface Poll {
  id: string;
  question: string;
  allowMultiple: boolean;
  isAnonymous: boolean;
  isClosed: boolean;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: number; // epoch ms
  closedAt: number | null; // epoch ms
  options: PollOption[];
  totalVotes: number;
  myVote: string[]; // option_id[]
}

// Группа вложений в сообщении: фото/видео (до 5) или документы (до 10).
// Смешивать в одном сообщении нельзя.
type AttachmentGroup = "media" | "files";
const ATTACHMENT_LIMITS: Record<AttachmentGroup, number> = { media: 10, files: 10 };
// Сколько медиа-плиток видно в коллаже сообщения; остальные скрываются за «+N».
const MEDIA_COLLAGE_VISIBLE = 4;

function attachmentGroupOf(kind: ChatAttachment["kind"]): AttachmentGroup {
  return kind === "document" ? "files" : "media";
}

function sanitizeChatAttachment(a: unknown): ChatAttachment | null {
  if (!a || typeof a !== "object") return null;
  const obj = a as Record<string, unknown>;
  if (
    typeof obj.url !== "string" ||
    typeof obj.name !== "string" ||
    (obj.kind !== "image" && obj.kind !== "video" && obj.kind !== "document")
  ) {
    return null;
  }
  return {
    url: obj.url,
    name: obj.name,
    kind: obj.kind,
    size: Number(obj.size) || 0,
    mime: String(obj.mime || ""),
  };
}

// Сообщения чата с вложениями едут через LiveKit в JSON-обёртке
// `{__voco:"msg", t, a: ChatAttachment[]}`. Чистый текст шлём как есть.
// Парсер также поддерживает legacy-формат `a: ChatAttachment` (одно вложение).
function buildChatPayload(text: string, attachments?: ChatAttachment[]): string {
  if (!attachments || attachments.length === 0) return text;
  return JSON.stringify({ __voco: "msg", t: text, a: attachments });
}

function parseChatPayload(raw: string | undefined | null): {
  text: string;
  attachments: ChatAttachment[];
} {
  if (!raw || typeof raw !== "string") return { text: raw ?? "", attachments: [] };
  if (!raw.startsWith("{")) return { text: raw, attachments: [] };
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.__voco === "msg" &&
      typeof parsed.t === "string"
    ) {
      const raw_a = parsed.a;
      const attachments: ChatAttachment[] = Array.isArray(raw_a)
        ? (raw_a.map(sanitizeChatAttachment).filter(Boolean) as ChatAttachment[])
        : (() => {
            const single = sanitizeChatAttachment(raw_a);
            return single ? [single] : [];
          })();
      return { text: parsed.t, attachments };
    }
  } catch {
    // не json — старый формат
  }
  return { text: raw, attachments: [] };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function readEntryTimestamp(entry: { timestamp?: unknown }): number {
  const ts = entry?.timestamp;
  if (typeof ts === "number" && Number.isFinite(ts)) return ts;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "string") {
    const n = Number(ts);
    if (Number.isFinite(n)) return n;
  }
  return Date.now();
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

function getStageTileFrames(
  count: number,
  gridLeft = DESKTOP_TILE_GRID_LEFT,
  expandSingleTile = false,
  expandedLeftPx = 0,
  expandedRightPx = 0,
  expandedAspectRatio = 16 / 9,
) {
  const normalizedCount = Math.max(1, Math.min(count, 4));

  if (normalizedCount === 1) {
    if (expandSingleTile) {
      // Tile максимально занимает зону между viewport-fixed панелями и bar'ами,
      // сохраняя aspect ratio демки — без обрезки и без боковых/верхних полос.
      // Тайл = медиа (зона видео) + футер 50px снизу. При подгонке аспекта учитываем,
      // что source aspect должен совпадать с медиа-зоной, а не со всем тайлом.
      const safeAspect = expandedAspectRatio > 0 ? expandedAspectRatio : 16 / 9;
      const horizontalReserved = expandedLeftPx + expandedRightPx;
      const verticalReserved = ROOM_BAR_HEIGHT * 2;
      const footer = TILE_FOOTER_HEIGHT;
      const widthCss = `min(calc(100vw - ${horizontalReserved}px), calc((100vh - ${verticalReserved}px - ${footer}px) * ${safeAspect}))`;
      const heightCss = `min(calc(100vh - ${verticalReserved}px), calc((100vw - ${horizontalReserved}px) / ${safeAspect} + ${footer}px))`;
      return [
        {
          id: "tile-1",
          accent: true,
          style: {
            position: "fixed" as const,
            top: `calc(${ROOM_BAR_HEIGHT}px + (100vh - ${verticalReserved}px) / 2)`,
            left: `calc((100vw + ${expandedLeftPx}px - ${expandedRightPx}px) / 2)`,
            width: widthCss,
            height: heightCss,
            transform: "translate(-50%, -50%)",
            zIndex: 1,
          },
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

function getTrackConnectionQuality(trackRef: any): ConnectionQuality {
  return trackRef?.participant?.connectionQuality ?? ConnectionQuality.Unknown;
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

function parseParticipantStatus(participant: any): {
  status: "pending" | "active";
  isGuest: boolean;
  role?: "OWNER" | "MODERATOR" | "PARTICIPANT";
} {
  const raw = participant?.metadata;
  if (!raw || typeof raw !== "string") {
    return { status: "active", isGuest: false };
  }
  try {
    const data = JSON.parse(raw);
    const rawRole = data?.role;
    const role =
      rawRole === "OWNER" || rawRole === "MODERATOR" || rawRole === "PARTICIPANT"
        ? rawRole
        : undefined;
    return {
      status: data?.status === "pending" ? "pending" : "active",
      isGuest: Boolean(data?.isGuest),
      role,
    };
  } catch {
    return { status: "active", isGuest: false };
  }
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

// Русское склонение: 1 голос / 2-4 голоса / 5+ голосов.
function pluralVotes(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 14) return "голосов";
  if (last === 1) return "голос";
  if (last >= 2 && last <= 4) return "голоса";
  return "голосов";
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
      viewBox="0 0 50 50"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path d="M25 38.5L25 13.5" stroke="currentColor" strokeWidth="2" />
      <line
        y1="-1"
        x2="10.2591"
        y2="-1"
        transform="matrix(-0.682318 -0.731055 0.682318 -0.731055 32 19.5)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        y1="-1"
        x2="10.2591"
        y2="-1"
        transform="matrix(-0.682318 0.731055 -0.682318 -0.731055 25 12)"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

type DeviceMenuKey = "mic" | "speaker" | "cam";
type DeviceKind = "audioinput" | "audiooutput" | "videoinput";
type RoomPanelKey = "participants" | "chat" | "settings";

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

function getConnectionQualityLevel(quality: ConnectionQuality) {
  switch (quality) {
    case ConnectionQuality.Excellent:
      return 3;
    case ConnectionQuality.Good:
      return 2;
    case ConnectionQuality.Poor:
      return 1;
    default:
      return 0;
  }
}

function TileSignal({ quality }: { quality: ConnectionQuality }) {
  const level = getConnectionQualityLevel(quality);
  const qualityClass =
    level === 3
      ? styles.tileSignalExcellent
      : level === 2
        ? styles.tileSignalGood
        : level === 1
          ? styles.tileSignalPoor
          : styles.tileSignalLost;

  return (
    <span
      className={`${styles.tileSignal} ${qualityClass}`}
      aria-label={`Качество соединения: ${quality}`}
      title={`Качество соединения: ${quality}`}
    >
      <svg viewBox="0 0 16 20" fill="none">
        <path
          className={level >= 3 ? styles.tileSignalBarActive : styles.tileSignalBarInactive}
          d="M15 0L15 20"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          className={level >= 2 ? styles.tileSignalBarActive : styles.tileSignalBarInactive}
          d="M8 5L8 20"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          className={level >= 1 ? styles.tileSignalBarActive : styles.tileSignalBarInactive}
          d="M1 10L1 20"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
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

// Tile с видео или с аватаркой пользователя поверх (когда камера выключена).
// useIsMuted реактивно следит за mute-стейтом текущего трека и переключает оверлей.
function TileMedia({
  trackRef,
  displayName,
  avatarUrl,
  isGuest,
}: {
  trackRef: any;
  displayName: string;
  avatarUrl: string | null;
  isGuest: boolean;
}) {
  const isMuted = useIsMuted(trackRef);
  // Скрин-шеру оверлей не нужен — там «пауза» крайне редкая, и плейсхолдер LK ок.
  const source = trackRef?.publication?.source ?? trackRef?.source;
  const isCamera = source === Track.Source.Camera;
  const showAvatar = isCamera && isMuted;

  return (
    <div className={styles.tileMediaWrapper}>
      <ParticipantTile className={styles.livekitTile} trackRef={trackRef} />
      {showAvatar ? (
        <div className={styles.tileAvatarOverlay}>
          <ParticipantAvatar
            name={displayName}
            avatarUrl={avatarUrl}
            isGuest={isGuest}
            className={styles.tileAvatar}
          />
        </div>
      ) : null}
    </div>
  );
}

type ExpiryPreset = "none" | "1d" | "1w" | "1m" | "1y" | "custom";

type SettingsTab = "settings" | "link" | "ban";

interface RoomMeta {
  name: string;
  maxUsers: number;
  allowGuests: boolean;
  requireApproval: boolean;
}

interface BlockedUserEntry {
  id: string;
  user: { id: string; username: string };
  reason?: string | null;
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

function formatDateTimeLocal(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`;
}

function SettingsPanel({
  slug,
  layoutClass,
  initialTab = "settings",
  roomMeta,
  blockedUsers,
  canEditSettings,
  onClose,
  onMetaSaved,
  onUnblockUser,
}: {
  slug: string;
  layoutClass?: string;
  initialTab?: SettingsTab;
  roomMeta: RoomMeta | null;
  blockedUsers: BlockedUserEntry[];
  canEditSettings: boolean;
  onClose: () => void;
  onMetaSaved: () => void | Promise<void>;
  onUnblockUser: (userId: string) => void | Promise<void>;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  // ===== Вкладка «Настройки» =====
  const [name, setName] = useState(roomMeta?.name ?? "");
  const [maxUsersInput, setMaxUsersInput] = useState(
    roomMeta?.maxUsers != null ? String(roomMeta.maxUsers) : "",
  );
  const [allowGuestsSettings, setAllowGuestsSettings] = useState(
    roomMeta?.allowGuests ?? true,
  );
  const [requireApprovalSettings, setRequireApprovalSettings] = useState(
    roomMeta?.requireApproval ?? false,
  );
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsJustSaved, setSettingsJustSaved] = useState(false);

  useEffect(() => {
    if (!roomMeta) return;
    setName(roomMeta.name);
    setMaxUsersInput(String(roomMeta.maxUsers));
    setAllowGuestsSettings(roomMeta.allowGuests);
    setRequireApprovalSettings(roomMeta.requireApproval);
  }, [roomMeta]);

  useEffect(() => {
    if (!settingsJustSaved) return;
    const id = window.setTimeout(() => setSettingsJustSaved(false), 1500);
    return () => window.clearTimeout(id);
  }, [settingsJustSaved]);

  const handleSaveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSettingsError(null);

    const trimmedName = name.trim();
    const parsedMax = Number.parseInt(maxUsersInput.trim(), 10);
    const payload: {
      name?: string;
      maxUsers?: number;
      allowGuests?: boolean;
      requireApproval?: boolean;
    } = {};

    if (trimmedName && trimmedName !== roomMeta?.name) payload.name = trimmedName;
    if (
      Number.isFinite(parsedMax) &&
      parsedMax >= 2 &&
      parsedMax <= 50 &&
      parsedMax !== roomMeta?.maxUsers
    ) {
      payload.maxUsers = parsedMax;
    }
    if (allowGuestsSettings !== roomMeta?.allowGuests) {
      payload.allowGuests = allowGuestsSettings;
    }
    if (requireApprovalSettings !== roomMeta?.requireApproval) {
      payload.requireApproval = requireApprovalSettings;
    }

    if (Object.keys(payload).length === 0) {
      setSettingsJustSaved(true);
      return;
    }

    setSavingSettings(true);
    try {
      await api.updateRoom(slug, payload);
      setSettingsJustSaved(true);
      await onMetaSaved();
    } catch (err: any) {
      setSettingsError(err?.message || "Не удалось сохранить");
    } finally {
      setSavingSettings(false);
    }
  };

  // ===== Вкладка «Ссылка» =====
  const [invites, setInvites] = useState<any[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [inviteError, setInviteError] = useState("");
  const [creating, setCreating] = useState(false);
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>("none");
  const [customExpiresAt, setCustomExpiresAt] = useState(() => formatDateTimeLocal(new Date()));
  const [maxUses, setMaxUses] = useState("");
  const [allowGuestsInvite, setAllowGuestsInvite] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [expiryDropdownOpen, setExpiryDropdownOpen] = useState(false);
  const expirySelectRef = useRef<HTMLDivElement>(null);

  const expiryOptions: { value: ExpiryPreset; label: string }[] = [
    { value: "none", label: "Без лимита" },
    { value: "1d", label: "1 день" },
    { value: "1w", label: "1 неделя" },
    { value: "1m", label: "1 месяц" },
    { value: "1y", label: "1 год" },
    { value: "custom", label: "Своё время" },
  ];

  const expiryLabel =
    expiryOptions.find((o) => o.value === expiryPreset)?.label ?? "Без лимита";

  useEffect(() => {
    if (!expiryDropdownOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (expirySelectRef.current?.contains(event.target as Node)) return;
      setExpiryDropdownOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [expiryDropdownOpen]);

  const nowLocal = formatDateTimeLocal(new Date());

  const reloadInvites = useCallback(async () => {
    setInvitesLoading(true);
    setInviteError("");
    try {
      const data = await api.listInvites(slug);
      const activeOnly = (data.invites ?? []).filter((invite: any) => invite.isActive);
      setInvites(activeOnly);
    } catch (err: any) {
      setInviteError(err?.message || "Не удалось загрузить ссылки");
    } finally {
      setInvitesLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (tab !== "link") return;
    void reloadInvites();
  }, [tab, reloadInvites]);

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
    if (expiryPreset === "1m") {
      const d = new Date(now);
      d.setMonth(d.getMonth() + 1);
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

  const handleCreateInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setInviteError("");

    const expiresDate = resolveExpiresAt();
    if (expiryPreset === "custom") {
      if (!expiresDate) {
        setInviteError("Укажите корректную дату истечения");
        return;
      }
      if (expiresDate.getTime() <= Date.now()) {
        setInviteError("Дата истечения не может быть в прошлом");
        return;
      }
      if (expiresDate.getFullYear() > 9999) {
        setInviteError("Год должен содержать не более 4 цифр");
        return;
      }
    }

    setCreating(true);
    try {
      const options: { expiresAt?: string; maxUses?: number; allowGuests?: boolean } = {
        allowGuests: allowGuestsInvite,
      };
      if (expiresDate) options.expiresAt = expiresDate.toISOString();
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
      setAllowGuestsInvite(true);
      await reloadInvites();
    } catch (err: any) {
      setInviteError(err?.message || "Не удалось создать ссылку");
    } finally {
      setCreating(false);
    }
  };

  const handleDeactivate = async (code: string) => {
    setInviteError("");
    try {
      await api.deactivateInvite(slug, code);
      setInvites((current) => current.filter((invite: any) => invite.code !== code));
    } catch (err: any) {
      setInviteError(err?.message || "Не удалось удалить ссылку");
    }
  };

  const copyInviteUrl = async (code: string) => {
    const url = `${window.location.origin}/invite/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(code);
      setTimeout(() => setCopied((current) => (current === code ? null : current)), 1500);
    } catch {
      setInviteError("Не удалось скопировать ссылку");
    }
  };

  const formatInviteUrl = (code: string) => {
    const full = `${window.location.origin}/invite/${code}`;
    if (full.length <= 28) return full;
    const startLen = 15;
    const endLen = 10;
    return `${full.slice(0, startLen)}...${full.slice(-endLen)}`;
  };

  const fullInviteUrl = (code: string) => `${window.location.origin}/invite/${code}`;

  return (
    <aside
      className={`${styles.settingsPanel} ${layoutClass ?? ""}`}
      data-tab={tab}
      role="dialog"
      aria-label="Настройки конференции"
      onClick={(event) => event.stopPropagation()}
    >
      <div className={styles.settingsHeader}>
        <div className={styles.settingsTabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "settings"}
            className={`${styles.settingsTab} ${tab === "settings" ? styles.settingsTabActive : ""}`}
            onClick={() => setTab("settings")}
          >
            Настройки
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "link"}
            className={`${styles.settingsTab} ${tab === "link" ? styles.settingsTabActive : ""}`}
            onClick={() => setTab("link")}
          >
            Ссылка
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "ban"}
            className={`${styles.settingsTab} ${tab === "ban" ? styles.settingsTabActive : ""}`}
            onClick={() => setTab("ban")}
          >
            Бан
          </button>
        </div>
        <button
          type="button"
          className={styles.settingsClose}
          onClick={onClose}
          aria-label="Закрыть"
        >
          <CloseCrossIcon />
        </button>
      </div>

      <div className={styles.settingsBody}>
        {tab === "settings" ? (
          <form className={styles.settingsForm} onSubmit={handleSaveSettings}>
            <label className={styles.settingsField}>
              <span>Название комнаты</span>
              <input
                type="text"
                value={name}
                placeholder="Название"
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                disabled={!canEditSettings}
              />
            </label>

            <label className={styles.settingsField}>
              <span>Макс. количество участников</span>
              <input
                type="number"
                min={2}
                max={50}
                value={maxUsersInput}
                placeholder="Количество"
                onChange={(event) => setMaxUsersInput(event.target.value)}
                disabled={!canEditSettings}
              />
            </label>

            <button
              type="button"
              className={`${styles.settingsToggleRow} ${
                allowGuestsSettings ? styles.settingsToggleOn : styles.settingsToggleOff
              }`}
              aria-pressed={allowGuestsSettings}
              onClick={() => setAllowGuestsSettings((v) => !v)}
              disabled={!canEditSettings}
            >
              <span className={styles.settingsToggleText}>Разрешить вход гостям</span>
              <span className={styles.settingsToggleDot} aria-hidden="true" />
            </button>

            <button
              type="button"
              className={`${styles.settingsToggleRow} ${
                requireApprovalSettings ? styles.settingsToggleOn : styles.settingsToggleOff
              }`}
              aria-pressed={requireApprovalSettings}
              onClick={() => setRequireApprovalSettings((v) => !v)}
              disabled={!canEditSettings}
            >
              <span className={styles.settingsToggleText}>Вход по запросу</span>
              <span className={styles.settingsToggleDot} aria-hidden="true" />
            </button>

            {settingsError ? (
              <div className={styles.settingsError}>{settingsError}</div>
            ) : null}

            <button
              type="submit"
              className={styles.settingsSaveButton}
              disabled={savingSettings || !canEditSettings}
            >
              {savingSettings
                ? "Сохранение..."
                : settingsJustSaved
                  ? "Сохранено"
                  : "Сохранить"}
            </button>
          </form>
        ) : null}

        {tab === "link" ? (
          <div className={styles.settingsLinkTab}>
            <form className={styles.settingsForm} onSubmit={handleCreateInvite}>
              <label className={`${styles.settingsField} ${styles.settingsLinkMaxUsesField}`}>
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

              <div className={`${styles.settingsField} ${styles.settingsLinkExpiryField}`}>
                <span>Срок действия</span>
                <div className={styles.settingsSelectWrapper} ref={expirySelectRef}>
                  <button
                    type="button"
                    className={styles.settingsFakeSelect}
                    onClick={() => setExpiryDropdownOpen((o) => !o)}
                    aria-haspopup="listbox"
                    aria-expanded={expiryDropdownOpen}
                  >
                    <span className={styles.settingsFakeSelectValue}>{expiryLabel}</span>
                  </button>
                  <span className={styles.settingsSelectChevron} aria-hidden="true">
                    <ChevronDownIcon />
                  </span>
                  {expiryDropdownOpen ? (
                    <ul className={styles.settingsDropdown} role="listbox">
                      {expiryOptions.map((opt) => (
                        <li
                          key={opt.value}
                          role="option"
                          aria-selected={expiryPreset === opt.value}
                          className={`${styles.settingsDropdownItem} ${
                            expiryPreset === opt.value ? styles.settingsDropdownItemActive : ""
                          }`}
                          onClick={() => {
                            setExpiryPreset(opt.value);
                            setExpiryDropdownOpen(false);
                          }}
                        >
                          {opt.label}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>

              {expiryPreset === "custom" ? (
                <label className={`${styles.settingsField} ${styles.settingsLinkCustomExpiryField}`}>
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

              <button
                type="button"
                className={`${styles.settingsToggleRow} ${
                  allowGuestsInvite ? styles.settingsToggleOn : styles.settingsToggleOff
                }`}
                aria-pressed={allowGuestsInvite}
                onClick={() => setAllowGuestsInvite((v) => !v)}
              >
                <span className={styles.settingsToggleText}>Разрешить вход гостям</span>
                <span className={styles.settingsToggleDot} aria-hidden="true" />
              </button>

              {inviteError ? <div className={styles.settingsError}>{inviteError}</div> : null}

              <button
                type="submit"
                className={styles.settingsCreateLink}
                disabled={creating}
              >
                {creating ? "Создание..." : "Создать ссылку"}
              </button>
            </form>

            <div className={styles.settingsLinkList}>
              {invitesLoading ? (
                <div className={styles.settingsEmpty}>Загрузка...</div>
              ) : invites.length === 0 ? (
                <div className={styles.settingsEmpty}>Ссылок ещё нет</div>
              ) : (
                invites.map((invite: any) => {
                  const usesLabel = invite.maxUses
                    ? `${invite.usesCount}/${invite.maxUses}`
                    : `${invite.usesCount}/без лимита`;
                  const expiresLabel = invite.expiresAt
                    ? `Срок действия: ${new Date(invite.expiresAt).toLocaleDateString("ru-RU")}`
                    : "Срок действия: без лимита";
                  const isCopied = copied === invite.code;
                  return (
                    <div key={invite.id} className={styles.settingsLinkCard}>
                      <span
                        className={`${styles.settingsLinkUrl} ${isCopied ? styles.settingsLinkUrlCopied : ""}`}
                        aria-live="polite"
                        title={isCopied ? undefined : fullInviteUrl(invite.code)}
                      >
                        {isCopied ? "Скопировано!" : formatInviteUrl(invite.code)}
                      </span>
                      <div className={styles.settingsLinkMeta}>
                        <div>Использований: {usesLabel}</div>
                        <div>{expiresLabel}</div>
                        <div>
                          Вход гостей: {invite.allowGuests ? "разрешено" : "запрещено"}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={styles.settingsLinkIconBtn}
                        onClick={() => copyInviteUrl(invite.code)}
                        aria-label={isCopied ? "Скопировано" : "Копировать"}
                      >
                        <CopyIcon />
                      </button>
                      <button
                        type="button"
                        className={styles.settingsLinkDeleteBtn}
                        onClick={() => handleDeactivate(invite.code)}
                        aria-label="Удалить"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : null}

        {tab === "ban" ? (
          <div className={styles.settingsBanTab}>
            {blockedUsers.length === 0 ? (
              <div className={styles.settingsEmpty}>Заблокированных нет</div>
            ) : (
              blockedUsers.map((entry) => (
                <div key={entry.id} className={styles.settingsBanRow}>
                  <ParticipantAvatar name={entry.user.username} avatarUrl={null} />
                  <span className={styles.settingsBanName}>{entry.user.username}</span>
                  <button
                    type="button"
                    className={styles.settingsBanUnblock}
                    onClick={() => void onUnblockUser(entry.user.id)}
                  >
                    Разбанить
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
function SettingsIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.settingsSvg, className)}
      viewBox="0 0 50 50"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <rect width="50" height="50" rx="25" fill="currentColor" />
      <circle cx="25" cy="25" r="4" stroke="var(--settings-icon-color, #000)" strokeWidth="2" />
      <path
        d="M23.9834 16.5547C24.5334 15.9659 25.4666 15.9659 26.0166 16.5547C26.8137 17.4085 27.9949 17.7925 29.1416 17.5703C29.9328 17.4172 30.6884 17.9658 30.7871 18.7656C30.9302 19.9248 31.6595 20.9286 32.7178 21.4229C33.4479 21.7639 33.7368 22.6523 33.3467 23.3574C32.781 24.3793 32.781 25.6207 33.3467 26.6426C33.7368 27.3477 33.4479 28.2361 32.7178 28.5771C31.6595 29.0714 30.9302 30.0752 30.7871 31.2344C30.6884 32.0342 29.9328 32.5828 29.1416 32.4297C27.9949 32.2075 26.8137 32.5915 26.0166 33.4453C25.4666 34.0341 24.5334 34.0341 23.9834 33.4453C23.1863 32.5915 22.0051 32.2075 20.8584 32.4297C20.0672 32.5828 19.3116 32.0342 19.2129 31.2344C19.0698 30.0752 18.3405 29.0714 17.2822 28.5771C16.5521 28.2361 16.2632 27.3477 16.6533 26.6426C17.219 25.6207 17.219 24.3793 16.6533 23.3574C16.2632 22.6523 16.5521 21.7639 17.2822 21.4229C18.3405 20.9286 19.0698 19.9248 19.2129 18.7656C19.3116 17.9658 20.0672 17.4172 20.8584 17.5703C22.0051 17.7925 23.1863 17.4085 23.9834 16.5547Z"
        stroke="var(--settings-icon-color, #000)"
        strokeWidth="2"
      />
    </svg>
  );
}

function CopyIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function TrashIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 7h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M10 11v7M14 11v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CloseCrossIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function OwnerCrownIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={iconClassName(styles.roomIcon, styles.ownerCrownSvg, className)}
      viewBox="0 0 50 50"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M18 36V16L22 23L25 17L28 23L32 16V36H18Z"
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
  isGuest,
}: {
  name: string;
  avatarUrl?: string | null;
  className?: string;
  square?: boolean;
  isGuest?: boolean;
}) {
  const avatarLabel = typeof avatarUrl === "string" && avatarUrl.trim() ? avatarUrl : null;
  // Если в avatarUrl лежит относительный URL загруженного фото — рендерим <img>.
  const isImageAvatar =
    typeof avatarLabel === "string" && avatarLabel.startsWith("/uploads/");
  const fallbackLabel = isImageAvatar ? null : (avatarLabel ?? getInitials(name));

  return (
    <span
      className={`${styles.participantAvatar} ${square ? styles.participantAvatarSquare : ""} ${
        isGuest ? styles.participantAvatarGuest : ""
      } ${className ?? ""}`}
    >
      {isGuest ? (
        <svg
          className={styles.participantGuestAvatarIcon}
          width="50"
          height="50"
          viewBox="0 0 50 50"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="25" cy="25" r="25" fill="#8000FF" />
          <ellipse
            className={styles.participantGuestAvatarFace}
            cx="19.5"
            cy="21.5005"
            rx="3.5"
            ry="2.5"
            transform="rotate(10 19.5 21.5005)"
            fill="#EEDCFF"
          />
          <ellipse
            className={styles.participantGuestAvatarFace}
            cx="3.5"
            cy="2.5"
            rx="3.5"
            ry="2.5"
            transform="matrix(-0.984808 0.173648 0.173648 0.984808 33.5127 18.4307)"
            fill="#EEDCFF"
          />
          <path
            className={styles.participantGuestAvatarStroke}
            d="M38.5 13.5V26C38.5 33.4558 32.4558 39.5 25 39.5C17.5442 39.5 11.5 33.4558 11.5 26V13.5H38.5Z"
            stroke="#EEDCFF"
            strokeWidth="3"
          />
        </svg>
      ) : null}
      {isImageAvatar ? (
        <img
          src={avatarLabel ?? ""}
          alt=""
          className={styles.participantAvatarImage}
          draggable={false}
        />
      ) : (
        <span className={styles.participantAvatarFallback}>{fallbackLabel}</span>
      )}
    </span>
  );
}

interface PendingWatcherProps {
  onApproved: () => void;
}

export function PendingWatcher({ onApproved }: PendingWatcherProps) {
  const room = useRoomContext();
  useEffect(() => {
    if (!room) return;
    // Слушаем РЕАЛЬНОЕ событие смены permissions у локального участника.
    // Initial check не делаем — он ловит дефолтные значения до первого heartbeat
    // от LiveKit и ошибочно триггерит approved.
    const handle = (_prev: unknown, participant: any) => {
      const localIdentity = room.localParticipant?.identity;
      if (!participant || !localIdentity || participant.identity !== localIdentity) return;
      const perms = participant.permissions;
      if (perms?.canSubscribe === true) {
        onApproved();
      }
    };
    room.on(RoomEvent.ParticipantPermissionsChanged, handle);
    return () => {
      room.off(RoomEvent.ParticipantPermissionsChanged, handle);
    };
  }, [room, onApproved]);
  return null;
}

export function ConferenceRoomContent({
  roomName,
  slug,
  onExitIntent,
  onEndRoomIntent,
  isOwner,
  canEndRoom,
  currentUserAvatarUrl,
  initialPinnedMessages,
  initialChatHistory,
  initialPolls,
  livekitToken,
}: ConferenceRoomContentProps) {
  const room = useRoomContext();
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
  const [handRaisedMap, setHandRaisedMap] = useState<Record<string, boolean>>({});
  // identity → avatarUrl, синхронизируется через LiveKit participant attributes.
  // Нужно, чтобы гости (у них нет Bearer-токена для GET /api/rooms/:slug, т.е.
  // нет participantMetaByUserId) видели аватарки зарегистрированных, а все
  // клиенты видели свежий аватар после смены в профиле без переподключения.
  const [avatarAttrMap, setAvatarAttrMap] = useState<Record<string, string>>({});
  const [openDeviceMenu, setOpenDeviceMenu] = useState<DeviceMenuKey | null>(null);
  const [exitMenuOpen, setExitMenuOpen] = useState(false);
  const [visiblePanels, setVisiblePanels] = useState<Record<RoomPanelKey, boolean>>({
    participants: false,
    chat: false,
    settings: false,
  });
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>("settings");
  const [roomMeta, setRoomMeta] = useState<RoomMeta | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>(
    () => initialPinnedMessages ?? [],
  );
  const [currentPinIndex, setCurrentPinIndex] = useState(0);
  const [pinListOpen, setPinListOpen] = useState(false);
  const pinListRef = useRef<HTMLDivElement>(null);
  const [chatHistory, setChatHistory] = useState<ChatHistoryEntry[]>(
    () => initialChatHistory ?? [],
  );
  const [polls, setPolls] = useState<Poll[]>(() => initialPolls ?? []);
  const [pollModalOpen, setPollModalOpen] = useState(false);
  const [pollResultsId, setPollResultsId] = useState<string | null>(null);
  const [pollBusyId, setPollBusyId] = useState<string | null>(null);
  const [pollError, setPollError] = useState("");
  // Промежуточный выбор пользователя в баблах опросов до клика «Голосовать»:
  // pollId → массив option_id, которые сейчас отмечены чекбоксами/радио.
  const [pollDraftVotes, setPollDraftVotes] = useState<Record<string, string[]>>({});
  // Inline-ошибка под кнопкой «Голосовать» в баббле конкретного опроса.
  const [pollVoteErrorByPoll, setPollVoteErrorByPoll] = useState<Record<string, string>>({});
  const [chatClearedAt, setChatClearedAt] = useState(0);
  const [clearChatConfirmOpen, setClearChatConfirmOpen] = useState(false);
  const savedChatKeysRef = useRef<Set<string>>(new Set());
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [uploadingAttachmentCount, setUploadingAttachmentCount] = useState(0);
  const [attachmentError, setAttachmentError] = useState("");
  const pendingGroup: AttachmentGroup | null =
    pendingAttachments.length > 0 ? attachmentGroupOf(pendingAttachments[0].kind) : null;
  const uploadingAttachment = uploadingAttachmentCount > 0;
  // Лайтбокс умеет листать всю медиа-группу сообщения: items — массив, index —
  // активный элемент. Открывается из коллажа (клик по плитке или «+N»).
  type LightboxItem = { url: string; kind: "image" | "video"; name: string };
  const [lightboxState, setLightboxState] = useState<{
    items: LightboxItem[];
    index: number;
  } | null>(null);
  const lightboxItem = lightboxState
    ? lightboxState.items[lightboxState.index] ?? null
    : null;
  const closeLightbox = useCallback(() => setLightboxState(null), []);
  const lightboxNext = useCallback(() => {
    setLightboxState((cur) =>
      cur ? { ...cur, index: (cur.index + 1) % cur.items.length } : cur,
    );
  }, []);
  const lightboxPrev = useCallback(() => {
    setLightboxState((cur) =>
      cur
        ? { ...cur, index: (cur.index - 1 + cur.items.length) % cur.items.length }
        : cur,
    );
  }, []);
  useEffect(() => {
    if (!lightboxState) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxState(null);
      else if (event.key === "ArrowRight") lightboxNext();
      else if (event.key === "ArrowLeft") lightboxPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxState, lightboxNext, lightboxPrev]);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const composerMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [openParticipantMenu, setOpenParticipantMenu] = useState<string | null>(null);
  const [participantMenuRect, setParticipantMenuRect] = useState<{ top: number; left: number } | null>(null);
  const [roomParticipants, setRoomParticipants] = useState<RoomParticipantMeta[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<
    Array<{ id: string; user: { id: string; username: string }; reason?: string | null }>
  >([]);
  const [roomRole, setRoomRole] = useState<RoomRole | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingNow, setRecordingNow] = useState(Date.now());
  const [codeCopyStatus, setCodeCopyStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [tilePage, setTilePage] = useState(0);
  const [participantsMetaTick, setParticipantsMetaTick] = useState(0);
  const [pendingActionFor, setPendingActionFor] = useState<string | null>(null);
  const codeCopyResetRef = useRef<number | null>(null);

  useEffect(() => {
    if (!room) return;
    const bump = () => setParticipantsMetaTick((tick) => tick + 1);
    room.on(RoomEvent.ParticipantMetadataChanged, bump);
    room.on(RoomEvent.ParticipantConnected, bump);
    room.on(RoomEvent.ParticipantDisconnected, bump);
    room.on(RoomEvent.ConnectionQualityChanged, bump);
    room.on(RoomEvent.LocalTrackPublished, bump);
    return () => {
      room.off(RoomEvent.ParticipantMetadataChanged, bump);
      room.off(RoomEvent.ParticipantConnected, bump);
      room.off(RoomEvent.ParticipantDisconnected, bump);
      room.off(RoomEvent.ConnectionQualityChanged, bump);
      room.off(RoomEvent.LocalTrackPublished, bump);
    };
  }, [room]);

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
      const r = data.room;
      if (r) {
        setRoomMeta({
          name: r.name ?? "",
          maxUsers: typeof r.maxUsers === "number" ? r.maxUsers : 10,
          allowGuests: r.allowGuests ?? true,
          requireApproval: r.requireApproval ?? false,
        });
      }
      if (Array.isArray(r?.pinnedMessages)) {
        setPinnedMessages(r.pinnedMessages as PinnedMessage[]);
      }
      if (Array.isArray(r?.chatHistory)) {
        setChatHistory(r.chatHistory as ChatHistoryEntry[]);
      }
      if (Array.isArray(r?.polls)) {
        setPolls(r.polls as Poll[]);
      }
      // Список заблокированных доступен только владельцу/модератору; для остальных вернётся 403
      if (nextRole === "OWNER" || nextRole === "MODERATOR") {
        try {
          const blocked = await api.listBlocked(slug);
          setBlockedUsers(blocked.blocked ?? []);
        } catch {
          // ignore
        }
      } else {
        setBlockedUsers([]);
      }
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

  const closeParticipantMenu = useCallback(() => {
    setParticipantMenuRect(null);
    setOpenParticipantMenu(null);
  }, []);

  const sendModerationCommand = useCallback(
    async (type: "mute" | "kick", targetIdentity: string) => {
      if (!localParticipant || !targetIdentity) return;
      const payload = new TextEncoder().encode(
        JSON.stringify({ type, target: targetIdentity }),
      );
      try {
        await localParticipant.publishData(payload, {
          reliable: true,
          topic: "voco-moderation",
          destinationIdentities: [targetIdentity],
        });
      } catch (error) {
        console.error("Не удалось отправить команду модерации", error);
      }
    },
    [localParticipant],
  );

  const handleToggleModerator = useCallback(
    async (meta: RoomParticipantMeta) => {
      closeParticipantMenu();
      if (!slug || !meta.user.id) return;
      const nextRole = meta.role === "MODERATOR" ? "PARTICIPANT" : "MODERATOR";
      try {
        await api.changeParticipantRole(slug, meta.user.id, nextRole);
        await refreshRoomState();
      } catch (error) {
        console.error("Не удалось изменить роль", error);
      }
    },
    [slug, refreshRoomState, closeParticipantMenu],
  );

  const handleMuteParticipant = useCallback(
    async (meta: RoomParticipantMeta) => {
      closeParticipantMenu();
      if (!meta.user.id) return;
      await sendModerationCommand("mute", meta.user.id);
    },
    [sendModerationCommand, closeParticipantMenu],
  );

  const handleKickParticipant = useCallback(
    async (meta: RoomParticipantMeta) => {
      closeParticipantMenu();
      if (!meta.user.id) return;
      await sendModerationCommand("kick", meta.user.id);
    },
    [sendModerationCommand, closeParticipantMenu],
  );

  const handleBanParticipant = useCallback(
    async (meta: RoomParticipantMeta) => {
      closeParticipantMenu();
      if (!slug || !meta.user.id) return;
      try {
        await api.blockUser(slug, meta.user.id);
        await refreshRoomState();
      } catch (error) {
        console.error("Не удалось забанить участника", error);
      }
    },
    [slug, refreshRoomState, closeParticipantMenu],
  );

  useEffect(() => {
    if (!room) return;
    const handleData = (
      payload: Uint8Array,
      _participant?: unknown,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic && topic !== "voco-moderation") return;
      let message: { type?: string; target?: string } | null = null;
      try {
        message = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        return;
      }
      if (!message || message.target !== localParticipant?.identity) return;
      if (message.type === "mute") {
        void localParticipant?.setMicrophoneEnabled(false);
      } else if (message.type === "kick") {
        onExitIntent();
        void room.disconnect();
      }
    };
    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room, localParticipant, onExitIntent]);

  // Live-синхронизация закреплённых сообщений: модератор после pin/unpin
  // публикует data-сообщение с полным списком, остальные просто заменяют состояние.
  useEffect(() => {
    if (!room) return;
    const handle = (
      payload: Uint8Array,
      _participant?: unknown,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic !== "voco-pins") return;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(payload));
        if (parsed?.type === "pin_list" && Array.isArray(parsed.pins)) {
          setPinnedMessages(parsed.pins as PinnedMessage[]);
        }
      } catch {
        // ignore
      }
    };
    room.on(RoomEvent.DataReceived, handle);
    return () => {
      room.off(RoomEvent.DataReceived, handle);
    };
  }, [room]);

  // Live-синхронизация опросов: получаем полный объект Poll и мерджим.
  // myVote — поле «индивидуального просмотра», поэтому его пересчитываем
  // относительно своей identity, а не берём из payload.
  useEffect(() => {
    if (!room) return;
    const handle = (
      payload: Uint8Array,
      _participant?: unknown,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic !== "voco-polls") return;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(payload));
        if (parsed?.type !== "poll_full" || !parsed.poll) return;
        const incoming = parsed.poll as Poll;
        const myIdentity = localParticipant?.identity;
        setPolls((prev) => {
          const idx = prev.findIndex((p) => p.id === incoming.id);
          // Для не-анонимных пересчитываем myVote по списку voters.
          // Для анонимных — сохраняем локальный (broadcast его не содержит).
          const recomputeMyVote = (poll: Poll) => {
            if (!myIdentity) return poll.myVote ?? [];
            if (poll.isAnonymous) {
              // Берём предыдущий локальный myVote, если был.
              return idx === -1 ? [] : prev[idx].myVote ?? [];
            }
            const my: string[] = [];
            for (const opt of poll.options) {
              if (opt.voters.some((v) => v.identity === myIdentity)) {
                my.push(opt.id);
              }
            }
            return my;
          };
          const next: Poll = { ...incoming, myVote: recomputeMyVote(incoming) };
          if (idx === -1) {
            return [...prev, next].sort((a, b) =>
              a.createdAt - b.createdAt,
            );
          }
          const copy = prev.slice();
          copy[idx] = next;
          return copy;
        });
      } catch {
        // ignore
      }
    };
    room.on(RoomEvent.DataReceived, handle);
    return () => {
      room.off(RoomEvent.DataReceived, handle);
    };
  }, [room, localParticipant]);

  // Очистка чата от модератора: clearedAt — это серверное «отсечение»,
  // все сообщения с sentAt <= clearedAt больше не показываются ни у кого.
  useEffect(() => {
    if (!room) return;
    const handle = (
      payload: Uint8Array,
      _participant?: unknown,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic !== "voco-chat-clear") return;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(payload));
        const at = typeof parsed?.at === "number" ? parsed.at : Date.now();
        setChatClearedAt((prev) => Math.max(prev, at));
        setChatHistory([]);
        setPinnedMessages([]);
        setPolls([]);
      } catch {
        setChatClearedAt(Date.now());
        setChatHistory([]);
        setPinnedMessages([]);
        setPolls([]);
      }
    };
    room.on(RoomEvent.DataReceived, handle);
    return () => {
      room.off(RoomEvent.DataReceived, handle);
    };
  }, [room]);

  // Держим индекс активного пина в диапазоне массива; новый пин показываем последним.
  useEffect(() => {
    setCurrentPinIndex((idx) => {
      if (pinnedMessages.length === 0) return 0;
      if (idx >= pinnedMessages.length) return pinnedMessages.length - 1;
      if (idx < 0) return 0;
      return idx;
    });
  }, [pinnedMessages.length]);

  // Закрываем поповер со списком пинов по клику снаружи
  useEffect(() => {
    if (!pinListOpen) return;
    const handleDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (pinListRef.current?.contains(event.target)) return;
      setPinListOpen(false);
    };
    window.addEventListener("mousedown", handleDown);
    return () => window.removeEventListener("mousedown", handleDown);
  }, [pinListOpen]);

  const broadcastPinList = useCallback(
    async (pins: PinnedMessage[]) => {
      if (!localParticipant) return;
      try {
        const payload = new TextEncoder().encode(
          JSON.stringify({ type: "pin_list", pins }),
        );
        await localParticipant.publishData(payload, {
          reliable: true,
          topic: "voco-pins",
        });
      } catch (error) {
        console.error("Не удалось разослать обновление пинов", error);
      }
    },
    [localParticipant],
  );

  const handlePinChatMessage = useCallback(
    async (entry: {
      message: string;
      from?: { identity?: string; name?: string };
      timestamp?: number;
      externalId?: string;
      attachments?: ChatAttachment[] | null;
    }) => {
      if (!slug) return;
      try {
        const data: any = await api.pinMessage(slug, {
          message: entry.message,
          authorIdentity: entry.from?.identity,
          authorName: entry.from?.name,
          originalExternalId: entry.externalId,
          originalTimestamp: entry.timestamp,
          attachments:
            entry.attachments && entry.attachments.length > 0
              ? entry.attachments
              : undefined,
        });
        const newPin = data?.pin as PinnedMessage | undefined;
        if (newPin) {
          const next = [...pinnedMessages, newPin];
          setPinnedMessages(next);
          setCurrentPinIndex(next.length - 1);
          void broadcastPinList(next);
        }
      } catch (error) {
        console.error("Не удалось закрепить сообщение", error);
      }
    },
    [slug, pinnedMessages, broadcastPinList],
  );

  // Прыжок к оригинальному сообщению из плашки закрепа.
  // Ищем строку в текущем chatScroll по data-message-id и подсвечиваем её.
  const handleJumpToPinned = useCallback((pin: PinnedMessage) => {
    if (!chatScrollRef.current) return;
    const targetId = pin.originalExternalId;
    if (!targetId) return;
    const escaped = (window as any).CSS?.escape ? (window as any).CSS.escape(targetId) : targetId;
    const node = chatScrollRef.current.querySelector(
      `[data-message-id="${escaped}"]`,
    ) as HTMLElement | null;
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add(styles.chatMessageRowHighlight);
    window.setTimeout(() => {
      node.classList.remove(styles.chatMessageRowHighlight);
    }, 1600);
  }, []);

  const handleClearChatRequest = useCallback(() => {
    if (!slug) return;
    if (!api.getToken()) return;
    setClearChatConfirmOpen(true);
  }, [slug]);

  const handleClearChatConfirm = useCallback(async () => {
    if (!slug) return;
    if (!api.getToken()) return;
    setClearChatConfirmOpen(false);
    const at = Date.now();
    try {
      await api.clearRoomMessages(slug);
    } catch (error) {
      console.error("Не удалось очистить чат на сервере", error);
      return;
    }
    setChatHistory([]);
    setChatClearedAt(at);
    setPinnedMessages([]);
    setPolls([]);
    if (localParticipant) {
      try {
        const payload = new TextEncoder().encode(
          JSON.stringify({ type: "chat_cleared", at }),
        );
        await localParticipant.publishData(payload, {
          reliable: true,
          topic: "voco-chat-clear",
        });
      } catch (error) {
        console.error("Не удалось разослать очистку чата", error);
      }
    }
  }, [slug, localParticipant]);

  // === Опросы ===
  // Рассылка изменений опросов через LiveKit data-channel.
  // Тип "poll_full" — полный объект Poll (после создания/закрытия/голосования).
  // Тип "poll_removed" — pollId, чтобы убрать из локального состояния (при очистке).
  const broadcastPoll = useCallback(
    async (poll: Poll) => {
      if (!localParticipant) return;
      try {
        const payload = new TextEncoder().encode(
          JSON.stringify({ type: "poll_full", poll }),
        );
        await localParticipant.publishData(payload, {
          reliable: true,
          topic: "voco-polls",
        });
      } catch (err) {
        console.error("Не удалось разослать опрос", err);
      }
    },
    [localParticipant],
  );

  const upsertPoll = useCallback((poll: Poll) => {
    setPolls((prev) => {
      const idx = prev.findIndex((p) => p.id === poll.id);
      if (idx === -1) return [...prev, poll].sort((a, b) => a.createdAt - b.createdAt);
      const next = prev.slice();
      next[idx] = poll;
      return next;
    });
  }, []);

  const handleCreatePoll = useCallback(
    async (input: {
      question: string;
      options: string[];
      allowMultiple: boolean;
      isAnonymous: boolean;
    }) => {
      if (!slug) return;
      setPollError("");
      setPollBusyId("__create__");
      try {
        const createdByName = localParticipant?.name || undefined;
        const data: any = await api.createPoll(slug, { ...input, createdByName });
        const poll = data?.poll as Poll | undefined;
        if (!poll) throw new Error("Сервер не вернул опрос");
        upsertPoll(poll);
        void broadcastPoll(poll);
        setPollModalOpen(false);
      } catch (err: any) {
        setPollError(err?.message || "Не удалось создать опрос");
      } finally {
        setPollBusyId(null);
      }
    },
    [slug, upsertPoll, broadcastPoll, localParticipant],
  );

  const handleVotePoll = useCallback(
    async (pollId: string, optionIds: string[]) => {
      if (!slug || !localParticipant) return;
      // Гости (нет нашего JWT) — голосование запрещено.
      if (!api.getToken()) {
        setPollVoteErrorByPoll((prev) => ({
          ...prev,
          [pollId]: "Голосование доступно только зарегистрированным",
        }));
        return;
      }
      const voterIdentity = localParticipant.identity;
      const voterName = localParticipant.name || voterIdentity;
      setPollError("");
      setPollVoteErrorByPoll((prev) => {
        const copy = { ...prev };
        delete copy[pollId];
        return copy;
      });
      setPollBusyId(pollId);
      try {
        await api.votePoll(
          slug,
          pollId,
          { optionIds, voterIdentity, voterName },
        );
        // Локально проставляем голос. Сервер отдаст полное состояние позже
        // через broadcast (если это сделал владелец) — иначе сами обновим.
        setPolls((prev) =>
          prev.map((p) => {
            if (p.id !== pollId) return p;
            if (p.myVote.length > 0) return p; // защита от двойного клика
            const myVote = [...optionIds];
            const options = p.options.map((o) => {
              if (!optionIds.includes(o.id)) return o;
              const voted = !p.isAnonymous
                ? [
                    ...o.voters,
                    {
                      identity: voterIdentity,
                      name: voterName,
                      userId: null,
                      votedAt: Date.now(),
                    },
                  ]
                : o.voters;
              return { ...o, voteCount: o.voteCount + 1, voters: voted };
            });
            const updated: Poll = {
              ...p,
              options,
              totalVotes: p.totalVotes + optionIds.length,
              myVote,
            };
            // Рассылаем обновлённый опрос всем (с включением моего голоса в .voters,
            // если не анонимный). Для других смотрящих "myVote" будет пересчитан
            // в их upsert-логике (нет — оставим как есть; их myVote не зависит от нас).
            void broadcastPoll(updated);
            return updated;
          }),
        );
      } catch (err: any) {
        setPollVoteErrorByPoll((prev) => ({
          ...prev,
          [pollId]: err?.message || "Не удалось проголосовать",
        }));
      } finally {
        setPollBusyId(null);
      }
    },
    [slug, localParticipant, broadcastPoll],
  );

  const handleClosePoll = useCallback(
    async (pollId: string) => {
      if (!slug) return;
      setPollError("");
      setPollBusyId(pollId);
      try {
        await api.closePoll(slug, pollId);
        setPolls((prev) =>
          prev.map((p) => {
            if (p.id !== pollId) return p;
            const updated: Poll = {
              ...p,
              isClosed: true,
              closedAt: Date.now(),
            };
            void broadcastPoll(updated);
            return updated;
          }),
        );
      } catch (err: any) {
        setPollError(err?.message || "Не удалось закрыть опрос");
      } finally {
        setPollBusyId(null);
      }
    },
    [slug, broadcastPoll],
  );

  const handleUnpinMessage = useCallback(
    async (pinId: string) => {
      if (!slug || !pinId) return;
      try {
        await api.unpinMessage(slug, pinId);
        const next = pinnedMessages.filter((p) => p.id !== pinId);
        setPinnedMessages(next);
        void broadcastPinList(next);
      } catch (error) {
        console.error("Не удалось открепить сообщение", error);
      }
    },
    [slug, pinnedMessages, broadcastPinList],
  );

  useEffect(() => {
    if (!openParticipantMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-participant-menu-root]")) return;
      { setParticipantMenuRect(null); setOpenParticipantMenu(null); };
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setParticipantMenuRect(null); setOpenParticipantMenu(null); };
    };

    const handleViewportChange = () => {
      setParticipantMenuRect(null);
      setOpenParticipantMenu(null);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
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
    void room?.disconnect();
  }, [onExitIntent, room]);

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

  const handleCopyRoomCode = useCallback(async () => {
    if (!slug || codeCopyStatus === "copying") return;
    setCodeCopyStatus("copying");
    try {
      await navigator.clipboard.writeText(slug);
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
  }, [slug, codeCopyStatus]);

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

  void participantsMetaTick;
  const allRoomParticipants = [...participants];
  const pendingParticipants = allRoomParticipants.filter(
    (participant: any) =>
      participant.identity !== localIdentity &&
      parseParticipantStatus(participant).status === "pending",
  );
  const participantMetaByUserId = new Map(
    roomParticipants.map((participant) => [participant.user.id, participant] as const),
  );
  // Получаем роль участника. Сначала пытаемся из LiveKit-метаданных (доступно всем,
  // в т.ч. гостям), потом из participantMetaByUserId (только для авторизованных).
  const resolveParticipantRole = (participant: any): "OWNER" | "MODERATOR" | "PARTICIPANT" | undefined => {
    const fromMeta = parseParticipantStatus(participant).role;
    if (fromMeta) return fromMeta;
    return participantMetaByUserId.get(participant?.identity ?? "")?.role as any;
  };
  // Ранг для сортировки: OWNER → MODERATOR → обычный зарегистрированный → гость
  const participantRoleRank = (participant: any): number => {
    const identity = participant?.identity;
    if (!identity) return 3;
    if (identity.startsWith("guest_")) return 3;
    const role = resolveParticipantRole(participant);
    if (role === "OWNER") return 0;
    if (role === "MODERATOR") return 1;
    return 2;
  };
  const orderedParticipants = allRoomParticipants
    .filter(
      (participant: any) =>
        participant.identity === localIdentity ||
        parseParticipantStatus(participant).status !== "pending",
    )
    .sort((left: any, right: any) => {
      if (left.identity === localIdentity) return -1;
      if (right.identity === localIdentity) return 1;
      const lRank = participantRoleRank(left);
      const rRank = participantRoleRank(right);
      if (lRank !== rRank) return lRank - rRank;
      return (left.name || left.identity || "").localeCompare(right.name || right.identity || "", "ru");
    });
  const canModerateParticipants = Boolean(
    isOwner || roomRole === "OWNER" || roomRole === "MODERATOR",
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
  const isSettingsPanelOpen = visiblePanels.settings;
  const expandedTileLeft = isParticipantsPanelOpen ? DESKTOP_PARTICIPANTS_PANEL_WIDTH : 0;
  const expandedTileRight = isChatPanelOpen ? DESKTOP_CHAT_PANEL_WIDTH : 0;
  const expandedTrackPublication = (visibleTracks[0] as any)?.publication;
  const expandedTrack = expandedTrackPublication?.track;
  const expandedTrackSid: string | undefined = expandedTrackPublication?.trackSid;
  const expandedMediaRef = useRef<HTMLDivElement | null>(null);
  const [expandedVideoAspect, setExpandedVideoAspect] = useState<number | null>(null);
  const [expandedTrackDimsState, setExpandedTrackDimsState] = useState<
    { width: number; height: number } | null
  >(null);
  useEffect(() => {
    if (!expandedTrack) {
      setExpandedTrackDimsState(null);
      return;
    }
    const initial = expandedTrack.dimensions ?? expandedTrackPublication?.dimensions;
    if (initial?.width && initial?.height) {
      setExpandedTrackDimsState({ width: initial.width, height: initial.height });
    }
    const handle = (dims: { width: number; height: number } | undefined) => {
      if (dims?.width && dims?.height) {
        setExpandedTrackDimsState({ width: dims.width, height: dims.height });
      }
    };
    expandedTrack.on?.("videoDimensionsChanged", handle);
    return () => {
      expandedTrack.off?.("videoDimensionsChanged", handle);
    };
  }, [expandedTrack, expandedTrackPublication]);
  // Меряем aspect напрямую с <video>: videoWidth/Height у remote-трека
  // обновляются надёжнее, чем publication.dimensions / videoDimensionsChanged.
  useEffect(() => {
    setExpandedVideoAspect(null);
    const container = expandedMediaRef.current;
    if (!container) return;

    let activeVideo: HTMLVideoElement | null = null;
    let detach: (() => void) | null = null;

    const measure = () => {
      if (activeVideo && activeVideo.videoWidth > 0 && activeVideo.videoHeight > 0) {
        setExpandedVideoAspect(activeVideo.videoWidth / activeVideo.videoHeight);
      }
    };

    const attach = (video: HTMLVideoElement) => {
      if (video === activeVideo) return;
      detach?.();
      activeVideo = video;
      video.addEventListener("loadedmetadata", measure);
      video.addEventListener("resize", measure);
      measure();
      detach = () => {
        video.removeEventListener("loadedmetadata", measure);
        video.removeEventListener("resize", measure);
      };
    };

    const initial = container.querySelector("video");
    if (initial) attach(initial as HTMLVideoElement);

    const observer = new MutationObserver(() => {
      const next = container.querySelector("video");
      if (next) {
        attach(next as HTMLVideoElement);
      } else {
        detach?.();
        detach = null;
        activeVideo = null;
        setExpandedVideoAspect(null);
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      detach?.();
    };
  }, [expandedTrackSid]);
  const expandedTrackDims =
    expandedTrackDimsState ?? expandedTrackPublication?.dimensions;
  const expandedAspectRatio =
    expandedVideoAspect ??
    (expandedTrackDims?.width && expandedTrackDims?.height
      ? expandedTrackDims.width / expandedTrackDims.height
      : 16 / 9);
  const tileFrames = getStageTileFrames(
    visibleTracks.length,
    DESKTOP_TILE_GRID_LEFT,
    visibleTracks.length === 1 && hasExpandedVideoMedia(visibleTracks[0]),
    expandedTileLeft,
    expandedTileRight,
    expandedAspectRatio,
  );
  const tabletTileFrames = getTabletTileFrames(visibleTracks.length);
  const mobileVisibleTracks = visibleTracks.slice(0, 4);
  const mobileTileFrames = getMobileTileFrames(mobileVisibleTracks.length);

  useEffect(() => {
    setTilePage((current) => Math.min(current, tilePageCount - 1));
  }, [tilePageCount]);

  // Авто-сохранение чат-сообщений в БД. Дедуп по стабильному LiveKit-id (entry.id).
  // Каждый авторизованный клиент пишет ВСЕ сообщения, что видит (в т.ч. гостевые),
  // UNIQUE(room_id, external_id) на бэке снимает дубли между клиентами.
  useEffect(() => {
    if (!slug) return;
    if (!api.getToken()) return; // гостям бэкенд не доступен
    chatMessages.forEach((entry: any) => {
      const identity = entry.from?.identity;
      const externalId = typeof entry.id === "string" ? entry.id : "";
      if (!identity || !externalId) return;
      const sentAt = readEntryTimestamp(entry);
      if (sentAt <= chatClearedAt) return;
      if (savedChatKeysRef.current.has(externalId)) return;
      savedChatKeysRef.current.add(externalId);
      const { text, attachments } = parseChatPayload(entry.message);
      void api
        .saveRoomMessage(slug, {
          externalId,
          message: text,
          authorIdentity: identity,
          authorName: entry.from?.name,
          sentAt,
          isGuest: identity.startsWith("guest_"),
          attachments: attachments.length > 0 ? attachments : undefined,
        })
        .catch(() => {
          // молча — другой клиент сохранит, или это уже сохранённое
        });
    });
  }, [chatMessages, slug, chatClearedAt]);

  // Склеиваем серверную историю с live-сообщениями LiveKit. Дедуп по стабильному
  // LiveKit-id (externalId на сервере = entry.id у live). Если id вдруг нет — fallback
  // на identity+sentAt, но это резервный путь.
  const combinedChatEntries = useMemo(() => {
    type MessageEntry = {
      kind: "message";
      key: string;
      externalId?: string;
      sentAt: number;
      message: string;
      authorIdentity: string;
      authorName?: string | null;
      isGuest: boolean;
      attachments: ChatAttachment[];
    };
    type PollEntry = {
      kind: "poll";
      key: string;
      sentAt: number;
      authorIdentity: string;
      authorName?: string | null;
      isGuest: boolean;
      poll: Poll;
    };
    type Entry = MessageEntry | PollEntry;
    const map = new Map<string, Entry>();
    for (const item of chatHistory) {
      if (!item.authorIdentity) continue;
      const itemAttachments = item.attachments ?? [];
      if (!item.message && itemAttachments.length === 0) continue;
      if (item.sentAt <= chatClearedAt) continue;
      const key = item.externalId
        ? `ext:${item.externalId}`
        : `ts:${item.authorIdentity}|${item.sentAt}`;
      map.set(key, {
        kind: "message",
        key,
        externalId: item.externalId ?? undefined,
        sentAt: item.sentAt,
        message: item.message,
        authorIdentity: item.authorIdentity,
        authorName: item.authorName ?? undefined,
        isGuest: Boolean(item.isGuest) || item.authorIdentity.startsWith("guest_"),
        attachments: itemAttachments,
      });
    }
    for (const entry of chatMessages as any[]) {
      const identity = entry.from?.identity;
      if (!identity) continue;
      const sentAt = readEntryTimestamp(entry);
      if (sentAt <= chatClearedAt) continue;
      const externalId = typeof entry.id === "string" ? entry.id : "";
      const key = externalId ? `ext:${externalId}` : `ts:${identity}|${sentAt}`;
      const { text, attachments } = parseChatPayload(entry.message);
      map.set(key, {
        kind: "message",
        key,
        externalId: externalId || undefined,
        sentAt,
        message: text,
        authorIdentity: identity,
        authorName: entry.from?.name ?? undefined,
        isGuest: identity.startsWith("guest_"),
        attachments,
      });
    }
    // Опросы вписываются в общий timeline по createdAt (epoch ms с бэка).
    for (const poll of polls) {
      const sentAt = typeof poll.createdAt === "number" ? poll.createdAt : 0;
      if (sentAt <= chatClearedAt) continue;
      map.set(`poll:${poll.id}`, {
        kind: "poll",
        key: `poll:${poll.id}`,
        sentAt,
        authorIdentity: poll.createdBy ?? "",
        authorName: poll.createdByName,
        isGuest: false,
        poll,
      });
    }
    return Array.from(map.values()).sort((a, b) => a.sentAt - b.sentAt);
  }, [chatHistory, chatMessages, polls, chatClearedAt]);

  // Авто-скролл вниз: только когда добавлена новая запись (счётчик/последний key
  // изменились) И пользователь уже находится у нижнего края (≤80px). Иначе
  // обновления внутри уже видимых записей (например, пересчёт голосов в опросе)
  // не дёргают позицию — респектим то, что юзер скроллит руками.
  const lastEntryKeyRef = useRef<string>("");
  const lastEntryCountRef = useRef<number>(0);
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const lastKey = combinedChatEntries[combinedChatEntries.length - 1]?.key ?? "";
    const isNewEntry =
      combinedChatEntries.length !== lastEntryCountRef.current ||
      lastKey !== lastEntryKeyRef.current;
    lastEntryCountRef.current = combinedChatEntries.length;
    lastEntryKeyRef.current = lastKey;
    if (!isNewEntry) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > 80) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [combinedChatEntries]);

  useEffect(() => {
    if (!isChatPanelOpen) setEmojiPickerOpen(false);
  }, [isChatPanelOpen]);

  const handleToggleComposerMenu = useCallback(() => {
    setComposerMenuOpen((open) => !open);
    setAttachmentError("");
  }, []);

  const handlePickFile = useCallback(() => {
    // Сначала вызываем нативный picker — пока меню видимо и кнопка в DOM.
    // Только потом закрываем меню (state-change затем размонтирует кнопку).
    setAttachmentError("");
    fileInputRef.current?.click();
    setComposerMenuOpen(false);
  }, []);

  const handleOpenPolls = useCallback(() => {
    setPollError("");
    setPollModalOpen(true);
    setComposerMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!composerMenuOpen) return;
    const handleDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (composerMenuRef.current?.contains(event.target)) return;
      setComposerMenuOpen(false);
    };
    window.addEventListener("mousedown", handleDown);
    return () => window.removeEventListener("mousedown", handleDown);
  }, [composerMenuOpen]);

  const handleFileSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = ""; // позволяем выбрать те же файлы повторно
      if (files.length === 0 || !slug) return;
      setAttachmentError("");

      // Кинд по MIME (тот же маппинг, что на бэке в uploads.ts).
      const kindByMime = (mime: string): ChatAttachment["kind"] | null => {
        if (mime.startsWith("image/")) return "image";
        if (mime.startsWith("video/")) return "video";
        if (
          mime === "application/pdf" ||
          mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        ) {
          return "document";
        }
        return null;
      };

      // Определяем целевую группу: либо текущая (если уже что-то выбрано), либо
      // первая из переданных файлов.
      const currentGroup = pendingAttachments.length > 0
        ? attachmentGroupOf(pendingAttachments[0].kind)
        : null;

      const accepted: File[] = [];
      let rejectedGroupMismatch = false;
      let targetGroup: AttachmentGroup | null = currentGroup;
      for (const file of files) {
        const kind = kindByMime(file.type);
        if (!kind) {
          setAttachmentError(`Тип файла не поддерживается: ${file.name}`);
          continue;
        }
        const group = attachmentGroupOf(kind);
        if (!targetGroup) targetGroup = group;
        if (group !== targetGroup) {
          rejectedGroupMismatch = true;
          continue;
        }
        accepted.push(file);
      }
      if (rejectedGroupMismatch) {
        setAttachmentError(
          targetGroup === "media"
            ? "В одном сообщении — только фото/видео ИЛИ файлы"
            : "В одном сообщении — только файлы ИЛИ фото/видео",
        );
      }
      if (accepted.length === 0 || !targetGroup) return;

      const limit = ATTACHMENT_LIMITS[targetGroup];
      const remaining = Math.max(0, limit - pendingAttachments.length);
      const toUpload = accepted.slice(0, remaining);
      if (toUpload.length < accepted.length) {
        setAttachmentError(
          targetGroup === "media"
            ? `До ${limit} фото/видео в одном сообщении`
            : `До ${limit} файлов в одном сообщении`,
        );
      }
      if (toUpload.length === 0) return;

      setUploadingAttachmentCount((c) => c + toUpload.length);
      // Грузим параллельно; добавляем по мере готовности, сохраняя порядок выбора.
      const results = await Promise.allSettled(
        toUpload.map((file) => api.uploadRoomFile(slug, file, livekitToken)),
      );
      const uploaded: ChatAttachment[] = [];
      let lastError = "";
      for (const r of results) {
        if (r.status === "fulfilled") uploaded.push(r.value);
        else lastError = r.reason?.message || "Не удалось загрузить файл";
      }
      if (uploaded.length > 0) {
        setPendingAttachments((prev) => [...prev, ...uploaded].slice(0, limit));
      }
      if (lastError) setAttachmentError(lastError);
      setUploadingAttachmentCount((c) => Math.max(0, c - toUpload.length));
    },
    [slug, livekitToken, pendingAttachments],
  );

  const handleRemovePendingAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
    setAttachmentError("");
  }, []);

  const handleClearPendingAttachments = useCallback(() => {
    setPendingAttachments([]);
    setAttachmentError("");
  }, []);

  const handleChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedMessage = message.trim();
    if (!normalizedMessage && pendingAttachments.length === 0) return;
    if (uploadingAttachment) return;

    const payload = buildChatPayload(
      normalizedMessage,
      pendingAttachments.length > 0 ? pendingAttachments : undefined,
    );
    try {
      await send(payload);
      setMessage("");
      setPendingAttachments([]);
      setAttachmentError("");
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
      ? "Код скопирован"
      : codeCopyStatus === "copying"
        ? "Копируем..."
        : codeCopyStatus === "error"
          ? "Не удалось скопировать"
          : roomCodeBase;
  const roomCodeTitle = slug ? "Скопировать код комнаты" : undefined;

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
      <span className={styles.roomCodeCopyHint}>Скопировать код комнаты</span>
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
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className={styles.chatFileInput}
        accept={
          pendingGroup === "media"
            ? "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
            : pendingGroup === "files"
              ? "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              : "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        }
        onChange={(e) => void handleFileSelected(e)}
      />
      <div className={styles.chatAttachWrap} ref={composerMenuRef}>
        <button
          className={`${styles.chatIconButton} ${styles.chatAttachButton}`}
          type="button"
          aria-label="Меню вложений"
          aria-haspopup="menu"
          aria-expanded={composerMenuOpen}
          onClick={handleToggleComposerMenu}
          disabled={
            uploadingAttachment ||
            (pendingGroup !== null &&
              pendingAttachments.length >= ATTACHMENT_LIMITS[pendingGroup])
          }
        >
          <PlusIcon />
        </button>
        {composerMenuOpen ? (
          <div className={styles.chatAttachMenu} role="menu">
            <button
              type="button"
              className={`${styles.chatAttachMenuButton} ${styles.chatAttachMenuButtonFile}`}
              role="menuitem"
              aria-label="Прикрепить файл"
              title="Прикрепить файл"
              onClick={handlePickFile}
            />
            {canModerateParticipants ? (
              <button
                type="button"
                className={`${styles.chatAttachMenuButton} ${styles.chatAttachMenuButtonPoll}`}
                role="menuitem"
                aria-label="Создать опрос"
                title="Опрос"
                onClick={handleOpenPolls}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {pendingAttachments.length > 0 && pendingGroup ? (
        <div className={styles.chatPendingPanel}>
          <div
            className={styles.chatAttachmentInfoBar}
            data-state={attachmentError ? "error" : uploadingAttachment ? "loading" : "idle"}
          >
            <span className={styles.chatAttachmentInfoBarMessage}>
              {attachmentError
                ? attachmentError
                : uploadingAttachment
                  ? uploadingAttachmentCount > 1
                    ? `Загружаем файлы… (${uploadingAttachmentCount})`
                    : "Загружаем файл…"
                  : null}
            </span>
            <span className={styles.chatAttachmentInfoBarRight}>
              <span className={styles.chatAttachmentInfoBarCount}>
                {pendingGroup === "media"
                  ? `Фото/видео: ${pendingAttachments.length}/${ATTACHMENT_LIMITS.media}`
                  : `Файлы: ${pendingAttachments.length}/${ATTACHMENT_LIMITS.files}`}
              </span>
              <button
                type="button"
                className={styles.chatPendingClearAll}
                onClick={handleClearPendingAttachments}
              >
                Убрать все
              </button>
            </span>
          </div>
          {pendingGroup === "media" ? (
            <div className={styles.chatPendingGrid} data-count={pendingAttachments.length}>
              {pendingAttachments.map((att, idx) => (
                <div className={styles.chatPendingThumb} key={`${att.url}-${idx}`} title={att.name}>
                  {att.kind === "image" ? (
                    <img src={att.url} alt={att.name} loading="lazy" />
                  ) : (
                    <>
                      <video src={att.url} muted preload="metadata" />
                      <span className={styles.chatPendingPlay} aria-hidden="true" />
                    </>
                  )}
                  <button
                    type="button"
                    className={styles.chatPendingRemove}
                    onClick={() => handleRemovePendingAttachment(idx)}
                    aria-label={`Убрать ${att.name}`}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.chatPendingList}>
              {pendingAttachments.map((att, idx) => (
                <div className={styles.chatPendingFileRow} key={`${att.url}-${idx}`} title={att.name}>
                  <span className={styles.chatPendingFileIcon} aria-hidden="true" />
                  <span className={styles.chatPendingFileMeta}>
                    <span className={styles.chatPendingFileName}>{att.name}</span>
                    <span className={styles.chatPendingFileSize}>{formatFileSize(att.size)}</span>
                  </span>
                  <button
                    type="button"
                    className={styles.chatPendingFileRemove}
                    onClick={() => handleRemovePendingAttachment(idx)}
                    aria-label={`Убрать ${att.name}`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : uploadingAttachment || attachmentError ? (
        <div
          className={`${styles.chatAttachmentInfoBar} ${styles.chatAttachmentInfoBarFloating}`}
          data-state={attachmentError ? "error" : "loading"}
        >
          <span className={styles.chatAttachmentInfoBarMessage}>
            {attachmentError
              ? attachmentError
              : uploadingAttachmentCount > 1
                ? `Загружаем файлы… (${uploadingAttachmentCount})`
                : "Загружаем файл…"}
          </span>
        </div>
      ) : null}

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
        disabled={isSending || uploadingAttachment || (!message.trim() && pendingAttachments.length === 0)}
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
          settings: panel === "settings" ? !current.settings : false,
        };
      }

      return {
        ...current,
        [panel]: !current[panel],
      };
    });
  }, [isCompactLayout]);

  const openRoomPanel = useCallback((panel: RoomPanelKey) => {
    setVisiblePanels((current) => {
      if (isCompactLayout) {
        return {
          participants: panel === "participants",
          chat: panel === "chat",
          settings: panel === "settings",
        };
      }

      return {
        ...current,
        [panel]: true,
      };
    });
  }, [isCompactLayout]);
  const localIdentityForHand = localParticipant?.identity;
  const isHandRaised = localIdentityForHand
    ? Boolean(handRaisedMap[localIdentityForHand])
    : false;

  useEffect(() => {
    if (!room) return;

    const readFlag = (p: any): boolean => {
      const raw = p?.attributes?.handRaised;
      return raw === "true" || raw === true;
    };
    const readAvatar = (p: any): string => {
      const raw = p?.attributes?.avatarUrl;
      return typeof raw === "string" ? raw : "";
    };

    const snapshot = () => {
      const hand: Record<string, boolean> = {};
      const avatar: Record<string, string> = {};
      const visit = (p: any) => {
        if (!p?.identity) return;
        hand[p.identity] = readFlag(p);
        const a = readAvatar(p);
        if (a) avatar[p.identity] = a;
      };
      visit(room.localParticipant);
      const remotes: Iterable<any> =
        (room.remoteParticipants && typeof room.remoteParticipants.values === "function"
          ? room.remoteParticipants.values()
          : room.remoteParticipants) ?? [];
      for (const p of remotes) visit(p);
      return { hand, avatar };
    };
    const initial = snapshot();
    setHandRaisedMap(initial.hand);
    setAvatarAttrMap(initial.avatar);

    const handleAttributes = (changed: Record<string, string>, participant: any) => {
      if (!participant?.identity) return;
      if (changed && "handRaised" in changed) {
        setHandRaisedMap((prev) => ({
          ...prev,
          [participant.identity]: changed.handRaised === "true",
        }));
      }
      if (changed && "avatarUrl" in changed) {
        const next = typeof changed.avatarUrl === "string" ? changed.avatarUrl : "";
        setAvatarAttrMap((prev) => {
          if (!next) {
            if (!(participant.identity in prev)) return prev;
            const copy = { ...prev };
            delete copy[participant.identity];
            return copy;
          }
          if (prev[participant.identity] === next) return prev;
          return { ...prev, [participant.identity]: next };
        });
      }
    };
    const handleConnected = (participant: any) => {
      if (!participant?.identity) return;
      setHandRaisedMap((prev) => ({
        ...prev,
        [participant.identity]: readFlag(participant),
      }));
      const a = readAvatar(participant);
      setAvatarAttrMap((prev) => {
        if (!a) return prev;
        if (prev[participant.identity] === a) return prev;
        return { ...prev, [participant.identity]: a };
      });
    };
    const handleDisconnected = (participant: any) => {
      if (!participant?.identity) return;
      setHandRaisedMap((prev) => {
        if (!(participant.identity in prev)) return prev;
        const next = { ...prev };
        delete next[participant.identity];
        return next;
      });
      setAvatarAttrMap((prev) => {
        if (!(participant.identity in prev)) return prev;
        const next = { ...prev };
        delete next[participant.identity];
        return next;
      });
    };

    room.on(RoomEvent.ParticipantAttributesChanged, handleAttributes);
    room.on(RoomEvent.ParticipantConnected, handleConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleDisconnected);

    return () => {
      room.off(RoomEvent.ParticipantAttributesChanged, handleAttributes);
      room.off(RoomEvent.ParticipantConnected, handleConnected);
      room.off(RoomEvent.ParticipantDisconnected, handleDisconnected);
    };
  }, [room]);

  // Публикуем свою аватарку через LiveKit-аттрибут, чтобы её видели остальные
  // (в т.ч. гости, которым недоступен GET /api/rooms/:slug с participantMetaByUserId).
  // Пустая строка = нет аватарки (показывать инициалы / иконку гостя).
  useEffect(() => {
    if (!localParticipant) return;
    const value =
      typeof currentUserAvatarUrl === "string" && currentUserAvatarUrl
        ? currentUserAvatarUrl
        : "";
    void Promise.resolve(localParticipant.setAttributes({ avatarUrl: value })).catch(
      (err) => {
        console.error("setAttributes(avatarUrl) failed", err);
      },
    );
  }, [localParticipant, currentUserAvatarUrl]);

  const toggleRaisedHand = useCallback(() => {
    if (!localParticipant) return;
    const identity = localParticipant.identity;
    const next = !(identity ? Boolean(handRaisedMap[identity]) : false);
    if (identity) {
      setHandRaisedMap((prev) => ({ ...prev, [identity]: next }));
    }
    void Promise.resolve(localParticipant.setAttributes({ handRaised: next ? "true" : "false" })).catch(
      (err) => {
        console.error("setAttributes(handRaised) failed", err);
        if (identity) {
          setHandRaisedMap((prev) => ({ ...prev, [identity]: !next }));
        }
      },
    );
  }, [localParticipant, handRaisedMap]);
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

  const getParticipantMeta = (participant: any) => {
    const existing = participantMetaByUserId.get(participant?.identity);
    if (existing) {
      // Если у участника метаданные LiveKit говорят о более актуальной роли —
      // (например, гость смотрит и не имеет доступа к /api/rooms),
      // подменим. Для зарегистрированных это обычно одно и то же.
      const metaRole = parseParticipantStatus(participant).role;
      if (metaRole && metaRole !== existing.role) {
        return { ...existing, role: metaRole };
      }
      return existing;
    }
    const metaRole = parseParticipantStatus(participant).role;
    const fallbackRole =
      metaRole ??
      (participant?.identity === localIdentity && isOwner ? "OWNER" : "PARTICIPANT");
    return {
      id: participant?.identity ?? "",
      role: fallbackRole,
      user: {
        id: participant?.identity ?? "",
        username: participant?.name || participant?.identity || "Участник",
        avatarUrl: participant?.identity === localIdentity ? currentUserAvatarUrl ?? null : null,
      },
    } satisfies RoomParticipantMeta;
  };

  const canManageTarget = (meta: RoomParticipantMeta, isLocal: boolean) => {
    if (!canModerateParticipants || isLocal || !meta.user.id) return false;
    if (meta.role === "OWNER") return false;
    if (!(isOwner || roomRole === "OWNER") && meta.role === "MODERATOR") return false;
    return true;
  };

  const renderTrackMedia = (trackRef: any) => {
    if (!trackRef) {
      return (
        <div className={styles.placeholderTile}>
          <PlaceholderLogo />
        </div>
      );
    }
    const participant = trackRef.participant;
    const identity = participant?.identity ?? "";
    const isLocal = identity === localIdentity;
    // Лукап: 1) по identity (= userId для зарегистрированных), 2) резерв — по
    // participant.name (LiveKit display name == username), 3) у local — последний
    // fallback на currentUserAvatarUrl (мы знаем свой свежий выбор аватарки).
    let meta = participantMetaByUserId.get(identity);
    if (!meta && participant?.name) {
      meta = roomParticipants.find((p) => p.user.username === participant.name);
    }
    const displayName =
      meta?.user.username || participant?.name || identity || "Участник";
    // Аватарка: 1) метадата с сервера (для тех, кто звал GET /api/rooms/:slug),
    // 2) LiveKit-атрибут avatarUrl (работает и для гостей — единственный источник),
    // 3) свой свежий выбор у локального участника.
    const liveAvatar = avatarAttrMap[identity];
    const avatarUrl =
      (meta?.user.avatarUrl ?? null) ||
      (liveAvatar || null) ||
      (isLocal ? currentUserAvatarUrl ?? null : null);
    const isGuest =
      typeof identity === "string" && identity.startsWith("guest_");
    return (
      <TileMedia
        trackRef={trackRef}
        displayName={displayName}
        avatarUrl={avatarUrl}
        isGuest={isGuest}
      />
    );
  };

  const renderParticipantMenu = (meta: RoomParticipantMeta, isLocal: boolean) => {
    const isOpen = openParticipantMenu === meta.user.id;
    const canManage = canManageTarget(meta, isLocal);
    const isGuest = typeof meta.user.id === "string" && meta.user.id.startsWith("guest_");
    const canChangeRole = Boolean(
      (isOwner || roomRole === "OWNER") && canManage && meta.role !== "OWNER" && !isGuest,
    );

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
            const button = event.currentTarget;
            setOpenParticipantMenu((current) => {
              if (current === meta.user.id) {
                setParticipantMenuRect(null);
                return null;
              }
              const rect = button.getBoundingClientRect();
              const menuWidth = 173;
              const top = isCompactLayout ? rect.bottom + 4 : rect.top;
              const left = isCompactLayout
                ? Math.max(8, rect.right - menuWidth)
                : rect.right + 8;
              setParticipantMenuRect({ top, left });
              return meta.user.id;
            });
          }}
        >
          <MoreVerticalIcon />
        </button>

        {isOpen && participantMenuRect
          ? createPortal(
              <div
                className={styles.participantActionMenu}
                role="menu"
                data-participant-menu-root
                style={{
                  position: "fixed",
                  top: participantMenuRect.top,
                  left: participantMenuRect.left,
                  right: "auto",
                }}
              >
                {canChangeRole ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void handleToggleModerator(meta)}
                  >
                    {meta.role === "MODERATOR" ? "Снять права модера" : "Выдать права модера"}
                  </button>
                ) : null}
                {canManage ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleMuteParticipant(meta)}
                    >
                      Замутить
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleKickParticipant(meta)}
                    >
                      Кикнуть
                    </button>
                    {!isGuest ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void handleBanParticipant(meta)}
                      >
                        Забанить
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>,
              document.body,
            )
          : null}
      </div>
    );
  };

  const handleApprovePending = useCallback(
    async (identity: string) => {
      if (!slug) return;
      setPendingActionFor(identity);
      try {
        await api.approveParticipant(slug, identity);
      } catch (err) {
        console.error("approve error", err);
      } finally {
        setPendingActionFor((current) => (current === identity ? null : current));
      }
    },
    [slug],
  );

  const handleRejectPending = useCallback(
    async (identity: string) => {
      if (!slug) return;
      setPendingActionFor(identity);
      try {
        await api.rejectParticipant(slug, identity);
      } catch (err) {
        console.error("reject error", err);
      } finally {
        setPendingActionFor((current) => (current === identity ? null : current));
      }
    },
    [slug],
  );

  const handleUnblockUser = useCallback(
    async (userId: string) => {
      if (!slug) return;
      try {
        await api.unblockUser(slug, userId);
        await refreshRoomState();
      } catch (err) {
        console.error("unblock error", err);
      }
    },
    [slug, refreshRoomState],
  );

  const renderPendingParticipantRows = () => {
    if (pendingParticipants.length === 0) return null;
    if (!canModerateParticipants) return null;
    return (
      <div className={styles.pendingParticipantsBlock}>
        <div className={styles.pendingParticipantsHeader}>Ожидают входа</div>
        {pendingParticipants.map((participant: any) => {
          const displayName = participant.name || participant.identity || "Гость";
          const inProgress = pendingActionFor === participant.identity;
          const isGuest = typeof participant.identity === "string" && participant.identity.startsWith("guest_");
          return (
            <div className={styles.pendingParticipantRow} key={participant.identity}>
              <ParticipantAvatar name={displayName} avatarUrl={null} isGuest={isGuest} />
              <span className={styles.stageParticipantText}>{displayName}</span>
              <span className={styles.pendingActions}>
                  <button
                    type="button"
                    className={styles.pendingApproveButton}
                    disabled={inProgress}
                    onClick={() => void handleApprovePending(participant.identity)}
                    aria-label="Одобрить"
                  >
                    <svg width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="25" cy="25" r="25" fill="url(#voco-pending-approve-grad)" />
                      <path d="M17 28.6667L22.7143 34L32 14" stroke="currentColor" strokeWidth="2" />
                      <defs>
                        <radialGradient
                          id="voco-pending-approve-grad"
                          cx="0"
                          cy="0"
                          r="1"
                          gradientUnits="userSpaceOnUse"
                          gradientTransform="translate(25 25) rotate(90) scale(29.4)"
                        >
                          <stop stopColor="#00FF00" />
                          <stop offset="0.5" stopColor="#00FF00" stopOpacity="0.55" />
                          <stop offset="0.85" stopColor="#00FF00" stopOpacity="0" />
                        </radialGradient>
                      </defs>
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={styles.pendingRejectButton}
                    disabled={inProgress}
                    onClick={() => void handleRejectPending(participant.identity)}
                    aria-label="Отклонить"
                  >
                    <svg width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="25" cy="25" r="25" fill="url(#voco-pending-reject-grad)" />
                      <path d="M18.0728 32.2139L32.2149 18.0717" stroke="currentColor" strokeWidth="2" />
                      <path d="M18.0728 18.0713L32.2149 32.2134" stroke="currentColor" strokeWidth="2" />
                      <defs>
                        <radialGradient
                          id="voco-pending-reject-grad"
                          cx="0"
                          cy="0"
                          r="1"
                          gradientUnits="userSpaceOnUse"
                          gradientTransform="translate(25 25) rotate(90) scale(29.4)"
                        >
                          <stop stopColor="#FF3333" />
                          <stop offset="0.5" stopColor="#FF3333" stopOpacity="0.55" />
                          <stop offset="0.85" stopColor="#FF3333" stopOpacity="0" />
                        </radialGradient>
                      </defs>
                    </svg>
                  </button>
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderStageParticipantRows = () =>
    orderedParticipants.map((participant: any) => {
      const isLocal = participant.identity === localIdentity;
      const meta = getParticipantMeta(participant);
      const displayName = getParticipantDisplayName(participant, localIdentity);
      const shouldShowRaisedHand = Boolean(handRaisedMap[participant.identity]);
      const isGuest =
        (typeof participant.identity === "string" && participant.identity.startsWith("guest_")) ||
        (typeof meta.user.id === "string" && meta.user.id.startsWith("guest_"));

      return (
        <div
          className={`${styles.stageParticipantRow} ${
            meta.role === "MODERATOR" || meta.role === "OWNER" ? styles.participantRowModerator : ""
          }`}
          key={participant.identity}
        >
          <ParticipantAvatar
            name={displayName}
            avatarUrl={meta.user.avatarUrl}
            square={meta.role === "MODERATOR" || meta.role === "OWNER"}
            isGuest={isGuest}
          />
          <span className={styles.stageParticipantText}>
            {displayName}
          </span>

          {shouldShowRaisedHand ? (
            <span className={`${styles.stageParticipantStatus} ${styles.stageParticipantStatusOn}`} aria-hidden="true">
              <RaisedHandIcon />
            </span>
          ) : null}
          {meta.role === "OWNER" ? (
            <span className={styles.participantOwnerCrown} aria-label="Владелец комнаты">
              <OwnerCrownIcon />
            </span>
          ) : (
            renderParticipantMenu(meta, isLocal)
          )}
        </div>
      );
    });

  // Медиа-тайл коллажа сообщения. Клик открывает лайтбокс на текущем индексе
  // и передаёт всю медиа-группу — чтобы можно было листать стрелками.
  const renderMediaTile = (
    attachment: ChatAttachment,
    mediaItems: LightboxItem[],
    index: number,
    badge?: number | null,
  ) => {
    const open = () => setLightboxState({ items: mediaItems, index });
    const overlay = badge && badge > 0 ? (
      <span className={styles.chatAttachmentMoreBadge} aria-hidden="true">
        +{badge}
      </span>
    ) : null;
    if (attachment.kind === "image") {
      return (
        <button
          key={index}
          type="button"
          className={styles.chatAttachmentImage}
          onClick={open}
          aria-label={`Открыть ${attachment.name}`}
        >
          <img src={attachment.url} alt={attachment.name} loading="lazy" />
          {overlay}
        </button>
      );
    }
    return (
      <button
        key={index}
        type="button"
        className={styles.chatAttachmentVideo}
        onClick={open}
        aria-label={`Открыть видео ${attachment.name}`}
      >
        <video src={attachment.url} preload="metadata" muted playsInline />
        <span className={styles.chatAttachmentPlayIcon} aria-hidden="true" />
        {overlay}
      </button>
    );
  };

  const renderDocumentRow = (attachment: ChatAttachment, key: number) => (
    <a
      key={key}
      className={styles.chatAttachmentFile}
      href={attachment.url}
      download={attachment.name}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className={styles.chatAttachmentFileIcon} aria-hidden="true" />
      <span className={styles.chatAttachmentFileMeta}>
        <span className={styles.chatAttachmentFileName}>{attachment.name}</span>
        <span className={styles.chatAttachmentFileSize}>
          {formatFileSize(attachment.size)}
        </span>
      </span>
    </a>
  );

  // Группа вложений в сообщении: фото/видео — коллаж до 4 тайлов с «+N» на
  // последнем; документы — вертикальный список.
  const renderChatAttachments = (attachments: ChatAttachment[]) => {
    if (attachments.length === 0) return null;
    const group = attachmentGroupOf(attachments[0].kind);
    if (group === "media") {
      const mediaItems: LightboxItem[] = attachments.map((a) => ({
        url: a.url,
        kind: a.kind === "video" ? "video" : "image",
        name: a.name,
      }));
      if (attachments.length === 1) {
        return (
          <div className={styles.chatAttachmentSingle}>
            {renderMediaTile(attachments[0], mediaItems, 0)}
          </div>
        );
      }
      const total = attachments.length;
      const visibleCount = Math.min(total, MEDIA_COLLAGE_VISIBLE);
      const overflow = total - visibleCount;
      const visible = attachments.slice(0, visibleCount);
      return (
        <div
          className={styles.chatAttachmentGrid}
          data-count={visibleCount}
        >
          {visible.map((a, i) =>
            renderMediaTile(
              a,
              mediaItems,
              i,
              i === visibleCount - 1 && overflow > 0 ? overflow : null,
            ),
          )}
        </div>
      );
    }
    return (
      <div className={styles.chatAttachmentList}>
        {attachments.map((a, i) => renderDocumentRow(a, i))}
      </div>
    );
  };

  const renderPollBubble = (poll: Poll, sentAt: number, _isLocal: boolean) => {
    const hasVoted = poll.myVote.length > 0;
    const draft = pollDraftVotes[poll.id] ?? [];
    const canVote = !hasVoted && !poll.isClosed;
    const showResults = hasVoted || poll.isClosed;
    const total = Math.max(poll.totalVotes, 1);
    const sortedOptions = [...poll.options].sort((a, b) => a.position - b.position);
    const toggleDraft = (optionId: string) => {
      setPollDraftVotes((prev) => {
        const cur = prev[poll.id] ?? [];
        if (poll.allowMultiple) {
          const next = cur.includes(optionId)
            ? cur.filter((x) => x !== optionId)
            : [...cur, optionId];
          return { ...prev, [poll.id]: next };
        }
        return { ...prev, [poll.id]: [optionId] };
      });
    };
    const submitVote = () => {
      if (draft.length === 0) return;
      void handleVotePoll(poll.id, draft);
      setPollDraftVotes((prev) => {
        const copy = { ...prev };
        delete copy[poll.id];
        return copy;
      });
    };
    return (
      <div className={styles.pollContent}>
        <div className={styles.pollQuestion}>{poll.question}</div>
        <ul className={styles.pollOptionList}>
          {sortedOptions.map((opt) => {
            const myChoice = poll.myVote.includes(opt.id);
            const draftChoice = draft.includes(opt.id);
            const percent = poll.totalVotes > 0 ? Math.round((opt.voteCount / total) * 100) : 0;
            return (
              <li key={opt.id} className={styles.pollOptionRow}>
                {showResults ? (
                  <div className={styles.pollOptionResult} aria-label={`${opt.text}: ${percent}%`}>
                    <div className={styles.pollOptionBarTrack}>
                      <div
                        className={styles.pollOptionBarFill}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className={styles.pollOptionResultMeta}>
                      <span className={`${styles.pollOptionText} ${myChoice ? styles.pollOptionMine : ""}`}>
                        {opt.text}
                      </span>
                      <span className={styles.pollOptionPercent}>{percent}%</span>
                    </div>
                  </div>
                ) : (
                  <label className={styles.pollOptionPick}>
                    <input
                      type={poll.allowMultiple ? "checkbox" : "radio"}
                      name={`poll-${poll.id}`}
                      checked={draftChoice}
                      disabled={!canVote || pollBusyId === poll.id}
                      onChange={() => toggleDraft(opt.id)}
                    />
                    <span className={styles.pollOptionText}>{opt.text}</span>
                  </label>
                )}
              </li>
            );
          })}
        </ul>
        <div className={styles.pollAction}>
          {canVote ? (
            <button
              type="button"
              className={styles.pollVoteButton}
              onClick={submitVote}
              disabled={draft.length === 0 || pollBusyId === poll.id}
            >
              {pollBusyId === poll.id ? "Голосуем…" : "Голосовать"}
            </button>
          ) : (
            <button
              type="button"
              className={styles.pollResultsButton}
              onClick={() => setPollResultsId(poll.id)}
            >
              {poll.isClosed
                ? `Завершён · Посмотреть голоса (${poll.totalVotes})`
                : `Посмотреть голоса (${poll.totalVotes})`}
            </button>
          )}
        </div>
        {pollVoteErrorByPoll[poll.id] ? (
          <div className={styles.pollVoteError}>{pollVoteErrorByPoll[poll.id]}</div>
        ) : null}
        <div className={styles.pollFooter}>
          <span className={styles.pollLabel}>Опрос</span>
          <span className={styles.pollTime}>{formatMessageTime(sentAt)}</span>
        </div>
      </div>
    );
  };

  const renderChatMessages = (emptyClass?: string) =>
    combinedChatEntries.length === 0 ? (
      <div className={emptyClass ?? styles.chatEmpty}>Сообщений пока нет</div>
    ) : (
      combinedChatEntries.map((entry) => {
        const isLocal = entry.authorIdentity === localIdentity;
        const authorName = entry.authorName || entry.authorIdentity || "Система";
        const authorMeta = participantMetaByUserId.get(entry.authorIdentity);
        const isGuestAuthor =
          entry.isGuest ||
          (typeof authorMeta?.user.id === "string" && authorMeta.user.id.startsWith("guest_"));
        if (entry.kind === "poll") {
          return (
            <div
              className={`${styles.chatMessageRow} ${isLocal ? styles.chatMessageOwn : styles.chatMessageRemote}`}
              key={entry.key}
              data-message-id={entry.key}
            >
              {!isLocal ? (
                <ParticipantAvatar
                  name={authorName}
                  avatarUrl={authorMeta?.user.avatarUrl}
                  className={styles.chatAvatar}
                  isGuest={isGuestAuthor}
                />
              ) : null}
              <article
                className={`${styles.chatBubble} ${isLocal ? styles.chatBubbleOwn : styles.chatBubbleRemote} ${styles.chatBubblePoll}`}
              >
                {!isLocal ? <div className={styles.chatAuthor}>{authorName}</div> : null}
                {renderPollBubble(entry.poll, entry.sentAt, isLocal)}
                {canModerateParticipants && slug ? (
                  <button
                    type="button"
                    className={styles.chatPinTrigger}
                    aria-label="Закрепить опрос"
                    title="Закрепить"
                    onClick={() =>
                      void handlePinChatMessage({
                        message: `Опрос: ${entry.poll.question}`,
                        from: {
                          identity: entry.authorIdentity,
                          name: entry.authorName ?? undefined,
                        },
                        timestamp: entry.sentAt,
                        externalId: entry.key,
                      })
                    }
                  />
                ) : null}
              </article>
            </div>
          );
        }
        return (
          <div
            className={`${styles.chatMessageRow} ${isLocal ? styles.chatMessageOwn : styles.chatMessageRemote}`}
            key={entry.key}
            data-message-id={entry.externalId ?? entry.key}
          >
            {!isLocal ? (
              <ParticipantAvatar
                name={authorName}
                avatarUrl={authorMeta?.user.avatarUrl}
                className={styles.chatAvatar}
                isGuest={isGuestAuthor}
              />
            ) : null}
            <article
              className={`${styles.chatBubble} ${isLocal ? styles.chatBubbleOwn : styles.chatBubbleRemote}`}
            >
              {!isLocal ? <div className={styles.chatAuthor}>{authorName}</div> : null}
              {entry.attachments.length > 0 ? renderChatAttachments(entry.attachments) : null}
              {entry.message ? <div className={styles.chatBody}>{entry.message}</div> : null}
              <div className={styles.chatTime}>{formatMessageTime(entry.sentAt)}</div>
              {canModerateParticipants && slug ? (
                <button
                  type="button"
                  className={styles.chatPinTrigger}
                  aria-label="Закрепить сообщение"
                  title="Закрепить"
                  onClick={() =>
                    void handlePinChatMessage({
                      message: entry.message,
                      from: { identity: entry.authorIdentity, name: entry.authorName ?? undefined },
                      timestamp: entry.sentAt,
                      externalId: entry.externalId,
                      attachments: entry.attachments,
                    })
                  }
                />
              ) : null}
            </article>
          </div>
        );
      })
    );

  const renderChatClearButton = () =>
    canModerateParticipants && slug ? (
      <button
        type="button"
        className={styles.chatClearButton}
        aria-label="Очистить чат"
        title="Очистить чат"
        onClick={handleClearChatRequest}
      />
    ) : null;

  const renderClearChatConfirm = () =>
    clearChatConfirmOpen ? (
      <div
        className={styles.reportModalOverlay}
        role="dialog"
        aria-modal="true"
        aria-labelledby="clear-chat-modal-title"
      >
        <div className={styles.chatClearModal}>
          <button
            type="button"
            className={styles.chatClearClose}
            aria-label="Отмена"
            title="Отмена"
            onClick={() => setClearChatConfirmOpen(false)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1 1L13 13" stroke="#000000" strokeWidth="2" strokeLinecap="round" />
              <path d="M13 1L1 13" stroke="#000000" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <h2 id="clear-chat-modal-title" className={styles.chatClearTitle}>
            Очистить чат?
          </h2>
          <p className={styles.chatClearText}>
            Все сообщения будут удалены для всех участников. Это действие нельзя
            отменить!
          </p>
          <button
            type="button"
            className={styles.chatClearAction}
            onClick={() => void handleClearChatConfirm()}
          >
            Очистить
          </button>
        </div>
      </div>
    ) : null;

  const renderPollModal = () =>
    pollModalOpen ? (
      <NewPollModal
        busy={pollBusyId === "__create__"}
        error={pollError}
        onClose={() => setPollModalOpen(false)}
        onSubmit={handleCreatePoll}
      />
    ) : null;

  const renderPollResults = () => {
    if (!pollResultsId) return null;
    const poll = polls.find((p) => p.id === pollResultsId);
    if (!poll) return null;
    return (
      <PollResultsModal
        poll={poll}
        canClose={canModerateParticipants && !poll.isClosed}
        onClose={() => setPollResultsId(null)}
        onClosePoll={() => {
          void handleClosePoll(poll.id);
        }}
        busy={pollBusyId === poll.id}
      />
    );
  };

  const renderPinnedBanner = () => {
    if (pinnedMessages.length === 0) return null;
    const safeIndex = Math.min(currentPinIndex, pinnedMessages.length - 1);
    const pin = pinnedMessages[safeIndex];
    if (!pin) return null;
    const showArrows = pinnedMessages.length > 1;
    return (
      <div className={styles.chatPinnedBanner} ref={pinListRef}>
        <div className={styles.chatPinnedRow}>
          <button
            type="button"
            className={styles.chatPinnedListButton}
            aria-label="Список закреплённых"
            aria-expanded={pinListOpen}
            onClick={() => setPinListOpen((open) => !open)}
          />
          {showArrows ? (
            <button
              type="button"
              className={styles.chatPinnedArrowPrev}
              aria-label="Предыдущее закреплённое"
              disabled={safeIndex === 0}
              onClick={() => setCurrentPinIndex((idx) => Math.max(0, idx - 1))}
            />
          ) : null}
          <button
            type="button"
            className={styles.chatPinnedText}
            title={pin.originalExternalId ? "Перейти к сообщению" : (pin.message || pin.attachments?.[0]?.name || "")}
            onClick={() => handleJumpToPinned(pin)}
            disabled={!pin.originalExternalId}
          >
            {pin.authorName ? (
              <span className={styles.chatPinnedAuthor}>{pin.authorName}: </span>
            ) : null}
            {(pin.attachments?.length ?? 0) > 0 && !pin.message ? (
              <span className={styles.chatPinnedAttachment}>
                {(() => {
                  const first = pin.attachments![0];
                  const count = pin.attachments!.length;
                  if (count > 1) {
                    const isMedia = attachmentGroupOf(first.kind) === "media";
                    return `📎 ${isMedia ? "Фото/видео" : "Файлы"}: ${count}`;
                  }
                  return `📎 ${first.name}`;
                })()}
              </span>
            ) : (
              pin.message
            )}
          </button>
          {showArrows ? (
            <button
              type="button"
              className={styles.chatPinnedArrowNext}
              aria-label="Следующее закреплённое"
              disabled={safeIndex >= pinnedMessages.length - 1}
              onClick={() =>
                setCurrentPinIndex((idx) =>
                  Math.min(pinnedMessages.length - 1, idx + 1),
                )
              }
            />
          ) : null}
          {canModerateParticipants ? (
            <button
              type="button"
              className={styles.chatPinnedUnpin}
              aria-label="Открепить"
              title="Открепить"
              onClick={() => void handleUnpinMessage(pin.id)}
            />
          ) : null}
        </div>
        {pinListOpen ? (
          <div className={styles.chatPinnedList} role="menu">
            {pinnedMessages.map((item, idx) => (
              <button
                type="button"
                key={item.id}
                className={`${styles.chatPinnedListItem} ${
                  idx === safeIndex ? styles.chatPinnedListItemActive : ""
                }`}
                role="menuitem"
                onClick={() => {
                  setCurrentPinIndex(idx);
                  setPinListOpen(false);
                  handleJumpToPinned(item);
                }}
              >
                {item.authorName ? (
                  <span className={styles.chatPinnedListAuthor}>{item.authorName}: </span>
                ) : null}
                <span className={styles.chatPinnedListText}>
                  {(() => {
                    const atts = item.attachments ?? [];
                    if (atts.length > 0 && !item.message) {
                      if (atts.length > 1) {
                        const isMedia = attachmentGroupOf(atts[0].kind) === "media";
                        return `📎 ${isMedia ? "Фото/видео" : "Файлы"}: ${atts.length}`;
                      }
                      return `📎 ${atts[0].name}`;
                    }
                    return item.message;
                  })()}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const sharedLiveKitUi = <RoomAudioRenderer muted={!outputEnabled} />;

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

  const renderHeaderSettingsButton = (style?: CSSProperties, compact = false, className?: string) =>
    canModerateParticipants && slug ? (
      <button
        type="button"
        className={
          compact
            ? styles.compactHeaderSettingsButton
            : `${styles.headerSettingsButton} ${className ?? ""} ${
                isSettingsPanelOpen ? styles.headerSettingsButtonActive : ""
              }`
        }
        style={style}
        onClick={() => {
          setSettingsInitialTab("settings");
          toggleRoomPanel("settings");
        }}
        aria-label="Настройки"
        aria-pressed={isSettingsPanelOpen}
      >
        <SettingsIcon />
      </button>
    ) : null;

  const renderSettingsPanel = (layoutClass: string) =>
    isSettingsPanelOpen && slug ? (
      <SettingsPanel
        slug={slug}
        layoutClass={layoutClass}
        initialTab={settingsInitialTab}
        roomMeta={roomMeta}
        blockedUsers={blockedUsers}
        canEditSettings={Boolean(isOwner || roomRole === "OWNER")}
        onClose={() => toggleRoomPanel("settings")}
        onMetaSaved={refreshRoomState}
        onUnblockUser={handleUnblockUser}
      />
    ) : null;

  const renderViewIndicator = (className: string) => (
    <ViewIndicator
      pageCount={tilePageCount}
      currentPage={currentTilePage}
      className={className}
      onPageChange={setTilePage}
    />
  );

  const lightboxOverlay = lightboxItem && lightboxState ? (
    <div
      className={styles.lightboxOverlay}
      role="dialog"
      aria-modal="true"
      aria-label={lightboxItem.name}
      onClick={closeLightbox}
    >
      <button
        type="button"
        className={styles.lightboxClose}
        onClick={(event) => {
          event.stopPropagation();
          closeLightbox();
        }}
        aria-label="Закрыть"
      />
      {lightboxState.items.length > 1 ? (
        <>
          <button
            type="button"
            className={styles.lightboxPrev}
            onClick={(event) => {
              event.stopPropagation();
              lightboxPrev();
            }}
            aria-label="Предыдущее"
          />
          <button
            type="button"
            className={styles.lightboxNext}
            onClick={(event) => {
              event.stopPropagation();
              lightboxNext();
            }}
            aria-label="Следующее"
          />
          <div
            className={styles.lightboxCounter}
            onClick={(event) => event.stopPropagation()}
          >
            {lightboxState.index + 1} / {lightboxState.items.length}
          </div>
        </>
      ) : null}
      {lightboxItem.kind === "image" ? (
        <img
          className={styles.lightboxImage}
          src={lightboxItem.url}
          alt={lightboxItem.name}
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        <video
          key={lightboxItem.url}
          className={styles.lightboxVideo}
          src={lightboxItem.url}
          controls
          autoPlay
          playsInline
          onClick={(event) => event.stopPropagation()}
        />
      )}
    </div>
  ) : null;

  if (isTabletLayout) {
    return (
      <div className={styles.tabletViewport}>
        <div className={styles.tabletStage}>
          <div className={styles.topBar} />
          <div className={styles.bottomBar} />
          {renderViewIndicator(styles.tabletToolbarHandle)}

          {tabletTileFrames.map((frame, index) => {
            const trackRef = visibleTracks[index];
            const connectionQuality = getTrackConnectionQuality(trackRef);
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
                  <TileSignal quality={connectionQuality} />
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
                {renderPendingParticipantRows()}
                {renderStageParticipantRows()}
              </div>
              <div className={styles.sideFooterFade} />
              <div className={styles.sideFooterText}>Всего участников: {orderedParticipants.length}</div>
            </aside>
          ) : null}

          {isChatPanelOpen ? (
            <aside
              className={`${styles.sidePanel} ${styles.chatPanel} ${styles.tabletSidePanel} ${styles.tabletChatPanel}${
                pinnedMessages.length > 0 ? ` ${styles.chatPanelHasPin}` : ""
              }`}
              style={tabletContentRect(384, 384, 0, 1)}
            >
              <div className={styles.sideHeaderFade} />
              <div className={styles.chatTitle}>Чат</div>
              {renderChatClearButton()}
              {renderPinnedBanner()}

              <div className={`${styles.chatScroll} ${styles.tabletChatScroll}`} ref={chatScrollRef}>
                <div className={styles.chatScrollInner}>
                  {combinedChatEntries.length > 0 ? <div className={styles.tabletChatDate}>{currentDate}</div> : null}
                  {renderChatMessages()}
                </div>
              </div>

              {renderChatComposer()}
            </aside>
          ) : null}

          {renderHeaderSettingsButton(undefined, false, styles.tabletHeaderSettingsButton)}
          {renderSettingsPanel(styles.tabletSettingsPanel)}
          {renderClearChatConfirm()}
          {renderPollModal()}
          {renderPollResults()}

          <h1 className={`${styles.stageConferenceName} ${styles.tabletConferenceName}`}>
            {roomTitle}
          </h1>
          {slug ? (
            renderOwnerCopyButton(`${styles.stageRoomCode} ${styles.tabletRoomCode}`)
          ) : (
            <div className={`${styles.stageRoomCode} ${styles.tabletRoomCode}`}>
              {roomCodeLabel}
            </div>
          )}
          {renderRecordingIndicator(undefined, styles.tabletRecordingIndicator)}

          {canEndRoom ? (
            <>
              <button
                type="button"
                className={`${styles.tabletExitButton} ${styles.tabletHeaderExitButton}`}
                aria-label="Выйти"
                onClick={handleExitMenuLeave}
              >
                <span className={styles.exitGlow} aria-hidden="true" />
                <span className={styles.tabletExitIcon} aria-hidden="true">
                  <ExitArrowIcon />
                </span>
                <span className={styles.tabletExitMenu} aria-hidden="true">
                  <ChevronDownIcon />
                </span>
              </button>
              <button
                type="button"
                className={`${styles.exitMenuTrigger} ${styles.tabletHeaderExitMenuTrigger}`}
                aria-label="Меню выхода"
                aria-haspopup="menu"
                aria-expanded={exitMenuOpen}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setExitMenuOpen((c) => !c);
                }}
              />
            </>
          ) : (
            <DisconnectButton
              className={`${styles.tabletExitButton} ${styles.tabletHeaderExitButton}`}
              aria-label="Выйти"
              onClick={onExitIntent}
            >
              <span className={styles.exitGlow} aria-hidden="true" />
              <span className={styles.tabletExitIcon} aria-hidden="true">
                <ExitArrowIcon />
              </span>
            </DisconnectButton>
          )}
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
        {lightboxOverlay}
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
            const connectionQuality = getTrackConnectionQuality(trackRef);
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
                  <TileSignal quality={connectionQuality} />
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
                {renderPendingParticipantRows()}
                {renderStageParticipantRows()}
              </div>
              <div className={styles.sideFooterFade} />
              <div className={styles.sideFooterText}>Всего участников: {orderedParticipants.length}</div>
            </aside>
          ) : null}

          {isChatPanelOpen ? (
            <aside
              className={`${styles.sidePanel} ${styles.chatPanel} ${styles.mobileChatPanel}${
                pinnedMessages.length > 0 ? ` ${styles.chatPanelHasPin}` : ""
              }`}
              style={mobileContentRect(0, 1)}
            >
              <div className={styles.sideHeaderFade} />
              <div className={styles.chatTitle}>Чат</div>
              {renderChatClearButton()}
              {renderPinnedBanner()}

              <div className={`${styles.chatScroll} ${styles.mobileChatScroll}`} ref={chatScrollRef}>
                <div className={styles.chatScrollInner}>
                  {combinedChatEntries.length > 0 ? <div className={styles.mobileChatDate}>{currentDate}</div> : null}
                  {renderChatMessages()}
                </div>
              </div>

              {renderChatComposer(styles.mobileChatComposer)}
            </aside>
          ) : null}

          <h1 className={`${styles.stageConferenceName} ${styles.mobileConferenceName}`}>
            {roomTitle}
          </h1>
          {slug ? (
            renderOwnerCopyButton(`${styles.stageRoomCode} ${styles.mobileRoomCode}`)
          ) : (
            <div className={`${styles.stageRoomCode} ${styles.mobileRoomCode}`}>
              {roomCodeLabel}
            </div>
          )}

          {renderHeaderSettingsButton(undefined, false, styles.mobileHeaderSettingsButton)}
          {renderSettingsPanel(styles.mobileSettingsPanel)}
          {renderClearChatConfirm()}
          {renderPollModal()}
          {renderPollResults()}

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

            <button
              className={`${styles.mobileToolbarButton} ${
                isRecording ? styles.mobileToolbarRecordingActive : ""
              }`}
              type="button"
              aria-label={isRecording ? "Остановить запись" : "Начать запись"}
              aria-pressed={isRecording}
              onClick={toggleRecording}
            >
              <RecordingIcon />
            </button>

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
              className={styles.mobileToolbarButton}
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
                      setSettingsInitialTab("link");
                      openRoomPanel("settings");
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
                    void room?.localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
                    setMobileMoreOpen(false);
                  }}
                >
                  {isScreenShareEnabled ? "Остановить демонстрацию" : "Демонстрация"}
                </button>
              </div>
            ) : null}
          </div>

          {sharedLiveKitUi}
        </div>
        {lightboxOverlay}
      </div>
    );
  }
  return (
    <div className={styles.stageViewport}>
      <div
        className={styles.stage}
        style={{
          "--stage-reserve-left": `${expandedTileLeft}px`,
          "--stage-reserve-right": `${expandedTileRight}px`,
        } as CSSProperties}
      >
        <div className={styles.topBar} />
        <div className={styles.bottomBar} />
        {renderViewIndicator(styles.desktopToolbarIndicator)}

        {isParticipantsPanelOpen ? (
          <aside className={`${styles.sidePanel} ${styles.participantsPanel} ${styles.desktopParticipantsPanel}`}>
            <div className={styles.sideHeaderFade} />
            <div className={styles.sideTitle}>Участники</div>
            <div className={styles.participantsScroll}>
              {renderPendingParticipantRows()}
              {renderStageParticipantRows()}
            </div>
            <div className={styles.sideFooterFade} />
            <div className={styles.sideFooterText}>Всего участников: {orderedParticipants.length}</div>
          </aside>
        ) : null}

        {isChatPanelOpen ? (
          <aside
            className={`${styles.sidePanel} ${styles.chatPanel} ${styles.desktopChatPanel}${
              pinnedMessages.length > 0 ? ` ${styles.chatPanelHasPin}` : ""
            }`}
          >
            <div className={styles.sideHeaderFade} />
            <div className={styles.chatTitle}>Чат</div>
            {renderChatClearButton()}
            {renderPinnedBanner()}
            <div className={styles.chatDate}>{currentDate}</div>

            <div className={styles.chatScroll} ref={chatScrollRef}>
              <div className={styles.chatScrollInner}>
                {renderChatMessages()}
              </div>
            </div>

            {renderChatComposer()}
          </aside>
        ) : null}

        {tileFrames.map((frame, index) => {
          const trackRef = visibleTracks[index];
          const connectionQuality = getTrackConnectionQuality(trackRef);
          const displayName = getTrackDisplayName(trackRef, localIdentity);
          const speaking = isTrackSpeaking(trackRef);
          const isExpandedSingleTile =
            index === 0 && tileFrames.length === 1 && hasExpandedVideoMedia(trackRef);

          return (
            <article
              className={`${styles.tileCard} ${frame.accent ? styles.tileCardAccent : ""} ${
                speaking ? styles.tileSpeaking : ""
              }`}
              style={frame.style}
              key={frame.id}
            >
              <div
                className={styles.tileMedia}
                ref={isExpandedSingleTile ? expandedMediaRef : undefined}
              >
                {renderTrackMedia(trackRef)}
              </div>

              <div className={styles.tileFooter}>
                <span className={styles.tileFooterName}>{displayName || "Ожидание подключения"}</span>
                <TileSignal quality={connectionQuality} />
              </div>
            </article>
          );
        })}

        {renderHeaderSettingsButton(undefined, false, styles.desktopHeaderSettingsButton)}
        {renderSettingsPanel(styles.desktopSettingsPanel)}
        {renderClearChatConfirm()}
        {renderPollModal()}
        {renderPollResults()}

        <h1 className={`${styles.stageConferenceName} ${styles.desktopConferenceName}`}>
          {roomTitle}
        </h1>
        {slug ? (
          renderOwnerCopyButton(`${styles.stageRoomCode} ${styles.desktopRoomCode}`)
        ) : (
          <div className={`${styles.stageRoomCode} ${styles.desktopRoomCode}`}>
            {roomCodeLabel}
          </div>
        )}
        {renderRecordingIndicator(undefined, styles.desktopRecordingIndicator)}

        {canEndRoom ? (
          <>
            <button
              type="button"
              className={`${styles.exitButton} ${styles.desktopHeaderExitButton}`}
              aria-label="Выйти"
              onClick={handleExitMenuLeave}
            >
              <span className={styles.exitGlow} aria-hidden="true" />
              <span className={styles.exitIcon} aria-hidden="true">
                <ExitArrowIcon />
              </span>
              <span className={styles.exitLabel}>Выйти</span>
              <span className={styles.exitMenu} aria-hidden="true">
                <ChevronDownIcon />
              </span>
            </button>
            <button
              type="button"
              className={`${styles.exitMenuTrigger} ${styles.desktopHeaderExitMenuTrigger}`}
              aria-label="Меню выхода"
              aria-haspopup="menu"
              aria-expanded={exitMenuOpen}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setExitMenuOpen((c) => !c);
              }}
            />
          </>
        ) : (
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
          </DisconnectButton>
        )}
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
      {lightboxOverlay}
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
    const [inQueue, setInQueue] = useState(false);
    const [rejectionToast, setRejectionToast] = useState<string | null>(null);
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
    const handleReportModalExit = useCallback(() => {
        setReportModalOpen(false);
        leaveRequestedRef.current = true;
        void leaveRoomAndNavigate();
    }, [leaveRoomAndNavigate]);

    const handleDownloadReport = useCallback(async () => {
        if (!reportData || downloadingReport) return;
        setDownloadingReport(true);
        try {
            await downloadRoomReportPdf(reportData);
            handleReportModalExit();
        } catch (err) {
            console.error("Ошибка при формировании PDF-отчёта:", err);
        } finally {
            setDownloadingReport(false);
        }
    }, [reportData, downloadingReport, handleReportModalExit]);

    const handleConferenceDisconnected = useCallback(
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
                    navigate("/dashboard");
                }, 2200);
                return;
            }
            if (!leaveRequestedRef.current) {
                return;
            }

            void leaveRoomAndNavigate();
        },
        [conferenceReady, leaveRoomAndNavigate, navigate],
    );

    const [entering, setEntering] = useState(false);

    const handleEnterConference = useCallback(async () => {
        if (!slug || !token || !livekitUrl || error || entering || inQueue) return;

        const normalizedName = displayName.trim() || user?.username || user?.email || "";
        if (normalizedName) {
            localStorage.setItem("voco_room_display_name", normalizedName);
            setDisplayName(normalizedName);
        }

        setEntering(true);
        try {
            const fallbackName = user?.username || user?.email || "";
            let pendingFromJoin = false;
            if (normalizedName && normalizedName !== fallbackName) {
                const data = await api.joinRoom(slug, normalizedName);
                setToken(data.token);
                setLivekitUrl(data.livekitUrl);
                setRoomName(data.room.name);
                pendingFromJoin = Boolean(data.pending);
            } else {
                // Перевыпускаем токен на случай, если первое join (на mount) было до того, как
                // модератор создал/изменил настройки. Также узнаём актуальный pending-флаг.
                const data = await api.joinRoom(slug);
                setToken(data.token);
                setLivekitUrl(data.livekitUrl);
                setRoomName(data.room.name);
                pendingFromJoin = Boolean(data.pending);
            }
            leaveRequestedRef.current = false;
            if (pendingFromJoin) {
                setInQueue(true);
            } else {
                setConferenceReady(true);
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setEntering(false);
        }
    }, [displayName, entering, error, inQueue, livekitUrl, slug, token, user]);

    const handlePendingApproved = useCallback(() => {
        setInQueue(false);
        leaveRequestedRef.current = false;
        setConferenceReady(true);
    }, []);

    if (loading) {
        return (
            <div className={styles.loading}>
                <div className={styles.spinner} />
                <p>Подключение к комнате...</p>
            </div>
        );
    }

    const liveKitConnection =
        token && livekitUrl && (inQueue || conferenceReady) ? (
            <div style={conferenceReady ? undefined : { display: "none" }}>
                <LiveKitRoom
                    serverUrl={livekitUrl}
                    token={token}
                    connect={true}
                    onDisconnected={handleConferenceDisconnected}
                    data-lk-theme="default"
                    className={styles.livekitRoot}
                >
                    {!conferenceReady && (
                        <PendingWatcher onApproved={handlePendingApproved} />
                    )}
                    {conferenceReady && (
                        <ConferenceRoomContent
                            roomName={roomName}
                            slug={slug}
                            isOwner={isOwner}
                            canEndRoom={isOwner || myRole === "MODERATOR"}
                            onExitIntent={handleConferenceLeaveIntent}
                            onEndRoomIntent={handleEndRoomIntent}
                            currentUserAvatarUrl={user?.avatarUrl ?? null}
                        />
                    )}
                </LiveKitRoom>
            </div>
        ) : null;

    const rejectionToastNode = rejectionToast ? (
        <div className={styles.rejectionToast} role="status" aria-live="assertive">
            {rejectionToast}
        </div>
    ) : null;

    return (
        <div className={conferenceReady ? styles.container : styles.waitingScreen}>
            {rejectionToastNode}
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
                            disabled={!token || !livekitUrl || !!error || entering || inQueue}
                        >
                            {inQueue ? (
                                <>
                                    Ожидание в очереди
                                    <span className={styles.queueDots} aria-hidden="true" />
                                </>
                            ) : entering ? (
                                "Вход..."
                            ) : (
                                "Войти"
                            )}
                        </button>
                    </section>

                    {(roomName || ownerName) && (
                        <div className={styles.waitingMeta} aria-hidden="true">
                            {roomName && <div className={styles.waitingMetaName}>{roomName}</div>}
                            {ownerName && <div className={styles.waitingMetaOwner}>{ownerName}</div>}
                        </div>
                    )}
                </div>
            ) : reportModalOpen ? (
                <div
                    className={styles.reportModalOverlay}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="report-modal-title"
                >
                    <div className={styles.roomEndedModal}>
                        <button
                            type="button"
                            className={styles.roomEndedClose}
                            aria-label="Выйти"
                            title="Выйти"
                            onClick={handleReportModalExit}
                        >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                                <path d="M1 1L13 13" stroke="#000000" strokeWidth="2" strokeLinecap="round" />
                                <path d="M13 1L1 13" stroke="#000000" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                        </button>
                        <h2 id="report-modal-title" className={styles.roomEndedTitle}>
                            Комната завершена
                        </h2>
                        {reportLoading ? (
                            <p className={styles.roomEndedText}>Готовим отчёт о конференции…</p>
                        ) : reportError ? (
                            <p className={styles.roomEndedText}>Не удалось загрузить отчёт: {reportError}</p>
                        ) : (
                            <p className={styles.roomEndedText}>
                                Можно скачать PDF-отчёт о прошедшей конференции: участники, длительность, пик
                                одновременных и т.д.
                            </p>
                        )}
                        <button
                            type="button"
                            className={styles.roomEndedDownload}
                            onClick={handleDownloadReport}
                            disabled={!reportData || reportLoading || downloadingReport}
                        >
                            {downloadingReport ? "Формируем PDF…" : "Скачать PDF"}
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

// ====== Опросы ======

interface NewPollModalProps {
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (data: {
    question: string;
    options: string[];
    allowMultiple: boolean;
    isAnonymous: boolean;
  }) => void;
}

function NewPollModal({ busy, error, onClose, onSubmit }: NewPollModalProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<{ id: string; text: string }[]>([
    { id: "opt-1", text: "" },
    { id: "opt-2", text: "" },
  ]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [localError, setLocalError] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // При наборе текста в последней (пустой) строке — добавляем новую пустую строку
  // (если ещё не на лимите 10).
  const ensureEmptyTail = (next: { id: string; text: string }[]) => {
    if (next.length >= 10) return next;
    const last = next[next.length - 1];
    if (last && last.text.trim() === "") return next;
    return [...next, { id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: "" }];
  };

  const handleOptionInput = (id: string, value: string) => {
    setOptions((prev) => {
      const updated = prev.map((o) => (o.id === id ? { ...o, text: value } : o));
      return ensureEmptyTail(updated);
    });
  };

  const handleRemoveOption = (id: string) => {
    setOptions((prev) => {
      // Минимум 2 заполненных + 1 пустая строка-«добавить».
      if (prev.length <= 2) return prev;
      return prev.filter((o) => o.id !== id);
    });
  };

  // Кнопка «+» у последней пустой строки: добавляет ещё одну пустую снизу
  // (если ещё не на лимите 10).
  const handleAddOption = () => {
    setOptions((prev) => {
      if (prev.length >= 10) return prev;
      return [
        ...prev,
        {
          id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text: "",
        },
      ];
    });
  };

  // HTML5 drag-n-drop для перестановки вариантов.
  const handleDragStart = (id: string) => () => setDraggingId(id);
  const handleDragOver = (overId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggingId || draggingId === overId) return;
    setOptions((prev) => {
      const fromIdx = prev.findIndex((o) => o.id === draggingId);
      const toIdx = prev.findIndex((o) => o.id === overId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = prev.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };
  const handleDragEnd = () => setDraggingId(null);

  const submit = () => {
    setLocalError("");
    const q = question.trim();
    if (!q) {
      setLocalError("Введите вопрос");
      return;
    }
    const filled = options.map((o) => o.text.trim()).filter((t) => t.length > 0);
    if (filled.length < 2) {
      setLocalError("Нужно минимум 2 варианта");
      return;
    }
    onSubmit({ question: q, options: filled, allowMultiple, isAnonymous });
  };

  const showError = localError || error;

  return (
    <div
      className={styles.reportModalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-poll-title"
    >
      <div className={styles.pollModal}>
        <button
          type="button"
          className={styles.pollModalClose}
          aria-label="Закрыть"
          title="Закрыть"
          disabled={busy}
          onClick={onClose}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 1L13 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <h2 id="new-poll-title" className={styles.pollModalTitle}>
          Новый опрос
        </h2>

        <label className={styles.pollFieldLabel}>Вопрос</label>
        <input
          className={styles.pollQuestionInput}
          type="text"
          maxLength={500}
          placeholder="Вопрос?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
        />

        <div className={styles.pollFieldLabel}>Варианты ответа</div>
        <ul className={styles.pollOptionEditList}>
          {options.map((opt, idx) => {
            const isLastEmpty =
              idx === options.length - 1 && opt.text.trim() === "";
            return (
              <li
                key={opt.id}
                className={`${styles.pollOptionEditRow} ${
                  draggingId === opt.id ? styles.pollOptionEditDragging : ""
                }`}
                draggable={!isLastEmpty && !busy}
                onDragStart={handleDragStart(opt.id)}
                onDragOver={handleDragOver(opt.id)}
                onDragEnd={handleDragEnd}
              >
                <input
                  className={styles.pollOptionEditInput}
                  type="text"
                  maxLength={200}
                  placeholder={isLastEmpty ? "Ответ" : `Ответ ${idx + 1}`}
                  value={opt.text}
                  onChange={(e) => handleOptionInput(opt.id, e.target.value)}
                  disabled={busy}
                  draggable={false}
                />
                {isLastEmpty ? (
                  <button
                    type="button"
                    className={styles.pollOptionEditAddIcon}
                    aria-label="Добавить ещё вариант"
                    title="Добавить ещё вариант"
                    onClick={handleAddOption}
                    disabled={busy || options.length >= 10}
                  >
                    {/* Плюс 26×26 как в svg.txt: вертикальная и горизонтальная по 26px. */}
                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
                      <path d="M0 13H26" stroke="currentColor" strokeWidth="2" />
                      <path d="M13 0V26" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.pollOptionEditDragHandle}
                    aria-label="Переместить"
                    title="Удалить (двойной клик)"
                    onDoubleClick={() => handleRemoveOption(opt.id)}
                  >
                    {/* ≡ — три параллельные линии 20px по дизайну svg.txt. */}
                    <svg width="20" height="14" viewBox="0 0 20 14" fill="none" aria-hidden="true">
                      <path d="M0 1H20" stroke="currentColor" strokeWidth="2" />
                      <path d="M0 7H20" stroke="currentColor" strokeWidth="2" />
                      <path d="M0 13H20" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          className={`${styles.pollToggleRow}`}
          onClick={() => setAllowMultiple((v) => !v)}
          aria-pressed={allowMultiple}
          disabled={busy}
        >
          <span>Несколько ответов</span>
          <span
            className={`${styles.pollToggleDot} ${allowMultiple ? styles.pollToggleDotOn : ""}`}
            aria-hidden="true"
          />
        </button>

        <button
          type="button"
          className={`${styles.pollToggleRow}`}
          onClick={() => setIsAnonymous((v) => !v)}
          aria-pressed={isAnonymous}
          disabled={busy}
        >
          <span>Анонимные ответы</span>
          <span
            className={`${styles.pollToggleDot} ${isAnonymous ? styles.pollToggleDotOn : ""}`}
            aria-hidden="true"
          />
        </button>

        {showError ? <div className={styles.pollModalError}>{showError}</div> : null}

        <button
          type="button"
          className={styles.pollCreateButton}
          onClick={submit}
          disabled={busy}
        >
          {busy ? "Создаём…" : "Создать"}
        </button>
      </div>
    </div>
  );
}

interface PollResultsModalProps {
  poll: Poll;
  canClose: boolean;
  busy: boolean;
  onClose: () => void;
  onClosePoll: () => void;
}

function PollResultsModal({ poll, canClose, busy, onClose, onClosePoll }: PollResultsModalProps) {
  const sorted = [...poll.options].sort((a, b) => a.position - b.position);
  return (
    <div
      className={styles.reportModalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="poll-results-title"
    >
      <div className={styles.pollResultsModal}>
        <button
          type="button"
          className={styles.pollModalClose}
          aria-label="Закрыть"
          title="Закрыть"
          onClick={onClose}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 1L13 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <h2 id="poll-results-title" className={styles.pollResultsHeader}>
          Результаты
        </h2>
        <div className={styles.pollResultsQuestion}>{poll.question}</div>
        <div className={styles.pollResultsTotal}>
          {poll.totalVotes} {pluralVotes(poll.totalVotes)}
        </div>
        <ul className={styles.pollResultsList}>
          {sorted.map((opt) => {
            const percent =
              poll.totalVotes > 0
                ? Math.round((opt.voteCount / poll.totalVotes) * 100)
                : 0;
            return (
              <li key={opt.id} className={styles.pollResultsOption}>
                <div className={styles.pollResultsOptionHeader}>
                  <span className={styles.pollResultsOptionName}>{opt.text}</span>
                  <span className={styles.pollResultsOptionCount}>
                    {opt.voteCount} {pluralVotes(opt.voteCount)}
                  </span>
                </div>
                {!poll.isAnonymous && opt.voters.length > 0 ? (
                  <ul className={styles.pollVoterList}>
                    {opt.voters.map((v) => {
                      const d = new Date(v.votedAt);
                      const time = d.toLocaleTimeString("ru-RU", {
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                      const date = d.toLocaleDateString("ru-RU", {
                        day: "2-digit",
                        month: "2-digit",
                      });
                      return (
                        <li key={`${v.identity}-${v.votedAt}`} className={styles.pollVoterRow}>
                          <ParticipantAvatar
                            name={v.name || v.identity}
                            avatarUrl={null}
                            isGuest={v.identity.startsWith("guest_")}
                          />
                          <span className={styles.pollVoterName}>
                            {v.name || v.identity}
                          </span>
                          <span className={styles.pollVoterTime}>{`${time}\n${date}`}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                <div className={styles.pollVoterPercent}>{percent} %</div>
              </li>
            );
          })}
        </ul>
        {canClose ? (
          <button
            type="button"
            className={styles.pollResultsCloseButton}
            onClick={onClosePoll}
            disabled={busy}
          >
            {busy ? "Закрываем…" : "Закрыть опрос"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
