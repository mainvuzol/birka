export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    // The server's `details` for this refusal, unread by most callers. The till
    // needs them: `INSUFFICIENT_STOCK` names the stock key that is short and
    // whether a correction may be offered for it.
    public details: Record<string, unknown> = {},
  ) {
    super(code);
  }
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
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: body === undefined ? "GET" : method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      code?: string;
      error?: { code?: string };
      details?: Record<string, unknown>;
    } | null;
    throw new ApiError(
      response.status,
      data?.code ?? data?.error?.code ?? "HTTP_ERROR",
      data?.details ?? {},
    );
  }
  return (await response.json()) as T;
}
export function errorText(error: unknown): string {
  if (!(error instanceof ApiError))
    return "Немає відповіді сервера. Перевірте зв’язок і повторіть спробу.";
  // Paying in parts, refused for what the seller stated.
  // The sales report: one day to a year (owner decisions, 2026-10-02).
  if (error.details.reason === "PERIOD")
    return "Оберіть період від одного дня до року; перший день — не пізніше останнього.";
  if (error.details.reason === "PAID_IN_FULL")
    return "Клієнт сплачує все одразу — це звичайний продаж. Зніміть «Оплата частинами».";
  if (error.details.reason === "CUSTOMER_NAME")
    return "Вкажіть ім’я покупця, який платить частинами.";
  if (error.details.reason === "CUSTOMER_PHONE")
    return "Телефон покупця має містити від 10 до 15 цифр.";
  if (error.code === "NO_ACCESS")
    return "Доступ до магазину закрито. Зверніться до власника.";
  // A blocked or archived store does nothing (owner decisions, 2026-10-01).
  if (error.code === "STORE_NOT_TRADING")
    return error.details.state === "ARCHIVED"
      ? "Магазин закрито, він в архіві: операції в ньому не проводяться."
      : "Магазин заблоковано власником: операції в ньому зупинено.";
  if (error.status === 401)
    return "Сесія завершилась. Закрийте й відкрийте застосунок у Telegram. Незавершену команду збережено.";
  if (error.status === 403)
    return "Немає доступу до цієї операції або складу. Зверніться до менеджера.";
  if (error.code === "INSUFFICIENT_STOCK")
    return "Доступного товару вже недостатньо. Оновіть залишки та перевірте кількість.";
  if (error.code === "IDEMPOTENCY_IN_PROGRESS")
    return "Попередня спроба ще виконується. Зачекайте кілька секунд і перевірте результат.";
  if (error.status === 409)
    return "Дані змінилися або команда конфліктує з попередньою. Оновіть замовлення.";
  if (error.status === 422)
    return "Перевірте дані та поточний статус замовлення.";
  return "Не вдалося виконати операцію. Спробуйте ще раз.";
}
