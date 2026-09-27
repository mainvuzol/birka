import { useState } from "react";
import type { JSX } from "react";
import type { Decision } from "./types";

export function CreateProduct({
  decision,
  blocked,
  submit,
}: {
  decision: Decision;
  blocked: boolean;
  submit: (body: Record<string, unknown>) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [family, setFamily] = useState("");
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
            if (
              blocked ||
              !system ||
              !size.trim() ||
              !lengthValid ||
              (!family && (!concept.trim() || (separate && !note.trim())))
            )
              return;
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
                    ...(category.trim()
                      ? { business_category: category.trim() }
                      : {}),
                    ...(garment.trim() ? { garment_type: garment.trim() } : {}),
                    new_model: separate,
                    ...(separate ? { distinction_note: note.trim() } : {}),
                  }),
              variant,
              sizes: [{ system, code: size.trim() }],
            });
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
                {families.map((c) => (
                  <option key={c.family_id} value={c.family_id}>
                    {c.display_name}
                    {c.distinction_note ? ` — ${c.distinction_note}` : ""}
                  </option>
                ))}
              </select>
            </label>
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
            <button
              type="submit"
              disabled={
                !system ||
                !size.trim() ||
                !lengthValid ||
                (!family && (!concept.trim() || (separate && !note.trim())))
              }
            >
              Створити та пов’язати товар
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
