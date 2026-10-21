import type { AnyFn } from "./@types";

type StringKeyOf<T> = Extract<keyof T, string>;
type CallbackType<
  T extends object,
  EventName extends StringKeyOf<T>,
> = T[EventName] extends unknown[] ? T[EventName] : [T[EventName]];
type CallbackFunction<T extends object, EventName extends StringKeyOf<T>> = (
  ...props: CallbackType<T, EventName>
) => unknown;

export class EventEmitter<T extends object> {
  private callbacks: { [key: string]: AnyFn[] } = {};

  public on<EventName extends StringKeyOf<T>>(
    event: EventName,
    fn: CallbackFunction<T, EventName>,
  ): this {
    if (!this.callbacks[event]) {
      this.callbacks[event] = [];
    }

    this.callbacks[event].push(fn);

    return this;
  }

  protected emit<EventName extends StringKeyOf<T>>(
    event: EventName,
    ...args: CallbackType<T, EventName>
  ): this {
    const callbacks = this.callbacks[event];

    if (callbacks) {
      for (const callback of callbacks) {
        // AnyFn takes `never[]` (it accepts every signature); the call
        // site knows the concrete argument list, so the cast is local.
        (callback as (...callArgs: unknown[]) => unknown).apply(this, args);
      }
    }

    return this;
  }

  public off<EventName extends StringKeyOf<T>>(
    event: EventName,
    fn?: CallbackFunction<T, EventName>,
  ): this {
    const callbacks = this.callbacks[event];

    if (callbacks) {
      if (fn) {
        this.callbacks[event] = callbacks.filter((callback) => callback !== fn);
      } else {
        delete this.callbacks[event];
      }
    }

    return this;
  }

  protected removeAllListeners(): void {
    this.callbacks = {};
  }
}
