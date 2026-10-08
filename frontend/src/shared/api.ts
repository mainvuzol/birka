import { fileProblemText, isFileIssue } from "@/openings/fileErrors";
import { noteAnswered, noteUnreachable } from "@/shared/reach";

/**
 * What the seller is told when the server does not answer, in the owner's
 * words (owner decision, 2026-10-04; ADR-0013 §3): the shop sells on paper,
 * and types it in once the server answers. Nothing about phoning the owner:
 * the bot tells them itself.
 */
export const UNREACHABLE =
  "Сервер не відповідає. Продавайте на папері: модель, розмір, ціна, як оплачено, час. Коли сервер відповість — внесіть продажі до закриття каси.";

/**
 * No answer from the server, as `api()` itself knows it (ADR-0013 §3):
 * `fetch` gave up — no network, a connection reset, the edge dead — or the
 * 20 s ran out, or a page that is not the API's answered for it (a captive
 * portal's, an operator's). A request that got no answer may still have been
 * recorded, so a journal keeps its attempt. The app's own errors are never
 * this, so a bug never tells the seller to sell on paper.
 */
export class Unreachable extends Error {
  constructor(cause: unknown) {
    super("UNREACHABLE", { cause });
    this.name = "Unreachable";
  }
}

/**
 * A call declared slow ran out of its own 60 s with no answer (ADR-0014
 * §16): adding a stock list's file, creating a list from one, approving a
 * list. The server may still be working on it, so this is not an outage —
 * the phone is not marked as having lost the server — and the call is safe to
 * repeat: each of them is.
 */
export class SlowAnswer extends Error {
  constructor(cause: unknown) {
    super("SLOW_ANSWER", { cause });
    this.name = "SlowAnswer";
  }
}

/** How long a call declared slow waits for its answer (ADR-0014 §16). */
export const SLOW_TIMEOUT_MS = 60_000;

/**
 * One refusal of a request's shape, as FastAPI reports it in its 422
 * `detail`: where (`loc`), what (`type`) and its particulars (`ctx`). A
 * stock list's file names its line as `ctx.line` (ADR-0014 §13).
 */
export interface ValidationIssue {
  loc: (string | number)[];
  type: string;
  msg: string;
  ctx: Record<string, unknown>;
}

function validationIssues(detail: unknown): ValidationIssue[] {
  if (!Array.isArray(detail)) return [];
  return detail.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const { loc, type, msg, ctx } = item as Record<string, unknown>;
    return [
      {
        loc: Array.isArray(loc)
          ? loc.filter(
              (part): part is string | number =>
                typeof part === "string" || typeof part === "number",
            )
          : [],
        type: typeof type === "string" ? type : "",
        msg: typeof msg === "string" ? msg : "",
        ctx:
          typeof ctx === "object" && ctx !== null
            ? (ctx as Record<string, unknown>)
            : {},
      },
    ];
  });
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    // The server's `details` for this refusal, unread by most callers. The till
    // needs them: `INSUFFICIENT_STOCK` names the stock key that is short and
    // whether a correction may be offered for it.
    public details: Record<string, unknown> = {},
    // The server's number for the request (`X-Request-ID`), or null when the
    // answer carried none (the edge's own 502). A seller quotes it when a
    // server error is shown, so the log line can be found.
    public requestId: string | null = null,
    // A 422's refusals of the request's shape, each where it stands: a stock
    // list's file names the line refused (ADR-0014 §15).
    public validation: ValidationIssue[] = [],
  ) {
    super(code);
  }
}

/** A timeout's own abort, as `fetch` rejects with it. */
function timedOut(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "TimeoutError"
  );
}

