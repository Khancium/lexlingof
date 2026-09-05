"use client";

// A plain input backed by a <datalist> -- shows existing options as
// suggestions but always lets the user type a new value, since tribes,
// sub-tribes, villages, and quarters don't have a fixed enumerable list
// up front (the whole point is that contributors grow these lists).
export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; name: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <>
      <input
        list={`${id}-options`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        className="w-full rounded-lg bg-slate-900 px-4 py-3 text-white placeholder-slate-500 outline-none ring-1 ring-slate-700 focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      />
      <datalist id={`${id}-options`}>
        {options.map((option) => (
          <option key={option.id} value={option.name} />
        ))}
      </datalist>
    </>
  );
}
