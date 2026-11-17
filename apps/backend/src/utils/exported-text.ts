/**
 * The Native / Roman / IPA text of a published recording or translation.
 *
 * Two sources: what the contributor typed (word_recordings / translations -- never edited after the fact),
 * and what an admin curated in the Publishing module (published_* rows). The public API and the admin UI
 * must agree on which one wins, so the rule lives here once:
 *
 *   - never curated (`textEditedAt` null)  -> the contributor's text, as-is
 *   - curated                              -> exactly the curated three; a null one means "none", so an
 *                                             admin can drop a contributor's wrong IPA without inventing one
 */

export type ProvidedText = {
  nativeText: string | null;
  romanization: string | null;
  ipa: string | null;
};

/** The curated columns of a published_word_recordings / published_translations row. */
export type CuratedText = {
  nativeText: string | null;
  romanText: string | null;
  ipaText: string | null;
  textEditedAt: Date | null;
};

export type ExportedText = ProvidedText & {
  /** true when an admin has set the text; false when it is still the contributor's own. */
  isCurated: boolean;
};

export function resolveExportedText(provided: ProvidedText, curated: CuratedText | null): ExportedText {
  if (!curated || !curated.textEditedAt) {
    return { nativeText: provided.nativeText, romanization: provided.romanization, ipa: provided.ipa, isCurated: false };
  }
  return { nativeText: curated.nativeText, romanization: curated.romanText, ipa: curated.ipaText, isCurated: true };
}

/** Trims; blank or whitespace-only becomes null. */
export function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The three fields an admin types -- the API's names (`romanization`), not the column names (`roman_text`). */
export type PublishedTextInput = ProvidedText;

/** Column values that mark a publication as curated with this text. */
export function curatedColumns(input: PublishedTextInput, now: Date = new Date()) {
  return {
    nativeText: cleanText(input.nativeText),
    romanText: cleanText(input.romanization),
    ipaText: cleanText(input.ipa),
    textEditedAt: now,
  };
}

/** Column values that return a publication to exporting the contributor's own text. */
export function uncuratedColumns() {
  return { nativeText: null, romanText: null, ipaText: null, textEditedAt: null };
}
