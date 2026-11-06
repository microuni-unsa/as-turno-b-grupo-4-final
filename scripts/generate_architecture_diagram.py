#!/usr/bin/env python3
"""
Architecture Diagram Generator for PIMS Incident Management Agent
Generates high-resolution architecture diagrams showcasing all technologies,
their placement, and roles within the system.
"""

import os
import shutil
from diagrams import Diagram, Cluster, Edge
from diagrams.onprem.client import User, Client
from diagrams.onprem.network import Traefik, Internet
from diagrams.onprem.container import Docker
from diagrams.onprem.database import PostgreSQL
from diagrams.onprem.security import Vault, Trivy
from diagrams.programming.language import TypeScript, Python, NodeJS, Bash
from diagrams.programming.framework import React, FastAPI
from diagrams.generic.storage import Storage
from diagrams.generic.compute import Rack
from diagrams.generic.database import SQL
from diagrams.generic.blank import Blank
from diagrams.generic.os import LinuxGeneral

graph_attr = {
    "fontsize": "28",
    "fontname": "Helvetica-Bold",
    "bgcolor": "#0f172a",
    "fontcolor": "#f8fafc",
    "pad": "0.6",
    "nodesep": "0.7",
    "ranksep": "1.0",
    "splines": "spline",
    "concentrate": "false",
}

node_attr = {
    "fontsize": "11",
    "fontname": "Helvetica",
    "fontcolor": "#0f172a",
    "fillcolor": "#ffffff",
    "style": "filled",
}

edge_attr = {
    "color": "#94a3b8",
    "arrowsize": "0.85",
    "fontsize": "10",
    "fontname": "Helvetica",
    "fontcolor": "#cbd5e1",
}

cluster_cockpit_attr = {
    "fontsize": "15",
    "fontname": "Helvetica-Bold",
    "bgcolor": "#1e293b",
    "fontcolor": "#38bdf8",
    "style": "rounded,filled",
}

cluster_agent_attr = {
    "fontsize": "15",
    "fontname": "Helvetica-Bold",
    "bgcolor": "#1e293b",
    "fontcolor": "#4ade80",
    "style": "rounded,filled",
}

cluster_privacy_attr = {
    "fontsize": "15",
    "fontname": "Helvetica-Bold",
    "bgcolor": "#1e293b",
    "fontcolor": "#f87171",
    "style": "rounded,filled",
}

cluster_rag_attr = {
    "fontsize": "15",
    "fontname": "Helvetica-Bold",
    "bgcolor": "#1e293b",
    "fontcolor": "#fbbf24",
    "style": "rounded,filled",
}

cluster_data_attr = {
    "fontsize": "15",
    "fontname": "Helvetica-Bold",
    "bgcolor": "#1e293b",
    "fontcolor": "#c084fc",
    "style": "rounded,filled",
}

cluster_notices_attr = {
    "fontsize": "15",
    "fontname": "Helvetica-Bold",
    "bgcolor": "#1e293b",
    "fontcolor": "#f472b6",
    "style": "rounded,filled",
}

cluster_infra_attr = {
    "fontsize": "15",
    "fontname": "Helvetica-Bold",
    "bgcolor": "#1e293b",
    "fontcolor": "#94a3b8",
    "style": "rounded,filled",
}

output_dir = "docs"
os.makedirs(output_dir, exist_ok=True)
os.makedirs("t2/img", exist_ok=True)

