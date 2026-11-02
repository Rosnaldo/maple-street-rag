export interface Turn {
  role: "user" | "assistant";
  content: string;
}

interface Session {
  turns: Turn[];
  lastActiveAt: number;
}

const MAX_TURNS = 10; // last 5 exchanges
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes idle

/**
 * In-memory conversation history keyed by sessionId. Only the user message and
 * the final answer are kept: chunks and the system prompt are rebuilt each turn.
 * Expired sessions are dropped lazily on read.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly now: () => number = Date.now) {}

  getHistory(sessionId: string): Turn[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    if (this.now() - session.lastActiveAt > SESSION_TTL_MS) {
      this.sessions.delete(sessionId);
      return [];
    }
    return session.turns;
  }

  /** Called only after a successful reply, so a failed call leaves no half exchange behind. */
  appendExchange(sessionId: string, userMessage: string, answer: string): void {
    const turns: Turn[] = [
      ...this.getHistory(sessionId),
      { role: "user", content: userMessage },
      { role: "assistant", content: answer },
    ];
    this.sessions.set(sessionId, { turns: turns.slice(-MAX_TURNS), lastActiveAt: this.now() });
  }
}
