import fs from "node:fs";
import path from "node:path";

// Vector icons definition
const ICONS = {
  astro: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none"><path d="M8.358 20.162c-1.15-1.07-1.457-3.02-1.228-4.385.23-1.365 1.15-2.678 2.07-3.64.92-.962 1.84-1.924 2.3-3.136.46-1.212.46-2.576.23-3.888 1.61.91 2.99 2.274 3.91 3.888.92 1.614 1.38 3.486 1.15 5.305-.23 1.819-1.15 3.486-2.53 4.698-1.38 1.212-3.22 1.82-5.06 1.82-1.84 0-3.68-.608-5.06-1.82 1.38 0 2.99-.454 4.22-1.362z" fill="#FF5D01"/><path d="M12 2l1.6 3.6 3.9.5-2.8 2.7.7 3.9-3.4-1.8-3.4 1.8.7-3.9-2.8-2.7 3.9-.5z" fill="#7C3AED"/></svg>`,
  hono: `<svg viewBox="0 0 24 24" width="24" height="24" fill="#E36002"><path d="M12.002 0c-.292 0-.585.074-.848.223L3.195 4.82a1.703 1.703 0 00-.853 1.474v9.412c0 .61.326 1.176.853 1.474l7.959 4.597c.526.298 1.17.298 1.696 0l7.955-4.597c.527-.298.853-.864.853-1.474V6.294c0-.61-.326-1.176-.853-1.474L12.85.223a1.696 1.696 0 00-.848-.223zm0 4.2l5.8 3.35v6.7l-5.8 3.35-5.8-3.35v-6.7l5.8-3.35z"/></svg>`,
  bun: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none"><path d="M4 14c0 4.4 3.6 8 8 8s8-3.6 8-8c0-3.3-2-6.1-5-7.3V6c0-1.7-1.3-3-3-3S9 4.3 9 6v.7C6 7.9 4 10.7 4 14z" fill="#FBF0DF" stroke="#D97706" stroke-width="1.8"/><circle cx="9" cy="13" r="1.5" fill="#451A03"/><circle cx="15" cy="13" r="1.5" fill="#451A03"/><path d="M11 16c.5.5 1.5.5 2 0" stroke="#451A03" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  typescript: `<svg viewBox="0 0 24 24" width="24" height="24"><rect width="24" height="24" rx="4" fill="#3178C6"/><path d="M11.5 15.5h-1.8v-6.3h-2.1V7.7h6v1.5h-2.1v6.3zm3.7 0c-.8 0-1.4-.2-1.9-.5l.5-1.3c.4.3.9.5 1.4.5.6 0 1-.3 1-.7 0-.4-.3-.6-.8-.8l-.8-.3c-1-.4-1.5-.9-1.5-1.8 0-1.1.9-1.9 2.2-1.9.7 0 1.3.2 1.7.4l-.5 1.3c-.4-.2-.8-.4-1.2-.4-.6 0-.9.3-.9.6 0 .4.3.6.8.8l.7.3c1.1.4 1.6 1 1.6 1.9 0 1.2-.9 2-2.1 2z" fill="#FFF"/></svg>`,
  postgres: `<svg viewBox="0 0 24 24" width="24" height="24" fill="#336791"><path d="M12 2C6.5 2 2 6.5 2 12c0 3.6 1.9 6.7 4.8 8.4l-.8-2.6c1.1.6 2.3.9 3.6.9 1.1 0 2.2-.3 3.1-.7l-.5 2.5c2.9-1.6 4.8-4.7 4.8-8.5 0-5.5-4.5-10-10-10zm-1.8 14.5c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5-.7 1.5-1.5 1.5zm3.6 0c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5-.7 1.5-1.5 1.5z"/></svg>`,
  tailwind: `<svg viewBox="0 0 24 24" width="24" height="24" fill="#38BDF8"><path d="M12 6c-4 0-6 2-6 6 1.5-2 3.5-2.5 5-1.5 1 1 2 2.5 4 2.5 4 0 6-2 6-6-1.5 2-3.5 2.5-5 1.5-1-1-2-2.5-4-2.5zm-6 6c-4 0-6 2-6 6 1.5-2 3.5-2.5 5-1.5 1 1 2 2.5 4 2.5 4 0 6-2 6-6-1.5 2-3.5 2.5-5 1.5-1-1-2-2.5-4-2.5z"/></svg>`,
  docker: `<svg viewBox="0 0 24 24" width="24" height="24" fill="#2496ED"><path d="M13.9 10.4h1.7v1.7h-1.7zm-2.6 0H13v1.7h-1.7zm-2.6 0h1.7v1.7H8.7zm-2.6 0h1.7v1.7H6.1zm5.2-2.6H13v1.7h-1.7zm-2.6 0h1.7v1.7H8.7zm5.2 0h1.7v1.7h-1.7zm-7.8 0h1.7v1.7H6.1zm15.7 4.7c-.5-.3-1.6-.4-2.3.1-.3-.6-.8-1-1.4-1.2l-.5-.2-.3.5c-.5.8-.8 1.8-.8 2.8 0 1.2.4 2.4 1.2 3.3 1.3 1.5 3.3 2.1 5.3 1.8 1.8-.3 3.3-1.5 3.8-3.2.1-.4-.2-.8-.6-.8h-4.4zm-1.8 1.4c-.4 0-.7-.3-.7-.7 0-.4.3-.7.7-.7.4 0 .7.3.7.7 0 .4-.3.7-.7.7z"/></svg>`,
  nix: `<svg viewBox="0 0 24 24" width="24" height="24" fill="#5277C3"><path d="M8.2 2.5l5.6 9.7-1.9 1.1-5.6-9.7 1.9-1.1zm7.6 19l-5.6-9.7 1.9-1.1 5.6 9.7-1.9 1.1zM2.5 15.8l9.7-5.6 1.1 1.9-9.7 5.6-1.1-1.9zm19-7.6l-9.7 5.6-1.1-1.9 9.7-5.6 1.1 1.9z"/></svg>`,
  traefik: `<svg viewBox="0 0 24 24" width="24" height="24" fill="#24A1C1"><path d="M12 2L2 7l10 5 10-5-10-5zm0 9l-10-5v10l10 5 10-5v-10l-10 5z"/></svg>`,
  presidio: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#E11D48" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`,
  compass: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.43 13.17 9.02 14.98 10.83 9.57 16.24 7.76"/></svg>`,
  inbox: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`,
  triage: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#0D9488" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
  investigate: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#7C3AED" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>`,
  drafter: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#D97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>`,
  notifier: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#EA580C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>`,
  monitor: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#4F46E5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  rag: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#B45309" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#475569" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  hash: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#047857" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`,
  brain: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#4338CA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,
  check: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
};

