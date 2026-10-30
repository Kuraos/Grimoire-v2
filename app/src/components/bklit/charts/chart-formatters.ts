// GRIMOIRE: locale "es-CO" en lugar de "en-US" (miles «1.000»).
// GRIMOIRE: «12 ago» y «mar 12 ago». Intl en es-CO da «12 de ago», que en un
// eje de seis marcas se pisa con la vecina. Sólo se usa `.format`, así que basta
// un objeto con ese método.
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

export const shortDateFmt = {
  format: (d: Date) => `${d.getDate()} ${MES[d.getMonth()]}`,
};

export const weekdayDateFmt = {
  format: (d: Date) => `${DIA[d.getDay()]} ${d.getDate()} ${MES[d.getMonth()]}`,
};

export const hmsTimeFmt = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

// `Intl.NumberFormat.prototype.format` is a bound getter — safe to extract.
export const intFmt = new Intl.NumberFormat("es-CO").format;