export async function api<T>(
  path: string,
  token?: string,
  body?: unknown,
  // A command that carries one. Sales require it; reads and the order
  // commands, which identify themselves by `command_id` alone, do not.
  idempotencyKey?: string,
  // A body is POSTed unless this says otherwise: a stock list's line is
  // answered by a PUT, which replaces its previous answer.
  method: "POST" | "PUT" = "POST",
  // `slow`: a call that may take longer than 20 s on a server that answers
  // (ADR-0014 §16). It waits 60 s, and running out of them is `SlowAnswer`,
  // not an outage. Only a call that is safe to repeat may declare it.
  options: { slow?: boolean } = {},
): Promise<T> {
  const slow = options.slow === true;
  // Built before the request: what fails here is the app's own, never the
  // connection.
  const init: RequestInit = {
    method: body === undefined ? "GET" : method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(slow ? SLOW_TIMEOUT_MS : 20000),
  };
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, init);
  } catch (error) {
    // A slow call's own 60 s ran out: the server may still be at it.
    if (slow && timedOut(error)) throw new SlowAnswer(error);
    // `fetch`'s own rejection, or the 20 s abort: no answer.
    noteUnreachable();
    throw new Unreachable(error);
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      code?: string;
      error?: { code?: string };
      details?: Record<string, unknown>;
      detail?: unknown;
    } | null;
    const error = new ApiError(
      response.status,
      data?.code ?? data?.error?.code ?? "HTTP_ERROR",
      data?.details ?? {},
      response.headers.get("X-Request-ID"),
      validationIssues(data?.detail),
    );
    // Whether the server is reachable, for the phone's own checks
    // (ADR-0013 §4.2).
    if (unreachable(error)) noteUnreachable();
    else noteAnswered();
    throw error;
  }
  let data: T;
  try {
    data = (await response.json()) as T;
  } catch (error) {
    // The answer began, and a slow call's 60 s ran out while it arrived.
    if (slow && timedOut(error)) throw new SlowAnswer(error);
    // A 2xx that is not the API's JSON: a page answering for the server.
    noteUnreachable();
    throw new Unreachable(error);
  }
  noteAnswered();
  return data;
}

/**
 * The server was not reached (ADR-0013 §3): no answer at all (`Unreachable`),
 * or a 502, 503 or 504 — the edge's own for a stopped API, the server's own
 * `SERVER_UNAVAILABLE` when its database does not answer, a gateway's
 * timeout. Nothing else: an error of the app's own code is not an outage.
 */
export function unreachable(error: unknown): boolean {
  return (
    error instanceof Unreachable ||
    (error instanceof ApiError &&
      (error.status === 502 || error.status === 503 || error.status === 504))
  );
}
/**
 * A refusal the server raised after looking the command up under its lock,
 * so it proves the command recorded nothing (`details.recorded === false`):
 * the model was merged into another, or retired, since (ADR-0008 §9), and
 * since ADR-0013 §1 every refusal decided after a seller's command was
 * looked up — goods gone, the debt paid meanwhile, the order cancelled. It
 * settles even an attempt whose outcome was unknown, so a phone that sent a
 * sale just before the server stopped answering is not left blocked.
 */
export function recordedNothing(error: unknown): boolean {
  return error instanceof ApiError && error.details.recorded === false;
}

