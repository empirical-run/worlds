export type WorldContext = { worldId: string; origin: (host: string) => string };

export type ServiceRuntime<Spec, State> = {
  setup(spec: Spec | undefined, world: WorldContext): Promise<State>;
  state(): Promise<State | null>;
  fetch(request: Request, host: string, world: WorldContext): Promise<Response>;
  alarm(world: WorldContext | null): Promise<void>;
  nextDue(): Promise<number | null>;
};

export type Page = "members-only" | "ui" | null;

export type ServiceHosting<Spec, State> = {
  runtime(storage: DurableObjectStorage): ServiceRuntime<Spec, State>;
  page(request: Request, url: URL, host: string): Page;
};
