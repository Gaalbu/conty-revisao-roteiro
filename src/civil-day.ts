export const TIMEZONE = "America/Sao_Paulo";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Dia civil em São Paulo no formato YYYY-MM-DD. Não usa os dez primeiros
// caracteres do ISO, que são o dia em UTC.
export function civilDay(at: Date): string {
  return formatter.format(at);
}
