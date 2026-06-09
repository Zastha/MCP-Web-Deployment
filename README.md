# MCP Web Deployment - AI Orchestrator & Fullstack Platform

Este proyecto es una plataforma fullstack modular diseñada para la integración, gestión y orquestación inteligente de Modelos de Lenguaje de Gran Escala (LLMs) como Claude, ChatGPT y Gemini, utilizando la especificación nativa de **Model Context Protocol (MCP)**. 

La plataforma cuenta con un backend desacoplado que ejecuta flujos multi-herramienta automatizados (`ToolLoop`) y un frontend reactivo en tiempo real con streaming de estados de procesamiento.

---

## 🏗️ Arquitectura General del Sistema

El ecosistema se divide en un cliente de interfaz SPA, un servidor orquestador de API y un clúster de microservicios MCP ejecutados nativamente o a través de contenedores aislados.

```mermaid
graph TD
    subgraph Frontend [Cliente Web - React & Vite]
        A[ChatBox UI] -->|1. POST /message| B(Axios API Client)
        B -->|2. Polling /status & /result| A
    end

    subgraph Backend [Orquestador Central - Express Node.js]
        C[Chat Router] -->|Encola en background| D[Orquestador Principal]
        C -->|Respuesta Inmediata| B
        D -->|Caché Semántica / Whitelist| E[(MongoDB Atlas)]
        D -->|Factoría de Modelos| F[LLM Factory]
    end

    subgraph LLM_Providers [Proveedores de IA Externos]
        F -->|API Request| G[Anthropic Claude]
        F -->|API Request| H[OpenAI GPT]
        F -->|API Request| I[Google Gemini]
    end

    subgraph MCP_Cluster [Ecosistema de Servidores MCP]
        D -->|Ejección STDIO / Docker| J[mcpService]
        J -->|Herramientas de Red| K[Puppeteer MCP]
        J -->|Estructuras Locales| L[Filesystem / CSV / PDF MCP]
        J -->|Persistencia MCP| M[MongoDB MCP Server]
    end
```

---

## 📂 Estructura del Repositorio

```text
├── backend/                       # Servidor Node.js (Express & Orchestrator)
│   ├── config/                    # Entornos y mcpConfig.js (Mapeo de servidores)
│   ├── controllers/               # Controladores de la API (chatController.js async)
│   ├── middlewares/               # Validaciones de esquemas y errorHandler.js
│   ├── routes/                    # Definición de endpoints expuestos
│   └── services/                  # Capa lógica de infraestructura
│       ├── orchestrator/          # Lógica central del ToolLoop y ContextBuilder
│       ├── claudeService.js       # Integración SDK Anthropic
│       ├── geminiService.js       # Integración Google Generative AI (Identity-Shot)
│       ├── openaiService.js       # Integración OpenAI Core (Strict Schemas)
│       └── mcpService.js          # Core de conexión, filtrado y normalización MCP
│
└── frontend/                      # Cliente SPA (React + TypeScript + Vite)
    ├── src/
    │   ├── components/            # UI Components (ChatBox, MessageInput, MessageList)
    │   ├── services/              # Cliente HTTP (api.ts - Mecanismo de Polling)
    │   └── types/                 # Tipados estáticos TypeScript de la app
    └── vite.config.ts             # Configuración de compilación de Vite
```

---

## ⚙️ Arquitectura Asíncrona (Mecanismo de Polling)

Para evitar caídas por *Timeout* de red HTTP durante ejecuciones largas de web scraping o procesamiento masivo de datos, la plataforma utiliza un flujo completamente desacoplado mediante identificadores únicos (`requestId`):

```mermaid
sequenceDiagram
    autonumber
    actor Usuario
    participant FE as Frontend (ChatBox)
    participant BE as Backend (API Controller)
    participant ORQ as Orquestador Core
    participant LLM as Proveedor LLM

    Usuario->>FE: Escribe consulta y presiona Enviar
    FE->>BE: POST /api/chat/message (Payload + Historial)
    Note over BE: Valida estructura y genera requestId
    BE-->>FE: Responde inmediato: { success: true, requestId }
    Note over FE: Activa pantalla de carga y arranca Polling cada 700ms

    par Procesamiento en Background
        BE->>ORQ: Invoca processUserMessage() en segundo plano
        activate ORQ
        ORQ->>LLM: Inicia ciclo ToolLoop / Inyección de Contextos
        deactivate ORQ
    and Ciclo de Polling del Cliente
        loop Cada 700ms hasta finalización
            FE->>BE: GET /api/chat/status/:requestId
            BE-->>FE: Retorna estado de progreso (ej: 'tool_executing')
            Note over FE: Renderiza log dinámico en la UI
        end
    end

    Note over ORQ: Orquestador finaliza y ejecuta .complete()
    ORQ->>BE: Guarda payload final en memoria (TTL 10min)
    FE->>BE: Polling detecta status: 'completed'
    FE->>BE: GET /api/chat/result/:requestId
    BE-->>FE: Retorna texto y metadatos estructurados
    FE->>Usuario: Muestra respuesta final en la burbuja del chat
```

