import { useState } from "react";
import type { JSX } from "react";
import { visible } from "@/shared/visible";
import { readStockFile } from "./stockFile";
import type { StockFileRead } from "./stockFile";

const priceKinds = {
  sale: "ціни продажні",
  purchase: "ціни закупівельні",
} as const;

/**
 * Pick a parser's file and say what is in it, before anything is sent
 * (ADR-0014 §15): for a new list and for «Додати файл» alike.
 *
 * The picker has no `accept` filter: Android's pickers grey out a JSON file
 * they report as `application/octet-stream`, and the phone reads the bytes
 * itself anyway.
 */
export function FileChooser({
  read,
  onRead,
  warehouse,
  disabled,
}: {
  read: StockFileRead | null;
  onRead: (read: StockFileRead) => void;
  /** The warehouse whose list the file goes to; null while not chosen. */
  warehouse: string | null;
  disabled: boolean;
}): JSX.Element {
  const [reading, setReading] = useState(false);

  return (
    <>
      <label>
        Файл від парсера (.json)
        <input
          type="file"
          disabled={disabled || reading}
          onChange={(event) => {
            const input = event.target;
            const picked = input.files?.[0];
            if (!picked) return;
            setReading(true);
            void readStockFile(picked)
              .catch((): StockFileRead => ({
                ok: false,
                name: picked.name,
                problems: ["Файл не вдалося прочитати. Оберіть його ще раз."],
              }))
              .then(onRead)
              .finally(() => {
                setReading(false);
                // The same file picked again is read again.
                input.value = "";
              });
          }}
        />
      </label>
      {reading && <p role="status">Читаємо файл…</p>}
      {read &&
        !reading &&
        (read.ok ? (
          <p className="notice" aria-label="Що у файлі">
            {`Файл «${visible(read.name)}»: рядків ${String(read.summary.lines)}, фото ${String(read.summary.photos)}${read.summary.price_kind ? `, ${priceKinds[read.summary.price_kind]}` : ""}. `}
            {warehouse === null
              ? "Оберіть склад, до списку якого піде файл."
              : `Піде до списку складу «${visible(warehouse)}».`}
          </p>
        ) : (
          <div role="alert">
            <p>Файл «{visible(read.name)}» не прийнято:</p>
            <ul>
              {read.problems.map((problem, index) => (
                <li key={index}>{visible(problem)}</li>
              ))}
            </ul>
          </div>
        ))}
    </>
  );
}
