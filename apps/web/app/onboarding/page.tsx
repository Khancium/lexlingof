"use client";

import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { api, getErrorMessage, type NamedOption } from "@/lib/api";
import { Combobox } from "@/components/combobox";
import { GENDER_OPTIONS, MOTHER_TONGUE_LANGUAGES } from "@/lib/demographics-constants";

const schema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  age: z.number("Age is required").int().min(1).max(120),
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"], "Gender is required"),
  motherTongue: z.enum(MOTHER_TONGUE_LANGUAGES, "Language is required"),
  tribe: z.string().min(1, "Tribe is required"),
  subTribe: z.string().optional(),
  countryCode: z.string().min(1, "Country is required"),
  city: z.string().min(1, "City is required"),
  village: z.string().min(1, "Village is required"),
  quarter: z.string().optional(),
  dialect: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const inputClass =
  "w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 outline-none ring-1 ring-border focus:ring-2 focus:ring-brand";
const labelClass = "mb-1 block text-sm font-medium text-ink";

export default function OnboardingPage() {
  const user = useAuthStore((state) => state.user);
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [tribes, setTribes] = useState<NamedOption[]>([]);
  const [subTribes, setSubTribes] = useState<NamedOption[]>([]);
  const [villages, setVillages] = useState<NamedOption[]>([]);
  const [quarters, setQuarters] = useState<NamedOption[]>([]);
  const [countries, setCountries] = useState<{ code: string; name: string }[]>([]);
  const [cities, setCities] = useState<string[]>([]);

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

  useEffect(() => {
    const match = tribes.find((t) => t.name === tribe);
    if (match) {
      api.demographics.getSubTribes(match.id).then(setSubTribes).catch(() => setSubTribes([]));
    } else {
      setSubTribes([]);
    }
  }, [tribe, tribes]);

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
        age: values.age,
        gender: values.gender,
        motherTongue: values.motherTongue,
        tribe: values.tribe,
        subTribe: values.subTribe || undefined,
        country: countryName,
        city: values.city,
        village: values.village,
        quarter: values.quarter || undefined,
        dialect: values.dialect || undefined,
      });
      router.push("/dashboard");
    } catch (err) {
      setServerError(getErrorMessage(err, "Failed to save your information"));
    }
  }

  if (!user) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-12">
      <div className="w-full max-w-lg rounded-3xl bg-surface p-8 shadow-sm border border-border">
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Age</label>
              <input
                {...register("age", { valueAsNumber: true })}
                type="number"
                min={1}
                max={120}
                className={inputClass}
                placeholder="Age"
              />
              {errors.age && <p className="mt-1 text-xs text-red-600">{errors.age.message}</p>}
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

          <div className="grid grid-cols-2 gap-4">
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
            </div>
            <div>
              <label className={labelClass}>Sub-tribe (optional)</label>
              <Controller
                name="subTribe"
                control={control}
                render={({ field }) => (
                  <Combobox
                    id="sub-tribe"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    options={subTribes}
                    placeholder="Sub-tribe"
                    disabled={!tribe}
                  />
                )}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
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
              <select {...register("city")} className={inputClass} defaultValue="" disabled={!countryCode}>
                <option value="" disabled>
                  Select city
                </option>
                {cities.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              {errors.city && <p className="mt-1 text-xs text-red-600">{errors.city.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
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
            </div>
            <div>
              <label className={labelClass}>Quarter (optional)</label>
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
          </div>

          <div>
            <label className={labelClass}>Dialect (optional)</label>
            <input {...register("dialect")} className={inputClass} placeholder="Dialect" />
          </div>

          {serverError && <p className="text-sm text-red-600">{serverError}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-full bg-brand py-3 font-semibold text-ink-inverted transition hover:bg-brand-dark disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
