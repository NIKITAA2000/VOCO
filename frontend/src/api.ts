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

  async getRooms() {
    return this.request("/rooms");
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
