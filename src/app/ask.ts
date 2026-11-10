// Questions and notices in our own dialog (panels/AskDialog.tsx), in place
// of the browser's confirm() and alert(). Plain module state rather than
// React, so non-React code (file.ts) can ask too. One question shows at a
// time; later ones wait their turn.

import { useSyncExternalStore } from "react";

export interface Question {
  title: string;
  message: string;
  /** Label of the button that answers yes. Default "OK". */
  confirm?: string;
  /** Label of the button that answers no. Default "Cancel"; null for none. */
  cancel?: string | null;
  /** Yes destroys something: the confirm button is red. */
  danger?: boolean;
  /**
   * Label of a third answer, shown apart on the left in red, as a
   * destructive way out: "Discard" beside Save and Cancel. Only `choose`
   * tells it apart; to `ask` it counts as no.
   */
  alternative?: string;
}

/** Which button answered: the confirm one, cancel (or Escape), or the alternative. */
export type Choice = "confirm" | "cancel" | "alternative";

interface Pending { question: Question; resolve: (c: Choice) => void }

const queue: Pending[] = [];
const listeners = new Set<() => void>();
const notify = () => { for (const fn of listeners) fn(); };

/** Resolves with the button that answered. */
export function choose(question: Question): Promise<Choice> {
  return new Promise((resolve) => {
    queue.push({ question, resolve });
    notify();
  });
}

/** Resolves true if confirmed; false if cancelled, dismissed or the alternative. */
export function ask(question: Question): Promise<boolean> {
  return choose(question).then((c) => c === "confirm");
}

/** A notice with only an OK button; resolves once it is dismissed. */
export function tell(title: string, message: string): Promise<void> {
  return ask({ title, message, cancel: null }).then(() => undefined);
}

/** The question showing now, if any. */
export function currentQuestion(): Question | null {
  return queue[0]?.question ?? null;
}

/** Answers the question showing now (true: confirm, false: cancel) and moves on to the next. */
export function answer(a: boolean | "alternative"): void {
  const head = queue.shift();
  if (!head) return;
  notify();
  head.resolve(a === "alternative" ? "alternative" : a ? "confirm" : "cancel");
}

export function useQuestion(): Question | null {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    currentQuestion,
  );
}
