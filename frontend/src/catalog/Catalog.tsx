import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { createPortal } from "react-dom";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/shared/api";
import { Eyelet } from "@/shared/Eyelet";
import { ModeSwitch } from "@/shared/ModeSwitch";
import { Sheet } from "@/shared/Sheet";
import { Stub } from "@/shared/Stub";
import { buzz, useMainButton } from "@/shared/telegram";
import { visible } from "@/shared/visible";
import type { Store } from "@/orders/types";
import {
  catalogMessage,
  catalogRefusal,
  forgetCatalogRefusal,
  submitCatalogCommand,
  useCatalogCommand,
} from "./commands";
import type { Command } from "./commands";
import { KeptCatalog } from "./KeptCatalog";
import { NewModel } from "./NewModel";
import { fieldLabels, reviewText, statusLabels } from "./types";
import type { Decision } from "./types";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import { Back } from "@/shared/Back";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { Unread } from "@/shared/Unread";
import { Sticker } from "@/shared/Sticker";
import { Empty } from "@/shared/Empty";
import { Placeholder } from "@/shared/Placeholder";
import { useNextPageFailed } from "@/shared/nextPage";
const base = "/catalog/match-decisions";
/** A page of the queue; the server reads no further than offset 10 000. */
const PAGE = 20;
const LAST_OFFSET = 10000;

type Queue = "OPEN" | "APPLIED" | "REJECTED";
const queues: readonly { mode: Queue; label: string }[] = [
  { mode: "OPEN", label: "Чекають" },
  { mode: "APPLIED", label: "Підтверджені" },
  { mode: "REJECTED", label: "Відхилені" },
];
/** The blank tag's one line, and its meta where the queue needs one (goods
 * task list after stage 2, P2-2): the words as they were. */
const emptyQueue: Record<Queue, { title: string; meta?: string }> = {
  OPEN: {
    title: "Нічого не чекає перевірки.",
    meta: "Перевірка не змінює залишки й не об’єднує моделі.",
  },
  APPLIED: { title: "Підтверджених пропозицій ще немає." },
  REJECTED: { title: "Відхилених пропозицій немає." },
};

/**
 * A name's answer saved, in the shop's words (stage 2, goods task list,
 * P2-2): «Збережено: «{опис}» — назва {модель}.», or «— не назва» for a
 * model it is not. The description as its name is kept: spaces as one.
 */
function feedbackSaid(
  command: Command,
  decision: Decision | undefined,
): string {
  if (decision === undefined) return "Збережено.";
  const variant = command.body.variant_id;
  const name =
    decision.preview.candidates.find((c) => c.variant_id === variant)
      ?.display_name ??
    (decision.resolved_variant_id === variant
      ? decision.creation?.display_name
      : undefined);
  if (name === undefined) return "Збережено.";
  const phrase = decision.preview.raw_text.trim().replace(/\s+/g, " ");
  return command.body.event === "REJECT"
    ? `Збережено: «${visible(phrase)}» — не назва ${visible(name)}.`
    : `Збережено: «${visible(phrase)}» — назва ${visible(name)}.`;
}

/**
 * «Перевірка каталогу» (stage 2, goods task list, P1-1): the queue one switch
 * — «Чекають · Підтверджені · Відхилені» — over its rows, «Оновити» and
 * «Нова пропозиція» in the header; a proposal its own screen, its words
 * large, the candidates rows with «Це вона», «Підтвердити: …» its one button,
 * «Створити нову» the sheet «Нова модель» at its third step, «Відхилити» a
 * sheet with the reason. The name's answer folded under «Цей опис — назва
 * товару?». The commands are the ones they were.
 */
