import { useNavigation } from "react-router";

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

export function useSubmitting(intent: string): boolean {
  const navigation = useNavigation();
  return navigation.state !== "idle" && navigation.formData?.get("intent") === intent;
}

export function ActionError({
  result,
  intent,
}: {
  result: ActionResult | undefined;
  intent: string;
}) {
  if (result?.intent !== intent || !result.error) return null;
  return (
    <p className="form-status error" role="alert">
      {result.error}
    </p>
  );
}
