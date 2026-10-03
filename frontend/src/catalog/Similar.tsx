import type { JSX } from "react";
import { similarText } from "./modelTypes";
import type { SimilarWord } from "./modelTypes";

/**
 * A similar name the catalogue already uses (owner decision, 2026-10-03):
 * what was typed, the spelling in use and the models with it, and a way to
 * take that spelling. Confirming it is another name is the caller's button.
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
      <h3>Схожа назва вже є</h3>
      {words.map((word) => (
        <div key={`${word.field}:${word.typed}`}>
          <p>{similarText(word)}</p>
          {word.models.length > 0 && (
            <p>
              Моделі з нею:{" "}
              {word.models.map((model) => model.display_name).join("; ")}
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
              Взяти «{spelling}»
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}