export function Catalog({
  store,
  token,
  journalKey,
  storageError,
  back,
}: {
  store: Store;
  token: string;
  journalKey: string;
  storageError: boolean;
  /** Whoever this phone belongs to: named on the kept operation's paper
   * line, now read from the catalogue's journal. */
  person?: string;
  /** «← Ще» over the heading: a section opened from «Ще» (navigation task
   * list, P0-4). */
  back?: MoreBack | undefined;
}): JSX.Element {
  const cache = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // «Створити нову» on a proposal: the sheet over this screen.
  const [making, setMaking] = useState(false);
  const [queue, setQueue] = useState<Queue>("OPEN");
  const [success, setSuccess] = useState("");
  const { pending, busy, error, kept } = useCatalogCommand();
  // Kept when this screen opened: its journal read it from the phone's
  // storage, since a kept operation holds every tab on this one.
  const [loaded] = useState(() => pending !== null);
  const blocked = storageError || busy || pending !== null;
  const canCreate = store.permissions.includes("catalog:create");
  // «Показати ще» adds the next page under the rows (goods task list after
  // stage 2, P2-1): the first never goes while the next is read.
  const list = useInfiniteQuery({
    queryKey: ["catalog-decisions", journalKey, queue],
    queryFn: ({ pageParam }) =>
      api<{ items: Decision[]; has_more: boolean }>(
        `${base}?store_id=${store.id}&limit=${String(PAGE)}&offset=${String(pageParam)}${queue === "OPEN" ? "" : `&status=${queue}`}`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.has_more && pages.length * PAGE <= LAST_OFFSET
        ? pages.length * PAGE
        : undefined,
  });
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  // What could not be read (as the till's list, sale P1-4): never read, the
  // plate in the rows' place; read again and refused, the plate over the
  // rows read; a next page, the plate where «Показати ще» stood (review).
  const nextFailed = useNextPageFailed(list);
  const neverRead = list.error !== null && list.data === undefined;
  const readAgainFailed =
    list.error !== null && list.data !== undefined && !nextFailed;
  // «Показати ще» pressed: the cursor goes to the first row it brings.
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const shelf = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (focusAt === null) return;
    const next =
      shelf.current?.querySelectorAll<HTMLElement>(".catalog-proposal")[
        focusAt
      ];
    if (next) {
      next.focus();
      setFocusAt(null);
    }
  });
  const detail = useQuery({
    queryKey: ["catalog-decision", journalKey, selected],
    queryFn: () => api<Decision>(`${base}/${selected ?? ""}`, token),
    enabled: selected !== null,
  });
  async function run(command: Command): Promise<void> {
    setSuccess("");
    // Said of the proposal as it was read before the answer.
    const said = command.path.endsWith("/alias-feedback")
      ? feedbackSaid(
          command,
          cache.getQueryData<Decision>([
            "catalog-decision",
            journalKey,
            command.decisionId,
          ]),
        )
      : "Рішення збережено.";
    // A kept operation was felt once, as it was kept: its later checks are
    // felt nothing (spec §4.4; «Усе на бірці» task list, P1-2).
    const resent = useCatalogCommand.getState().pending !== null;
    const result = await submitCatalogCommand(journalKey, token, command);
    const after = useCatalogCommand.getState();
    if (result) {
      cache.setQueryData(
        ["catalog-decision", journalKey, result.decision_id],
        result,
      );
      setSelected(result.decision_id);
      setSuccess(said);
      if (!resent) buzz("success");
      await cache.invalidateQueries({
        queryKey: ["catalog-decisions", journalKey],
      });
    } else if (!resent && after.pending === null && after.error !== null)
      buzz("error");
  }
  // A first attempt's refusal goes with this screen: back from another tab,
  // the queue opens without it.
  useEffect(
    () => () => {
      forgetCatalogRefusal();
    },
    [],
  );
  const toQueue = (): void => {
    forgetCatalogRefusal();
    setMaking(false);
    setSelected(null);
    setSuccess("");
  };
  return (
    <>
      {/* A sheet over the screen says a kept operation itself: one place
          checks it. */}
      {!creating && !making && <KeptCatalog loaded={loaded} run={run} />}
      {error !== null && !creating && !making && (
        <p role="alert">{catalogRefusal(error, kept, pending !== null)}</p>
      )}
      <ScreenHeader
        title={selected ? "Пропозиція" : "Перевірка каталогу"}
        back={
          // One way back, as every screen's (goods task list after stage
          // 2, P2-3): the arrow unheard, the queue's name said.
          selected ? (
            <Back
              go={toQueue}
              held={blocked}
              label="Назад до «Перевірка каталогу»"
            >
              <span aria-hidden="true">← </span>
              Перевірка каталогу
            </Back>
          ) : (
            back && <BackToMore back={back} />
          )
        }
        aside={
          <div className="catalog-ways">
            <button
              type="button"
              className="quiet"
              disabled={blocked}
              onClick={() => {
                setSuccess("");
                void (selected ? detail.refetch() : list.refetch());
              }}
            >
              Оновити
            </button>
            {!selected && (
              <button
                type="button"
                className="quiet"
                disabled={blocked}
                onClick={() => {
                  forgetCatalogRefusal();
                  setSuccess("");
                  setCreating(true);
                }}
              >
                Нова пропозиція
              </button>
            )}
          </div>
        }
      />
      {success && (
        <div className="notice stub-notice">
          <Stub state="recorded">
            <p role="status">{success}</p>
          </Stub>
        </div>
      )}
      {creating && (
        <NewModel
          store={store}
          token={token}
          close={(made) => {
            setCreating(false);
            // A proposal made and left: its own screen, never a page of the
            // queue to look for it on.
            if (made) setSelected(made.decision_id);
            void cache.invalidateQueries({
              queryKey: ["catalog-decisions", journalKey],
            });
          }}
          done={(_variant, _said, decision) => {
            setCreating(false);
            setSelected(decision.decision_id);
            setSuccess(addedSaid(decision));
            void cache.invalidateQueries({
              queryKey: ["catalog-decisions", journalKey],
            });
          }}
        />
      )}
      {selected ? (
        detail.isPending ? (
          <ProposalPlaceholder />
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
            store={store}
            token={token}
            canCreate={canCreate}
            blocked={blocked}
            run={run}
            making={making}
            make={setMaking}
            made={(decision) => {
              setSuccess(addedSaid(decision));
            }}
          />
        )
      ) : (
        <>
          <ModeSwitch
            label="Стан пропозицій"
            modes={queues}
            current={queue}
            choose={(mode) => {
              setQueue(mode);
              setSuccess("");
              setFocusAt(null);
            }}
            disabled={blocked}
            filters
          />
          {list.isPending ? (
            <Placeholder
              said="Завантажуємо чергу…"
              rows={3}
              day={false}
              rowShape={{
                list: "catalog-rows",
                row: "catalog-proposal",
                pill: true,
              }}
            />
          ) : neverRead ? (
            <Failure
              error={list.error}
              retry={() => {
                void list.refetch();
              }}
            />
          ) : (
            <>
              {readAgainFailed && (
                <Failure
                  error={list.error}
                  held={list.isFetching}
                  retry={() => {
                    void list.refetch();
                  }}
                />
              )}
              {rows.length === 0 ? (
                <Empty
                  title={emptyQueue[queue].title}
                  meta={emptyQueue[queue].meta}
                />
              ) : (
                <ul
                  ref={shelf}
                  className="catalog-rows"
                  aria-label="Пропозиції"
                >
                  {rows.map((d) => (
                    <li key={d.decision_id}>
                      <button
                        type="button"
                        className="catalog-proposal"
                        disabled={blocked}
                        onClick={() => {
                          forgetCatalogRefusal();
                          setSelected(d.decision_id);
                          setSuccess("");
                        }}
                      >
                        <span className="catalog-raw">
                          «{visible(d.preview.raw_text)}»
                        </span>
                        <Sticker>{statusLabels[d.status]}</Sticker>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {/* A page that failed: its retry alone, never «Показати ще»
                  beside it reading the same page (as «Накладні»'s). */}
              {nextFailed ? (
                <Failure
                  error={list.error}
                  held={list.isFetching}
                  retry={() => {
                    void list.fetchNextPage();
                  }}
                />
              ) : (
                list.hasNextPage && (
                  <button
                    type="button"
                    className="quiet"
                    disabled={blocked || list.isFetching || readAgainFailed}
                    onClick={() => {
                      // Kept until the page is read: after its retry too.
                      setFocusAt(rows.length);
                      void list.fetchNextPage();
                    }}
                  >
                    Показати ще
                  </button>
                )
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

/**
 * A proposal being read (goods task list after stage 2, P2-2): its words
 * large, its sticker and two candidates' rows in grey where they come; the
 * title «Пропозиція» and its «←» stand already. A screen reader hears that
 * it is read.
 */
function ProposalPlaceholder(): JSX.Element {
  return (
    <>
      <p role="status" className="visually-hidden">
        Завантажуємо пропозицію…
      </p>
      <section
        className="catalog-proposal-screen placeholder"
        aria-hidden="true"
      >
        <p className="catalog-raw catalog-raw-large">
          <span className="skeleton-line">
            <span>«Пальто кокон графіт»</span>
          </span>
        </p>
        <p>
          <span className="skeleton skeleton-pill" />
        </p>
        <ul className="new-model-candidates">
          {[0, 1].map((n) => (
            <li key={n}>
              <span className="new-model-name">
                <span className="skeleton skeleton-name" />
              </span>
              <span className="skeleton skeleton-choose" />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** What a proposal resolved by «Нова модель» says on this screen. */
function addedSaid(decision: Decision): string {
  const variant = decision.resolved_variant_id;
  const name =
    decision.creation?.display_name ??
    decision.preview.candidates.find((c) => c.variant_id === variant)
      ?.display_name ??
    "";
  return decision.creation
    ? `Модель додано: ${visible(name)}.`
    : `Модель обрано: ${visible(name)}.`;
}

function Failure({
  error,
  retry,
  held = false,
}: {
  error: unknown;
  retry: () => void;
  /** Its retry held while the list is read. */
  held?: boolean;
}): JSX.Element {
  return (
    <Unread error={error} said={catalogMessage} retry={retry} held={held} />
  );
}

function Detail({
  decision,
  store,
  token,
  canCreate,
  blocked,
  run,
  making,
  make,
  made,
}: {
  decision: Decision;
  store: Store;
  token: string;
  canCreate: boolean;
  blocked: boolean;
  run: (c: Command) => Promise<void>;
  making: boolean;
  make: (on: boolean) => void;
  made: (decision: Decision) => void;
}): JSX.Element {
  const busy = useCatalogCommand((state) => state.busy);
  const error = useCatalogCommand((state) => state.error);
  const keptRefusal = useCatalogCommand((state) => state.kept);
  const stillKept = useCatalogCommand((state) => state.pending !== null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [naming, setNaming] = useState(false);
  const [foot, setFoot] = useState<HTMLElement | null>(null);
  const open = ["PENDING", "NEEDS_REVIEW"].includes(decision.status);
  const candidates = decision.preview.candidates;
  const aliasTooLong =
    decision.preview.raw_text.trim().replace(/\s+/g, " ").length > 200;
  const reasons = [
    ...new Set(decision.preview.review_reasons.map(reviewText)),
  ].join(" ");
  function action(suffix: string, body: Record<string, unknown>): void {
    void run({
      path: `${base}/${decision.decision_id}/${suffix}`,
      decisionId: decision.decision_id,
      body,
    });
  }
  const chosenName = candidates.find(
    (c) => c.variant_id === chosen,
  )?.display_name;
  const confirmWords =
    chosenName === undefined
      ? "Оберіть модель"
      : `Підтвердити: ${visible(chosenName)}`;
  const confirm = (): void => {
    if (blocked || chosen === null) return;
    action("confirm", {
      variant_id: chosen,
      expected_knowledge_revision: decision.knowledge_revision,
    });
  };
  // The screen's one button, Telegram's while nothing lies over it.
  const main = useMainButton(confirmWords, confirm, {
    shown: open && chosen !== null && !making && !rejecting,
    progress: busy,
    active: !blocked && chosen !== null,
  });
  const reject = (): void => {
    if (blocked || !reason.trim()) return;
    action("reject", { reason: reason.trim() });
  };
  const rejectMain = useMainButton("Відхилити", reject, {
    shown: rejecting,
    progress: busy,
    active: !blocked && reason.trim() !== "",
  });
  return (
    <section className="catalog-proposal-screen">
      <p className="catalog-raw catalog-raw-large">
        «{visible(decision.preview.raw_text)}»
      </p>
      <p>
        <Sticker>{statusLabels[decision.status]}</Sticker>
      </p>
      {reasons && <p className="t-meta">{reasons}</p>}
      {decision.rejection && (
        <p>Причина відхилення: {visible(decision.rejection.reason)}</p>
      )}
      {decision.preview.truncated && open && (
        <p className="notice">
          Список кандидатів обмежено. Не обирайте товар лише через схожість
          назви.
        </p>
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
        <>
          {/* What the person may do, never the rule (stage 2, goods task
              list, P1-5). */}
          {candidates.length === 0 && (
            <p>
              {canCreate
                ? "Кандидатів немає. Перевірте опис і створіть нову модель або відхиліть пропозицію з поясненням."
                : "Кандидатів немає. Перевірте опис або відхиліть пропозицію з поясненням."}
            </p>
          )}
          <ul className="new-model-candidates" aria-label="Схожі моделі">
            {candidates.map((c) => (
              <li key={c.variant_id}>
                <span className="new-model-name">
                  <strong>{visible(c.display_name)}</strong>
                  {c.distinction_note && (
                    <span className="t-meta">
                      Відмінність моделі: {visible(c.distinction_note)}
                    </span>
                  )}
                  {c.conflicts.length > 0 && (
                    <span className="t-meta">
                      Не збігається:{" "}
                      {c.conflicts
                        .map(
                          (f) => fieldLabels[f] ?? "ознака потребує перевірки",
                        )
                        .join(", ")}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="quiet"
                  aria-pressed={chosen === c.variant_id}
                  aria-label={`Це вона: ${visible(c.display_name)}`}
                  disabled={blocked}
                  onClick={() => {
                    buzz("selection");
                    setChosen(c.variant_id);
                  }}
                >
                  Це вона
                </button>
              </li>
            ))}
          </ul>
          {/* Outside Telegram its own, docked over the menu: in sight
              however many models are offered (P1-1). */}
          {!main && chosen !== null && (
            <div className="result-dock">
              <button
                type="button"
                className="main-mimic"
                disabled={blocked}
                onClick={confirm}
              >
                {busy ? (
                  <>
                    <Eyelet state="spin" size={20} />
                    <span className="visually-hidden">{confirmWords}</span>
                  </>
                ) : (
                  confirmWords
                )}
              </button>
            </div>
          )}
          <div className="catalog-actions">
            {canCreate && (
              <button
                type="button"
                className="quiet"
                disabled={blocked}
                onClick={() => {
                  forgetCatalogRefusal();
                  make(true);
                }}
              >
                Створити нову
              </button>
            )}
            <button
              type="button"
              className="quiet"
              disabled={blocked}
              onClick={() => {
                forgetCatalogRefusal();
                setRejecting(true);
              }}
            >
              Відхилити
            </button>
          </div>
          {making && (
            <NewModel
              store={store}
              token={token}
              decision={decision}
              close={() => {
                make(false);
              }}
              done={(_variant, _said, result) => {
                make(false);
                made(result);
              }}
            />
          )}
          {rejecting && (
            <Sheet
              title="Відхилити пропозицію"
              held={busy}
              close={() => {
                if (!busy) setRejecting(false);
              }}
              foot={<div ref={setFoot} />}
            >
              <p className="t-meta">«{visible(decision.preview.raw_text)}»</p>
              {error !== null && (
                <p role="alert">
                  {catalogRefusal(
                    error,
                    keptRefusal,
                    stillKept,
                    "Перевірте причину відхилення.",
                  )}
                </p>
              )}
              <label>
                Причина відхилення
                <textarea
                  maxLength={1000}
                  value={reason}
                  disabled={blocked}
                  onChange={(e) => {
                    setReason(e.target.value);
                  }}
                />
              </label>
              {!rejectMain &&
                foot &&
                createPortal(
                  <button
                    type="button"
                    className="sheet-done main-mimic"
                    disabled={blocked || !reason.trim()}
                    onClick={reject}
                  >
                    Відхилити
                  </button>,
                  foot,
                )}
            </Sheet>
          )}
        </>
      ) : (
        <div className="catalog-name">
          <button
            type="button"
            className="quiet"
            aria-expanded={naming}
            onClick={() => {
              setNaming(!naming);
            }}
          >
            Цей опис — назва товару?
          </button>
          {naming && (
            <>
              {aliasTooLong && (
                <p>Опис задовгий для назви: назва — до 200 символів.</p>
              )}
              <p className="t-meta">
                Зберігайте зв’язок лише коли весь початковий опис справді є
                назвою цього товару. Це не робить назву автоматично перевіреною.
              </p>
              {decision.status === "APPLIED" &&
                decision.resolved_variant_id && (
                  <div className="catalog-name-row">
                    <span>
                      Обраний товар:{" "}
                      <strong>
                        {visible(
                          decision.creation?.display_name ??
                            candidates.find(
                              (c) =>
                                c.variant_id === decision.resolved_variant_id,
                            )?.display_name ??
                            "Підтверджений товар",
                        )}
                      </strong>
                    </span>
                    <button
                      type="button"
                      disabled={blocked || aliasTooLong}
                      onClick={() => {
                        action("alias-feedback", {
                          feedback_id: crypto.randomUUID(),
                          variant_id: decision.resolved_variant_id,
                          event: "CONFIRM",
                        });
                      }}
                    >
                      Так, це його назва
                    </button>
                  </div>
                )}
              {candidates
                .filter((c) => c.variant_id !== decision.resolved_variant_id)
                .map((c) => (
                  <div className="catalog-name-row" key={c.variant_id}>
                    <span>
                      {visible(c.display_name)}
                      {c.distinction_note
                        ? ` — ${visible(c.distinction_note)}`
                        : ""}
                    </span>
                    <button
                      type="button"
                      className="quiet"
                      aria-label={`Ні, не про нього: ${visible(c.display_name)}`}
                      disabled={blocked || aliasTooLong}
                      onClick={() => {
                        action("alias-feedback", {
                          feedback_id: crypto.randomUUID(),
                          variant_id: c.variant_id,
                          event: "REJECT",
                        });
                      }}
                    >
                      Ні, не про нього
                    </button>
                  </div>
                ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
