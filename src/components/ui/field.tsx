import { cn } from "@/lib/utils";
import { useId } from "react";

/**
 * Labelled text input with a hint and an inline error.
 *
 * Used by the checkout form. Errors are wired up with `aria-invalid` and
 * `aria-describedby`, so a screen reader announces the message together with the
 * field instead of leaving the visitor to hunt for it.
 */
type TextFieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  /** Shown under the field, replaced by `error` when there is one. */
  hint?: string;
  error?: string;
  type?: "text" | "email" | "tel" | "number" | "password";
  inputMode?: "text" | "email" | "tel" | "numeric";
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
};

export function TextField({
  label,
  name,
  value,
  onChange,
  hint,
  error,
  type = "text",
  inputMode,
  autoComplete,
  placeholder,
  required,
  min,
  max,
  disabled,
  className,
}: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold tracking-tight">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-marigold ml-1">
            *
          </span>
        ) : null}
      </label>

      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "border-border bg-background/60 h-11 w-full rounded-xl border px-3.5 text-sm transition-colors",
          "placeholder:text-muted/50 focus:border-marigold/60 focus:ring-marigold/20 focus:ring-2 focus:outline-none",
          error ? "border-rani/60" : null,
          disabled ? "opacity-60" : null,
        )}
      />

      {error ? (
        <p id={errorId} className="text-rani-soft text-xs font-medium">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-muted/80 text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type SelectFieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  hint?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
};

/** Labelled select, with the same error wiring as `TextField`. */
export function SelectField({
  label,
  name,
  value,
  onChange,
  options,
  hint,
  error,
  disabled,
  className,
}: SelectFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold tracking-tight">
        {label}
      </label>

      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "border-border bg-background/60 h-11 w-full rounded-xl border px-3 text-sm transition-colors",
          "focus:border-marigold/60 focus:ring-marigold/20 focus:ring-2 focus:outline-none",
          error ? "border-rani/60" : null,
          disabled ? "opacity-60" : null,
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {error ? (
        <p id={errorId} className="text-rani-soft text-xs font-medium">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-muted/80 text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type TextAreaFieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  hint?: string;
  error?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  className?: string;
};

/** Labelled textarea for the short notes these screens carry. */
export function TextAreaField({
  label,
  name,
  value,
  onChange,
  rows = 2,
  hint,
  error,
  placeholder,
  maxLength,
  disabled,
  className,
}: TextAreaFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold tracking-tight">
        {label}
      </label>

      <textarea
        id={id}
        name={name}
        value={value}
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "border-border bg-background/60 w-full rounded-xl border px-3.5 py-2.5 text-sm transition-colors",
          "placeholder:text-muted/50 focus:border-marigold/60 focus:ring-marigold/20 focus:ring-2 focus:outline-none",
          error ? "border-rani/60" : null,
          disabled ? "opacity-60" : null,
        )}
      />

      {error ? (
        <p id={errorId} className="text-rani-soft text-xs font-medium">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-muted/80 text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
