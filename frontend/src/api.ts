const API_URL = "/api";

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

  async hideRoom(slug: string) {
    return this.request(`/rooms/${slug}/hide`, { method: "POST" });
  }

  async unhideRoom(slug: string) {
    return this.request(`/rooms/${slug}/hide`, { method: "DELETE" });
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
