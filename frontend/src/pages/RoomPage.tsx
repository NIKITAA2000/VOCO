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
import styles from "./Room.module.css";

const STAGE_WIDTH = 1440;
const STAGE_HEIGHT = 1024;
const TABLET_WIDTH = 768;
const TABLET_HEIGHT = 1024;
const TABLET_ROOM_LAYOUT_MEDIA_QUERY =
  "(min-width: 641px) and (max-width: 900px) and (min-height: 900px) and (orientation: portrait)";
const COMPACT_ROOM_LAYOUT_MEDIA_QUERY = "(max-width: 640px), (max-height: 820px)";

interface Props {
  user: any;
}

interface ConferenceRoomContentProps {
  roomName: string;
  slug?: string;
  onExitIntent: () => void;
  isOwner?: boolean;
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

function stageText(left: number, top: number, width: number): CSSProperties {
  return {
    left: toStagePercent(left, STAGE_WIDTH),
    top: toStagePercent(top, STAGE_HEIGHT),
    width: toStagePercent(width, STAGE_WIDTH),
  };
}

function tabletRect(left: number, top: number, width: number, height: number): CSSProperties {
  return {
    left: toStagePercent(left, TABLET_WIDTH),
    top: toStagePercent(top, TABLET_HEIGHT),
    width: toStagePercent(width, TABLET_WIDTH),
    height: toStagePercent(height, TABLET_HEIGHT),
  };
}

function tabletText(left: number, top: number, width: number): CSSProperties {
  return {
    left: toStagePercent(left, TABLET_WIDTH),
    top: toStagePercent(top, TABLET_HEIGHT),
    width: toStagePercent(width, TABLET_WIDTH),
  };
}

function getStageTileFrames(count: number) {
  const normalizedCount = Math.max(1, Math.min(count, 4));

  if (normalizedCount === 1) {
    return [{ id: "tile-1", accent: true, style: stageRect(250, 100, 940, 824) }];
  }

  if (normalizedCount === 2) {
    return [
      { id: "tile-1", accent: true, style: stageRect(250, 100, 470, 824) },
      { id: "tile-2", accent: false, style: stageRect(720, 100, 470, 824) },
    ];
  }

  if (normalizedCount === 3) {
    return [
      { id: "tile-1", accent: true, style: stageRect(250, 100, 940, 412) },
      { id: "tile-2", accent: false, style: stageRect(250, 512, 470, 412) },
      { id: "tile-3", accent: false, style: stageRect(720, 512, 470, 412) },
    ];
  }

  return [
    { id: "tile-1", accent: true, style: stageRect(250, 100, 470, 412) },
    { id: "tile-2", accent: false, style: stageRect(720, 100, 470, 412) },
    { id: "tile-3", accent: false, style: stageRect(250, 512, 470, 412) },
    { id: "tile-4", accent: false, style: stageRect(720, 512, 470, 412) },
  ];
}

function getTabletTileFrames(count: number) {
  const normalizedCount = Math.max(1, Math.min(count, 4));

  if (normalizedCount === 1) {
    return [{ id: "tablet-tile-1", accent: true, style: tabletRect(0, 100, 768, 824) }];
  }

  if (normalizedCount === 2) {
    return [
      { id: "tablet-tile-1", accent: true, style: tabletRect(0, 100, 384, 824) },
      { id: "tablet-tile-2", accent: false, style: tabletRect(384, 100, 384, 824) },
    ];
  }

  if (normalizedCount === 3) {
    return [
      { id: "tablet-tile-1", accent: true, style: tabletRect(0, 100, 768, 412) },
      { id: "tablet-tile-2", accent: false, style: tabletRect(0, 512, 384, 412) },
      { id: "tablet-tile-3", accent: false, style: tabletRect(384, 512, 384, 412) },
    ];
  }

  return [
    { id: "tablet-tile-1", accent: true, style: tabletRect(0, 100, 384, 412) },
    { id: "tablet-tile-2", accent: false, style: tabletRect(384, 100, 384, 412) },
    { id: "tablet-tile-3", accent: false, style: tabletRect(0, 512, 384, 412) },
    { id: "tablet-tile-4", accent: false, style: tabletRect(384, 512, 384, 412) },
  ];
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

function ExitArrowIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 27 14" fill="none" aria-hidden="true" {...props}>
      <line
        y1="-1"
        x2="10.2591"
        y2="-1"
        transform="matrix(-0.731055 -0.682318 0.731055 -0.682318 8 14)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        y1="-1"
        x2="10.2591"
        y2="-1"
        transform="matrix(-0.731055 0.682318 0.731055 0.682318 8 0)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M26 7H1" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 14 9" fill="none" aria-hidden="true" {...props}>
      <line
        y1="-1"
        x2="10.2591"
        y2="-1"
        transform="matrix(0.682318 0.731055 -0.682318 0.731055 0 1.46289)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        y1="-1"
        x2="10.2591"
        y2="-1"
        transform="matrix(0.682318 -0.731055 0.682318 0.731055 7 8.96289)"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function MicIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 18 30" fill="none" aria-hidden="true" {...props}>
      <rect x="5" y="1" width="8" height="18" rx="4" stroke="currentColor" strokeWidth="2" />
      <path d="M4 29H14" stroke="currentColor" strokeWidth="2" />
      <path d="M9 22V30" stroke="currentColor" strokeWidth="2" />
      <path
        d="M18 15C18 19.9706 13.9706 24 9 24C4.02944 24 0 19.9706 0 15H2C2 18.866 5.13401 22 9 22C12.866 22 16 18.866 16 15H18Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SpeakerIcon(props: SVGProps<SVGSVGElement>) {
  const maskId = useId();

  return (
    <svg viewBox="0 0 22 20" fill="none" aria-hidden="true" {...props}>
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

function CameraIcon(props: SVGProps<SVGSVGElement>) {
  const maskId = useId();

  return (
    <svg viewBox="0 0 30 20" fill="none" aria-hidden="true" {...props}>
      <rect x="1" y="1" width="20" height="18" rx="9" stroke="currentColor" strokeWidth="2" />
      <mask id={maskId} fill="white">
        <path d="M30 20L20 10L30 0V20Z" />
      </mask>
      <path
        d="M30 20L28.5858 21.4142L32 24.8284V20H30ZM20 10L18.5858 8.58579L17.1716 10L18.5858 11.4142L20 10ZM30 0H32V-4.82843L28.5858 -1.41421L30 0ZM30 20L31.4142 18.5858L21.4142 8.58579L20 10L18.5858 11.4142L28.5858 21.4142L30 20ZM20 10L21.4142 11.4142L31.4142 1.41421L30 0L28.5858 -1.41421L18.5858 8.58579L20 10ZM30 0H28V20H30H32V0H30Z"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}

function ScreenIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 30 20" fill="none" aria-hidden="true" {...props}>
      <rect x="1" y="1" width="28" height="14.3636" stroke="currentColor" strokeWidth="2" />
      <path d="M15 14.5449V18.1813" stroke="currentColor" strokeWidth="2" />
      <line x1="9" y1="19" x2="21.8571" y2="19" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function UserIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 30" fill="none" aria-hidden="true" {...props}>
      <path
        d="M14.3447 16.0039C16.0657 16.0463 17.7652 16.4059 19.3574 17.0654C21.056 17.769 22.5994 18.8006 23.8994 20.1006C25.1994 21.4006 26.231 22.944 26.9346 24.6426C27.6381 26.3411 28 28.1616 28 30H14V28H25.8291C25.6791 27.1131 25.4327 26.2432 25.0869 25.4082C24.4839 23.9523 23.5997 22.629 22.4854 21.5146C21.371 20.4003 20.0477 19.5161 18.5918 18.9131C17.136 18.3102 15.5757 18 14 18C12.4243 18 10.864 18.3102 9.4082 18.9131C7.9523 19.5161 6.62895 20.4003 5.51465 21.5146C4.40035 22.629 3.51614 23.9523 2.91309 25.4082C2.56727 26.2432 2.32085 27.1131 2.1709 28H14V30H0C-3.32827e-08 28.2763 0.317931 26.5683 0.9375 24.9619L1.06543 24.6426C1.7251 23.05 2.6731 21.5937 3.86035 20.3467L4.10059 20.1006C5.31946 18.8817 6.75212 17.899 8.32617 17.2012L8.64258 17.0654C10.3411 16.3619 12.1616 16 14 16L14.3447 16.0039Z"
        fill="currentColor"
      />
      <circle cx="14" cy="9" r="8" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function ChatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path d="M10 1C14.9706 1 19 5.02944 19 10V19H10C5.02944 19 1 14.9706 1 10C1 5.02944 5.02944 1 10 1Z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function RecordingIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="2" />
      <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function RaisedHandIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 10 30" fill="none" aria-hidden="true" {...props}>
      <rect x="1" y="1" width="8" height="18" rx="4" stroke="currentColor" strokeWidth="2" />
      <circle cx="5" cy="25" r="4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 26 26" fill="none" aria-hidden="true" {...props}>
      <path d="M0 13L26 13" stroke="currentColor" strokeWidth="2" />
      <path d="M13 0L13 26" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function SendIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 27 14" fill="none" aria-hidden="true" {...props}>
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

  return (
    <ul className={className} role="menu" onMouseDown={(event) => event.stopPropagation()}>
      {devices.length === 0 ? (
        <li className={styles.deviceDropdownEmpty}>Устройства не найдены</li>
      ) : (
        devices.map((device, index) => {
          const label = device.label || `Устройство ${index + 1}`;
          const isActive = device.deviceId === activeDeviceId;
          return (
            <li key={device.deviceId || `device-${index}`}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                className={`${styles.deviceDropdownItem} ${
                  isActive ? styles.deviceDropdownItemActive : ""
                }`}
                onClick={() => {
                  void setActiveMediaDevice(device.deviceId);
                  onSelect();
                }}
              >
                <span className={styles.deviceDropdownItemLabel}>{label}</span>
              </button>
            </li>
          );
        })
      )}
    </ul>
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

function PlaceholderLogo() {
  return (
    <svg className={styles.placeholderLogo} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M0 75C3.28305 75 6.53424 75.647 9.56738 76.9033C12.6004 78.1597 15.3564 80.0009 17.6777 82.3223C19.9991 84.6436 21.8403 87.3996 23.0967 90.4326C24.353 93.4658 25 96.717 25 100H50C50 93.4341 48.7069 86.9324 46.1943 80.8662C43.6816 74.7999 39.9984 69.2875 35.3555 64.6445C30.7125 60.0016 25.2001 56.3184 19.1338 53.8057C13.0676 51.2931 6.56593 50 0 50V75Z" fill="#8000FF" />
      <path d="M100 75C96.717 75 93.4658 75.647 90.4326 76.9033C87.3996 78.1597 84.6436 80.0009 82.3223 82.3223C80.0009 84.6436 78.1597 87.3996 76.9033 90.4326C75.647 93.4658 75 96.717 75 100H50C50 93.4341 51.2931 86.9324 53.8057 80.8662C56.3184 74.7999 60.0016 69.2875 64.6445 64.6445C69.2875 60.0016 74.7999 56.3184 80.8662 53.8057C86.9324 51.2931 93.4341 50 100 50V75Z" fill="#8000FF" />
      <path d="M50 25C53.283 25 56.5342 25.647 59.5674 26.9033C62.6004 28.1597 65.3564 30.0009 67.6777 32.3223C69.9991 34.6436 71.8403 37.3996 73.0967 40.4326C74.353 43.4658 75 46.717 75 50H100C100 43.4341 98.7069 36.9324 96.1943 30.8662C93.6816 24.7999 89.9984 19.2875 85.3555 14.6445C80.7125 10.0016 75.2001 6.3184 69.1338 3.80566C63.0676 1.29305 56.5659 0 50 0V25Z" fill="#8000FF" />
      <path d="M100 50C100 43.4339 98.7067 36.9321 96.194 30.8658C93.6812 24.7995 89.9983 19.2876 85.3553 14.6447C80.7124 10.0017 75.2005 6.31876 69.1342 3.80602C63.0679 1.29329 56.5661 -2.08713e-07 50 0C43.4339 2.08713e-07 36.9321 1.29329 30.8658 3.80602C24.7995 6.31876 19.2876 10.0017 14.6447 14.6447C10.0017 19.2876 6.31876 24.7996 3.80602 30.8658C1.29329 36.9321 0 43.4339 0 50L25 50C25 46.717 25.6466 43.4661 26.903 40.4329C28.1594 37.3998 30.0009 34.6438 32.3223 32.3223C34.6438 30.0009 37.3998 28.1594 40.4329 26.903C43.4661 25.6466 46.717 25 50 25C53.283 25 56.5339 25.6466 59.5671 26.903C62.6002 28.1594 65.3562 30.0009 67.6777 32.3223C69.9991 34.6438 71.8406 37.3998 73.097 40.4329C74.3534 43.4661 75 46.717 75 50L100 50Z" fill="#8000FF" />
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

function InviteIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07l-1.41 1.41"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M14 11a5 5 0 0 0-7.07 0l-2.83 2.83a5 5 0 0 0 7.07 7.07l1.41-1.41"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ConferenceRoomContent({ roomName, slug, onExitIntent, isOwner }: ConferenceRoomContentProps) {
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
  const participantsSectionRef = useRef<HTMLElement>(null);
  const chatSectionRef = useRef<HTMLElement>(null);
  const [message, setMessage] = useState("");
  const [outputEnabled, setOutputEnabled] = useState(true);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [openDeviceMenu, setOpenDeviceMenu] = useState<DeviceMenuKey | null>(null);
  const [inviteManagerOpen, setInviteManagerOpen] = useState(false);
  const [codeCopyStatus, setCodeCopyStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const codeCopyResetRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (codeCopyResetRef.current) {
        window.clearTimeout(codeCopyResetRef.current);
      }
    };
  }, []);

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
  const localIdentity = localParticipant?.identity;
  const isTabletLayout = useTabletRoomLayout();
  const isCompactLayout = useCompactRoomLayout();

  const tracks = [...(useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]) as any[])].sort((left, right) => {
    const leftLocal = left?.participant?.identity === localIdentity ? -1 : 0;
    const rightLocal = right?.participant?.identity === localIdentity ? -1 : 0;
    if (leftLocal !== rightLocal) return leftLocal - rightLocal;

    const leftScreen = left?.publication?.source === Track.Source.ScreenShare ? -1 : 0;
    const rightScreen = right?.publication?.source === Track.Source.ScreenShare ? -1 : 0;
    if (leftScreen !== rightScreen) return leftScreen - rightScreen;

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

  const visibleTracks = (tracks.length > 0 ? tracks : [null]).slice(0, 4);
  const tileFrames = getStageTileFrames(visibleTracks.length);
  const tabletTileFrames = getTabletTileFrames(visibleTracks.length);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chatMessages]);

  const handleChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedMessage = message.trim();
    if (!normalizedMessage) return;

    try {
      await send(normalizedMessage);
      setMessage("");
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

  const focusChatInput = () => chatInputRef.current?.focus();
  const blurChatInput = () => chatInputRef.current?.blur();
  const toggleRaisedHand = () => setIsHandRaised((current) => !current);
  const scrollToParticipants = () =>
    participantsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const scrollToChat = () => {
    chatSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    focusChatInput();
  };

  const renderTrackMedia = (trackRef: any) =>
    trackRef ? (
      <ParticipantTile className={styles.livekitTile} trackRef={trackRef} />
    ) : (
      <div className={styles.placeholderTile}>
        <PlaceholderLogo />
      </div>
    );

  const renderParticipantRows = (rowClass: string, textClass: string) =>
    orderedParticipants.map((participant: any) => (
      <div className={rowClass} key={participant.identity}>
        <span
          className={`${styles.participantDot} ${
            participant.isMicrophoneEnabled ? styles.participantDotOn : styles.participantDotOff
          }`}
          aria-hidden="true"
        />
        <span className={textClass}>{getParticipantDisplayName(participant, localIdentity)}</span>
      </div>
    ));

  const renderStageParticipantRows = () =>
    orderedParticipants.map((participant: any) => {
      const isLocal = participant.identity === localIdentity;
      const shouldShowRaisedHand = isLocal && isHandRaised;

      return (
        <div className={styles.stageParticipantRow} key={participant.identity}>
          <span className={styles.stageParticipantText}>
            {getParticipantDisplayName(participant, localIdentity)}
          </span>

          {shouldShowRaisedHand ? (
            <span className={`${styles.stageParticipantStatus} ${styles.stageParticipantStatusOn}`} aria-hidden="true">
              <RaisedHandIcon />
            </span>
          ) : null}
        </div>
      );
    });

  const renderChatMessages = (emptyClass?: string) =>
    chatMessages.length === 0 ? (
      <div className={emptyClass ?? styles.chatEmpty}>Сообщений пока нет</div>
    ) : (
      chatMessages.map((entry) => {
        const isLocal = entry.from?.identity === localIdentity;
        return (
          <article
            className={`${styles.chatBubble} ${isLocal ? styles.chatBubbleOwn : styles.chatBubbleRemote}`}
            key={`${entry.timestamp}-${entry.from?.identity ?? "system"}`}
          >
            <div className={styles.chatAuthor}>{entry.from?.name || entry.from?.identity || "Система"}</div>
            <div className={styles.chatBody}>{entry.message}</div>
            <div className={styles.chatTime}>{formatMessageTime(entry.timestamp)}</div>
          </article>
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

  if (isTabletLayout) {
    return (
      <div className={styles.tabletViewport}>
        <div className={styles.tabletStage}>
          <div className={styles.topBar} />
          <div className={styles.bottomBar} />

          {tabletTileFrames.map((frame, index) => {
            const trackRef = visibleTracks[index];
            const micEnabled = getTrackMicEnabled(trackRef);
            const displayName = getTrackDisplayName(trackRef, localIdentity);

            return (
              <article
                className={`${styles.tileCard} ${styles.tabletTileCard} ${
                  frame.accent ? styles.tileCardAccent : ""
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

          <h1 className={styles.stageConferenceName} style={tabletText(25, 20, 460)}>
            {roomTitle}
          </h1>
          {isOwner && slug ? (
            <button
              type="button"
              className={styles.stageRoomCode}
              style={tabletText(25, 65, 326)}
              onClick={handleCopyRoomCode}
              disabled={codeCopyStatus === "copying"}
              title={roomCodeTitle}
            >
              {roomCodeLabel}
            </button>
          ) : (
            <div className={styles.stageRoomCode} style={tabletText(25, 65, 326)}>
              {roomCodeLabel}
            </div>
          )}

          <DisconnectButton
            className={styles.tabletExitButton}
            style={tabletRect(643, 25, 100, 50)}
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

          <div
            className={styles.deviceSlot}
            style={tabletRect(25, 949, 90, 50)}
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
            className={styles.deviceSlot}
            style={tabletRect(130, 949, 90, 50)}
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
            className={styles.deviceSlot}
            style={tabletRect(235, 949, 90, 50)}
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
            className={styles.tabletDeviceButton}
            style={tabletRect(340, 949, 90, 50)}
            source={Track.Source.ScreenShare}
            showIcon={false}
          >
            <TabletDeviceControlContent active={isScreenShareEnabled} icon={<ScreenIcon />} />
          </TrackToggle>

          {isOwner && slug ? (
            <button
              type="button"
              className={`${styles.tabletDeviceButton} ${styles.deviceActionHover}`}
              style={tabletRect(445, 949, 90, 50)}
              onClick={() => setInviteManagerOpen(true)}
              aria-label="Пригласить"
            >
              <TabletDeviceControlContent active={true} icon={<InviteIcon />} hideMenu />
            </button>
          ) : null}

          <div className={styles.utilityGroup} style={tabletRect(543, 949, 200, 50)}>
            <button className={styles.utilityButton} type="button" aria-label="Участники" onClick={blurChatInput}>
              <UserIcon />
            </button>
            <button className={styles.utilityButton} type="button" aria-label="Чат" onClick={focusChatInput}>
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
            <button className={styles.utilityButton} type="button" aria-label="Запись" onClick={blurChatInput}>
              <RecordingIcon />
            </button>
          </div>

          {sharedLiveKitUi}
        </div>
      </div>
    );
  }

  if (isCompactLayout) {
    return (
      <div className={styles.compactRoom}>
        <header className={styles.compactHeader}>
          <div className={styles.compactHeaderText}>
            <h1 className={styles.compactTitle}>{roomTitle}</h1>
            {isOwner && slug ? (
              <button
                type="button"
                className={styles.compactRoomCode}
                onClick={handleCopyRoomCode}
                disabled={codeCopyStatus === "copying"}
                title={roomCodeTitle}
              >
                {roomCodeLabel}
              </button>
            ) : (
              <div className={styles.compactRoomCode}>{roomCodeLabel}</div>
            )}
          </div>

          <DisconnectButton
            className={styles.compactExitButton}
            aria-label="Выйти"
            onClick={onExitIntent}
          >
            <ExitArrowIcon />
          </DisconnectButton>
        </header>

        <main className={styles.compactContent}>
          <section className={styles.compactTiles}>
            {visibleTracks.map((trackRef, index) => {
              const micEnabled = getTrackMicEnabled(trackRef);
              const displayName = getTrackDisplayName(trackRef, localIdentity);

              return (
                <article
                  className={`${styles.tileCard} ${styles.compactTile} ${
                    index === 0 ? styles.tileCardAccent : ""
                  }`}
                  key={`compact-tile-${index}`}
                >
                  <div className={styles.tileMedia}>{renderTrackMedia(trackRef)}</div>

                  <div className={styles.tileFooter}>
                    <span className={styles.tileFooterName}>{displayName || "Ожидание подключения"}</span>
                    <TileSignal active={micEnabled} />
                  </div>
                </article>
              );
            })}
          </section>

          <div className={styles.compactPanels}>
            <section className={styles.compactPanelCard} ref={participantsSectionRef}>
              <div className={`${styles.compactPanelTitle} ${styles.compactParticipantsTitle}`}>Участники</div>
              <div className={styles.compactParticipantsList}>
                {renderParticipantRows(styles.compactParticipantRow, styles.compactParticipantText)}
              </div>
              <div className={styles.compactParticipantsFooter}>
                Всего участников: {orderedParticipants.length}
              </div>
            </section>

            <section className={styles.compactPanelCard} ref={chatSectionRef}>
              <div className={`${styles.compactPanelTitle} ${styles.compactChatTitle}`}>Чат</div>
              <div className={styles.compactChatDate}>{currentDate}</div>

              <div className={styles.compactChatList} ref={chatScrollRef}>
                {renderChatMessages(styles.compactChatEmpty)}
              </div>

              <form className={styles.compactChatComposer} onSubmit={handleChatSubmit}>
                <button
                  className={styles.chatIconButton}
                  type="button"
                  aria-label="Добавить вложение"
                  onClick={focusChatInput}
                >
                  <PlusIcon />
                </button>

                <input
                  ref={chatInputRef}
                  className={`${styles.chatInput} ${styles.compactChatInput}`}
                  type="text"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Сообщение..."
                />

                <button
                  className={styles.chatIconButton}
                  type="submit"
                  aria-label="Отправить сообщение"
                  disabled={isSending || !message.trim()}
                >
                  <SendIcon />
                </button>
              </form>
            </section>
          </div>
        </main>

        <div className={styles.compactControls}>
          <div className={styles.compactPrimaryControls}>
            <div className={styles.compactDeviceSlot} data-device-menu-root>
              <TrackToggle
                className={styles.compactControlButton}
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

            <div className={styles.compactDeviceSlot} data-device-menu-root>
              <button
                className={styles.compactControlButton}
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

            <div className={styles.compactDeviceSlot} data-device-menu-root>
              <TrackToggle
                className={styles.compactControlButton}
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
              className={styles.compactControlButton}
              source={Track.Source.ScreenShare}
              showIcon={false}
            >
              <DeviceControlContent
                label="Демонстрация"
                active={isScreenShareEnabled}
                icon={<ScreenIcon />}
              />
            </TrackToggle>

            {isOwner && slug ? (
              <button
                type="button"
                className={`${styles.compactControlButton} ${styles.deviceActionHover}`}
                onClick={() => setInviteManagerOpen(true)}
              >
                <DeviceControlContent label="Пригласить" active={true} icon={<InviteIcon />} hideMenu />
              </button>
            ) : null}
          </div>

          <div className={styles.compactUtilityControls}>
            <button
              className={`${styles.compactUtilityButton} ${styles.compactUtilityParticipants}`}
              type="button"
              onClick={scrollToParticipants}
            >
              <UserIcon />
              <span>Участники</span>
            </button>

            <button
              className={`${styles.compactUtilityButton} ${styles.compactUtilityChat}`}
              type="button"
              onClick={scrollToChat}
            >
              <ChatIcon />
              <span>Чат</span>
            </button>

            <button
              className={`${styles.compactUtilityButton} ${styles.compactUtilityAudio}`}
              type="button"
              aria-pressed={isHandRaised}
              onClick={toggleRaisedHand}
            >
              <RaisedHandIcon />
              <span>Рука</span>
            </button>

            <button
              className={`${styles.compactUtilityButton} ${styles.compactUtilitySettings}`}
              type="button"
              onClick={blurChatInput}
            >
              <RecordingIcon />
              <span>Запись</span>
            </button>
          </div>
        </div>

        {sharedLiveKitUi}
      </div>
    );
  }

  return (
    <div className={styles.stageViewport}>
      <div className={styles.stage}>
        <div className={styles.topBar} />
        <div className={styles.bottomBar} />

        <aside className={`${styles.sidePanel} ${styles.participantsPanel}`} style={stageRect(0, 100, 250, 824)}>
          <div className={styles.sideHeaderFade} />
          <div className={styles.sideTitle}>Участники</div>
          <div className={styles.participantsScroll}>{renderStageParticipantRows()}</div>
          <div className={styles.sideFooterFade} />
          <div className={styles.sideFooterText}>Всего участников: {orderedParticipants.length}</div>
        </aside>

        <aside className={`${styles.sidePanel} ${styles.chatPanel}`} style={stageRect(1190, 100, 250, 824)}>
          <div className={styles.sideHeaderFade} />
          <div className={styles.chatTitle}>Чат</div>
          <div className={styles.chatDate}>{currentDate}</div>

          <div className={styles.chatScroll} ref={chatScrollRef}>
            {renderChatMessages()}
          </div>

          <form className={styles.chatComposer} onSubmit={handleChatSubmit}>
            <button
              className={`${styles.chatIconButton} ${styles.chatAttachButton}`}
              type="button"
              aria-label="Добавить вложение"
              onClick={focusChatInput}
            >
              <PlusIcon />
            </button>

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
        </aside>

        {tileFrames.map((frame, index) => {
          const trackRef = visibleTracks[index];
          const micEnabled = getTrackMicEnabled(trackRef);
          const displayName = getTrackDisplayName(trackRef, localIdentity);

          return (
            <article
              className={`${styles.tileCard} ${frame.accent ? styles.tileCardAccent : ""}`}
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

        <h1 className={styles.stageConferenceName} style={stageText(25, 20, 460)}>
          {roomTitle}
        </h1>
        {isOwner && slug ? (
          <button
            type="button"
            className={styles.stageRoomCode}
            style={stageText(25, 64, 326)}
            onClick={handleCopyRoomCode}
            disabled={codeCopyStatus === "copying"}
            title={roomCodeTitle}
          >
            {roomCodeLabel}
          </button>
        ) : (
          <div className={styles.stageRoomCode} style={stageText(25, 64, 326)}>
            {roomCodeLabel}
          </div>
        )}

        <DisconnectButton
          className={styles.exitButton}
          style={stageRect(1215, 25, 200, 50)}
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

        <div className={styles.deviceSlot} style={stageRect(25, 949, 200, 50)} data-device-menu-root>
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

        <div className={styles.deviceSlot} style={stageRect(250, 949, 200, 50)} data-device-menu-root>
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

        <div className={styles.deviceSlot} style={stageRect(475, 949, 200, 50)} data-device-menu-root>
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
          className={styles.deviceButton}
          style={stageRect(700, 949, 200, 50)}
          source={Track.Source.ScreenShare}
          showIcon={false}
        >
          <DeviceControlContent label="Демонстрация" active={isScreenShareEnabled} icon={<ScreenIcon />} />
        </TrackToggle>

        {isOwner && slug ? (
          <button
            type="button"
            className={`${styles.deviceButton} ${styles.deviceActionHover}`}
            style={stageRect(925, 949, 200, 50)}
            onClick={() => setInviteManagerOpen(true)}
          >
            <DeviceControlContent label="Пригласить" active={true} icon={<InviteIcon />} hideMenu />
          </button>
        ) : null}

        <div className={styles.utilityGroup} style={stageRect(1222, 949, 200, 50)}>
          <button className={styles.utilityButton} type="button" aria-label="Участники" onClick={blurChatInput}>
            <UserIcon />
          </button>
          <button className={styles.utilityButton} type="button" aria-label="Чат" onClick={focusChatInput}>
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
          <button className={styles.utilityButton} type="button" aria-label="Запись" onClick={blurChatInput}>
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
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [conferenceReady, setConferenceReady] = useState(false);
    const [isOwner, setIsOwner] = useState(false);
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
                    isOwner={isOwner}
                />
            </LiveKitRoom>
        </div>
    );
}
