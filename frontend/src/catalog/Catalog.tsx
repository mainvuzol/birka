import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorText, recordedNothing } from "@/shared/api";
import { keptText, useAutoCheck } from "@/shared/reach";
import { visible } from "@/shared/visible";
import type { Store } from "@/orders/types";
import {
  CANCEL_CREATION_REASON,
  forgetCatalogRefusal,
  submitCatalogCommand,
  useCatalogCommand,
} from "./commands";
import type { Command } from "./commands";
import { fieldLabels, reviewText, statusLabels } from "./types";
import type { Decision } from "./types";
import { CreateProduct } from "./CreateProduct";
const base = "/catalog/match-decisions";
function message(error: unknown): string {
  // Correcting the catalogue (owner decision, 2026-10-03) says its own.
  if (
    error instanceof ApiError &&
    ["CATALOG_SIMILAR", "MODEL_RETIRED", "MODEL_MERGED"].includes(error.code)
  )
    return errorText(error);
  if (error instanceof ApiError && error.code === "IDEMPOTENCY_CONFLICT")
    return "Для цієї операції або назви вже збережено інше рішення. Оновіть перегляд; повторно зараховувати свідчення не потрібно.";
  if (error instanceof ApiError && error.code === "CATALOG_AMBIGUOUS")
    return "Модель неоднозначна або стан каталогу змінився. Перевірте обрану модель. Для окремої моделі зі схожою назвою вкажіть її відмінність; за тимчасового конфлікту повторіть спробу.";
  if (error instanceof ApiError && error.status === 409)
    return "Каталог або рішення змінилися. Оновіть перегляд. Для застарілої підказки створіть нову пропозицію та перевірте товар заново.";
  if (error instanceof ApiError && error.status === 422)
    return "Перевірте введені дані та стан пропозиції.";
  return errorText(error);
}
export function Catalog({
  store,
  token,
  journalKey,
  storageError,
  person,
}: {
  store: Store;
  token: string;
  journalKey: string;
  storageError: boolean;
  /** Whoever this phone belongs to: named on the kept operation's paper line. */
  person: string;
}): JSX.Element {
  const cache = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [raw, setRaw] = useState("");
  const [filter, setFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [success, setSuccess] = useState("");
  const { pending, busy, error, kept } = useCatalogCommand();
  // Kept when this screen opened: its journal read it from the phone's
  // storage, since a kept operation holds every tab on this one.
  const [loaded] = useState(() => pending !== null);
  const blocked = storageError || busy || pending !== null;
  const list = useQuery({
    queryKey: ["catalog-decisions", journalKey, filter, offset],
    queryFn: () =>
      api<{ items: Decision[]; has_more: boolean }>(
        `${base}?store_id=${store.id}&limit=20&offset=${String(offset)}${filter ? `&status=${filter}` : ""}`,
        token,
      ),
  });
  const detail = useQuery({
    queryKey: ["catalog-decision", journalKey, selected],
    queryFn: () => api<Decision>(`${base}/${selected ?? ""}`, token),
    enabled: selected !== null,
  });
  async function run(command: Command): Promise<void> {
    setSuccess("");
    const result = await submitCatalogCommand(journalKey, token, command);
    if (result) {
      cache.setQueryData(
        ["catalog-decision", journalKey, result.decision_id],
        result,
      );
      setSelected(result.decision_id);
      setCreating(false);
      setRaw("");
      setSuccess(
        command.path.endsWith("/alias-feedback")
          ? "Свідчення про назву збережено. Автоматичне підтвердження назв вимкнене."
          : "Рішення збережено.",
      );
      await cache.invalidateQueries({
        queryKey: ["catalog-decisions", journalKey],
      });
    }
  }
  // A seller's kept catalogue operation holds the till too, so the phone
  // checks it by itself (ADR-0013 §4.3, G11): the same operation resent.
  useAutoCheck([
    {
      pending: pending !== null,
      busy,
      loaded,
      run: () => {
        if (pending) void run(pending);
      },
    },
  ]);
  // A first attempt's refusal goes with this screen: back from another tab,
  // the queue opens without it.
  useEffect(
    () => () => {
      forgetCatalogRefusal();
    },
    [],
  );
  return (
    <>
      {pending && (
        <section className="notice">
          <h3>Незавершена операція каталогу</h3>
          <p>
            Результат ще не підтверджено. Повторна спроба використовує ту саму
            операцію.
          </p>
          <p>{keptText(pending.since, person)}</p>
          <button
            disabled={busy}
            onClick={() => {
              void run(pending);
            }}
          >
            Повторити ту саму операцію
          </button>
          {pending.path.endsWith("/create-product") && (
            <>
              <p>
                Якщо створення не вдається, можна скасувати пропозицію. Якщо
                товар уже збережено, покажемо результат.
              </p>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => {
                  void run({
                    path: `${base}/${pending.decisionId}/reject`,
                    decisionId: pending.decisionId,
                    body: { reason: CANCEL_CREATION_REASON },
                    ambiguous: true,
                  });
                }}
              >
                Скасувати незавершене створення
              </button>
            </>
          )}
        </section>
      )}
      {error !== null && (
        <p role="alert">
          {kept && recordedNothing(error)
            ? `Операцію каталогу не записано. ${message(error)}`
            : message(error)}
        </p>
      )}
      {success && <p role="status">{success}</p>}
      <div className="toolbar">
        <h2>Перевірка каталогу</h2>
        <button
          disabled={blocked}
          onClick={() => {
            forgetCatalogRefusal();
            setCreating(true);
            setSelected(null);
            setSuccess("");
          }}
        >
          + Нова пропозиція
        </button>
      </div>
      <p className="hint">
        Підказки допомагають знайти товар. Перевірка не змінює залишки та не
        об’єднує товари.
      </p>
      {(creating || selected) && (
        <button
          className="quiet"
          disabled={blocked}
          onClick={() => {
            forgetCatalogRefusal();
            setCreating(false);
            setSelected(null);
            setSuccess("");
          }}
        >
          ← До черги перевірки
        </button>
      )}
      {creating ? (
        <section>
          <h3>Нова пропозиція</h3>
          <fieldset disabled={blocked}>
            <label>
              Початковий опис товару
              <textarea
                maxLength={2000}
                value={raw}
                onChange={(e) => {
                  setRaw(e.target.value);
                }}
              />
            </label>
            <p className="hint">Зберігаємо текст без змін. До 2000 символів.</p>
            <button
              disabled={!raw.trim()}
              onClick={() => {
                const id = crypto.randomUUID();
                void run({
                  path: base,
                  decisionId: id,
                  body: { decision_id: id, store_id: store.id, raw_text: raw },
                });
              }}
            >
              Зберегти пропозицію
            </button>
          </fieldset>
        </section>
      ) : selected ? (
        detail.isPending ? (
          <p role="status">Завантажуємо пропозицію…</p>
        ) : detail.error ? (
          <Failure
            error={detail.error}
            retry={() => {
              void detail.refetch();
            }}
          />
        ) : (
          <Detail
            key={detail.data.decision_id + detail.data.status}
            decision={detail.data}
            token={token}
            scopeKey={journalKey}
            canCreate={store.permissions.includes("catalog:create")}
            blocked={blocked}
            run={run}
            refresh={() => {
              void detail.refetch();
            }}
          />
        )
      ) : (
        <section>
          <label>
            Стан пропозицій
            <select
              disabled={blocked}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Очікують перевірки</option>
              <option value="APPLIED">Підтверджені</option>
              <option value="REJECTED">Відхилені</option>
            </select>
          </label>
          <button
            className="quiet"
            disabled={blocked}
            onClick={() => {
              void list.refetch();
            }}
          >
            Оновити чергу
          </button>
          {list.isPending ? (
            <p role="status">Завантажуємо чергу…</p>
          ) : list.error ? (
            <Failure
              error={list.error}
              retry={() => {
                void list.refetch();
              }}
            />
          ) : (
            <>
              {list.data.items.length === 0 && (
                <p>У цій черзі поки немає пропозицій.</p>
              )}
              {list.data.items.map((d) => (
                <button
                  className="order-card catalog-card"
                  key={d.decision_id}
                  disabled={blocked}
                  onClick={() => {
                    forgetCatalogRefusal();
                    setSelected(d.decision_id);
                    setSuccess("");
                  }}
                >
                  <span className="badge">{statusLabels[d.status]}</span>
                  <strong className="catalog-raw">
                    {visible(d.preview.raw_text)}
                  </strong>
                </button>
              ))}
              <div className="toolbar">
                <button
                  className="quiet"
                  disabled={blocked || offset === 0}
                  onClick={() => {
                    setOffset(Math.max(0, offset - 20));
                  }}
                >
                  Попередні пропозиції
                </button>
                <button
                  className="quiet"
                  disabled={blocked || !list.data.has_more || offset >= 10000}
                  onClick={() => {
                    setOffset(offset + 20);
                  }}
                >
                  Наступні пропозиції
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
function Failure({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}): JSX.Element {
  return (
    <div role="alert">
      <p>{message(error)}</p>
      <button onClick={retry}>Повторити завантаження</button>
    </div>
  );
}
function Detail({
  decision,
  token,
  scopeKey,
  canCreate,
  blocked,
  run,
  refresh,
}: {
  decision: Decision;
  token: string;
  scopeKey: string;
  canCreate: boolean;
  blocked: boolean;
  run: (c: Command) => Promise<void>;
  refresh: () => void;
}): JSX.Element {
  // The last refusal and the operation it answered: creating this proposal's
  // product answers a similar name, never another proposal's.
  const { error, refused } = useCatalogCommand();
  const [variant, setVariant] = useState("");
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState(false);
  const [rejectedVariant, setRejectedVariant] = useState("");
  const open = ["PENDING", "NEEDS_REVIEW"].includes(decision.status);
  const candidates = decision.preview.candidates;
  const aliasTooLong =
    decision.preview.raw_text.trim().replace(/\s+/g, " ").length > 200;
  function action(suffix: string, body: Record<string, unknown>): void {
    void run({
      path: `${base}/${decision.decision_id}/${suffix}`,
      decisionId: decision.decision_id,
      body,
    });
  }
  return (
    <section>
      <div className="toolbar">
        <h3>Пропозиція каталогу</h3>
        <button className="quiet" disabled={blocked} onClick={refresh}>
          Оновити пропозицію
        </button>
      </div>
      <span className="badge">{statusLabels[decision.status]}</span>
      <h4>Оригінальний опис</h4>
      <p className="catalog-raw">{visible(decision.preview.raw_text)}</p>
      {decision.rejection && (
        <p>Причина відхилення: {visible(decision.rejection.reason)}</p>
      )}
      <ul>
        {[...new Set(decision.preview.review_reasons.map(reviewText))].map(
          (text) => (
            <li key={text}>{text}</li>
          ),
        )}
      </ul>
      {decision.preview.truncated && (
        <p className="notice">
          Список кандидатів обмежено. Не обирайте товар лише через схожість
          назви.
        </p>
      )}
      {open && canCreate && (
        <CreateProduct
          decision={decision}
          token={token}
          scopeKey={scopeKey}
          blocked={blocked}
          submit={(body) => {
            action("create-product", body);
          }}
          refusal={
            error !== null &&
            refused?.decisionId === decision.decision_id &&
            refused.path.endsWith("/create-product")
              ? { error, sent: refused.body }
              : null
          }
        />
      )}
      {decision.creation?.redirected_from && (
        <p role="status">
          Ця назва була в моделі, яку об’єднали з іншою, тож товар пов’язано з
          моделлю, що лишилась.
        </p>
      )}
      {decision.creation && (
        <p>
          Збережений товар: {visible(decision.creation.display_name)}. Розміри:{" "}
          {decision.creation.sizes
            .map((s) => `${visible(s.code)} (${s.system})`)
            .join(", ")}
        </p>
      )}
      {/* One size, one spelling (owner decision, 2026-10-03): whoever typed
          «м» sees that it is the size «M». */}
      {decision.creation?.sizes
        .filter((s) => s.typed && s.typed !== s.code)
        .map((s) => (
          <p key={s.code} role="status">
            Набрано «{visible(s.typed ?? "")}» — це розмір «{visible(s.code)}».
          </p>
        ))}
      {open ? (
        <fieldset disabled={blocked}>
          <legend>Оберіть товар після перевірки</legend>
          {candidates.length === 0 && (
            <p>
              Кандидатів немає. Перевірте опис і створіть товар, якщо маєте
              право, або відхиліть пропозицію з поясненням.
            </p>
          )}
          {candidates.map((c) => (
            <label className="catalog-candidate" key={c.variant_id}>
              <span className="check">
                <input
                  type="radio"
                  name="catalog-variant"
                  value={c.variant_id}
                  checked={variant === c.variant_id}
                  onChange={() => {
                    setVariant(c.variant_id);
                  }}
                />
                <strong>{visible(c.display_name)}</strong>
              </span>
              {c.distinction_note && (
                <span>Відмінність моделі: {visible(c.distinction_note)}</span>
              )}
              {c.conflicts.length > 0 && (
                <span>
                  Не збігається:{" "}
                  {c.conflicts
                    .map((f) => fieldLabels[f] ?? "ознака потребує перевірки")
                    .join(", ")}
                </span>
              )}
            </label>
          ))}
          <button
            disabled={!variant}
            onClick={() => {
              action("confirm", {
                variant_id: variant,
                expected_knowledge_revision: decision.knowledge_revision,
              });
            }}
          >
            Підтвердити обраний товар
          </button>
          <label>
            Причина відхилення
            <textarea
              maxLength={1000}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
          </label>
          <button
            className="quiet"
            disabled={!reason.trim()}
            onClick={() => {
              action("reject", { reason: reason.trim() });
            }}
          >
            Відхилити пропозицію
          </button>
        </fieldset>
      ) : (
        <fieldset disabled={blocked || aliasTooLong}>
          <legend>Свідчення про назву — за бажанням</legend>
          {aliasTooLong && (
            <p>
              Опис задовгий для назви: свідчення підтримують до 200 символів.
            </p>
          )}
          <p>
            Зберігайте зв’язок лише коли весь початковий опис справді є назвою
            цього товару. Це не робить назву автоматично перевіреною.
          </p>
          {decision.status === "APPLIED" && decision.resolved_variant_id && (
            <>
              <p>
                Обраний товар:{" "}
                {visible(
                  decision.creation?.display_name ??
                    candidates.find(
                      (c) => c.variant_id === decision.resolved_variant_id,
                    )?.display_name ??
                    "Підтверджений товар",
                )}
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={feedback}
                  onChange={(e) => {
                    setFeedback(e.target.checked);
                  }}
                />
                Зберегти підтвердження назви
              </label>
              <button
                disabled={!feedback}
                onClick={() => {
                  action("alias-feedback", {
                    feedback_id: crypto.randomUUID(),
                    variant_id: decision.resolved_variant_id,
                    event: "CONFIRM",
                  });
                  setFeedback(false);
                }}
              >
                Підтвердити зв’язок назви
              </button>
            </>
          )}
          <label>
            Товар, якому ця назва не відповідає
            <select
              value={rejectedVariant}
              onChange={(e) => {
                setRejectedVariant(e.target.value);
              }}
            >
              <option value="">Оберіть явно</option>
              {candidates
                .filter((c) => c.variant_id !== decision.resolved_variant_id)
                .map((c) => (
                  <option key={c.variant_id} value={c.variant_id}>
                    {visible(c.display_name)}
                    {c.distinction_note
                      ? ` — ${visible(c.distinction_note)}`
                      : ""}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="quiet"
            disabled={!rejectedVariant}
            onClick={() => {
              action("alias-feedback", {
                feedback_id: crypto.randomUUID(),
                variant_id: rejectedVariant,
                event: "REJECT",
              });
              setRejectedVariant("");
            }}
          >
            Заперечити зв’язок назви
          </button>
        </fieldset>
      )}
    </section>
  );
}
