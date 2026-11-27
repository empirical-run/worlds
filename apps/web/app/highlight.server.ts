import { createHighlighter, type RegisteredHighlighter } from "@pierre/highlights/core";
import shellscript from "@pierre/highlights/langs/shellscript";
import typescript from "@pierre/highlights/langs/typescript";
import githubDark from "@pierre/highlights/themes/github-dark-default";
import githubLight from "@pierre/highlights/themes/github-light-default";

import type { CodeLine } from "./components/CodeBlock";

export type CodeLang = "bash" | "ts";

let highlighter: Promise<RegisteredHighlighter> | undefined;

export async function highlight(code: string, lang: CodeLang): Promise<CodeLine[]> {
  highlighter ??= createHighlighter({
    langs: [shellscript, typescript],
    themes: [githubLight, githubDark],
  });
  const { tokens } = (await highlighter).codeToTokens(code, {
    lang,
    themes: { light: githubLight, dark: githubDark },
    defaultColor: "light-dark()",
  });
  return tokens.map((line) =>
    line.map(({ content, htmlStyle }) => ({ content, color: htmlStyle?.color })),
  );
}
