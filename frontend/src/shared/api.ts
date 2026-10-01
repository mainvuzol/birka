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
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
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
  if (error.code === "NO_ACCESS")
    return "Доступ до магазину закрито. Зверніться до власника.";
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
