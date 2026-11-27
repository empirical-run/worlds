import type { Db, Membership, Team, User } from "@worlds/db";
import { createContext } from "react-router";

import type { Env } from "./env";

export type Account = { user: User; team: Team; role: Membership["role"] };

export type WorkerContext = { env: Env; db: Db; account: Account | null };

export const workerContext = createContext<WorkerContext>();
