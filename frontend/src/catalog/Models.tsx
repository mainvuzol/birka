import { useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorText } from "@/shared/api";
import type { Store } from "@/orders/types";
import { familyLabel } from "./FamilySearch";
import type { Family } from "./FamilySearch";
import {
  resolveCorrectionCommand,
  submitCorrectionCommand,
  useCorrectionCommand,
} from "./modelCommands";
import type { CorrectionBody } from "./modelCommands";
import { Similar } from "./Similar";
import { blockerText, similarFrom, statusText, wordLabels } from "./modelTypes";
import type {
  Correction,
  ModelCard,
  ModelItem,
  ModelPage,
  MergePreview,
  StockLine,
} from "./modelTypes";

const pageSize = 20;
type Field =
  | "concept"
  | "source"
  | "color"
  | "material"
  | "texture"
  | "fur"
  | "collar"
  | "length_cm"
  | "business_category"
  | "garment_type";
const nameWords = Object.keys(wordLabels) as Field[];
// Sent without `store_id` and `command_id`, which `send` adds once.
type Command =
  | Omit<Extract<CorrectionBody, { kind: "rename" }>, "store_id" | "command_id">
  | Omit<Extract<CorrectionBody, { kind: "merge" }>, "store_id" | "command_id">
  | Omit<
      Extract<CorrectionBody, { kind: "retire" | "restore" }>,
      "store_id" | "command_id"
    >;

function doneText(correction: Correction): string {
  switch (correction.kind) {
    case "RENAME":
      return correction.correction_id === null
        ? "Назва та сама — нічого не змінено."
        : `Назву змінено: «${correction.name_before}» → «${correction.name_after}».`;
    case "MERGE":
      return `Об’єднано: «${correction.name_before}» тепер веде до «${correction.name_after}». Залишок і ціни перенесено.`;
    case "RETIRE":
      return `«${correction.name_after}» прибрано: залишок продають, нового не приймають.`;
    case "RESTORE":
      return `«${correction.name_after}» повернуто: її знову приймають.`;
  }
}

/** A model found by its words, retired ones too (ADR-0008). */
function ModelSearch({
  store,
  token,
  label,
  except,
  choose,
}: {
  store: Store;
  token: string;
  label: string;
  except?: string;
  choose: (model: ModelItem) => void;
}): JSX.Element {
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [shown, setShown] = useState(pageSize);
  const found = useQuery({
    queryKey: ["catalog-models", store.id, asked, shown],
    queryFn: () =>
      api<ModelPage>(
        `/catalog/models?store_id=${store.id}&query=${encodeURIComponent(
          asked ?? "",
        )}&limit=${String(Math.min(shown, 50))}`,
        token,
      ),
    enabled: asked !== null,
    retry: false,
  });
  return (
    <section>
      <form
        className="fields"
        onSubmit={(e) => {
          e.preventDefault();
          setShown(pageSize);
          setAsked(text.trim());
        }}
      >
        <label>
          {label}
          <input
            maxLength={200}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
        </label>
        <button type="submit">Знайти</button>
      </form>
      {found.isError && <p role="alert">{errorText(found.error)}</p>}
      {found.data && found.data.items.length === 0 && (
        <p>Нічого не знайдено.</p>
      )}
      {found.data && found.data.items.length > 0 && (
        <ul className="list">
          {found.data.items
            .filter((item) => item.product_variant_id !== except)
            .map((item) => (
              <li key={item.product_variant_id}>
                <button
                  className="quiet"
                  onClick={() => {
                    choose(item);
                  }}
                >
                  {item.display_name}
                  {item.status !== "ACTIVE" && (
                    <small> — {statusText[item.status]}</small>
                  )}
                </button>
              </li>
            ))}
        </ul>
      )}
      {found.data?.has_more && shown < 50 && (
        <button
          className="quiet"
          onClick={() => {
            setShown(shown + pageSize);
          }}
        >
          Показати ще
        </button>
      )}
    </section>
  );
}

