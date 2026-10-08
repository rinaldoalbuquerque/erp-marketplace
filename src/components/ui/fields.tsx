// Select and textarea fields matching <Field> (src/components/ui/form.tsx).

const controlClass = (error?: string) =>
  `rounded-lg border bg-surface px-3 text-ink transition-colors outline-none focus:border-brand focus:ring-3 focus:ring-brand/20 ${
    error ? "border-danger" : "border-border hover:border-muted/60"
  }`;

function FieldShell({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <div id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

type SelectFieldProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  name: string;
  error?: string;
  hint?: React.ReactNode;
  options: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
};

export function SelectField({
  label,
  name,
  error,
  hint,
  options,
  placeholder,
  id,
  ...props
}: SelectFieldProps) {
  const inputId = id ?? name;
  return (
    <FieldShell id={inputId} label={label} error={error} hint={hint}>
      <select
        id={inputId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        className={`h-10 ${controlClass(error)}`}
        {...props}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

type TextareaFieldProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  name: string;
  error?: string;
  hint?: React.ReactNode;
};

export function TextareaField({ label, name, error, hint, id, ...props }: TextareaFieldProps) {
  const inputId = id ?? name;
  return (
    <FieldShell id={inputId} label={label} error={error} hint={hint}>
      <textarea
        id={inputId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        className={`min-h-24 py-2 ${controlClass(error)}`}
        {...props}
      />
    </FieldShell>
  );
}

/** Titled group of fields inside a form. */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="rounded-xl border border-border bg-surface p-5">
      <legend className="px-1 font-display text-base font-semibold text-ink">{title}</legend>
      {description ? <p className="-mt-1 mb-4 text-sm text-muted">{description}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
