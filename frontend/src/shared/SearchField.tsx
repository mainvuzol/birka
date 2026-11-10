import type { JSX, RefObject } from "react";
import { Icon } from "./Icon";

/**
 * The search field (spec §6.6; «Усе на бірці» task list, P0-5): 52 high,
 * the magnifier on its left, what to type as its placeholder, and «×» on
 * its right once something is typed, which empties it and keeps the cursor
 * in it. Its name is read aloud and never seen: the placeholder says it.
 * Built for the till, taken by «Повернути» (P1-3), «Внесок» and «Покупці»
 * (audit after stage 2, sale P1-1).
 */
export function SearchField({
  label,
  placeholder,
  value,
  change,
  inputRef,
  maxLength = 200,
  autoFocus = false,
  inputMode,
}: {
  label: string;
  placeholder: string;
  value: string;
  change: (text: string) => void;
  inputRef: RefObject<HTMLInputElement>;
  /** What the server takes for this search. */
  maxLength?: number;
  /** Mounted by a tap: the cursor in it at once, the keyboard with it
   * (iOS opens it only inside the tap). */
  autoFocus?: boolean;
  /** The keyboard it asks for: digits where only a number is searched. */
  inputMode?: "tel" | undefined;
}): JSX.Element {
  return (
    <div className="search-field">
      <label>
        <span className="visually-hidden">{label}</span>
        <Icon name="search" size={20} />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          type="search"
          maxLength={maxLength}
          enterKeyHint="search"
          autoComplete="off"
          inputMode={inputMode}
          placeholder={placeholder}
          value={value}
          onChange={(event) => {
            change(event.target.value);
          }}
        />
      </label>
      {value !== "" && (
        <button
          type="button"
          className="search-clear"
          aria-label="Очистити пошук"
          onClick={() => {
            change("");
            inputRef.current?.focus();
          }}
        >
          <Icon name="close" size={20} />
        </button>
      )}
    </div>
  );
}
