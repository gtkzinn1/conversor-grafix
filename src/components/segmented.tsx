/** Grupo de opções em botões (mesmo visual da escolha de operação). */
export function Segmented<T extends string | number>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset class="choices choices--small">
      <legend class="choices__legend">{legend}</legend>
      {options.map(([id, label]) => (
        <label key={String(id)} class="choice">
          <input
            type="radio"
            name={name}
            checked={value === id}
            onChange={() => {
              onChange(id);
            }}
          />
          <span>{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
