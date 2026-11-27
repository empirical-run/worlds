import { createHighlighter, type RegisteredHighlighter } from "@pierre/highlights/core";
import shellscript from "@pierre/highlights/langs/shellscript";
import typescript from "@pierre/highlights/langs/typescript";
import { pierreDark, pierreLight } from "@pierre/highlights/themes";

import type { CodeLine } from "./components/CodeBlock";

export type CodeLang = "bash" | "ts";

let highlighter: Promise<RegisteredHighlighter> | undefined;

export async function highlight(code: string, lang: CodeLang): Promise<CodeLine[]> {
  highlighter ??= createHighlighter({
    langs: [shellscript, typescript],
    themes: [pierreLight, pierreDark],
  });
  const { tokens } = (await highlighter).codeToTokens(code, {
    lang,
    themes: { light: pierreLight, dark: pierreDark },
    defaultColor: "light-dark()",
  });
  return tokens.map((line) =>
    line.map(({ content, htmlStyle }) => ({ content, color: htmlStyle?.color })),
  );
}
