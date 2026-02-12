import express from 'express';
import cors from 'cors';
import { AccessToken } from 'livekit-server-sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173'
}));
app.use(express.json());

// Для тестов
app.post('/test-post', (req, res) => {
  console.log('POST работает:', req.body);
  res.json({ success: true, received: req.body });
});

// Главный эндпоинт — JWT-токен для LiveKit
app.post('/api/rooms/:room/join', async (req, res) => {
  try {
    const { identity } = req.body;
    const room = req.params.room;

    console.log(`JOIN: ${identity} → ${room}`);

    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY || 'devkey',
      process.env.LIVEKIT_API_SECRET || 'secret',
      {
        identity: identity || `user-${Date.now()}`,
        name: identity || 'User'
      }
    );

    token.addGrant({
      roomJoin: true,
      room: room || 'test-room',
      canPublish: true,
      canSubscribe: true
    });

    const jwtString = await token.toJwt();

    console.log(`JWT: ${jwtString.slice(0, 30)}...`);

    res.json({
      token: jwtString,
      url: process.env.LIVEKIT_URL || 'ws://localhost:7880'
    });

  } catch (error) {
    console.error('ERROR:', error);
    res.status(500).json({ error: 'Token failed' });
  }
});

// Health-проверка
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    port: PORT,
    livekit: process.env.LIVEKIT_URL || 'ws://localhost:7880'
  });
});

app.listen(PORT, () => {
  console.log(`Backend: http://localhost:${PORT}`);
  console.log(`POST /api/rooms/test-room/join`);
});
