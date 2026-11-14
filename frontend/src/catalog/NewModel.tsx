import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/shared/api";
import { Eyelet } from "@/shared/Eyelet";
import { ModeSwitch } from "@/shared/ModeSwitch";
import { Sheet } from "@/shared/Sheet";
import { buzz, hideKeyboard, useMainButton } from "@/shared/telegram";
import { enterGoes } from "@/shared/enter";
import { visible } from "@/shared/visible";
import { Placeholder } from "@/shared/Placeholder";
import { Unread } from "@/shared/Unread";
import type { Store } from "@/orders/types";
import type { ReceivableVariant, SizeOption } from "@/inventory/receiptTypes";
import {
  catalogRefusal,
  forgetCatalogRefusal,
  submitCatalogCommand,
  useCatalogCommand,
  useCatalogJournal,
} from "./commands";
import type { Command } from "./commands";
import { FamilySearch, familyLabel } from "./FamilySearch";
import type { Family } from "./FamilySearch";
import { KeptCatalog } from "./KeptCatalog";
import { Similar } from "./Similar";
import { similarFrom } from "./modelTypes";
import type { Decision } from "./types";

const base = "/catalog/match-decisions";

/** «1 розмір · 3 розміри · 5 розмірів». */
export function sizesWord(count: number): string {
  const ten = count % 10;
  const hundred = count % 100;
  if (ten === 1 && hundred !== 11) return `${String(count)} розмір`;
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14))
    return `${String(count)} розміри`;
  return `${String(count)} розмірів`;
}

/** A typed size's system, the person's choice as the old form's was: none
 * is chosen for them. */
const systemLabels = [
  { system: "ALPHA", label: "Літерна" },
  { system: "NUMERIC_EU", label: "Числова EU" },
  { system: "UNSPECIFIED", label: "Інша" },
] as const;

/** The words the similar-name check reads — the model's name, its source and
 * the variant's words (`typed_words`, backend) — as one value to compare. */
function words(body: Record<string, unknown>): string {
  const variant = (body.variant ?? {}) as Record<string, unknown>;
  return JSON.stringify([
    body.concept,
    body.source,
    ...["color", "material", "texture", "fur", "collar"].map((k) => variant[k]),
  ]);
}

const extraWords = {
  material: "Матеріал",
  texture: "Фактура",
  fur: "Хутро",
  collar: "Комір",
} as const;

type Step = "raw" | "similar" | "new";

/**
 * «Нова модель» (stage 2, goods task list, P0-1): a sheet over the screen
 * where the coat is in hand, so its lines stay. The catalogue's own commands,
 * no new data: «Як записано» saves the proposal as typed; «Схожі» offers the
 * candidates, none chosen for the person; «Нова модель» creates it, a new
 * model or another colour of one, with every size at once. Recorded, the
 * model is the screen's choice. From «Перевірка каталогу» (P1-1) it opens on
 * a proposal already made, at its third step.
 */
