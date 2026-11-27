import { redirect, type RouterContextProvider } from "react-router";
import { workerContext, type Account } from "../worker/context";

export function requireAccount(context: Readonly<RouterContextProvider>, request: Request): Account {
  const { account } = context.get(workerContext);
  if (account) return account;
  const { pathname, search } = new URL(request.url);
  throw redirect(`/account?next=${encodeURIComponent(`${pathname}${search}`)}`);
}
