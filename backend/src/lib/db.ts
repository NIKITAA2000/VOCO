export interface User {
  id: string;
  email: string;
  username: string;
  password: string;
  avatarUrl: string | null;
  createdAt: Date;
}

export interface Room {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  maxUsers: number;
  ownerId: string;
  createdAt: Date;
  closedAt: Date | null;
}

export interface Participant {
  id: string;
  userId: string;
  roomId: string;
  role: "OWNER" | "MODERATOR" | "PARTICIPANT";
  joinedAt: Date;
  leftAt: Date | null;
}

class InMemoryDB {
  users: User[] = [];
  rooms: Room[] = [];
  participants: Participant[] = [];

  // --- Users ---
  findUserByEmail(email: string): User | undefined {
    return this.users.find((u) => u.email === email);
  }

  findUserByUsername(username: string): User | undefined {
    return this.users.find((u) => u.username === username);
  }

  findUserById(id: string): User | undefined {
    return this.users.find((u) => u.id === id);
  }

  createUser(data: Omit<User, "id" | "createdAt" | "avatarUrl">): User {
    const user: User = {
      ...data,
      id: crypto.randomUUID(),
      avatarUrl: null,
      createdAt: new Date(),
    };
    this.users.push(user);
    return user;
  }

  // --- Rooms ---
  findRoomBySlug(slug: string): Room | undefined {
    return this.rooms.find((r) => r.slug === slug);
  }

  findRoomById(id: string): Room | undefined {
    return this.rooms.find((r) => r.id === id);
  }

  findRoomsByUser(userId: string): Room[] {
    const participantRoomIds = this.participants
      .filter((p) => p.userId === userId)
      .map((p) => p.roomId);

    return this.rooms.filter(
      (r) => r.ownerId === userId || participantRoomIds.includes(r.id)
    );
  }

  createRoom(data: Omit<Room, "id" | "createdAt" | "isActive" | "closedAt">): Room {
    const room: Room = {
      ...data,
      id: crypto.randomUUID(),
      isActive: true,
      createdAt: new Date(),
      closedAt: null,
    };
    this.rooms.push(room);
    return room;
  }

  closeRoom(id: string): void {
    const room = this.rooms.find((r) => r.id === id);
    if (room) {
      room.isActive = false;
      room.closedAt = new Date();
    }
  }

  // --- Participants ---
  getActiveParticipants(roomId: string): Participant[] {
    return this.participants.filter(
      (p) => p.roomId === roomId && p.leftAt === null
    );
  }

  getActiveParticipantsWithUsers(roomId: string) {
    return this.getActiveParticipants(roomId).map((p) => {
      const user = this.findUserById(p.userId);
      return {
        ...p,
        user: user
          ? { id: user.id, username: user.username, avatarUrl: user.avatarUrl }
          : null,
      };
    });
  }

  addParticipant(
    userId: string,
    roomId: string,
    role: Participant["role"]
  ): Participant {
    const participant: Participant = {
      id: crypto.randomUUID(),
      userId,
      roomId,
      role,
      joinedAt: new Date(),
      leftAt: null,
    };
    this.participants.push(participant);
    return participant;
  }

  removeParticipant(userId: string, roomId: string): void {
    const p = this.participants.find(
      (p) => p.userId === userId && p.roomId === roomId && p.leftAt === null
    );
    if (p) {
      p.leftAt = new Date();
    }
  }
}

// Единственный экземпляр "базы данных"
export const db = new InMemoryDB();