function RenameForm({
  store,
  token,
  card,
  blocked,
  send,
  mergeInto,
}: {
  store: Store;
  token: string;
  card: ModelCard;
  blocked: boolean;
  send: (command: Command) => Promise<ApiError | null>;
  mergeInto: (model: string) => void;
}): JSX.Element {
  const [fields, setFields] = useState<Record<Field, string>>({
    concept: card.concept,
    source: card.source ?? "",
    color: card.color ?? "",
    material: card.material ?? "",
    texture: card.texture ?? "",
    fur: card.fur ?? "",
    collar: card.collar ?? "",
    length_cm: card.length_cm === null ? "" : String(card.length_cm),
    business_category: card.business_category ?? "",
    garment_type: card.garment_type ?? "",
  });
  const [refusal, setRefusal] = useState<ApiError | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const [separate, setSeparate] = useState(false);
  const [note, setNote] = useState("");
  const similar = similarFrom(refusal);
  const candidates =
    refusal?.code === "CATALOG_AMBIGUOUS" &&
    Array.isArray(refusal.details.candidate_family_ids)
      ? (refusal.details.candidate_family_ids as unknown[]).filter(
          (id): id is string => typeof id === "string",
        )
      : [];
  const families = useQuery({
    queryKey: ["catalog-model-families", store.id, fields.concept, candidates],
    queryFn: () =>
      api<{ items: Family[] }>(
        `/catalog/families?store_id=${store.id}&query=${encodeURIComponent(
          fields.concept.trim(),
        )}&limit=50`,
        token,
      ),
    enabled: candidates.length > 0,
    retry: false,
  });
  const sameAs =
    refusal?.code === "SAME_AS" && typeof refusal.details.same_as === "string"
      ? refusal.details.same_as
      : null;
  const length = fields.length_cm.trim().replace(",", ".");
  const lengthValid =
    !length || (/^\d{1,4}(\.\d)?$/.test(length) && Number(length) > 0);

  function value(name: Field): string | null {
    const trimmed = fields[name].trim();
    return trimmed ? trimmed : null;
  }

  async function submit(similarConfirmed: boolean): Promise<void> {
    if (blocked || !fields.concept.trim() || !lengthValid) return;
    const variant: Record<string, string> = {};
    for (const name of [
      "color",
      "material",
      "texture",
      "fur",
      "collar",
    ] as const) {
      const given = value(name);
      if (given) variant[name] = given;
    }
    if (length) variant.length_cm = length;
    const refused = await send({
      kind: "rename",
      product_variant_id: card.product_variant_id,
      concept: fields.concept.trim(),
      source: value("source"),
      variant,
      business_category: value("business_category"),
      garment_type: value("garment_type"),
      product_family_id: separate ? null : family,
      new_model: separate,
      distinction_note: separate ? note.trim() : null,
      similar_confirmed: similarConfirmed,
    });
    setRefusal(refused);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      <fieldset disabled={blocked}>
        <legend>Нова назва цієї моделі</legend>
        <p className="hint">
          Змінюється лише ця модель. Старі чеки зберігають назву, під якою
          продали.
        </p>
        {nameWords.map((name) => (
          <label key={name}>
            {wordLabels[name]}
            <input
              required={name === "concept"}
              maxLength={name === "concept" || name === "source" ? 200 : 120}
              value={fields[name]}
              onChange={(e) => {
                setFields({ ...fields, [name]: e.target.value });
                setRefusal(null);
              }}
            />
          </label>
        ))}
        <label>
          Довжина, см
          <input
            inputMode="decimal"
            value={fields.length_cm}
            onChange={(e) => {
              setFields({ ...fields, length_cm: e.target.value });
            }}
          />
        </label>
        {!lengthValid && (
          <p role="alert">
            Вкажіть додатну довжину до 9999,9 см, з одним знаком після коми.
          </p>
        )}
        <details>
          <summary>Категорія й тип виробу для нової назви моделі</summary>
          <p className="hint">
            Потрібні, лише якщо такої назви моделі ще немає в каталозі.
          </p>
          <label>
            Категорія
            <input
              maxLength={120}
              value={fields.business_category}
              onChange={(e) => {
                setFields({ ...fields, business_category: e.target.value });
              }}
            />
          </label>
          <label>
            Тип виробу
            <input
              maxLength={120}
              value={fields.garment_type}
              onChange={(e) => {
                setFields({ ...fields, garment_type: e.target.value });
              }}
            />
          </label>
        </details>
        {similar && (
          <>
            <Similar
              words={similar}
              take={(field, spelling) => {
                if ((nameWords as string[]).includes(field))
                  setFields({ ...fields, [field as Field]: spelling });
                setRefusal(null);
              }}
            />
            <button
              type="button"
              onClick={() => {
                void submit(true);
              }}
            >
              Це інша назва — зберегти як є
            </button>
          </>
        )}
        {sameAs && (
          <section className="notice" role="alert">
            {card.may_merge ? (
              <>
                <p>Така назва вже є в іншої моделі. Об’єднати їх?</p>
                <button
                  type="button"
                  onClick={() => {
                    mergeInto(sameAs);
                  }}
                >
                  Об’єднати з тією моделлю
                </button>
              </>
            ) : (
              <p>
                Така назва вже є в іншої моделі. Об’єднати їх може той, хто має
                це право в усіх магазинах мережі.
              </p>
            )}
          </section>
        )}
        {candidates.length > 0 && (
          <section className="notice" role="alert">
            <p>
              З такою назвою вже є модель. Це вона — чи окрема модель зі схожою
              назвою?
            </p>
            {families.isError && (
              <p role="alert">{errorText(families.error)}</p>
            )}
            {(families.data?.items ?? [])
              .filter((item) => candidates.includes(item.family_id))
              .map((item) => (
                <label key={item.family_id} className="check">
                  <input
                    type="radio"
                    name="family"
                    checked={!separate && family === item.family_id}
                    onChange={() => {
                      setFamily(item.family_id);
                      setSeparate(false);
                    }}
                  />
                  {familyLabel(item)}
                </label>
              ))}
            <label className="check">
              <input
                type="radio"
                name="family"
                checked={separate}
                onChange={() => {
                  setSeparate(true);
                  setFamily(null);
                }}
              />
              Окрема модель зі схожою назвою
            </label>
            {separate && (
              <label>
                Чим відрізняється модель
                <textarea
                  required
                  maxLength={1000}
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                  }}
                />
              </label>
            )}
          </section>
        )}
        {refusal && !similar && !sameAs && candidates.length === 0 && (
          <p role="alert">{errorText(refusal)}</p>
        )}
        <button
          type="submit"
          disabled={
            !fields.concept.trim() ||
            !lengthValid ||
            (candidates.length > 0 && !family && !(separate && note.trim()))
          }
        >
          Зберегти назву
        </button>
      </fieldset>
    </form>
  );
}

