const API_URL = "/api";

export interface PlaylistTrack {
  id: string;
  title: string;
  author: string | null;
  audioUrl: string;
  audioMime: string;
  audioSize: number;
  iconUrl: string | null;
  position: number;
}

export interface RoomSounds {
  fun: string | null;
  hand: string | null;
  join: string | null;
}

export type RoomSoundType = "fun" | "hand" | "join";

class ApiClient {
  private token: string | null = null;

  constructor() {
    this.token = localStorage.getItem("voco_token");
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem("voco_token", token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem("voco_token");
    localStorage.removeItem("voco_user");
  }

  getToken() {
    return this.token;
  }

  private async request(path: string, options: RequestInit = {}) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Ошибка сервера");
    }

    return data;
  }

  // Auth
  async register(email: string, username: string, password: string) {
    const data = await this.request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, username, password }),
    });
    this.setToken(data.token);
    localStorage.setItem("voco_user", JSON.stringify(data.user));
    return data;
  }

  async login(email: string, password: string) {
    const data = await this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    this.setToken(data.token);
    localStorage.setItem("voco_user", JSON.stringify(data.user));
    return data;
  }

  async getMe() {
    return this.request("/auth/me");
  }

  async updateProfile(payload: {
    username?: string;
    email?: string;
    password?: string;
    avatarUrl?: string | null;
  }) {
    const data = await this.request("/auth/me", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    if (data?.token) this.setToken(data.token);
    if (data?.user) localStorage.setItem("voco_user", JSON.stringify(data.user));
    return data;
  }

  // Загрузка фото-аватарки. Возвращает {avatarUrl: "/uploads/avatars/<file>"}.
  // Привязку к профилю делает следующий updateProfile({avatarUrl}).
  async uploadAvatar(file: File): Promise<{ avatarUrl: string }> {
    const form = new FormData();
    form.append("file", file);
    const headers: Record<string, string> = {};
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const res = await fetch(`${API_URL}/auth/avatar`, {
      method: "POST",
      body: form,
      headers,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Не удалось загрузить аватарку");
    return data;
  }

  // Rooms
  async createRoom(
    name: string,
    options?: {
      maxUsers?: number;
      allowGuests?: boolean;
      requireApproval?: boolean;
    },
  ) {
    const payload: Record<string, unknown> = { name };
    if (options?.maxUsers !== undefined) payload.maxUsers = options.maxUsers;
    if (options?.allowGuests !== undefined) payload.allowGuests = options.allowGuests;
    if (options?.requireApproval !== undefined) payload.requireApproval = options.requireApproval;
    return this.request("/rooms", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateRoom(
    slug: string,
    payload: {
      name?: string;
      maxUsers?: number;
      allowGuests?: boolean;
      requireApproval?: boolean;
    },
  ) {
    return this.request(`/rooms/${slug}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async getRooms(options?: { includeHidden?: boolean }) {
    const qs = options?.includeHidden ? "?includeHidden=true" : "";
    return this.request(`/rooms${qs}`);
  }

  async getRoom(slug: string) {
    return this.request(`/rooms/${slug}`);
  }

  async joinRoom(slug: string, displayName?: string) {
    return this.request(`/rooms/${slug}/join`, {
      method: "POST",
      body: JSON.stringify(displayName ? { displayName } : {}),
    });
  }

  async leaveRoom(slug: string) {
    return this.request(`/rooms/${slug}/leave`, { method: "POST" });
  }

  async deleteRoom(slug: string) {
    return this.request(`/rooms/${slug}`, { method: "DELETE" });
  }

  async restoreRoom(slug: string) {
    return this.request(`/rooms/${slug}/restore`, { method: "POST" });
  }

  async getRoomReport(slug: string) {
    return this.request(`/rooms/${slug}/report`);
  }

  async approveParticipant(slug: string, identity: string) {
    return this.request(
      `/rooms/${slug}/approve/${encodeURIComponent(identity)}`,
      { method: "POST" },
    );
  }

  async rejectParticipant(slug: string, identity: string) {
    return this.request(
      `/rooms/${slug}/reject/${encodeURIComponent(identity)}`,
      { method: "POST" },
    );
  }

  // Moderation
  async listBlocked(slug: string) {
    return this.request(`/rooms/${slug}/blocked`);
  }

  async blockUser(slug: string, userId: string, reason?: string) {
    return this.request(`/rooms/${slug}/block`, {
      method: "POST",
      body: JSON.stringify(reason ? { userId, reason } : { userId }),
    });
  }

  async unblockUser(slug: string, userId: string) {
    return this.request(`/rooms/${slug}/block/${userId}`, { method: "DELETE" });
  }

  async changeParticipantRole(
    slug: string,
    userId: string,
    role: "MODERATOR" | "PARTICIPANT",
  ) {
    return this.request(`/rooms/${slug}/participants/${userId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
  }

  // Pinned messages
  async pinMessage(
    slug: string,
    payload: {
      message?: string;
      authorIdentity?: string;
      authorName?: string;
      originalExternalId?: string;
      originalTimestamp?: number;
      attachments?: Array<{
        url: string;
        name: string;
        kind: "image" | "video" | "document";
        size: number;
        mime: string;
      }>;
    },
  ) {
    return this.request(`/rooms/${slug}/pins`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async unpinMessage(slug: string, pinId: string) {
    return this.request(`/rooms/${slug}/pins/${pinId}`, { method: "DELETE" });
  }

  // Chat persistence
  async saveRoomMessage(
    slug: string,
    payload: {
      externalId?: string;
      message: string;
      authorIdentity: string;
      authorName?: string;
      sentAt: number;
      isGuest?: boolean;
      attachments?: Array<{
        url: string;
        name: string;
        kind: "image" | "video" | "document";
        size: number;
        mime: string;
      }>;
    },
  ) {
    return this.request(`/rooms/${slug}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  // Загрузка файла-вложения в чат (multipart). Возвращает {url, kind, name, size, mime}.
  // `guestToken` — LiveKit JWT для гостей, у которых нет нашего Bearer.
  async uploadRoomFile(slug: string, file: File, guestToken?: string) {
    const form = new FormData();
    form.append("file", file);
    const headers: Record<string, string> = {};
    // Зарегистрированные ходят под своим JWT; гостям — только LiveKit-токен.
    const tok = this.token || guestToken;
    if (tok) headers["Authorization"] = `Bearer ${tok}`;
    const res = await fetch(`${API_URL}/rooms/${slug}/uploads`, {
      method: "POST",
      headers,
      body: form,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Не удалось загрузить файл");
    }
    return data as {
      url: string;
      kind: "image" | "video" | "document";
      name: string;
      size: number;
      mime: string;
    };
  }

  async clearRoomMessages(slug: string) {
    return this.request(`/rooms/${slug}/messages`, { method: "DELETE" });
  }

  // Polls
  async createPoll(
    slug: string,
    payload: {
      question: string;
      options: string[];
      allowMultiple?: boolean;
      isAnonymous?: boolean;
      createdByName?: string;
    },
  ) {
    return this.request(`/rooms/${slug}/polls`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  // Голосование. Для гостей передаём LiveKit JWT через guestToken.
  async votePoll(
    slug: string,
    pollId: string,
    payload: {
      optionIds: string[];
      voterIdentity: string;
      voterName?: string;
    },
    guestToken?: string,
  ) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const tok = this.token || guestToken;
    if (tok) headers["Authorization"] = `Bearer ${tok}`;
    const res = await fetch(`${API_URL}/rooms/${slug}/polls/${pollId}/vote`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Не удалось проголосовать");
    }
    return data;
  }

  async closePoll(slug: string, pollId: string) {
    return this.request(`/rooms/${slug}/polls/${pollId}/close`, {
      method: "POST",
    });
  }

  async hideRoom(slug: string) {
    return this.request(`/rooms/${slug}/hide`, { method: "POST" });
  }

  async unhideRoom(slug: string) {
    return this.request(`/rooms/${slug}/hide`, { method: "DELETE" });
  }

  // Sounds & playlist (owner-only)
  async uploadPlaylistTrack(
    slug: string,
    payload: { audio: File; icon?: File | null; title: string; author?: string },
  ): Promise<{ track: PlaylistTrack }> {
    const form = new FormData();
    form.append("audio", payload.audio);
    if (payload.icon) form.append("icon", payload.icon);
    form.append("title", payload.title);
    if (payload.author !== undefined) form.append("author", payload.author);

    const headers: Record<string, string> = {};
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const res = await fetch(`${API_URL}/rooms/${slug}/playlist`, {
      method: "POST",
      headers,
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Не удалось загрузить трек");
    return data;
  }

  async updatePlaylistTrack(
    slug: string,
    trackId: string,
    payload: { title?: string; author?: string | null },
  ): Promise<{ track: PlaylistTrack }> {
    return this.request(`/rooms/${slug}/playlist/${trackId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async deletePlaylistTrack(slug: string, trackId: string) {
    return this.request(`/rooms/${slug}/playlist/${trackId}`, {
      method: "DELETE",
    });
  }

  async reorderPlaylist(slug: string, orderedIds: string[]) {
    return this.request(`/rooms/${slug}/playlist/reorder`, {
      method: "PUT",
      body: JSON.stringify({ orderedIds }),
    });
  }

  // Загрузить файл прикольного/руки/подключения. Для сброса на дефолт см. resetRoomSound.
  async uploadRoomSound(
    slug: string,
    type: RoomSoundType,
    file: File,
  ): Promise<{ url: string }> {
    const form = new FormData();
    form.append("audio", file);
    const headers: Record<string, string> = {};
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const res = await fetch(`${API_URL}/rooms/${slug}/sounds/${type}`, {
      method: "PUT",
      headers,
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Не удалось загрузить звук");
    return data;
  }

  async resetRoomSound(slug: string, type: RoomSoundType) {
    return this.request(`/rooms/${slug}/sounds/${type}`, { method: "DELETE" });
  }

  // Invites (owner)
  async createInvite(
    slug: string,
    options?: { expiresAt?: string; maxUses?: number; allowGuests?: boolean },
  ) {
    return this.request(`/rooms/${slug}/invite`, {
      method: "POST",
      body: JSON.stringify(options ?? {}),
    });
  }

  async listInvites(slug: string) {
    return this.request(`/rooms/${slug}/invites`);
  }

  async deactivateInvite(slug: string, code: string) {
    return this.request(`/rooms/${slug}/invite/${code}`, { method: "DELETE" });
  }

  // Invites (join)
  async getInviteInfo(code: string) {
    return this.request(`/invite/${code}/info`, { method: "GET" });
  }

  async joinByInvite(code: string, displayName?: string) {
    return this.request(`/invite/${code}/join`, {
      method: "POST",
      body: JSON.stringify(displayName ? { displayName } : {}),
    });
  }

  async joinByInviteAsGuest(code: string, displayName: string) {
    return this.request(`/invite/${code}/join-guest`, {
      method: "POST",
      body: JSON.stringify({ displayName }),
    });
  }
}

export const api = new ApiClient();