export function NewModel({
  store,
  token,
  raw = "",
  decision: made,
  close,
  done,
}: {
  store: Store;
  token: string;
  /** What was searched for: the proposal's words as typed. */
  raw?: string;
  /** A proposal already made: straight to the new model. */
  decision?: Decision;
  /** Closed: with the proposal, if one was made — its screen may open it. */
  close: (decision?: Decision) => void;
  /** Recorded: the model the proposal resolved to, and its stub's words. */
  done: (variant: ReceivableVariant, said: string, decision: Decision) => void;
}): JSX.Element {
  const cache = useQueryClient();
  const journalKey = useCatalogJournal((state) => state.key) ?? "";
  const { pending, busy, error, kept, refused } = useCatalogCommand();
  const canCreate = store.permissions.includes("catalog:create");
  const [step, setStep] = useState<Step>(made ? "new" : "raw");
  const [decision, setDecision] = useState<Decision | null>(made ?? null);
  const [text, setText] = useState(raw);
  const [chosen, setChosen] = useState<string | null>(null);
  const [kind, setKind] = useState<"new" | "colour">("new");
  const [family, setFamily] = useState<Family | null>(null);
  const [concept, setConcept] = useState("");
  const [colour, setColour] = useState("");
  const [typedSystem, setTypedSystem] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ system: string; code: string }[]>([]);
  const [typedSize, setTypedSize] = useState("");
  const [more, setMore] = useState(false);
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [garment, setGarment] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [length, setLength] = useState("");
  const [separate, setSeparate] = useState(false);
  const [note, setNote] = useState("");
  const [foot, setFoot] = useState<HTMLElement | null>(null);
  const lengthId = useId();
  // The decisions this sheet sent: a refusal is said only where it was
  // asked (review).
  const [sentHere, setSentHere] = useState<readonly string[]>([]);
  // The step's first line takes the cursor as the step comes (review).
  const lead = useRef<HTMLParagraphElement>(null);
  const stepWas = useRef(step);
  useEffect(() => {
    if (stepWas.current === step) return;
    stepWas.current = step;
    lead.current?.focus();
  }, [step]);
  // The organisation's sizes need `inventory:receive`: without it they are
  // typed, as the old form had them (review).
  const readsSizes = store.permissions.includes("inventory:receive");
  const sizes = useQuery({
    queryKey: ["catalog-sizes", store.id],
    queryFn: () =>
      api<SizeOption[]>(`/catalog/sizes?store_id=${store.id}`, token),
    enabled: step === "new" && readsSizes,
  });
  const candidates = decision?.preview.candidates ?? [];
  const families = [
    ...new Map(candidates.map((c) => [c.family_id, c])).values(),
  ];
  const blocked = busy || pending !== null;

  const lengthValid =
    !length ||
    (/^\d{1,4}([.,]\d)?$/.test(length) && Number(length.replace(",", ".")) > 0);
  const variantWords: Record<string, string> = Object.fromEntries(
    Object.entries({ ...extra, color: colour })
      .filter(([, value]) => value.trim())
      .map(([key, value]) => [key, value.trim()]),
  );
  if (length) variantWords.length_cm = length.replace(",", ".");
  // What creating it sends as the form stands, but for `similar_confirmed`.
  const body: Record<string, unknown> = {
    store_id: store.id,
    ...(kind === "colour" && family
      ? { product_family_id: family.family_id }
      : {
          concept: concept.trim(),
          ...(source.trim() ? { source: source.trim() } : {}),
          ...(category.trim() ? { business_category: category.trim() } : {}),
          ...(garment.trim() ? { garment_type: garment.trim() } : {}),
          new_model: separate,
          ...(separate ? { distinction_note: note.trim() } : {}),
        }),
    variant: variantWords,
    sizes: picked,
  };
  const modelReady =
    kind === "colour"
      ? family !== null
      : concept.trim() !== "" && (!separate || note.trim() !== "");
  const creatable =
    !blocked &&
    decision !== null &&
    picked.length > 0 &&
    lengthValid &&
    modelReady;
  // A name like one the catalogue uses is refused once (owner decision,
  // 2026-10-03): take the spelling in use, or say this is another name —
  // only while the form holds the words refused.
  const refusedHere =
    refused !== null &&
    decision !== null &&
    refused.decisionId === decision.decision_id &&
    refused.path.endsWith("/create-product");
  const typed = words(body);
  const sent = refusedHere ? words(refused.body) : null;
  const similar = refusedHere && sent === typed ? similarFrom(error) : null;
  const refusedSimilar = refusedHere && similarFrom(error) !== null;
  const ours =
    refused !== null &&
    (sentHere.includes(refused.decisionId) ||
      refused.decisionId === decision?.decision_id);
  useEffect(() => {
    if (refusedSimilar && sent !== typed) forgetCatalogRefusal();
  }, [refusedSimilar, sent, typed]);
  // Refused as a model the catalogue has by that name: the way to say this
  // is another one, «Окрема модель зі схожою назвою», is in sight.
  const ambiguous =
    refusedHere &&
    error instanceof ApiError &&
    error.code === "CATALOG_AMBIGUOUS";
  useEffect(() => {
    if (ambiguous) setMore(true);
  }, [ambiguous]);
  // A refusal goes with the sheet: the screen under it never says it.
  useEffect(
    () => () => {
      forgetCatalogRefusal();
    },
    [],
  );

  /** What the server answered, by what was sent. */
  function answered(command: Command, result: Decision, resent: boolean): void {
    cache.setQueryData(
      ["catalog-decision", journalKey, result.decision_id],
      result,
    );
    void cache.invalidateQueries({ queryKey: ["catalog-decisions"] });
    if (command.path === base) {
      setDecision(result);
      setStep(
        result.preview.candidates.length > 0 || !canCreate ? "similar" : "new",
      );
      return;
    }
    const variant = result.resolved_variant_id;
    if (variant === null) {
      // The creation cancelled: nothing is chosen, the screen as it was.
      close(result);
      return;
    }
    // A model in the catalogue now: the screen under the sheet reads its
    // search and its sizes again — a size typed here is there to count —
    // and no search found empty before is shown from memory (review).
    void cache.resetQueries({ queryKey: ["receivable-variants"] });
    void cache.invalidateQueries({ queryKey: ["receive-sizes"] });
    void cache.invalidateQueries({ queryKey: ["catalog-sizes"] });
    // A cancellation that finds the model saved already says so, the model
    // chosen: it is in the catalogue either way (KeptCatalog).
    const creation = result.creation?.display_name;
    const candidate = result.preview.candidates.find(
      (c) => c.variant_id === variant,
    )?.display_name;
    const name = creation ?? candidate ?? "";
    if (!resent) buzz("success");
    done(
      { product_variant_id: variant, display_name: name },
      creation !== undefined
        ? `Модель додано: ${visible(name)}. Кількість впишіть тут.`
        : `Модель обрано: ${visible(name)}. Кількість впишіть тут.`,
      result,
    );
  }
  async function run(command: Command): Promise<void> {
    // A kept operation was felt once, as it was kept: its later checks,
    // answered or refused, are felt nothing (spec §4.4; «Усе на бірці» task
    // list, P1-2).
    const resent = useCatalogCommand.getState().pending !== null;
    setSentHere((ids) =>
      ids.includes(command.decisionId) ? ids : [...ids, command.decisionId],
    );
    const result = await submitCatalogCommand(journalKey, token, command);
    const after = useCatalogCommand.getState();
    if (result) answered(command, result, resent);
    else if (!resent && after.pending === null && after.error !== null)
      buzz("error");
  }
  function next(): void {
    if (blocked || !text.trim()) return;
    const id = crypto.randomUUID();
    void run({
      path: base,
      decisionId: id,
      body: { decision_id: id, store_id: store.id, raw_text: text },
    });
  }
  function confirm(): void {
    if (blocked || decision === null || chosen === null) return;
    void run({
      path: `${base}/${decision.decision_id}/confirm`,
      decisionId: decision.decision_id,
      body: {
        variant_id: chosen,
        expected_knowledge_revision: decision.knowledge_revision,
      },
    });
  }
  function create(similarConfirmed: boolean): void {
    if (!creatable || (similarConfirmed && !similar)) return;
    void run({
      path: `${base}/${decision.decision_id}/create-product`,
      decisionId: decision.decision_id,
      body: {
        ...body,
        ...(similarConfirmed ? { similar_confirmed: true } : {}),
      },
    });
  }
  function toggle(size: { system: string; code: string }): void {
    buzz("selection");
    setPicked((now) =>
      now.some((p) => p.system === size.system && p.code === size.code)
        ? now.filter((p) => !(p.system === size.system && p.code === size.code))
        : [...now, size],
    );
  }

  const chosenName = candidates.find(
    (c) => c.variant_id === chosen,
  )?.display_name;
  const words_ =
    step === "raw"
      ? "Далі"
      : step === "similar"
        ? chosenName === undefined
          ? "Оберіть модель"
          : `Підтвердити: ${visible(chosenName)}`
        : picked.length === 0
          ? "Додати модель"
          : `Додати модель · ${sizesWord(picked.length)}`;
  const ready =
    !blocked &&
    (step === "raw"
      ? text.trim() !== ""
      : step === "similar"
        ? chosen !== null
        : creatable);
  const press = (): void => {
    if (step === "raw") next();
    else if (step === "similar") confirm();
    else create(false);
  };
  // The sheet's own button while nothing is kept; «Оберіть модель», held,
  // until a model is chosen.
  const shown = pending === null;
  // Telegram's is the sheet's for as long as it is open, held while it
  // waits: never the screen's under it — «Записати прихід» pressed through
  // the sheet (review).
  const main = useMainButton(words_, press, {
    progress: busy,
    active: ready,
  });
  const own = (
    <button
      type="button"
      className="sheet-done main-mimic"
      disabled={!ready && !busy}
      aria-disabled={busy || undefined}
      onClick={press}
    >
      {busy ? (
        <>
          <Eyelet state="spin" size={20} />
          <span className="visually-hidden">{words_}</span>
        </>
      ) : (
        words_
      )}
    </button>
  );
  // A typed size the organisation has is that size, whichever system it is
  // asked under (ADR-0009 §2): it needs no system.
  // The same letters typed twice are one size too, whichever system the
  // second is typed under (review).
  const typedCode = typedSize.trim().toLowerCase();
  const typedKnown =
    (sizes.data ?? []).find((size) => size.code.toLowerCase() === typedCode) ??
    picked.find((p) => p.code.toLowerCase() === typedCode);
  const cellsOf = [
    // Every size the organisation has, in the order a seller reads them: a
    // size system does not separate sizes (ADR-0009 §2, §3).
    ...(sizes.data ?? []),
    // Typed by hand: a size the organisation does not have yet.
    ...picked
      .filter(
        (p) =>
          !(sizes.data ?? []).some(
            (size) => size.system === p.system && size.code === p.code,
          ),
      )
      .map((p) => ({
        size_id: `typed:${p.system}:${p.code}`,
        code: p.code,
        system: p.system,
      })),
  ];

  return (
    <Sheet
      title="Нова модель"
      held={blocked}
      // While a command is on its way, or kept, the sheet stands: it is that
      // operation's screen until the server answers (review).
      close={() => {
        if (!busy && useCatalogCommand.getState().pending === null)
          close(decision ?? undefined);
      }}
      foot={<div ref={setFoot} />}
    >
      <div className="new-model">
        {pending !== null && <KeptCatalog loaded={false} run={run} />}
        {/* The refusal's own words, a similar name's too: what to do with
            it (owner decision, 2026-10-03) — this sheet's only, never a kept
            operation's refused elsewhere (review). */}
        {error !== null && ours && (
          <p role="alert" className="new-model-refusal">
            {catalogRefusal(error, kept, pending !== null)}
          </p>
        )}
        {step === "raw" ? (
          <label className="new-model-raw">
            Як записано
            <textarea
              rows={2}
              maxLength={2000}
              value={text}
              disabled={blocked}
              // Several lines: Enter a new line (audit 2026-11-13, goods
              // P2-3; review).
              enterKeyHint="enter"
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          </label>
        ) : step === "similar" && decision ? (
          <>
            <p className="t-meta" ref={lead} tabIndex={-1}>
              «{visible(decision.preview.raw_text)}»
            </p>
            <p className="new-model-ask">
              {candidates.length > 0
                ? "Може, це модель, що вже є?"
                : "Схожих моделей у каталозі немає. Пропозиція чекає в «Перевірці каталогу»."}
            </p>
            {decision.preview.truncated && (
              <p className="notice">
                Список кандидатів обмежено. Не обирайте товар лише через
                схожість назви.
              </p>
            )}
            <ul className="new-model-candidates">
              {candidates.map((c) => (
                <li key={c.variant_id}>
                  <span className="new-model-name">
                    <strong>{visible(c.display_name)}</strong>
                    {c.distinction_note && (
                      <span className="t-meta">
                        {visible(c.distinction_note)}
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
            {canCreate && (
              <button
                type="button"
                className="quiet"
                disabled={blocked}
                onClick={() => {
                  setChosen(null);
                  setStep("new");
                }}
              >
                Ні, це нова модель
              </button>
            )}
          </>
        ) : decision ? (
          <>
            <p className="t-meta" ref={lead} tabIndex={-1}>
              «{visible(decision.preview.raw_text)}»
            </p>
            <ModeSwitch
              label="Яка модель"
              modes={[
                { mode: "new", label: "Нова модель" },
                { mode: "colour", label: "Інший колір нашої моделі" },
              ]}
              current={kind}
              choose={setKind}
              disabled={blocked}
              className="new-model-kind"
            />
            {kind === "new" ? (
              <label>
                Назва моделі
                <input
                  maxLength={200}
                  value={concept}
                  disabled={blocked}
                  enterKeyHint="next"
                  onKeyDown={enterGoes}
                  onChange={(event) => {
                    setConcept(event.target.value);
                  }}
                />
              </label>
            ) : family ? (
              <div className="new-model-family">
                <p>
                  Модель: <strong>{familyLabel(family)}</strong>
                </p>
                <button
                  type="button"
                  className="quiet"
                  disabled={blocked}
                  onClick={() => {
                    setFamily(null);
                  }}
                >
                  Інша модель
                </button>
              </div>
            ) : (
              <>
                {families.length > 0 && (
                  <div className="chips" role="group" aria-label="Схожі моделі">
                    {families.map((c) => (
                      <button
                        type="button"
                        className="chip"
                        key={c.family_id}
                        disabled={blocked}
                        onClick={() => {
                          setFamily({
                            family_id: c.family_id,
                            concept_name: c.display_name,
                            source_name: null,
                            business_category_name: null,
                            garment_type_name: null,
                            distinction_note: c.distinction_note,
                          });
                        }}
                      >
                        {visible(c.display_name)}
                      </button>
                    ))}
                  </div>
                )}
                <FamilySearch
                  storeId={store.id}
                  decisionId={decision.decision_id}
                  token={token}
                  scopeKey={journalKey}
                  blocked={blocked}
                  choose={setFamily}
                />
              </>
            )}
            <label>
              Колір
              <input
                maxLength={120}
                value={colour}
                disabled={blocked}
                enterKeyHint="next"
                onKeyDown={enterGoes}
                onChange={(event) => {
                  setColour(event.target.value);
                }}
              />
            </label>
            <div className="new-model-sizes">
              {readsSizes && sizes.error && (
                <Unread
                  error={sizes.error}
                  retry={() => {
                    void sizes.refetch();
                  }}
                />
              )}
              {/* A row of grey cells where the sizes come (audit after
                  stage 2, frame P1-4) — unless sizes typed by hand stand
                  there already. */}
              {readsSizes && sizes.isPending && cellsOf.length === 0 ? (
                <Placeholder said="Завантажуємо розміри…" cells={4} />
              ) : (
                <div className="cells" role="group" aria-label="Розміри">
                  {cellsOf.map((size) => {
                    const on = picked.some(
                      (p) => p.system === size.system && p.code === size.code,
                    );
                    return (
                      <button
                        type="button"
                        key={size.size_id}
                        className={on ? "size-cell chosen" : "size-cell"}
                        aria-pressed={on}
                        disabled={blocked}
                        onClick={() => {
                          // A cell is a choice, not typing: the keyboard
                          // goes away (spec §6.3; audit 2026-11-13, goods
                          // P2-3).
                          hideKeyboard();
                          toggle({ system: size.system, code: size.code });
                        }}
                      >
                        <span className="size-letter">
                          {visible(size.code)}
                        </span>
                      </button>
                    );
                  })}
                  {readsSizes && sizes.isPending && (
                    <span role="status" className="visually-hidden">
                      Завантажуємо розміри…
                    </span>
                  )}
                </div>
              )}
              <div className="new-model-typed">
                <label>
                  Іншого розміру немає — впишіть
                  <input
                    maxLength={20}
                    value={typedSize}
                    disabled={blocked}
                    enterKeyHint="done"
                    onKeyDown={enterGoes}
                    onChange={(event) => {
                      setTypedSize(event.target.value);
                      // Other letters, their system asked again.
                      setTypedSystem(null);
                    }}
                  />
                </label>
                {typedSize.trim() !== "" && !typedKnown && (
                  <div
                    className="chips"
                    role="group"
                    aria-label="Система розміру"
                  >
                    {systemLabels.map((one) => (
                      <button
                        type="button"
                        className="chip"
                        key={one.system}
                        aria-pressed={typedSystem === one.system}
                        disabled={blocked}
                        onClick={() => {
                          setTypedSystem(one.system);
                        }}
                      >
                        {one.label}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="quiet"
                  disabled={
                    blocked ||
                    !typedSize.trim() ||
                    (!typedKnown && typedSystem === null)
                  }
                  onClick={() => {
                    const size = typedKnown
                      ? { system: typedKnown.system, code: typedKnown.code }
                      : typedSystem !== null
                        ? { system: typedSystem, code: typedSize.trim() }
                        : null;
                    if (size === null) return;
                    if (
                      !picked.some(
                        (p) => p.system === size.system && p.code === size.code,
                      )
                    )
                      toggle(size);
                    setTypedSize("");
                    setTypedSystem(null);
                  }}
                >
                  Додати розмір
                </button>
              </div>
            </div>
            <button
              type="button"
              className="quiet new-model-more"
              aria-expanded={more}
              onClick={() => {
                setMore(!more);
              }}
            >
              Ще ознаки
            </button>
            {more && (
              <div className="new-model-extra">
                {kind === "new" && (
                  <>
                    <label>
                      Джерело
                      <input
                        enterKeyHint="next"
                        onKeyDown={enterGoes}
                        maxLength={200}
                        value={source}
                        disabled={blocked}
                        onChange={(event) => {
                          setSource(event.target.value);
                        }}
                      />
                    </label>
                    <label>
                      Категорія
                      <input
                        enterKeyHint="next"
                        onKeyDown={enterGoes}
                        maxLength={120}
                        value={category}
                        disabled={blocked}
                        onChange={(event) => {
                          setCategory(event.target.value);
                        }}
                      />
                    </label>
                    <label>
                      Тип виробу
                      <input
                        enterKeyHint="next"
                        onKeyDown={enterGoes}
                        maxLength={120}
                        value={garment}
                        disabled={blocked}
                        onChange={(event) => {
                          setGarment(event.target.value);
                        }}
                      />
                    </label>
                  </>
                )}
                {Object.entries(extraWords).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      enterKeyHint="next"
                      onKeyDown={enterGoes}
                      maxLength={120}
                      value={extra[key] ?? ""}
                      disabled={blocked}
                      onChange={(event) => {
                        setExtra({ ...extra, [key]: event.target.value });
                      }}
                    />
                  </label>
                ))}
                <label>
                  Довжина, см
                  <input
                    enterKeyHint="done"
                    onKeyDown={enterGoes}
                    inputMode="decimal"
                    value={length}
                    disabled={blocked}
                    aria-describedby={lengthValid ? undefined : lengthId}
                    onChange={(event) => {
                      setLength(event.target.value);
                    }}
                  />
                </label>
                {!lengthValid && (
                  <p role="alert" id={lengthId}>
                    Вкажіть додатну довжину до 9999,9 см, з одним знаком після
                    коми.
                  </p>
                )}
                {kind === "new" && (
                  <>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={separate}
                        disabled={blocked}
                        onChange={(event) => {
                          setSeparate(event.target.checked);
                        }}
                      />
                      Окрема модель зі схожою назвою
                    </label>
                    {separate && (
                      <label>
                        Чим відрізняється модель
                        <textarea
                          enterKeyHint="enter"
                          maxLength={1000}
                          value={note}
                          disabled={blocked}
                          onChange={(event) => {
                            setNote(event.target.value);
                          }}
                        />
                      </label>
                    )}
                  </>
                )}
              </div>
            )}
            {similar && (
              <>
                <Similar
                  words={similar}
                  take={(field, spelling) => {
                    if (field === "concept") setConcept(spelling);
                    else if (field === "source") setSource(spelling);
                    else if (field === "color") setColour(spelling);
                    else setExtra({ ...extra, [field]: spelling });
                  }}
                />
                <button
                  type="button"
                  className="quiet"
                  disabled={!creatable}
                  onClick={() => {
                    create(true);
                  }}
                >
                  Це інша назва — створити як є
                </button>
              </>
            )}
            <p className="t-meta">
              Залишок не додається — кількість впишете тут.
            </p>
          </>
        ) : null}
        {!main && shown && foot && createPortal(own, foot)}
      </div>
    </Sheet>
  );
}