/** Stock by warehouse and size, as the preview shows it. */
function Stock({ lines }: { lines: StockLine[] }): JSX.Element {
  if (lines.length === 0) return <p>Залишку немає.</p>;
  return (
    <ul>
      {lines.map((line) => (
        <li key={`${line.location_id}:${line.size_id}`}>
          {line.location_name} · {line.size_label ?? "розмір"} ·{" "}
          {line.quantity === null
            ? "є залишок (кількість не видно)"
            : `${String(line.quantity)} шт.`}
        </li>
      ))}
    </ul>
  );
}

function Merge({
  store,
  token,
  duplicate,
  into: initial,
  blocked,
  send,
}: {
  store: Store;
  token: string;
  duplicate: ModelCard;
  into: string | null;
  blocked: boolean;
  send: (command: Command) => Promise<ApiError | null>;
}): JSX.Element {
  const [into, setInto] = useState<string | null>(initial);
  const [swapped, setSwapped] = useState(false);
  const [sure, setSure] = useState(false);
  const [refusal, setRefusal] = useState<ApiError | null>(null);
  const from = swapped && into ? into : duplicate.product_variant_id;
  const to = swapped ? duplicate.product_variant_id : into;
  const preview = useQuery({
    queryKey: ["catalog-merge-preview", store.id, from, to],
    queryFn: () =>
      api<MergePreview>(
        `/catalog/models/${from}/merge/${to ?? ""}?store_id=${store.id}`,
        token,
      ),
    enabled: to !== null,
    retry: false,
  });
  const blockers = preview.data?.blockers ?? [];
  return (
    <section>
      <h3>Об’єднати дублікат з моделлю, що лишиться</h3>
      {!into && (
        <ModelSearch
          store={store}
          token={token}
          label="Модель, що лишиться"
          except={duplicate.product_variant_id}
          choose={(model) => {
            setInto(model.product_variant_id);
            setSure(false);
          }}
        />
      )}
      {preview.isError && <p role="alert">{errorText(preview.error)}</p>}
      {preview.data && (
        <>
          <dl>
            <dt>Дублікат — зникне</dt>
            <dd>
              {preview.data.duplicate.display_name}
              {preview.data.duplicate.shared_price &&
                ` · ціна ${preview.data.duplicate.shared_price}`}
            </dd>
            <dt>Лишається</dt>
            <dd>
              {preview.data.into.display_name}
              {preview.data.into.shared_price &&
                ` · ціна ${preview.data.into.shared_price}`}
              {preview.data.into.status === "RETIRED" && " · прибрана"}
            </dd>
          </dl>
          <h4>Залишок, що перейде</h4>
          <Stock lines={preview.data.stock} />
          <h4>Залишок моделі, що лишається</h4>
          <Stock lines={preview.data.stock_into} />
          <p className="hint">
            Ціна моделі, що лишається, зберігається; якщо її немає — береться
            ціна дубліката. Так само з ціною кожного магазину.
          </p>
          {blockers.length > 0 && (
            <section className="notice" role="alert">
              <h4>Поки що не можна об’єднати</h4>
              <ul>
                {blockers.map((blocker) => (
                  <li key={blocker.reason}>{blockerText(blocker)}</li>
                ))}
              </ul>
            </section>
          )}
          <button
            className="quiet"
            disabled={blocked}
            onClick={() => {
              setSwapped(!swapped);
              setSure(false);
            }}
          >
            Поміняти місцями
          </button>
          <button
            className="quiet"
            disabled={blocked}
            onClick={() => {
              setInto(null);
              setSwapped(false);
              setSure(false);
            }}
          >
            Обрати іншу модель
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={sure}
              disabled={blocked || blockers.length > 0}
              onChange={(e) => {
                setSure(e.target.checked);
              }}
            />
            Розумію: об’єднання не можна скасувати.
          </label>
          {refusal && <p role="alert">{errorText(refusal)}</p>}
          <button
            disabled={blocked || !sure || blockers.length > 0 || !to}
            onClick={() => {
              if (!to) return;
              void send({
                kind: "merge",
                product_variant_id: from,
                into: to,
              }).then((error) => {
                setRefusal(error);
                if (error?.code === "MERGE_BLOCKED") {
                  // Something opened since the preview: show it afresh, and
                  // ask again once it is finished.
                  setSure(false);
                  void preview.refetch();
                }
              });
            }}
          >
            Об’єднати
          </button>
        </>
      )}
    </section>
  );
}

