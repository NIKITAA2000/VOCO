const API_URL = "http://localhost:3001/api";

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

  async joinRoom(slug: string) {
    return this.request(`/rooms/${slug}/join`, { method: "POST" });
  }

  async leaveRoom(slug: string) {
    return this.request(`/rooms/${slug}/leave`, { method: "POST" });
  }

  async deleteRoom(slug: string) {
    return this.request(`/rooms/${slug}`, { method: "DELETE" });
  }
}

export const api = new ApiClient();