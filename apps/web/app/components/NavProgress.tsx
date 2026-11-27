import { useEffect, useRef, useState } from "react";
import { useNavigation } from "react-router";

const SHOW_AFTER_MS = 150;
const FADE_MS = 500;

type Phase = "idle" | "loading" | "done";

export function NavProgress() {
  const busy = useNavigation().state !== "idle";
  const [phase, setPhase] = useState<Phase>("idle");
  const startedAt = useRef(0);

  useEffect(() => {
    if (busy) {
      startedAt.current = performance.now();
      setPhase("loading");
      return;
    }
    const wasVisible = performance.now() - startedAt.current >= SHOW_AFTER_MS;
    setPhase((current) => (current === "loading" && wasVisible ? "done" : "idle"));
  }, [busy]);

  useEffect(() => {
    if (phase !== "done") return;
    const timer = setTimeout(() => setPhase("idle"), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  return <div className="nav-progress" data-phase={phase} aria-hidden="true" />;
}
