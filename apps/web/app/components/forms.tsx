import type { ComponentProps, ReactNode } from "react";
import { Form, useNavigation } from "react-router";

import { Button, type ButtonVariant, TextButton } from "./Button";

export type ActionResult = {
  intent: string;
  error?: string;
  secret?: string;
  saved?: boolean;
  createdWorld?: string;
};

export const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function useSubmitting(intent: string, field?: { name: string; value: string }): boolean {
  const navigation = useNavigation();
  return (
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === intent &&
    (!field || navigation.formData.get(field.name) === field.value)
  );
}

export function FormStatus({ error, message }: { error?: string; message?: string }) {
  if (error)
    return (
      <p className="form-status error" role="alert">
        {error}
      </p>
    );
  if (message)
    return (
      <p className="form-status" role="status">
        {message}
      </p>
    );
  return null;
}

export function ActionError({
  result,
  intent,
}: {
  result: ActionResult | undefined;
  intent: string;
}) {
  if (result?.intent !== intent) return null;
  return <FormStatus error={result.error} />;
}

export function InlineTextForm({
  intent,
  label,
  input,
  submitLabel,
  variant,
  result,
  successMessage,
  children,
}: {
  intent: string;
  label: string;
  input: Omit<ComponentProps<"input">, "className" | "id" | "name"> & { id: string; name: string };
  submitLabel: string;
  variant?: ButtonVariant;
  result?: ActionResult;
  successMessage?: string;
  children?: ReactNode;
}) {
  const submitting = useSubmitting(intent);
  const status = !submitting && result?.intent === intent ? result : undefined;
  return (
    <Form className="inline-form" method="post">
      <input type="hidden" name="intent" value={intent} />
      <label htmlFor={input.id}>{label}</label>
      <input className="input" autoComplete="off" {...input} />
      {children}
      <Button variant={variant} type="submit" disabled={submitting}>
        {submitLabel}
      </Button>
      {status && (
        <FormStatus error={status.error} message={status.error ? undefined : successMessage} />
      )}
    </Form>
  );
}

export function RowAction({
  intent,
  name,
  value,
  children,
}: {
  intent: string;
  name: string;
  value: string;
  children: string;
}) {
  const submitting = useSubmitting(intent, { name, value });
  return (
    <Form method="post">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name={name} value={value} />
      <TextButton type="submit" disabled={submitting}>
        {children}
      </TextButton>
    </Form>
  );
}
