"use client";

import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { api, getErrorMessage, type NamedOption } from "@/lib/api";
import { Combobox } from "@/components/combobox";
import { EDUCATION_LEVEL_OPTIONS, GENDER_OPTIONS, MOTHER_TONGUE_LANGUAGES } from "@/lib/demographics-constants";

const today = new Date();
const maxDateOfBirth = today.toISOString().slice(0, 10);
const minDateOfBirth = new Date(today.getFullYear() - 120, today.getMonth(), today.getDate()).toISOString().slice(0, 10);

function ageFromDateOfBirth(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const hasHadBirthdayThisYear = now.getMonth() > dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

const schema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  dateOfBirth: z
    .string()
    .min(1, "Date of birth is required")
    .refine((v) => ageFromDateOfBirth(v) >= 1 && ageFromDateOfBirth(v) <= 120, "Please enter a valid date of birth"),
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"], "Gender is required"),
  motherTongue: z.enum(MOTHER_TONGUE_LANGUAGES, "Language is required"),
  tribe: z.string().min(1, "Tribe is required"),
  countryCode: z.string().min(1, "Country is required"),
  city: z.string().min(1, "City is required"),
  village: z.string().min(1, "Village is required"),
  quarter: z.string().optional(),
  dialect: z.string().optional(),
  educationLevel: z.enum(["none", "high_school", "bachelors", "masters", "phd"]).optional(),
  profession: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const inputClass =
  "w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 outline-none ring-1 ring-border focus:ring-2 focus:ring-brand";
const labelClass = "mb-1 block text-sm font-medium text-ink";

export default function OnboardingPage() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [tribes, setTribes] = useState<NamedOption[]>([]);
  const [villages, setVillages] = useState<NamedOption[]>([]);
  const [quarters, setQuarters] = useState<NamedOption[]>([]);
  const [countries, setCountries] = useState<{ code: string; name: string }[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  // Each slot is one level of a root-to-leaf sub-tribe chain (a sub-tribe,
  // then optionally a sub-tribe of that sub-tribe, and so on to any depth).
  const [subTribeSlots, setSubTribeSlots] = useState<{ value: string; options: NamedOption[] }[]>([]);
  const [quarterOpen, setQuarterOpen] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: user?.displayName ?? "" },
  });

  const tribe = watch("tribe");
  const countryCode = watch("countryCode");
  const city = watch("city");
  const village = watch("village");

  useEffect(() => {
    if (!user) router.replace("/login");
  }, [user, router]);

  useEffect(() => {
    api.demographics.getTribes().then(setTribes).catch(() => setTribes([]));
    api.geo.getCountries().then(setCountries).catch(() => setCountries([]));
  }, []);

  // Sub-tribes are scoped to the selected tribe -- switching tribes discards
  // whatever chain was being built for the old one.
  useEffect(() => {
    setSubTribeSlots([]);
  }, [tribe]);

  async function addSubTribeLevel() {
    const last = subTribeSlots[subTribeSlots.length - 1];
    if (last && !last.value.trim()) return;

    let options: NamedOption[] = [];
    if (!last) {
      const match = tribes.find((t) => t.name === tribe);
      if (match) options = await api.demographics.getSubTribes(match.id).catch(() => []);
    } else {
      const parentMatch = last.options.find((o) => o.name === last.value);
      if (parentMatch) options = await api.demographics.getSubTribeChildren(parentMatch.id).catch(() => []);
    }
    setSubTribeSlots((prev) => [...prev, { value: "", options }]);
  }

  function updateSubTribeLevel(index: number, value: string) {
    // Changing a level invalidates whatever was chosen below it, since
    // those choices were children of the old value.
    setSubTribeSlots((prev) => {
      const next = prev.slice(0, index + 1);
      next[index] = { ...next[index], value };
      return next;
    });
  }

  const countryName = countries.find((c) => c.code === countryCode)?.name ?? "";

  useEffect(() => {
    if (countryCode) {
      api.geo.getCities(countryCode).then(setCities).catch(() => setCities([]));
    } else {
      setCities([]);
    }
  }, [countryCode]);

  useEffect(() => {
    if (countryName && city) {
      api.demographics.getVillages(countryName, city).then(setVillages).catch(() => setVillages([]));
    } else {
      setVillages([]);
    }
  }, [countryName, city]);

  useEffect(() => {
    const match = villages.find((v) => v.name === village);
    if (match) {
      api.demographics.getQuarters(match.id).then(setQuarters).catch(() => setQuarters([]));
    } else {
      setQuarters([]);
    }
  }, [village, villages]);

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      await api.demographics.submit({
        fullName: values.fullName,
        dateOfBirth: values.dateOfBirth,
        gender: values.gender,
        motherTongue: values.motherTongue,
        tribe: values.tribe,
        subTribes: subTribeSlots.map((s) => s.value.trim()).filter(Boolean),
        country: countryName,
        city: values.city,
        village: values.village,
        quarter: values.quarter || undefined,
        dialect: values.dialect || undefined,
        educationLevel: values.educationLevel || undefined,
        profession: values.profession || undefined,
      });
      // Demographics submission is what sets the user's primary language --
      // refresh the store so it (and dialect) are available immediately to
      // the contribute pages' useContributorLanguage instead of staying
      // stale (null) until the next hard reload.
      setUser(await api.users.getMe());
      router.push("/dashboard");
    } catch (err) {
      setServerError(getErrorMessage(err, "Failed to save your information"));
    }
  }

  if (!user) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-12">
      <div className="card-duo w-full max-w-lg rounded-3xl bg-surface p-6 shadow-sm border border-border sm:p-8">
        <h1 className="mb-1 text-2xl font-bold text-ink">Tell us about yourself</h1>
        <p className="mb-6 text-sm text-ink-muted">
          This helps us understand who&apos;s contributing to the corpus.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className={labelClass}>Full Name</label>
            <input {...register("fullName")} className={inputClass} placeholder="Full name" />
            {errors.fullName && <p className="mt-1 text-xs text-red-600">{errors.fullName.message}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Date of Birth</label>
              <input
                {...register("dateOfBirth")}
                type="date"
                min={minDateOfBirth}
                max={maxDateOfBirth}
                className={inputClass}
              />
              {errors.dateOfBirth && <p className="mt-1 text-xs text-red-600">{errors.dateOfBirth.message}</p>}
            </div>
            <div>
              <label className={labelClass}>Gender</label>
              <select {...register("gender")} className={inputClass} defaultValue="">
                <option value="" disabled>
                  Select gender
                </option>
                {GENDER_OPTIONS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
              {errors.gender && <p className="mt-1 text-xs text-red-600">{errors.gender.message}</p>}
            </div>
          </div>

          <div>
            <label className={labelClass}>Language</label>
            <select {...register("motherTongue")} className={inputClass} defaultValue="">
              <option value="" disabled>
                Select your language
              </option>
              {MOTHER_TONGUE_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
            {errors.motherTongue && <p className="mt-1 text-xs text-red-600">{errors.motherTongue.message}</p>}
          </div>

          <div>
            <label className={labelClass}>Tribe</label>
            <Controller
              name="tribe"
              control={control}
              render={({ field }) => (
                <Combobox id="tribe" value={field.value ?? ""} onChange={field.onChange} options={tribes} placeholder="Tribe" />
              )}
            />
            {errors.tribe && <p className="mt-1 text-xs text-red-600">{errors.tribe.message}</p>}

            {subTribeSlots.map((slot, i) => (
              <div key={i} className="mt-2 pl-4">
                <label className="mb-1 block text-xs font-medium text-ink-muted">
                  {i === 0 ? "Sub-tribe (optional)" : `Sub-tribe of "${subTribeSlots[i - 1].value}"`}
                </label>
                <Combobox
                  id={`sub-tribe-${i}`}
                  value={slot.value}
                  onChange={(v) => updateSubTribeLevel(i, v)}
                  options={slot.options}
                  placeholder="Sub-tribe"
                />
              </div>
            ))}

            {subTribeSlots.length === 0 || subTribeSlots[subTribeSlots.length - 1].value.trim() ? (
              <button
                type="button"
                onClick={addSubTribeLevel}
                disabled={!tribe}
                className="mt-2 text-sm font-medium text-brand hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
              >
                + Add sub-tribe
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Country</label>
              <select {...register("countryCode")} className={inputClass} defaultValue="">
                <option value="" disabled>
                  Select country
                </option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
              {errors.countryCode && <p className="mt-1 text-xs text-red-600">{errors.countryCode.message}</p>}
            </div>
            <div>
              <label className={labelClass}>City</label>
              <Controller
                name="city"
                control={control}
                render={({ field }) => (
                  <Combobox
                    id="city"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    options={cities.map((name) => ({ id: name, name }))}
                    placeholder="City"
                    disabled={!countryCode}
                  />
                )}
              />
              {errors.city && <p className="mt-1 text-xs text-red-600">{errors.city.message}</p>}
            </div>
          </div>

          <div>
            <label className={labelClass}>Village</label>
            <Controller
              name="village"
              control={control}
              render={({ field }) => (
                <Combobox
                  id="village"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  options={villages}
                  placeholder="Village"
                />
              )}
            />
            {errors.village && <p className="mt-1 text-xs text-red-600">{errors.village.message}</p>}

            {quarterOpen ? (
              <div className="mt-2 pl-4">
                <label className="mb-1 block text-xs font-medium text-ink-muted">Quarter (optional)</label>
                <Controller
                  name="quarter"
                  control={control}
                  render={({ field }) => (
                    <Combobox
                      id="quarter"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      options={quarters}
                      placeholder="Quarter"
                      disabled={!village}
                    />
                  )}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setQuarterOpen(true)}
                disabled={!village}
                className="mt-2 text-sm font-medium text-brand hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
              >
                + Add quarter
              </button>
            )}
          </div>

          <div>
            <label className={labelClass}>Dialect (optional)</label>
            <input {...register("dialect")} className={inputClass} placeholder="Dialect" autoComplete="off" />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Education Level (optional)</label>
              <select {...register("educationLevel")} className={inputClass} defaultValue="">
                <option value="">Select education level</option>
                {EDUCATION_LEVEL_OPTIONS.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Profession (optional)</label>
              <input {...register("profession")} className={inputClass} placeholder="Profession" autoComplete="off" />
            </div>
          </div>

          {serverError && <p className="text-sm text-red-600">{serverError}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-duo w-full bg-brand py-3 font-semibold text-ink-inverted transition hover:bg-brand-dark disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
