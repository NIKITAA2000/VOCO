import { db } from "./db.js";

export interface PollOptionDto {
  id: string;
  text: string;
  position: number;
  voteCount: number;
  voters: PollVoterDto[]; // пустой массив, если опрос анонимный
}

export interface PollVoterDto {
  identity: string;
  name: string | null;
  userId: string | null;
  votedAt: number; // epoch ms
}

export interface PollDto {
  id: string;
  question: string;
  allowMultiple: boolean;
  isAnonymous: boolean;
  isClosed: boolean;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: number; // epoch ms
  closedAt: number | null; // epoch ms
  options: PollOptionDto[];
  totalVotes: number;
  myVote: string[]; // option_id'ы, за которые проголосовал текущий viewer
}

/**
 * Загружает все опросы комнаты + опции + голоса.
 * @param roomId UUID комнаты
 * @param viewerIdentity LiveKit identity текущего смотрящего (для подсчёта myVote).
 *                      Для гостей — guest_xxx, для зарегистрированных — userId.
 *                      Если null/undefined — myVote будет всегда пустым.
 */
export async function loadRoomPolls(
  roomId: string,
  viewerIdentity?: string | null,
): Promise<PollDto[]> {
  // PG TIMESTAMP без TZ + контейнер postgres в UTC = pg-драйвер интерпретирует
  // как локальное время хоста и сдвигает на TZ-offset. Чтобы клиент получал
  // однозначные ms, возвращаем явный epoch (как в recordings.ts).
  const pollsResult = await db.query(
    `SELECT id,
            question,
            allow_multiple AS "allowMultiple",
            is_anonymous AS "isAnonymous",
            is_closed AS "isClosed",
            created_by AS "createdBy",
            created_by_name AS "createdByName",
            (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS "createdAtMs",
            (EXTRACT(EPOCH FROM closed_at) * 1000)::bigint AS "closedAtMs"
       FROM chat_polls
      WHERE room_id = $1
      ORDER BY created_at ASC`,
    [roomId],
  );
  if (pollsResult.rows.length === 0) return [];

  const pollIds: string[] = pollsResult.rows.map((r) => r.id);

  const optionsResult = await db.query(
    `SELECT id, poll_id AS "pollId", text, position
       FROM poll_options
      WHERE poll_id = ANY($1::uuid[])
      ORDER BY position ASC`,
    [pollIds],
  );

  const votesResult = await db.query(
    `SELECT poll_id AS "pollId",
            option_id AS "optionId",
            voter_user_id AS "voterUserId",
            voter_identity AS "voterIdentity",
            voter_name AS "voterName",
            (EXTRACT(EPOCH FROM voted_at) * 1000)::bigint AS "votedAtMs"
       FROM poll_votes
      WHERE poll_id = ANY($1::uuid[])
      ORDER BY voted_at ASC`,
    [pollIds],
  );

  // Группируем опции и голоса по pollId.
  const optionsByPoll = new Map<string, PollOptionDto[]>();
  for (const row of optionsResult.rows) {
    const arr = optionsByPoll.get(row.pollId) ?? [];
    arr.push({
      id: row.id,
      text: row.text,
      position: row.position,
      voteCount: 0,
      voters: [],
    });
    optionsByPoll.set(row.pollId, arr);
  }

  const votesByPoll = new Map<string, typeof votesResult.rows>();
  for (const row of votesResult.rows) {
    const arr = votesByPoll.get(row.pollId) ?? [];
    arr.push(row);
    votesByPoll.set(row.pollId, arr);
  }

  return pollsResult.rows.map((p) => {
    const options = (optionsByPoll.get(p.id) ?? []).map((o) => ({ ...o }));
    const optionMap = new Map(options.map((o) => [o.id, o]));
    const votes = votesByPoll.get(p.id) ?? [];

    const myVote: string[] = [];
    for (const v of votes) {
      const opt = optionMap.get(v.optionId);
      if (!opt) continue;
      opt.voteCount += 1;
      if (!p.isAnonymous) {
        opt.voters.push({
          identity: v.voterIdentity,
          name: v.voterName,
          userId: v.voterUserId,
          votedAt: v.votedAtMs != null ? Number(v.votedAtMs) : 0,
        });
      }
      if (viewerIdentity && v.voterIdentity === viewerIdentity) {
        myVote.push(v.optionId);
      }
    }

    return {
      id: p.id,
      question: p.question,
      allowMultiple: p.allowMultiple,
      isAnonymous: p.isAnonymous,
      isClosed: p.isClosed,
      createdBy: p.createdBy,
      createdByName: p.createdByName,
      createdAt: p.createdAtMs != null ? Number(p.createdAtMs) : Date.now(),
      closedAt: p.closedAtMs != null ? Number(p.closedAtMs) : null,
      options,
      totalVotes: votes.length,
      myVote,
    };
  });
}
