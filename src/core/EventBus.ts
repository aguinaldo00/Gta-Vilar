/**
 * Typed publish/subscribe. Systems talk through events instead of holding
 * references to each other (e.g. gameplay → HUD, audio, camera shake).
 */
export class EventBus<Events extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof Events, Set<(e: never) => void>>();

  on<K extends keyof Events>(type: K, fn: (e: Events[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as (e: never) => void);
    return () => set.delete(fn as (e: never) => void);
  }

  emit<K extends keyof Events>(type: K, e: Events[K]): void {
    for (const fn of this.handlers.get(type) ?? []) (fn as (e: Events[K]) => void)(e);
  }
}
