import { z } from "zod";

/**
 * A boolean query-string parameter: "true"/"1" -> true, "false"/"0" -> false,
 * and absent -> undefined; anything else is a 400.
 *
 * Use this instead of `z.coerce.boolean()` for query params. Coercion is
 * JavaScript truthiness, so every non-empty string -- including the literal
 * string "false" -- becomes `true`: `?mine=false` filtered to the caller's own
 * items, and `?includeHidden=false` revealed the hidden ones.
 */
export const queryBoolean = () => z.stringbool({ truthy: ["true", "1"], falsy: ["false", "0"] }).optional();
