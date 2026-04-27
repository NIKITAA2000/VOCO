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

  // Rooms
  async createRoom(name: string) {
    return this.request("/rooms", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  async getRooms() {
    return this.request("/rooms");
  }

  async getRoom(slug: string) {
    return this.request(`/rooms/${slug}`);
  }

  async joinRoom(slug: string, options?: {
    displayName?: string;
    isGuest?: boolean;
    sessionId?: string;
  }) {
    const body: Record<string, any> = {};
    if (options?.displayName)
      body.displayName = options.displayName;
    if (options?.isGuest !== undefined)
      body.isGuest = options.isGuest;
    if (options?.sessionId)
      body.sessionId = options.sessionId;

    return this.request(`/rooms/${slug}/join`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async leaveRoom(slug: string, sessionId: string) {
    const result = await this.request(`/rooms/${slug}/leave`, {
        method: "POST",
        body: JSON.stringify({ sessionId }),
    });

    return result;
  }

  async deleteRoom(slug: string) {
    return this.request(`/rooms/${slug}`, { method: "DELETE" });
  }

  async getRoomReport(slug: string) {
    return this.request(`/rooms/${slug}/report`);
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
  async joinByInvite(code: string, options?: { displayName?: string; isGuest?: boolean }) {
    const body: Record<string, any> = {};
    if (options?.displayName)
      body.displayName = options.displayName;
    if (options?.isGuest !== undefined)
      body.isGuest = options.isGuest;

    // Путь: /invites/:code/join
    return this.request(`/invites/${code}/join`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}

export const api = new ApiClient();