// Generate HTML for AI Architecture Diagram (Concise, High-Value Only)
function generateAiArchitectureHtml(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Arquitectura de IA y Orquestación Multi-Rol — ISO/IEC 27701</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #f8fafc;
    color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    padding: 32px;
    width: 2560px;
  }
  
  .header {
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 14px;
    padding: 20px 28px;
    margin-bottom: 24px;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.03);
  }
  .header h1 {
    font-size: 26px;
    font-weight: 800;
    color: #1e3a8a;
    letter-spacing: -0.5px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  /* Grid Layout */
  .main-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }

  /* Section Card */
  .section-card {
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 14px;
    padding: 22px;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.03);
  }
  .section-header {
    display: flex;
    align-items: center;
    padding-bottom: 14px;
    margin-bottom: 16px;
    border-bottom: 1.5px solid #e2e8f0;
  }
  .section-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 17px;
    font-weight: 800;
    color: #0f172a;
  }

  /* Lifecycle Loop */
  .lifecycle-container {
    grid-column: span 2;
  }
  .lifecycle-steps {
    display: grid;
    grid-template-columns: repeat(9, 1fr);
    gap: 12px;
  }
  .step-card {
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 10px;
    padding: 14px 10px;
    text-align: center;
  }
  .step-num {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #1e3a8a;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 6px auto;
  }
  .step-name {
    font-size: 13px;
    font-weight: 800;
    color: #0f172a;
    margin-bottom: 3px;
    text-transform: uppercase;
  }
  .step-role {
    font-size: 11px;
    font-weight: 700;
    color: #2563eb;
    margin-bottom: 6px;
  }
  .step-desc {
    font-size: 11px;
    color: #475569;
    line-height: 1.35;
  }

  /* Roles Grid */
  .roles-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }
  .role-card {
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 12px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .role-top {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .role-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: #f1f5f9;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .role-name {
    font-size: 14px;
    font-weight: 800;
    color: #0f172a;
  }
  .role-desc {
    font-size: 12px;
    color: #334155;
    line-height: 1.4;
    margin-bottom: 12px;
    flex-grow: 1;
  }
  .role-tools {
    border-top: 1px dashed #e2e8f0;
    padding-top: 8px;
  }
  .tools-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: #64748b;
    margin-bottom: 4px;
  }
  .tool-tag {
    display: inline-block;
    font-size: 10px;
    font-family: monospace;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    padding: 2px 6px;
    border-radius: 4px;
    margin: 2px 2px 0 0;
    color: #1e293b;
    font-weight: 600;
  }

  /* Pipelines */
  .pipeline-flow {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .pipeline-node {
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 10px;
    padding: 14px 16px;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .pipeline-icon {
    width: 38px;
    height: 38px;
    border-radius: 8px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .pipeline-info h4 {
    font-size: 14px;
    font-weight: 800;
    color: #0f172a;
    margin-bottom: 3px;
  }
  .pipeline-info p {
    font-size: 12px;
    color: #475569;
    line-height: 1.35;
  }
  .pipeline-arrow {
    text-align: center;
    color: #94a3b8;
    font-weight: 800;
    font-size: 15px;
    margin: -4px 0;
  }
</style>
</head>
<body>

  <!-- HEADER -->
  <div class="header">
    <h1>
      ${ICONS.brain}
      Arquitectura de IA, Orquestación Multi-Rol y Flujo Cognitivo (ISO/IEC 27701)
    </h1>
  </div>

  <div class="main-grid">

    <!-- 1. CICLO DE VIDA FIJO (9 ETAPAS) -->
    <div class="section-card lifecycle-container">
      <div class="section-header">
        <div class="section-title">
          ${ICONS.compass}
          1. Ciclo de Vida Secuencial de Incidentes (State Machine)
        </div>
      </div>

      <div class="lifecycle-steps">
        <div class="step-card">
          <div class="step-num">1</div>
          <div class="step-name">Capture</div>
          <div class="step-role">Intake</div>
          <div class="step-desc">Extracción de hechos a esquema Zod. Un único reprompt por campo faltante. Status O.</div>
        </div>
        <div class="step-card">
          <div class="step-num">2</div>
          <div class="step-name">Dedupe</div>
          <div class="step-role">Triage</div>
          <div class="step-desc">Comprobación de huella canónica para descarte inmediato de duplicados.</div>
        </div>
        <div class="step-card">
          <div class="step-num">3</div>
          <div class="step-name">Triage</div>
          <div class="step-role">Triage</div>
          <div class="step-desc">Clasificación de tipo, severidad e impacto con calibración conformal. Transición O→P.</div>
        </div>
        <div class="step-card">
          <div class="step-num">4</div>
          <div class="step-name">Investigate</div>
          <div class="step-role">Investigator</div>
          <div class="step-desc">Análisis de causa raíz, inspección forense de evidencias cifradas y enlace de riesgos.</div>
        </div>
        <div class="step-card">
          <div class="step-num">5</div>
          <div class="step-name">Draft</div>
          <div class="step-role">Drafter</div>
          <div class="step-desc">Redacción formal paquetes Art. 33 (autoridad) y Art. 34 (titulares) con citas normativas.</div>
        </div>
        <div class="step-card">
          <div class="step-num">6</div>
          <div class="step-name">Approve</div>
          <div class="step-role">Human DPO</div>
          <div class="step-desc">El operador aprueba el borrador en el Cockpit; autorización de un solo uso ligada al hash del contenido.</div>
        </div>
        <div class="step-card">
          <div class="step-num">7</div>
          <div class="step-name">Notify</div>
          <div class="step-role">Notifier</div>
          <div class="step-desc">Emisión firmada con review_approval_id o vencimiento de veto humano. Envío a PIMS.</div>
        </div>
        <div class="step-card">
          <div class="step-num">8</div>
          <div class="step-name">Monitor</div>
          <div class="step-role">Monitor</div>
          <div class="step-desc">Vigilancia de cuenta regresiva de 72h, reaperturas por nueva evidencia y estado.</div>
        </div>
        <div class="step-card">
          <div class="step-num">9</div>
          <div class="step-name">Close</div>
          <div class="step-role">Monitor</div>
          <div class="step-desc">Verificación estricta de la lista de cierre de 8 puntos antes de pasar a estado C.</div>
        </div>
      </div>
    </div>

    <!-- 2. LOS 7 ROLES ESPECIALIZADOS DEL AGENTE (+ APROBADOR HUMANO DPO) -->
    <div class="section-card" style="grid-column: span 2;">
      <div class="section-header">
        <div class="section-title">
          ${ICONS.brain}
          2. Especialización Multi-Rol del Agente (Mínimo Privilegio)
        </div>
      </div>

      <div class="roles-grid">
        <!-- Orchestrator -->
        <div class="role-card">
          <div>
            <div class="role-top">
              <div class="role-icon">${ICONS.compass}</div>
              <div class="role-name">Orchestrator</div>
            </div>
            <p class="role-desc">Gobierna el ciclo de vida, aplica invariantes de estado, activa/cancela timers y sincroniza eventos con el Cockpit.</p>
          </div>
          <div class="role-tools">
            <div class="tools-label">Allowed Tools</div>
            <span class="tool-tag">scheduler_arm</span>
            <span class="tool-tag">scheduler_cancel</span>
            <span class="tool-tag">indicator_emit</span>
            <span class="tool-tag">pims_manage_recipient</span>
          </div>
        </div>

        <!-- Intake -->
        <div class="role-card">
          <div>
            <div class="role-top">
              <div class="role-icon">${ICONS.inbox}</div>
              <div class="role-name">Intake</div>
            </div>
            <p class="role-desc">Extrae hechos crudos desde formularios o dictado por voz hacia el esquema tipado. Solo crea en Status O.</p>
          </div>
          <div class="role-tools">
            <div class="tools-label">Allowed Tools</div>
            <span class="tool-tag">pims_create_incident</span>
            <span class="tool-tag">pims_list_incidents</span>
            <span class="tool-tag">rag_query</span>
          </div>
        </div>

        <!-- Triage -->
        <div class="role-card">
          <div>
            <div class="role-top">
              <div class="role-icon">${ICONS.triage}</div>
              <div class="role-name">Triage</div>
            </div>
            <p class="role-desc">Clasifica severidad, tipo e impacto con calibración de entropía conformal. Valida duplicados y transiciona O→P.</p>
          </div>
          <div class="role-tools">
            <div class="tools-label">Allowed Tools</div>
            <span class="tool-tag">pims_get_incident</span>
            <span class="tool-tag">pims_update_incident</span>
            <span class="tool-tag">pims_transition_status</span>
            <span class="tool-tag">rag_query</span>
          </div>
        </div>

        <!-- Investigator -->
        <div class="role-card">
          <div>
            <div class="role-top">
              <div class="role-icon">${ICONS.investigate}</div>
              <div class="role-name">Investigator</div>
            </div>
            <p class="role-desc">Análisis de causa raíz en Reasoning Model, recolección forense de evidencias cifradas, registro de acciones y enlace de riesgos.</p>
          </div>
          <div class="role-tools">
            <div class="tools-label">Allowed Tools</div>
            <span class="tool-tag">pims_add_action</span>
            <span class="tool-tag">pims_upload_attachment</span>
            <span class="tool-tag">pims_emit_risk_signal</span>
            <span class="tool-tag">pims_create_audit_action</span>
          </div>
        </div>

        <!-- Drafter -->
        <div class="role-card">
          <div>
            <div class="role-top">
              <div class="role-icon">${ICONS.drafter}</div>
              <div class="role-name">Drafter</div>
            </div>
            <p class="role-desc">Compone paquetes normativos Art. 33 (autoridad) y avisos Art. 34 (titulares). Evalúa exenciones Art. 34(3) con fundamentación.</p>
          </div>
          <div class="role-tools">
            <div class="tools-label">Allowed Tools</div>
            <span class="tool-tag">pims_get_incident</span>
            <span class="tool-tag">pims_get_history</span>
            <span class="tool-tag">rag_query</span>
          </div>
        </div>

        <!-- Human DPO approver (no machine role: drafts await human approval) -->
        <!-- Notifier -->
        <div class="role-card">
          <div>
            <div class="role-top">
              <div class="role-icon">${ICONS.notifier}</div>
              <div class="role-name">Notifier</div>
            </div>
            <p class="role-desc">Dispara notificaciones a destinatarios aprobados mediante pims_notify. Contenido estrictamente inmutable.</p>
          </div>
          <div class="role-tools">
            <div class="tools-label">Allowed Tools</div>
            <span class="tool-tag">pims_notify</span>
            <span class="tool-tag">pims_list_recipients</span>
            <span class="tool-tag">pims_get_incident</span>
          </div>
        </div>

        <!-- Monitor -->
        <div class="role-card">
          <div>
            <div class="role-top">
              <div class="role-icon">${ICONS.monitor}</div>
              <div class="role-name">Monitor</div>
            </div>
            <p class="role-desc">Vigila la cuenta regresiva de 72h para Art. 33, detecta nuevas evidencias para reapertura y audita la lista de 8 puntos.</p>
          </div>
          <div class="role-tools">
            <div class="tools-label">Allowed Tools</div>
            <span class="tool-tag">pims_transition_status</span>
            <span class="tool-tag">indicator_emit</span>
            <span class="tool-tag">pims_get_incident</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. PRIVACIDAD & SAFE PROMPTING -->
    <div class="section-card">
      <div class="section-header">
        <div class="section-title">
          ${ICONS.presidio}
          3. Perímetro de Privacidad Fail-Closed (Pre-LLM)
        </div>
      </div>

      <div class="pipeline-flow">
        <div class="pipeline-node">
          <div class="pipeline-icon">${ICONS.inbox}</div>
          <div class="pipeline-info">
            <h4>Datos Crudos del Incidente / Evidencias</h4>
            <p>Reportes de operadores, archivos adjuntos y descripciones con potenciales datos personales.</p>
          </div>
        </div>

        <div class="pipeline-arrow">▼</div>

        <div class="pipeline-node" style="border-color: #fca5a5; background: #fff1f2;">
          <div class="pipeline-icon" style="border-color: #f87171;">${ICONS.presidio}</div>
          <div class="pipeline-info">
            <h4 style="color: #be123c;">Microsoft Presidio Sidecar (spaCy es_core_news_md)</h4>
            <p>Reconocimiento de entidades en español con analizadores para <strong>DNI y RUC peruanos</strong>, tarjetas y correos.</p>
          </div>
        </div>

        <div class="pipeline-arrow">▼</div>

        <div class="pipeline-node">
          <div class="pipeline-icon">${ICONS.lock}</div>
          <div class="pipeline-info">
            <h4>AgentModelClient: Fail-Closed Gate</h4>
            <p>Compuerta estricta: si el sidecar falla, se aborta inmediatamente con <code>PII_REDACTION_UNAVAILABLE</code>. Cero envíos sin sanitizar.</p>
          </div>
        </div>

        <div class="pipeline-arrow">▼</div>

        <div class="pipeline-node" style="border-color: #86efac; background: #f0fdf4;">
          <div class="pipeline-icon" style="border-color: #4ade80;">${ICONS.check}</div>
          <div class="pipeline-info">
            <h4 style="color: #15803d;">Texto Sanitizado & Tokens [REDACTED_*]</h4>
            <p>Únicamente texto libre de datos personales llega a los modelos de lenguaje en la nube.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 4. DUAL-MODAL RAG & INTELIGENCIA NORMATIVA -->
    <div class="section-card">
      <div class="section-header">
        <div class="section-title">
          ${ICONS.rag}
          4. Motor Dual-Modal RAG (Grounding Normativo)
        </div>
      </div>

      <div class="pipeline-flow">
        <div class="pipeline-node">
          <div class="pipeline-icon">${ICONS.rag}</div>
          <div class="pipeline-info">
            <h4>Corpus Normativo Centralizado</h4>
            <p>Texto íntegro oficial de <strong>ISO/IEC 27701:2025</strong> y articulado completo del <strong>GDPR</strong>.</p>
          </div>
        </div>

        <div class="pipeline-arrow">▼</div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div class="pipeline-node" style="padding: 10px 14px;">
            <div class="pipeline-icon">${ICONS.postgres}</div>
            <div class="pipeline-info">
              <h4 style="font-size: 13px;">pgvector (Embeddings)</h4>
              <p style="font-size: 11px;">Búsqueda semántica densa en 1536 dimensiones.</p>
            </div>
          </div>
          <div class="pipeline-node" style="padding: 10px 14px;">
            <div class="pipeline-icon">${ICONS.hash}</div>
            <div class="pipeline-info">
              <h4 style="font-size: 13px;">MiniSearch (BM25)</h4>
              <p style="font-size: 11px;">Búsqueda léxica exacta en memoria en español.</p>
            </div>
          </div>
        </div>

        <div class="pipeline-arrow">▼</div>

        <div class="pipeline-node" style="border-color: #fde68a; background: #fffbeb;">
          <div class="pipeline-icon" style="border-color: #f59e0b;">${ICONS.rag}</div>
          <div class="pipeline-info">
            <h4 style="color: #b45309;">Reciprocal Rank Fusion (RRF) & Cross-Encoder</h4>
            <p>Fusión ponderada denso-dispersa con reclasificación semántica profunda.</p>
          </div>
        </div>

        <div class="pipeline-arrow">▼</div>

        <div class="pipeline-node" style="border-color: #86efac; background: #f0fdf4;">
          <div class="pipeline-icon" style="border-color: #4ade80;">${ICONS.check}</div>
          <div class="pipeline-info">
            <h4 style="color: #15803d;">Citas Textuales Verbatim + Chunk SHA-256</h4>
            <p>Inyección en el contexto del LLM con código de cláusula exacto y hash forense verificable.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 5. CAPA DE MODELOS (MODEL PROVIDERS) -->
    <div class="section-card">
      <div class="section-header">
        <div class="section-title">
          ${ICONS.brain}
          5. Capa de Modelos & Enrutamiento (OpenAIModelProvider)
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
        <div class="pipeline-node">
          <div class="pipeline-icon">${ICONS.brain}</div>
          <div class="pipeline-info">
            <h4>Reasoning Route</h4>
            <p>Modelos de alta capacidad (Mistral Large, GPT-4o) para análisis de causa raíz y redacción jurídica Art. 33/34.</p>
          </div>
        </div>
        <div class="pipeline-node">
          <div class="pipeline-icon">${ICONS.triage}</div>
          <div class="pipeline-info">
            <h4>Fast Route (Conformal)</h4>
            <p>Modelos veloces y calibrados para triaje rápido, extracción de esquemas y evaluación de entropía.</p>
          </div>
        </div>
        <div class="pipeline-node">
          <div class="pipeline-icon">${ICONS.postgres}</div>
          <div class="pipeline-info">
            <h4>Embeddings Route</h4>
            <p>Modelos de representación vectorial para indexación semántica de cláusulas en pgvector.</p>
          </div>
        </div>
        <div class="pipeline-node">
          <div class="pipeline-icon">${ICONS.rag}</div>
          <div class="pipeline-info">
            <h4>Reranker Route</h4>
            <p>Cross-encoders especializados en ranking semántico para priorizar pasajes normativos.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 6. 19-TOOL REGISTRY & PERSISTENCIA FORENSE -->
    <div class="section-card">
      <div class="section-header">
        <div class="section-title">
          ${ICONS.lock}
          6. Registro de Herramientas & Persistencia Forense
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
        <div class="pipeline-node">
          <div class="pipeline-icon">${ICONS.lock}</div>
          <div class="pipeline-info">
            <h4>19-Tool Registry</h4>
            <p>Herramientas tipadas con Zod (gestión de incidentes, evidencias, riesgos, notificaciones y plazos).</p>
          </div>
        </div>
        <div class="pipeline-node">
          <div class="pipeline-icon">${ICONS.hash}</div>
          <div class="pipeline-info">
            <h4>tool_ledger Inmutable</h4>
            <p>Bitácora append-only que registra cada invocación, latencia, parámetros sanitizados y resultado.</p>
          </div>
        </div>
        <div class="pipeline-node">
          <div class="pipeline-icon">${ICONS.lock}</div>
          <div class="pipeline-info">
            <h4>AES-256-GCM Blob Store</h4>
            <p>Cifrado en reposo para archivos probatorios, capturas y evidencias forenses con confinamiento de rutas.</p>
          </div>
        </div>
        <div class="pipeline-node">
          <div class="pipeline-icon">${ICONS.hash}</div>
          <div class="pipeline-info">
            <h4>Forensic SHA-256 Sealer</h4>
            <p>Sellado canónico de bundles JSON y firmas criptográficas a prueba de manipulación.</p>
          </div>
        </div>
      </div>
    </div>

  </div>

</body>
</html>`;
}

// Generate HTML for Full System Architecture Diagram (Concise, High-Value Only)
function generateSystemArchitectureHtml(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Arquitectura Completa del Sistema PIMS — ISO/IEC 27701:2025</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #f8fafc;
    color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    padding: 32px;
    width: 2560px;
  }
  
  .header {
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 14px;
    padding: 20px 28px;
    margin-bottom: 24px;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.03);
  }
  .header h1 {
    font-size: 26px;
    font-weight: 800;
    color: #1e3a8a;
    letter-spacing: -0.5px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  /* Columns Grid Layout */
  .system-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 24px;
  }

  .layer-col {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .layer-card {
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 14px;
    padding: 20px;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.03);
  }
  .layer-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 12px;
    margin-bottom: 14px;
    border-bottom: 1.5px solid #e2e8f0;
  }
  .layer-header h3 {
    font-size: 16px;
    font-weight: 800;
    color: #0f172a;
  }

  /* Component Box */
  .component-box {
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 12px;
  }
  .component-box:last-child {
    margin-bottom: 0;
  }
  .comp-top {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }
  .comp-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .comp-title {
    font-size: 14px;
    font-weight: 800;
    color: #0f172a;
  }
  .comp-desc {
    font-size: 12px;
    color: #475569;
    line-height: 1.4;
  }
</style>
</head>
<body>

  <!-- HEADER -->
  <div class="header">
    <h1>
      ${ICONS.lock}
      Arquitectura Integral del Sistema PIMS (ISO/IEC 27701:2025)
    </h1>
  </div>

  <div class="system-grid">

    <!-- COLUMNA 1: INGRESS Y COCKPIT UI -->
    <div class="layer-col">
      <div class="layer-card">
        <div class="layer-header">
          ${ICONS.traefik}
          <h3>1. Ingress & TLS Edge</h3>
        </div>
        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.traefik}</div>
            <div class="comp-title">Traefik Edge Proxy</div>
          </div>
          <div class="comp-desc">Terminación TLS / HTTPS / WSS en <code>incidents-pims.mistercricro8.top</code> con proxy reverso seguro.</div>
        </div>
      </div>

      <div class="layer-card">
        <div class="layer-header">
          ${ICONS.astro}
          <h3>2. Glass-Box Cockpit</h3>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.astro}</div>
            <div class="comp-title">Astro v5 Framework</div>
          </div>
          <div class="comp-desc">Server-First MPA & SSR para vistas de cumplimiento (<code>/compliance</code>), incidentes y auditoría.</div>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.tailwind}</div>
            <div class="comp-title">Tailwind CSS + Starwind UI</div>
          </div>
          <div class="comp-desc">Sistema de componentes accesibles de alta fidelidad visual.</div>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.inbox}</div>
            <div class="comp-title">Web Speech API (Browser)</div>
          </div>
          <div class="comp-desc">Dictado por voz local en el navegador sin persistencia de audio ni streaming externo.</div>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.monitor}</div>
            <div class="comp-title">Server-Sent Events (SSE)</div>
          </div>
          <div class="comp-desc">Canal unidireccional <code>/api/stream</code> para trazas de pensamiento del agente y reloj de 72h.</div>
        </div>
      </div>
    </div>

    <!-- COLUMNA 2: BACKEND & AGENT DAEMON -->
    <div class="layer-col">
      <div class="layer-card">
        <div class="layer-header">
          ${ICONS.bun}
          <h3>3. Backend API & Daemon</h3>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.bun}</div>
            <div class="comp-title">Bun Runtime v1.4.x</div>
          </div>
          <div class="comp-desc">Ejecución nativa TypeScript, gestión de monorepo workspaces y empaquetado de alta velocidad.</div>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.hono}</div>
            <div class="comp-title">Hono API Server</div>
          </div>
          <div class="comp-desc">Endpoints REST para mutación de incidentes, sesiones y canal SSE backend.</div>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.typescript}</div>
            <div class="comp-title">TypeScript + Zod</div>
          </div>
          <div class="comp-desc">Validación fail-fast y tipado estricto en todos los contratos y herramientas.</div>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.monitor}</div>
            <div class="comp-title">Autonomous Watcher Daemon</div>
          </div>
          <div class="comp-desc">Sondeo continuo a PIMS, control de leases de concurrencia y bloqueo por hash de propuesta.</div>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.compass}</div>
            <div class="comp-title">Countdown Scheduler (72h)</div>
          </div>
          <div class="comp-desc">Cuenta regresiva para notificación a la autoridad según GDPR Art. 33.</div>
        </div>
      </div>
    </div>

    <!-- COLUMNA 3: PRIVACIDAD Y RAG -->
    <div class="layer-col">
      <div class="layer-card">
        <div class="layer-header">
          ${ICONS.presidio}
          <h3>4. Privacidad & RAG</h3>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.presidio}</div>
            <div class="comp-title">Microsoft Presidio Sidecar</div>
          </div>
          <div class="comp-desc">FastAPI + spaCy <code>es_core_news_md</code> con reconocedores de DNI y RUC peruanos.</div>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.lock}</div>
            <div class="comp-title">AgentModelClient Gate</div>
          </div>
          <div class="comp-desc">Filtro fail-closed: si el sidecar falla, aborta inmediatamente con <code>PII_REDACTION_UNAVAILABLE</code>.</div>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.postgres}</div>
            <div class="comp-title">pgvector Semantic Store</div>
          </div>
          <div class="comp-desc">Búsqueda semántica densa de cláusulas ISO 27701 y artículos del GDPR en 1536 dimensiones.</div>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.hash}</div>
            <div class="comp-title">MiniSearch BM25 Léxico</div>
          </div>
          <div class="comp-desc">Búsqueda léxica exacta en español para términos regulatorios específicos.</div>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.rag}</div>
            <div class="comp-title">RRF & Cross-Encoder</div>
          </div>
          <div class="comp-desc">Fusión denso-dispersa y re-clasificación semántica con citas normativas verificables.</div>
        </div>
      </div>
    </div>

    <!-- COLUMNA 4: PERSISTENCIA, PIMS Y DEVOPS -->
    <div class="layer-col">
      <div class="layer-card">
        <div class="layer-header">
          ${ICONS.postgres}
          <h3>5. Persistencia & PIMS</h3>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.postgres}</div>
            <div class="comp-title">PostgreSQL 17 + Drizzle ORM</div>
          </div>
          <div class="comp-desc">Almacén relacional de evidencias, leases y datos operativos con esquemas tipados.</div>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.lock}</div>
            <div class="comp-title">AES-256-GCM Blob Storage</div>
          </div>
          <div class="comp-desc">Cifrado en reposo para archivos probatorios confidenciales con confinamiento de rutas.</div>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.hash}</div>
            <div class="comp-title">Forensic SHA-256 Sealer</div>
          </div>
          <div class="comp-desc">Sellado canónico de bundles JSON y firmas criptográficas inmutables.</div>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.postgres}</div>
            <div class="comp-title">GESTITEL PIMS Server / Adapter</div>
          </div>
          <div class="comp-desc">Adaptador de cliente HTTP que conecta con los endpoints reversados E01 a E26.</div>
        </div>
      </div>

      <div class="layer-card">
        <div class="layer-header">
          ${ICONS.docker}
          <h3>6. Plataforma & DevOps</h3>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.docker}</div>
            <div class="comp-title">Docker & Microdev</div>
          </div>
          <div class="comp-desc">Definición tipada de servicios compartida entre tests de integración y producción.</div>
        </div>

        <div class="component-box">
          <div class="comp-top">
            <div class="comp-icon">${ICONS.nix}</div>
            <div class="comp-title">Nix Flake Hermético</div>
          </div>
          <div class="comp-desc">Toolchain 100% reproducible: bun, postgresql-17, sops y typst.</div>
        </div>
      </div>
    </div>

  </div>

</body>
</html>`;
}

// Write the HTML files
const docsDir = path.resolve("docs");
const t2ImgDir = path.resolve("t2/img");
fs.mkdirSync(docsDir, { recursive: true });
fs.mkdirSync(t2ImgDir, { recursive: true });

const aiHtmlPath = path.join(docsDir, "architecture-ai.html");
const systemHtmlPath = path.join(docsDir, "architecture-system.html");

fs.writeFileSync(aiHtmlPath, generateAiArchitectureHtml(), "utf-8");
fs.writeFileSync(systemHtmlPath, generateSystemArchitectureHtml(), "utf-8");

console.log(`✓ Simplified Architecture HTML diagrams written to:`);
console.log(`  - ${aiHtmlPath}`);
console.log(`  - ${systemHtmlPath}`);