export function Models({
  store,
  token,
  journalKey,
  blocked,
}: {
  store: Store;
  token: string;
  journalKey: string;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  blocked: boolean;
}): JSX.Element {
  const cache = useQueryClient();
  const { busy, pending } = useCorrectionCommand();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"rename" | "merge" | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const working = blocked || busy || pending !== null;
  const card = useQuery({
    queryKey: ["catalog-model", store.id, selected],
    queryFn: () =>
      api<ModelCard>(
        `/catalog/models/${selected ?? ""}?store_id=${store.id}`,
        token,
      ),
    enabled: selected !== null,
    retry: false,
  });

  async function settled(correction: Correction): Promise<void> {
    setDone(doneText(correction));
    setMode(null);
    setMergeTarget(null);
    setSelected(correction.into_variant_id ?? correction.product_variant_id);
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["catalog-models", store.id] }),
      cache.invalidateQueries({ queryKey: ["catalog-model", store.id] }),
      cache.invalidateQueries({ queryKey: ["catalog-merge-preview"] }),
    ]);
  }

  /** Send one correction through the journal; a refusal comes back. */
  async function send(command: Command): Promise<ApiError | null> {
    setDone(null);
    setFailure(null);
    const outcome = await submitCorrectionCommand(journalKey, token, {
      // A new transport key per attempt; `command_id` is the correction's
      // identity, made once here: a resend after a lost answer comes from
      // the journal, which keeps it.
      key: crypto.randomUUID(),
      body: {
        ...command,
        store_id: store.id,
        command_id: crypto.randomUUID(),
      },
    });
    if (outcome.kind === "done") {
      await settled(outcome.result);
      return null;
    }
    if (outcome.kind === "refused") return outcome.error;
    return null;
  }

  const notice = pending && (
    <section className="notice">
      <h3>{busy ? "Перевіряємо зміну…" : "Незавершена зміна каталогу"}</h3>
      <p>
        Невідомо, чи записано зміну. Перевірте результат — та сама зміна не
        запишеться двічі.
      </p>
      <button
        disabled={busy}
        onClick={() => {
          void resolveCorrectionCommand(journalKey, token, pending).then(
            (outcome) => {
              if (outcome.kind === "done") void settled(outcome.result);
              // Proven to have recorded nothing: it says so before why
              // (ADR-0008 §9; ADR-0013 §1).
              else if (outcome.kind === "refused")
                setFailure(
                  `Зміну каталогу не записано. ${errorText(outcome.error)}`,
                );
            },
          );
        }}
      >
        Перевірити результат зміни
      </button>
    </section>
  );

  return (
    <>
      {notice}
      <div className="toolbar">
        <h2>Моделі</h2>
        {selected && (
          <button
            className="quiet"
            disabled={working}
            onClick={() => {
              setSelected(null);
              setMode(null);
              setDone(null);
            }}
          >
            До пошуку
          </button>
        )}
      </div>
      <p className="hint">
        Виправлення каталогу: перейменувати модель, об’єднати дублікат, прибрати
        модель чи повернути її.
      </p>
      {done && <p role="status">{done}</p>}
      {failure && <p role="alert">{failure}</p>}
      {!selected && (
        <ModelSearch
          store={store}
          token={token}
          label="Знайти модель"
          choose={(model) => {
            setSelected(model.product_variant_id);
            setMode(null);
            setDone(null);
          }}
        />
      )}
      {selected && card.isError && <p role="alert">{errorText(card.error)}</p>}
      {selected && card.data && (
        <section>
          <h3>{card.data.display_name}</h3>
          <p>
            <span className="badge">{statusText[card.data.status]}</span>
          </p>
          {card.data.merged_into && (
            <p>Веде до моделі «{card.data.merged_into.display_name}».</p>
          )}
          {card.data.status !== "MERGED" && (
            <div className="toolbar">
              <button
                className={mode === "rename" ? "active" : "quiet"}
                disabled={working}
                onClick={() => {
                  setMode(mode === "rename" ? null : "rename");
                  setDone(null);
                }}
              >
                Перейменувати
              </button>
              {card.data.may_merge && (
                <button
                  className={mode === "merge" ? "active" : "quiet"}
                  disabled={working}
                  onClick={() => {
                    setMode(mode === "merge" ? null : "merge");
                    setMergeTarget(null);
                    setDone(null);
                  }}
                >
                  Об’єднати з іншою
                </button>
              )}
              {card.data.status === "RETIRED" ? (
                <button
                  className="quiet"
                  disabled={working}
                  onClick={() => {
                    void send({
                      kind: "restore",
                      product_variant_id: card.data.product_variant_id,
                    }).then((error) => {
                      if (error) setFailure(errorText(error));
                    });
                  }}
                >
                  Повернути модель
                </button>
              ) : (
                <button
                  className="quiet"
                  disabled={working}
                  onClick={() => {
                    void send({
                      kind: "retire",
                      product_variant_id: card.data.product_variant_id,
                    }).then((error) => {
                      if (error) setFailure(errorText(error));
                    });
                  }}
                >
                  Прибрати модель
                </button>
              )}
            </div>
          )}
          {card.data.status === "RETIRED" && (
            <p className="hint">
              Прибрану модель не пропонують у «Прийманні» й пошуку; її залишок
              продають, повертають і списують.
            </p>
          )}
          {mode === "rename" && (
            <RenameForm
              key={card.data.product_variant_id}
              store={store}
              token={token}
              card={card.data}
              blocked={working}
              send={send}
              mergeInto={(model) => {
                setMergeTarget(model);
                setMode("merge");
              }}
            />
          )}
          {mode === "merge" &&
            (card.data.may_merge ? (
              <Merge
                key={`${card.data.product_variant_id}:${mergeTarget ?? ""}`}
                store={store}
                token={token}
                duplicate={card.data}
                into={mergeTarget}
                blocked={working}
                send={send}
              />
            ) : (
              <p role="alert">
                Об’єднує лише той, хто має це право в усіх магазинах мережі.
              </p>
            ))}
        </section>
      )}
    </>
  );
}
