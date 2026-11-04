import type {
  INCIDENT_IMPACTS,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
} from "@pims/types/pims.ts";

export function formatRemainingTime(remainingMs: number): string {
  if (remainingMs <= 0) {
    return "00:00:00 (Vencido)";
  }
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") {
    return "—";
  }
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-PE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

export function getStatusLabel(
  status: (typeof INCIDENT_STATUSES)[number] | string,
): string {
  switch (status) {
    case "O":
      return "Abierto";
    case "P":
      return "En proceso";
    case "C":
      return "Cerrado";
    default:
      return status;
  }
}

export function getStatusBadgeClasses(
  status: (typeof INCIDENT_STATUSES)[number] | string,
): string {
  switch (status) {
    case "O":
      return "bg-amber-950/70 text-amber-300 border-amber-800/80";
    case "P":
      return "bg-sky-950/70 text-sky-300 border-sky-800/80";
    case "C":
      return "bg-emerald-950/70 text-emerald-300 border-emerald-800/80";
    default:
      return "bg-slate-800 text-slate-300 border-slate-700";
  }
}

export function getSeverityLabel(
  severity: (typeof INCIDENT_SEVERITIES)[number] | string | null | undefined,
): string {
  switch (severity) {
    case "B":
      return "Baja";
    case "M":
      return "Media";
    case "A":
      return "Alta";
    case "C":
      return "Crítica";
    default:
      return "No asignada";
  }
}

export function getSeverityBadgeClasses(
  severity: (typeof INCIDENT_SEVERITIES)[number] | string | null | undefined,
): string {
  switch (severity) {
    case "B":
      return "bg-slate-800 text-slate-300 border-slate-700";
    case "M":
      return "bg-amber-950/60 text-amber-400 border-amber-800/60";
    case "A":
      return "bg-orange-950/60 text-orange-400 border-orange-800/60";
    case "C":
      return "bg-rose-950/80 text-rose-300 border-rose-800/80";
    default:
      return "bg-slate-850 text-slate-400 border-slate-800";
  }
}

export function getImpactLabel(
  impact: (typeof INCIDENT_IMPACTS)[number] | string | null | undefined,
): string {
  switch (impact) {
    case "B":
      return "Bajo";
    case "M":
      return "Medio";
    case "A":
      return "Alto";
    case "C":
      return "Crítico";
    default:
      return "No asignado";
  }
}
