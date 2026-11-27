import { useEffect, useState } from "react";

import { Button } from "./Button";

const COPIED_LABEL_MS = 2000;

export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), COPIED_LABEL_MS);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  return (
    <Button onClick={copy} aria-live="polite">
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
    </Button>
  );
}