---

## 🔧 Flujo Interno de Ejecución (`ToolLoop`)

Cuando una consulta requiere extraer información externa o consultar bases de datos, el orquestador backend corre un flujo iterativo cerrado con protección de subdominios y listas negras:

```mermaid
flowchart TD
    A[Inicio: processUserMessage] --> B[Consultar MongoDB via MongoDataService]
    B --> C{¿Existe Cache Hit\nSemántico por LLM?}
    
    C -->|Sí| D[Recuperar dato ganador directamente] --> Z[Fin: Retornar Respuesta]
    C -->|No| E[Cargar Fuentes Autorizadas desde Whitelist]
    
    E --> F[Inyectar System Prompt + Fuentes al LLM]
    F --> G[Llamar al Modelo de Lenguaje Activo]
    
    G --> H{¿El modelo requiere\nllamar herramientas?}
    
    H -->|No| I[Extraer texto plano final] --> Z
    
    H -->|Sí| J[Validar URL del Tool contra WhitelistService]
    J --> K{¿URL Permitida?}
    
    K -->|No| L[Lanzar Whitelist Enforcement Error] --> Z
    K -->|Sí| M[Verificar límite de subdominios por Request]
    
    M --> N[Ejecutar Tool nativo en Servidor MCP correspondiente]
    N --> O{¿El resultado retornó\nvacio de DB/Record?}
    
    O -->|Sí| P[Inyectar instrucción estricta forcing_scraping_fallback]
    O -->|No| Q[Normalizar formato nativo según Proveedor]
    
    P & Q --> R[Acoplar respuesta al historial interno de mensajes]
    R --> S{¿Iteraciones < 8?}
    
    S -->|Sí| G
    S -->|No| T[Lanzar Error: Exceso de iteraciones MCP] --> Z
```

---

## 🛠️ Requisitos e Instalación Quickstart

### 1. Clonar y variables de entorno
```bash
git clone [https://github.com/Zastha/MCP-Web-Deployment.git](https://github.com/Zastha/MCP-Web-Deployment.git)
cd MCP-Web-Deployment
```

Configura un archivo `.env` en la carpeta `backend/` con tus credenciales:
```env
PORT=3000
NODE_ENV=development
MONGODB_URI=tu_conexion_mongodb
MONGODB_DB_NAME=MCP-Server
ANTHROPIC_API_KEY=tu_key_claude
OPENAI_API_KEY=tu_key_gpt
GOOGLE_API_KEY=tu_key_gemini
WHITELIST_ENFORCEMENT_ENABLED=true
MAX_SUBDOMAINS_PER_REQUEST=3
```

### 2. Levantar el Backend
```bash
cd backend
npm install
npm start
```

### 3. Levantar el Frontend (Vite)
En otra terminal independiente:
```bash
cd frontend
npm install
npm run dev
```

---

## 🧠 Características Especiales Implementadas

* **Identity-Shot Ingestion (Gemini)**: Implementa una inyección artificial dual de inicio de chat (`user`/`model`) para mitigar la autodegradación de prompts del sistema en Gemini 2.5, forzando la consistencia del rol de analista.
* **Filtro Selectivo de Herramientas (Web Mode)**: Restringe el catálogo global de herramientas a un subset de 16 herramientas esenciales de procesamiento de texto y scraping para OpenAI y Gemini, protegiendo las cuotas críticas de tokens por minuto (TPM).
* **Mitigación Estricta de Errores de Red**: Mapeo estricto e intercepción transparente en el flujo de ejecución de herramientas para solventar desajustes de nomenclatura por guiones bajos (`_`) introducidos por las limitantes nativas del SDK de Google.