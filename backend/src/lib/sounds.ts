import { db } from "./db.js";

export interface PlaylistTrackDto {
  id: string;
  title: string;
  author: string | null;
  audioUrl: string;
  audioMime: string;
  audioSize: number;
  iconUrl: string | null;
  position: number;
}

export interface RoomSoundUrlsDto {
  fun: string | null;
  hand: string | null;
  join: string | null;
}

export interface RoomSoundsDto {
  playlist: PlaylistTrackDto[];
  sounds: RoomSoundUrlsDto;
}

// Возвращает плейлист комнаты ожидания + три одиночных звука (fun/hand/join).
// Одиночные хранятся в колонках rooms; null означает, что фронт использует
// дефолтный ассет из public/sounds/.
export async function loadRoomSounds(roomId: string): Promise<RoomSoundsDto> {
  const [tracksResult, roomResult] = await Promise.all([
    db.query(
      `SELECT id, title, author,
              audio_url AS "audioUrl",
              audio_mime AS "audioMime",
              audio_size AS "audioSize",
              icon_url AS "iconUrl",
              position
         FROM room_playlist_tracks
        WHERE room_id = $1
        ORDER BY position ASC, created_at ASC`,
      [roomId],
    ),
    db.query(
      `SELECT sound_fun_url AS "fun",
              sound_hand_url AS "hand",
              sound_join_url AS "join"
         FROM rooms
        WHERE id = $1`,
      [roomId],
    ),
  ]);

  const playlist: PlaylistTrackDto[] = tracksResult.rows.map((row) => ({
    id: row.id,
    title: row.title,
    author: row.author ?? null,
    audioUrl: row.audioUrl,
    audioMime: row.audioMime,
    audioSize: Number(row.audioSize),
    iconUrl: row.iconUrl ?? null,
    position: row.position,
  }));

  const sounds: RoomSoundUrlsDto = {
    fun: roomResult.rows[0]?.fun ?? null,
    hand: roomResult.rows[0]?.hand ?? null,
    join: roomResult.rows[0]?.join ?? null,
  };

  return { playlist, sounds };
}

// Собирает все относительные URL'ы аудио и иконок комнаты (плейлист + одиночные),
// чтобы /api/rooms/:slug DELETE мог их физически снести с диска.
export async function collectRoomSoundFiles(roomId: string): Promise<string[]> {
  const [tracksResult, roomResult] = await Promise.all([
    db.query(
      `SELECT audio_url AS "audioUrl", icon_url AS "iconUrl"
         FROM room_playlist_tracks WHERE room_id = $1`,
      [roomId],
    ),
    db.query(
      `SELECT sound_fun_url AS "fun",
              sound_hand_url AS "hand",
              sound_join_url AS "join"
         FROM rooms WHERE id = $1`,
      [roomId],
    ),
  ]);

  const urls: string[] = [];
  for (const row of tracksResult.rows) {
    if (row.audioUrl) urls.push(row.audioUrl);
    if (row.iconUrl) urls.push(row.iconUrl);
  }
  const single = roomResult.rows[0];
  if (single) {
    if (single.fun) urls.push(single.fun);
    if (single.hand) urls.push(single.hand);
    if (single.join) urls.push(single.join);
  }
  return urls;
}
