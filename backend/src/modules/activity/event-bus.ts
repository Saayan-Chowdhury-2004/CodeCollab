export type ActivityEventType =
  | 'snippet.created'
  | 'snippet.edited'
  | 'snippet.deleted'
  | 'comment.added'
  | 'comment.resolved'
  | 'collaborator.added';

export interface DomainActivityEvent {
  actorId: string;
  type: ActivityEventType;
  snippetId: string | null;
  visibility: 'public' | 'unlisted' | 'private';
  metadata: Record<string, unknown>;
}

type ActivityListener = (event: DomainActivityEvent) => void | Promise<void>;

class DomainEventBus {
  private listeners = new Set<ActivityListener>();
  private pendingPromises = new Set<Promise<void>>();

  public emitActivity(event: DomainActivityEvent): void {
    for (const listener of this.listeners) {
      const p = Promise.resolve()
        .then(() => listener(event))
        .catch((err) => {
          console.error('Activity event listener error:', err);
        })
        .finally(() => {
          this.pendingPromises.delete(p);
        });
      this.pendingPromises.add(p);
    }
  }

  public onActivity(listener: ActivityListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async flush(): Promise<void> {
    if (this.pendingPromises.size === 0) return;
    await Promise.allSettled(Array.from(this.pendingPromises));
  }
}

export const domainEventBus = new DomainEventBus();
