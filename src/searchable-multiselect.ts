import { AutocompletePrompt, getRows, isCancel } from "@clack/core";
import {
  S_BAR,
  S_CHECKBOX_ACTIVE,
  S_CHECKBOX_INACTIVE,
  S_CHECKBOX_SELECTED,
  symbol,
} from "@clack/prompts";
import pc from "picocolors";

interface Option {
  value: string;
  label: string;
}

class TagPrompt extends AutocompletePrompt<Option> {
  ownCursor = -1;

  protected _isActionKey(
    char: string | undefined,
    key: { name?: string; ctrl?: boolean }
  ): boolean {
    const len = this.filteredOptions.length;

    if (key.name === "down") {
      if (len === 0) this.ownCursor = -1;
      else this.ownCursor = this.ownCursor >= len - 1 ? 0 : this.ownCursor + 1;
      this.focusedValue = this.filteredOptions[this.ownCursor]?.value;
      return super._isActionKey(char, key as never);
    }

    if (key.name === "up") {
      if (len === 0) this.ownCursor = -1;
      else this.ownCursor = this.ownCursor <= 0 ? len - 1 : this.ownCursor - 1;
      this.focusedValue = this.filteredOptions[this.ownCursor]?.value;
      return super._isActionKey(char, key as never);
    }

    if (key.name === "space") {
      if (this.ownCursor >= 0 && this.ownCursor < len) {
        this.focusedValue = this.filteredOptions[this.ownCursor].value;
      }
      return true;
    }

    // Any other key (typing, backspace) resets cursor
    this.ownCursor = -1;
    return super._isActionKey(char, key as never);
  }
}

interface SearchableMultiselectOptions {
  message: string;
  options: Option[];
}

export async function searchableMultiselect(
  opts: SearchableMultiselectOptions
): Promise<string[] | symbol> {
  const overhead = 4;
  const termRows = getRows(process.stdout);
  const maxVisible = Math.max(
    3,
    Math.min(opts.options.length, termRows - overhead)
  );

  const prompt = new TagPrompt({
    options: opts.options,
    multiple: true,
    render() {
      const tp = this as TagPrompt;
      const title = `${pc.gray(S_BAR)}\n${symbol(this.state)}  ${opts.message}`;

      if (this.state === "submit") {
        const selected = this.selectedValues as string[];
        return `${title}\n${pc.gray(S_BAR)}  ${pc.dim(selected.join(", ") || "none")}`;
      }
      if (this.state === "cancel") {
        return `${title}\n${pc.gray(S_BAR)}  ${pc.strikethrough(pc.dim("cancelled"))}`;
      }

      const searchInput = this.userInputWithCursor;
      const searchLine = `${pc.cyan(S_BAR)}  ${pc.cyan("/")} ${searchInput || pc.dim("Type to filter, Space to toggle, Enter to confirm")}`;

      const filtered = this.filteredOptions;
      const focusIdx = tp.ownCursor;

      let start = 0;
      if (focusIdx >= 0 && filtered.length > maxVisible) {
        const ideal = focusIdx - Math.floor(maxVisible / 2);
        start = Math.max(0, Math.min(ideal, filtered.length - maxVisible));
      }
      const end = Math.min(start + maxVisible, filtered.length);

      const lines: string[] = [];

      if (start > 0) {
        lines.push(`${pc.cyan(S_BAR)}  ${pc.dim(`↑ ${start} more`)}`);
      }

      for (let i = start; i < end; i++) {
        const opt = filtered[i];
        const isSelected = (this.selectedValues as string[]).includes(
          opt.value
        );
        const isFocused = i === focusIdx;

        const checkbox = isSelected
          ? pc.green(S_CHECKBOX_SELECTED)
          : isFocused
            ? pc.cyan(S_CHECKBOX_ACTIVE)
            : pc.dim(S_CHECKBOX_INACTIVE);

        const label = isFocused
          ? opt.label
          : isSelected
            ? pc.green(opt.label)
            : pc.dim(opt.label);

        lines.push(`${pc.cyan(S_BAR)}  ${checkbox} ${label}`);
      }

      const remaining = filtered.length - end;
      if (remaining > 0) {
        lines.push(`${pc.cyan(S_BAR)}  ${pc.dim(`↓ ${remaining} more`)}`);
      }

      const contentLines =
        (start > 0 ? 1 : 0) + (end - start) + (remaining > 0 ? 1 : 0);
      const padded = maxVisible + 2;
      for (let i = contentLines; i < padded; i++) {
        lines.push(`${pc.cyan(S_BAR)}`);
      }

      const count = (this.selectedValues as string[]).length;
      const countLabel = count > 0 ? pc.green(` ${count} selected`) : "";
      const matchLabel =
        filtered.length < opts.options.length
          ? pc.dim(` ${filtered.length}/${opts.options.length} tags`)
          : "";
      const footer = `${pc.cyan(S_BAR)}${countLabel}${matchLabel}`;

      return [title, searchLine, ...lines, footer].join("\n");
    },
  });

  const result = await prompt.prompt();
  if (isCancel(result)) return result;
  return (result ?? []) as string[];
}
