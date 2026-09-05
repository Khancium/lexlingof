/**
 * Fixed list of mother-tongue options for the onboarding demographics form.
 * Kept as a plain string enum (not a row in the `languages` table) since
 * `languages` is scoped to languages that actually have contribution
 * content wired up, while this list is just "what a contributor speaks".
 */
export const MOTHER_TONGUE_LANGUAGES = [
  "Pashto",
  "Gojri",
  "Torwali",
  "Gawri",
  "Ushojo",
  "Kalkoti",
  "Palula",
  "Gawar-Bati",
  "Dameli",
  "Kalasha",
  "Kamviri",
  "Kativiri",
  "Madaklashti",
  "Khowar",
  "Wakhi",
  "Sarikoli",
  "Kyrgyz",
  "Yidgha",
  "Badeshi",
  "Indus Kohistani",
  "Ormuri",
  "Seraiki",
  "Tirahi",
  "Kohati",
  "Hindko (Peshawar, Kohat, Hazara)",
  "Farsi",
  "Sanglechi",
  "Chiliso",
  "Shina",
  "Pahari-Potohari",
] as const;

export const GENDER_OPTIONS = ["male", "female", "other", "prefer_not_to_say"] as const;
