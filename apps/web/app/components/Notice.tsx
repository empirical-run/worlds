import type { ReactNode } from "react";

export function Notice({ tone, children }: { tone?: "error"; children: ReactNode }) {
  return tone === "error" ? (
    <div className="notice error" role="alert">
      {children}
    </div>
  ) : (
    <div className="notice" role="status">
      {children}
    </div>
  );
}