with Diagram(
    "Arquitectura Completa del Sistema: Agente de Incidentes PIMS (ISO/IEC 27701)",
    show=False,
    direction="TB",
    filename=os.path.join(output_dir, "architecture"),
    outformat="png",
    graph_attr=graph_attr,
    node_attr=node_attr,
    edge_attr=edge_attr,
):
    # Capa Externa: Ingress y Clientes
    with Cluster("1. Ingress & Control de Acceso Perimetral", graph_attr=cluster_cockpit_attr):
        user = User("Operador / DPO\n(Navegador Web)\nAcceso a la consola")
        edge_proxy = Traefik(
            "Traefik Edge Proxy\n"
            "Terminación TLS / HTTPS\n"
            "incidents-pims.mistercricro8.top"
        )
        user >> Edge(label="HTTPS / WSS", color="#38bdf8") >> edge_proxy

    # Capa Cockpit UI
    with Cluster("2. Glass-Box Cockpit UI (packages/cockpit)", graph_attr=cluster_cockpit_attr):
        astro_ui = React(
            "Astro v5 Framework\n"
            "Server-First MPA & SSR\n"
            "Vistas /compliance, /incidents, /chat"
        )
        tailwind = TypeScript(
            "Tailwind CSS + Starwind UI\n"
            "Sistema de componentes accesible\n"
            "Paleta oscura nativa GESTITEL"
        )
        web_speech = Client(
            "Web Speech API (Browser)\n"
            "Dictado por voz sin latencia\n"
            "Cero persistencia de audio"
        )
        sse_client = Blank(
            "Server-Sent Events (SSE)\n"
            "Canal unidireccional /api/stream\n"
            "Trazas de pensamiento y reloj 72h"
        )
        edge_proxy >> Edge(label="Proxy pass", color="#38bdf8") >> astro_ui
        astro_ui - Edge(style="dotted", color="#64748b") - tailwind
        web_speech >> Edge(label="Transcripción local", color="#38bdf8") >> astro_ui
        sse_client << Edge(label="Streaming en vivo", color="#38bdf8") << astro_ui

    # Capa Servidor API & Orquestador del Agente
    with Cluster("3. Backend API & Daemon Autónomo (packages/agent, packages/cockpit)", graph_attr=cluster_agent_attr):
        hono_api = FastAPI(
            "Hono API Server\n"
            "Routing HTTP ultrarrápido\n"
            "Endpoints REST y SSE backend"
        )
        bun_runtime = NodeJS(
            "Bun Runtime v1.4.x\n"
            "Ejecución nativa TS, empaquetado\n"
            "y gestión de workspaces monorepo"
        )
        zod_validation = TypeScript(
            "TypeScript + Zod\n"
            "Tipado estricto y validación fail-fast\n"
            "de contratos, herramientas y esquemas"
        )
        watcher_daemon = Rack(
            "Autonomous Watcher Daemon\n"
            "Sondeo continuo a PIMS, control\n"
            "de leases y bloqueo por hash de entrada"
        )
        orchestrator_roles = Blank(
            "Orquestador Multi-Rol (8 Roles)\nTriage, Investigator, DPO Reviewer,\nProsecutor, con hashes SHA-256 de prompts"
        )
        scheduler = Blank(
            "Scheduler de Plazos\n"
            "Cuenta regresiva de 72h para Art. 33\n"
            "y alertas de caducidad normativa"
        )
        tool_ledger = Storage(
            "19-Tool Registry & Tool Ledger\n"
            "Herramientas con mínimo privilegio\n"
            "y registro inmutable de auditoría"
        )

        astro_ui >> Edge(label="Llamadas REST / API", color="#4ade80") >> hono_api
        hono_api - Edge(style="dotted", color="#64748b") - bun_runtime
        hono_api - Edge(style="dotted", color="#64748b") - zod_validation
        hono_api >> Edge(label="Control de ciclo", color="#4ade80") >> watcher_daemon
        watcher_daemon >> Edge(label="Transición de estado", color="#4ade80") >> orchestrator_roles
        orchestrator_roles >> Edge(label="Control de plazos", color="#4ade80") >> scheduler
        orchestrator_roles >> Edge(label="Invocación restringida", color="#4ade80") >> tool_ledger

    # Capa de Privacidad y Redacción Pre-LLM
    with Cluster("4. Perímetro de Privacidad & Sanitización PII", graph_attr=cluster_privacy_attr):
        presidio = Python(
            "Microsoft Presidio Sidecar\n"
            "FastAPI + spaCy es_core_news_md\n"
            "Reconocedores DNI/RUC peruanos"
        )
        pii_gate = Vault(
            "Fail-Closed Safe Prompting Gate\n"
            "AgentModelClient: Redacta antes de enviar\n"
            "Fallo de sidecar = Aborto inmediato"
        )
        orchestrator_roles >> Edge(label="Solicitud con PII", color="#f87171") >> pii_gate
        pii_gate >> Edge(label="Análisis y anonimización", color="#f87171") >> presidio

    # Capa RAG e Inteligencia Normativa
    with Cluster("5. Motor Dual-Modal RAG (packages/rag)", graph_attr=cluster_rag_attr):
        pgvector_store = PostgreSQL(
            "pgvector (Embeddings Densos)\n"
            "Búsqueda semántica 768/1536 dim\n"
            "de cláusulas ISO 27701 y GDPR"
        )
        minisearch_sparse = Storage(
            "MiniSearch (BM25 Disperso)\n"
            "Búsqueda léxica exacta en memoria\n"
            "con tokenizador español e inglés"
        )
        rrf_reranker = Blank(
            "Reciprocal Rank Fusion (RRF)\n"
            "Fusión denso-dispersa ponderada\n"
            "y Cross-Encoder Reranker"
        )
        unpdf_loader = Blank(
            "Unpdf Extractor\n"
            "Ingesta estructurada de PDF de norma\n"
            "ISO/IEC 27701:2025 y evidencias"
        )
        normative_corpus = Storage(
            "Corpus Normativo Central\n"
            "Texto íntegro ISO 27701:2025 (md)\n"
            "y articulado oficial del GDPR"
        )

        unpdf_loader >> Edge(label="Extracción por secciones", color="#fbbf24") >> normative_corpus
        normative_corpus >> Edge(label="Indexación vectorial", color="#fbbf24") >> pgvector_store
        normative_corpus >> Edge(label="Indexación léxica", color="#fbbf24") >> minisearch_sparse
        tool_ledger >> Edge(label="truth_store.retrieve", color="#fbbf24") >> rrf_reranker
        rrf_reranker >> Edge(label="Búsqueda vectorial", color="#fbbf24") >> pgvector_store
        rrf_reranker >> Edge(label="Búsqueda BM25", color="#fbbf24") >> minisearch_sparse

    # Capa de Redacción Legal de Avisos
    with Cluster("6. Motor de Redacción Legal & Avisos (packages/notices)", graph_attr=cluster_notices_attr):
        art33_composer = Blank(
            "GDPR Art. 33 Authority Pack\n"
            "Composición del paquete para DPO\n"
            "con naturaleza, medidas y causa raíz"
        )
        art34_composer = Blank(
            "GDPR Art. 34 Subject Notice\n"
            "Redacción de avisos a titulares\n"
            "afectados por la brecha de datos"
        )
        intl_segmenter = TypeScript(
            "Intl.Segmenter Readability\n"
            "Validador de lenguaje sencillo por token\n"
            "según directrices regulatorias"
        )
        exemption_engine = Vault(
            "Art. 34(3) Exemption Engine\n"
            "Evaluación de exenciones legales:\n"
            "Cifrado, medidas ulteriores, desproporción"
        )

        orchestrator_roles >> Edge(label="Componer notificaciones", color="#f472b6") >> art33_composer
        orchestrator_roles >> Edge(label="Redactar avisos a titulares", color="#f472b6") >> art34_composer
        art34_composer >> Edge(label="Validación de lenguaje llano", color="#f472b6") >> intl_segmenter
        art34_composer >> Edge(label="Verificación de exención", color="#f472b6") >> exemption_engine

    # Capa de Persistencia y Evidencia Forense
    with Cluster("7. Persistencia Forense & Mock PIMS (packages/evidence, packages/pims-mock)", graph_attr=cluster_data_attr):
        postgres_db = PostgreSQL(
            "PostgreSQL 17 Data Store\n"
            "Base de datos de evidencias,\n"
            "estado KV del agente y base PIMS"
        )
        drizzle_orm = SQL(
            "Drizzle ORM\n"
            "Definición de esquemas relacionales,\n"
            "migraciones y consultas tipadas"
        )
        aes_storage = Storage(
            "AES-256-GCM Blob Storage\n"
            "Cifrado en reposo para evidencias sensibles\n"
            "con confinamiento de rutas"
        )
        sha_sealer = Trivy(
            "Forensic SHA-256 Chainer & Sealer\n"
            "Sellado canónico de bundles JSON y firmas\n"
            "a prueba de manipulaciones"
        )
        pims_server = SQL(
            "GESTITEL PIMS Server / Adapter\n"
            "API inversa Hono + Postgres simulando\n"
            "PIMS institucional (E01-E26)"
        )

        drizzle_orm - Edge(style="dotted", color="#64748b") - postgres_db
        tool_ledger >> Edge(label="Almacenar evidencias", color="#c084fc") >> aes_storage
        tool_ledger >> Edge(label="Firmar bundle forense", color="#c084fc") >> sha_sealer
        sha_sealer >> Edge(label="Registrar metadatos", color="#c084fc") >> drizzle_orm
        tool_ledger >> Edge(label="E01-E26 Read/Write", color="#c084fc") >> pims_server
        pims_server >> Edge(label="Persistir estado PIMS", color="#c084fc") >> postgres_db

    # Capa Externa: Inferencia LLM Cloud y DevOps
    with Cluster("8. Inferencia Cloud & Plataforma DevOps", graph_attr=cluster_infra_attr):
        cloud_llm = Rack(
            "OpenAI-Compatible LLM Providers\n"
            "Inferencia remota (Mistral, OpenRouter, OpenAI)\n"
            "Recibe únicamente texto sanitizado"
        )
        sops_secrets = Vault(
            "SOPS + Age / Microenv\n"
            "Gestión declarativa de secretos cifrados\n"
            "envs/dev.sops.yaml, envs/prod.sops.yaml"
        )
        docker_compose = Docker(
            "Docker & Microcompose\n"
            "Definición tipada de servicios compartida\n"
            "entre tests y entorno de producción"
        )
        nix_flake = LinuxGeneral(
            "Nix Flake & Direnv\n"
            "Toolchain hermético y reproducible:\n"
            "bun, postgresql, sops, typst, unsareport"
        )

        pii_gate >> Edge(label="Prompt anonimizado", color="#38bdf8") >> cloud_llm
        cloud_llm >> Edge(label="Inferencia / Razonamiento", color="#38bdf8") >> orchestrator_roles
        sops_secrets - Edge(style="dotted", color="#64748b") - bun_runtime
        docker_compose - Edge(style="dotted", color="#64748b") - postgres_db
        nix_flake - Edge(style="dotted", color="#64748b") - bun_runtime

print(f"Architecture diagram generated successfully in {output_dir}/architecture.png")
