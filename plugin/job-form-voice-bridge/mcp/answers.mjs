export function normalizeAnswer(text) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Exact label first; ordinal references apply only to the supplied finite choices. */
export function matchChoice(text, choices) {
  const value = normalizeAnswer(text);
  const exact = choices.filter((choice) => normalizeAnswer(choice) === value);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const ordinals = ["first", "second", "third", "fourth", "fifth"];
  const match =
    /^(?:(?:option|choice) ([1-5])|([1-5])|(?:the )?(first|second|third|fourth|fifth)(?: (?:option|choice))?)$/.exec(
      value,
    );
  if (!match) return undefined;
  const index =
    match[1] || match[2]
      ? Number(match[1] || match[2]) - 1
      : ordinals.indexOf(match[3]);
  return choices[index];
}