export function errorText(error: unknown): string {
  // The server was not reached: the shop sells on paper (ADR-0013 §3).
  if (unreachable(error)) return UNREACHABLE;
  // A slow call's own time ran out: not an outage (ADR-0014 §16).
  if (error instanceof SlowAnswer)
    return "Сервер ще не відповів. Оновіть список і перевірте, чи це збережено; повторити безпечно.";
  // The app's own failure, or a journal's: nothing to do with the connection.
  if (!(error instanceof ApiError))
    return "Не вдалося виконати операцію. Спробуйте ще раз.";
  // Paying in parts, refused for what the seller stated.
  // A warehouse waits for its opening list (owner decision, 2026-10-02).
  if (error.code === "OPENING_LIST_PENDING")
    return "На цьому складі чекає список початкових залишків. Спершу затвердіть або відхиліть його в «Початкових залишках».";
  // A shared warehouse's list whose own store does not trade is only
  // rejected, through the other store (owner decision, 2026-10-09).
  if (error.details.reason === "LIST_STORE_NOT_TRADING")
    return "Магазин, що почав цей список, не працює: список можна лише відхилити, а файли додати до нового списку.";
  // The sales report: one day to a year (owner decisions, 2026-10-02).
  if (error.details.reason === "PERIOD")
    return "Оберіть період від одного дня до року; перший день — не пізніше останнього.";
  if (error.details.reason === "PAID_IN_FULL")
    return "Клієнт сплачує все одразу — це звичайний продаж. Зніміть «Оплата частинами».";
  if (error.details.reason === "CUSTOMER_NAME")
    return "Вкажіть ім’я покупця, який платить частинами.";
  if (error.details.reason === "CUSTOMER_PHONE")
    return "Телефон покупця має містити від 10 до 15 цифр.";
  // A sale, a debt payment or money handed back says how the customer pays
  // (owner decision, 2026-10-04; ADR-0012 §B2). Refused with
  // `recorded: false`, so an old attempt saved without it settles. A collect
  // refused for the same reason has its own text («Вкажіть, як оплачено
  // замовлення.», `cash/errors.ts`), which the App picks before asking here.
  if (error.details.reason === "PAYMENT_METHOD_REQUIRED")
    return "Не вказано, як платить покупець. Натисніть «Готівка», «Картка» або «Переказ».";
  if (error.code === "NO_ACCESS")
    return "Доступ до магазину закрито. Зверніться до власника.";
  // A blocked or archived store does nothing (owner decisions, 2026-10-01).
  if (error.code === "STORE_NOT_TRADING")
    return error.details.state === "ARCHIVED"
      ? "Магазин закрито, він в архіві: операції в ньому не проводяться."
      : "Магазин заблоковано власником: операції в ньому зупинено.";
  if (error.status === 401)
    return "Сесія завершилась. Закрийте й відкрийте застосунок у Telegram. Незавершену команду збережено.";
  // Too many sign-ins from one address are refused for a while, so that the
  // public address cannot be flooded with them.
  if (error.code === "RATE_LIMITED")
    return "Забагато спроб входу. Зачекайте хвилину й спробуйте ще раз.";
  // The edge refuses a body larger than anything the app sends, before the
  // API reads it, and without a body of its own to explain.
  if (error.status === 413)
    return "Запит завеликий: сервер його не прийняв. Зверніться до адміністратора.";
  if (error.status === 403)
    return "Немає доступу до цієї операції або складу. Зверніться до менеджера.";
  // Correcting the catalogue (owner decision, 2026-10-03).
  if (error.code === "MODEL_MERGED")
    return "Цю модель об’єднано з іншою. Виберіть товар ще раз: стара назва тепер веде до моделі, що лишилась.";
  if (error.code === "MODEL_RETIRED")
    return "Цю модель прибрано: її залишок продають, але нового не приймають. Щоб приймати, поверніть її в «Моделях».";
  if (error.code === "CATALOG_SIMILAR")
    return "У каталозі вже є схожа назва. Візьміть її або підтвердьте, що це інша.";
  if (error.code === "SAME_AS")
    return "Така назва вже є в іншої моделі. Об’єднайте їх у «Моделях».";
  if (error.details.reason === "OPENING_LIST_WAITING")
    return "Модель є в списку початкових залишків, що чекає. Спершу затвердіть або відхиліть його в «Початкових залишках».";
  if (error.code === "MERGE_BLOCKED")
    return "Моделі ще не можна об’єднати: спершу завершіть те, що показано.";
  if (error.code === "INSUFFICIENT_STOCK")
    return "Доступного товару вже недостатньо. Оновіть залишки та перевірте кількість.";
  if (error.code === "IDEMPOTENCY_IN_PROGRESS")
    return "Попередня спроба ще виконується. Зачекайте кілька секунд і перевірте результат.";
  if (error.status === 409)
    return "Дані змінилися або команда конфліктує з попередньою. Оновіть замовлення.";
  // A stock list's file refused: which line, and what is wrong in it
  // (ADR-0014 §15). Every other 422 reads as before.
  const fileIssue = error.validation.find(isFileIssue);
  if (error.status === 422 && fileIssue) return fileProblemText(fileIssue);
  if (error.status === 422)
    return "Перевірте дані та поточний статус замовлення.";
  // A server error is logged under the request's number: the seller can
  // quote its start to whoever reads the log.
  if (error.status >= 500 && error.requestId)
    return `Не вдалося виконати операцію. Спробуйте ще раз. Номер запиту: ${error.requestId.slice(0, 8)}.`;
  return "Не вдалося виконати операцію. Спробуйте ще раз.";
}
