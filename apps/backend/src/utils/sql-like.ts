/**
 * Builds a "contains" pattern for LIKE / ILIKE from user input.
 *
 * Interpolating the raw term into `%${term}%` lets the user's own `%` and `_` act as
 * wildcards (Postgres LIKE gives them special meaning), so searching for `100%` or a lone
 * `_` matched far more than the literal text. Backslash is Postgres's default LIKE escape
 * character, so it is escaped first, then `%` and `_`.
 */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}
