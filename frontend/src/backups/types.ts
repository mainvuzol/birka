/** `GET /backups`: the server's nightly copies, as the owner is shown them. */
export interface Night {
  started_at: string;
  finished_at: string;
  ok: boolean;
  archive: string | null;
  archive_bytes: number | null;
  drill_ok: boolean | null;
  restore_seconds: number | null;
  /** What failed, worded as the Telegram message words it. */
  reasons: string[];
}

export interface Message {
  kind: "FAILED" | "OVERDUE" | "NOT_SET_UP" | "RECOVERED";
  status: "PENDING" | "SENT" | "REFUSED" | "FAILED";
  created_at: string;
  sent_at: string | null;
  error: string | null;
}

/**
 * Trouble on the server, as the watcher saw it (owner decision, 2026-10-03):
 * the app not answering, the disk nearly full, nobody able to sign in.
 */
export type TroubleKind = "NOT_ANSWERING" | "DISK_LOW" | "SIGN_IN_FAILING";

export interface Trouble {
  kind: TroubleKind;
  /** What is wrong, worded as the bot's message words it. */
  reason: string;
  started_at: string;
  told_at: string | null;
}

export interface PastTrouble {
  kind: TroubleKind;
  reason: string;
  started_at: string;
  ended_at: string;
}

export interface Server {
  /** The watcher's last finished look at the server; null when never. */
  looked_at: string | null;
  /** Not over yet, oldest first. */
  open: Trouble[];
  /** Over within the last 7 days, newest first, 10 at most. */
  recent: PastTrouble[];
}

export interface Backups {
  state: "OK" | "FAILED" | "OVERDUE" | "NOT_SET_UP";
  checked_at: string;
  due_hours: number;
  latest: Night | null;
  last_good: Night | null;
  nights: Night[];
  your_last_message: Message | null;
  /** Absent from a server older than this app. */
  server?: Server;
}
