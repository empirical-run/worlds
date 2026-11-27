import emojiByName from "virtual:slack-emoji";

export function emojiFor(name: string): string | undefined {
  return emojiByName[name] ?? emojiByName[name.split("::")[0] ?? ""];
}

export function Emoji({ name }: { name: string }) {
  const emoji = emojiFor(name);
  if (!emoji) {
    return <>:{name}:</>;
  }
  return (
    <span className="emoji" role="img" aria-label={name.replaceAll("_", " ")} title={`:${name}:`}>
      {emoji}
    </span>
  );
}
