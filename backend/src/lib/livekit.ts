import { RoomServiceClient } from "livekit-server-sdk";
import { config } from "../config/index.js";

function buildHttpUrl(rawUrl: string) {
  if (!rawUrl) return "";
  if (rawUrl.startsWith("ws://")) return "http://" + rawUrl.slice("ws://".length);
  if (rawUrl.startsWith("wss://")) return "https://" + rawUrl.slice("wss://".length);
  return rawUrl;
}

const httpUrl = buildHttpUrl(config.livekit.url);

export const roomService = new RoomServiceClient(
  httpUrl,
  config.livekit.apiKey,
  config.livekit.apiSecret,
);

export const PARTICIPANT_STATUS_PENDING = "pending";
export const PARTICIPANT_STATUS_ACTIVE = "active";

export type ParticipantRole = "OWNER" | "MODERATOR" | "PARTICIPANT";

export type ParticipantMetadata = {
  status: typeof PARTICIPANT_STATUS_PENDING | typeof PARTICIPANT_STATUS_ACTIVE;
  isGuest?: boolean;
  role?: ParticipantRole;
};

export function buildMetadata(meta: ParticipantMetadata) {
  return JSON.stringify(meta);
}
