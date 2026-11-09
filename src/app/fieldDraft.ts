// One form field's edit in progress: the stored value and the text being
// typed. Mutable so key and blur handlers see the current state, not the
// render they were created in (Escape then blur must not commit the edit).

export class FieldDraft {
  value: string;
  text: string;

  constructor(value: string) {
    this.value = value;
    this.text = value;
  }

  /** The user typed. */
  edit(text: string): void {
    this.text = text;
  }

  /** A new stored value arrived from outside; it replaces any draft. */
  reset(value: string): void {
    this.value = value;
    this.text = value;
  }

  /** Drop the edit; true if there was one to drop. */
  cancel(): boolean {
    const had = this.text !== this.value;
    this.text = this.value;
    return had;
  }

  /** The text to commit, once, or undefined if nothing changed. */
  take(): string | undefined {
    if (this.text === this.value) return undefined;
    this.value = this.text;
    return this.text;
  }
}
