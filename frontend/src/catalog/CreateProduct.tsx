import { useState } from "react";
import type { JSX } from "react";
import { FamilySearch, familyLabel } from "./FamilySearch";
import type { Family } from "./FamilySearch";
import { Similar } from "./Similar";
import { similarFrom } from "./modelTypes";
import type { Decision } from "./types";

export function CreateProduct({
  decision,
  token,
  scopeKey,
  blocked,
  submit,
  refusal,
}: {
  decision: Decision;
  token: string;
  scopeKey: string;
  blocked: boolean;
  submit: (body: Record<string, unknown>) => void;
  /** The last refusal of creating it; a similar name is answered here. */
  refusal: unknown;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [family, setFamily] = useState("");
  const [searchedFamily, setSearchedFamily] = useState<Family | null>(null);
  const [concept, setConcept] = useState("");
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [garment, setGarment] = useState("");
  const [separate, setSeparate] = useState(false);
  const [note, setNote] = useState("");
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [length, setLength] = useState("");
  const [system, setSystem] = useState("");
  const [size, setSize] = useState("");
  const families = [
    ...new Map(
      decision.preview.candidates.map((c) => [c.family_id, c]),
    ).values(),
  ];
  const lengthValid =
    !length ||
    (/^\d{1,4}([.,]\d)?$/.test(length) && Number(length.replace(",", ".")) > 0);
  // A name like one the catalogue uses is refused once (owner decision,
  // 2026-10-03): take the spelling in use, or say this is another name.
  const similar = similarFrom(refusal);
  const ready =
    !blocked &&
    Boolean(system) &&
    Boolean(size.trim()) &&
    lengthValid &&
    Boolean(family || (concept.trim() && (!separate || note.trim())));
  function send(similarConfirmed: boolean): void {
    if (!ready) return;
    const variant: Record<string, string> = Object.fromEntries(
      Object.entries(attributes)
        .filter(([, value]) => value.trim())
        .map(([key, value]) => [key, value.trim()]),
    );
    if (length) variant.length_cm = length.replace(",", ".");
    submit({
      store_id: decision.store_id,
      ...(family
        ? { product_family_id: family }
        : {
            concept: concept.trim(),
            ...(source.trim() ? { source: source.trim() } : {}),
            ...(category.trim() ? { business_category: category.trim() } : {}),
            ...(garment.trim() ? { garment_type: garment.trim() } : {}),
            new_model: separate,
            ...(separate ? { distinction_note: note.trim() } : {}),
          }),
      variant,
      sizes: [{ system, code: size.trim() }],
      ...(similarConfirmed ? { similar_confirmed: true } : {}),
    });
  }
  return (
    <section>
      <button
        className="quiet"
        disabled={blocked}
        onClick={() => {
          setExpanded(!expanded);
        }}
      >
        {expanded ? "Сховати форму товару" : "Створити товар з опису"}
      </button>
      {expanded && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(false);
          }}
        >
          <fieldset disabled={blocked}>
            <legend>Перевірені дані товару</legend>
            <p>
              Введіть дані явно. Створення товару не додає залишок на склад.
            </p>
            <label>
              Модель товару
              <select
                value={family}
                onChange={(e) => {
                  setFamily(e.target.value);
                }}
              >
                <option value="">Нова модель за назвою</option>
                {searchedFamily && (
                  <option value={searchedFamily.family_id}>
                    {familyLabel(searchedFamily)}
                  </option>
                )}
                {families
                  .filter((c) => c.family_id !== searchedFamily?.family_id)
                  .map((c) => (
                    <option key={c.family_id} value={c.family_id}>
                      {c.display_name}
                      {c.distinction_note ? ` — ${c.distinction_note}` : ""}
                    </option>
                  ))}
              </select>
            </label>
            <FamilySearch
              storeId={decision.store_id}
              decisionId={decision.decision_id}
              token={token}
              scopeKey={scopeKey}
              blocked={blocked}
              choose={(selected) => {
                setSearchedFamily(selected);
                setFamily(selected.family_id);
              }}
            />
            {family && (
              <p role="status">
                Обрано наявну модель. Вкажіть ознаки та розмір варіанта; дані
                моделі не змінюються.
              </p>
            )}
            {!family && (
              <>
                <label>
                  Назва моделі
                  <input
                    required
                    maxLength={200}
                    value={concept}
                    onChange={(e) => {
                      setConcept(e.target.value);
                    }}
                  />
                </label>
                <label>
                  Джерело / постачальник
                  <input
                    maxLength={200}
                    value={source}
                    onChange={(e) => {
                      setSource(e.target.value);
                    }}
                  />
                </label>
                <label>
                  Категорія
                  <input
                    maxLength={120}
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                    }}
                  />
                </label>
                <label>
                  Тип виробу
                  <input
                    maxLength={120}
                    value={garment}
                    onChange={(e) => {
                      setGarment(e.target.value);
                    }}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={separate}
                    onChange={(e) => {
                      setSeparate(e.target.checked);
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
              </>
            )}
            {Object.entries({
              color: "Колір",
              material: "Матеріал",
              texture: "Фактура",
              fur: "Хутро",
              collar: "Комір",
            }).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  maxLength={120}
                  value={attributes[key] ?? ""}
                  onChange={(e) => {
                    setAttributes({ ...attributes, [key]: e.target.value });
                  }}
                />
              </label>
            ))}
            <label>
              Довжина, см
              <input
                inputMode="decimal"
                value={length}
                onChange={(e) => {
                  setLength(e.target.value);
                }}
              />
            </label>
            {!lengthValid && (
              <p role="alert">
                Вкажіть додатну довжину до 9999,9 см, з одним знаком після коми.
              </p>
            )}
            <label>
              Система розмірів
              <select
                required
                value={system}
                onChange={(e) => {
                  setSystem(e.target.value);
                }}
              >
                <option value="">Оберіть систему</option>
                <option value="ALPHA">Літерна (XS, M, L)</option>
                <option value="NUMERIC_EU">Числова EU</option>
                <option value="UNSPECIFIED">Інша / не вказана система</option>
              </select>
            </label>
            <label>
              Розмір
              <input
                required
                maxLength={20}
                value={size}
                onChange={(e) => {
                  setSize(e.target.value);
                }}
              />
            </label>
            <p className="hint">
              Порожні ознаки не вгадуємо. Перевірте модель, ознаки та розмір
              перед збереженням.
            </p>
            {similar && (
              <>
                <Similar
                  words={similar}
                  take={(field, spelling) => {
                    if (field === "concept") setConcept(spelling);
                    else if (field === "source") setSource(spelling);
                    else setAttributes({ ...attributes, [field]: spelling });
                  }}
                />
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => {
                    send(true);
                  }}
                >
                  Це інша назва — створити як є
                </button>
              </>
            )}
            <button type="submit" disabled={!ready}>
              Створити та пов’язати товар
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
