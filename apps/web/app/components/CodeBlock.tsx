import { Fragment } from "react";

export type CodeLine = { content: string; color?: string }[];

export function CodeBlock({ lines }: { lines: CodeLine[] }) {
  return (
    <pre>
      <code>
        {lines.map((line, row) => (
          <Fragment key={row}>
            {row > 0 && "\n"}
            {line.map((token, col) => (
              <span key={col} style={{ color: token.color }}>
                {token.content}
              </span>
            ))}
          </Fragment>
        ))}
      </code>
    </pre>
  );
}
