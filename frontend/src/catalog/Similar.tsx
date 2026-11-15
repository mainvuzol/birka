import type { JSX } from "react";
import { visible } from "@/shared/visible";
import { similarText } from "./modelTypes";
import type { SimilarWord } from "./modelTypes";

/**
 * A similar name the catalogue already uses (owner decision, 2026-10-03):
 * what was typed, the spelling in use and the models with it, and a way to
 * take that spelling. Confirming it is another name is the caller's button.
 * Said at once, a warning's plate; «Схожа назва вже є» its first line in the
 * warning's colour, no heading (audit 2026-11-13, goods P2-5).
 */
export function Similar({
  words,
  take,
}: {
  words: SimilarWord[];
  take: (field: string, spelling: string) => void;
}): JSX.Element {
  return (
    <section className="notice" role="alert">
      <p className="notice-lead">Схожа назва вже є</p>
      {words.map((word) => (
        <div key={`${word.field}:${word.typed}`}>
          <p>{similarText(word)}</p>
          {word.models.length > 0 && (
            <p>
              {word.left_by_merge ? "Тепер це модель:" : "Моделі з нею:"}{" "}
              {word.models
                .map((model) => visible(model.display_name))
                .join("; ")}
            </p>
          )}
          {word.existing.map((spelling) => (
            <button
              key={spelling}
              type="button"
              className="quiet"
              onClick={() => {
                take(word.field, spelling);
              }}
            >
              Взяти «{visible(spelling)}»
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}
