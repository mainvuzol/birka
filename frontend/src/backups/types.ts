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

export interface Backups {
  state: "OK" | "FAILED" | "OVERDUE" | "NOT_SET_UP";
  checked_at: string;
  due_hours: number;
  latest: Night | null;
  last_good: Night | null;
  nights: Night[];
  your_last_message: Message | null;
}
