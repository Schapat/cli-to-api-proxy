# n8n Marktanalyse Workflow

Automatisierte 5-Schritte-Marktanalyse für die Bewertung neuer Geschäftsfelder.

## Architektur

```
┌─────────────────────────────────────────────────────────────────────────┐
│  FORM TRIGGER                                                           │
│  └── Thema, Kontext, E-Mail, Human-in-Loop Option                      │
└─────────────────┬───────────────────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  AI: Kernfragen generieren (3-5 strategische Fragen)                   │
└─────────────────┬───────────────────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  LOOP: Für jede Kernfrage                                              │
│  ├── SearXNG: Web-Recherche                                            │
│  ├── AI: Hypothesen entwickeln + Evidenz bewerten                      │
│  └── [Optional] E-Mail: Zwischenstand senden                           │
└─────────────────┬───────────────────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  AI: Selbstkritik (Blinde Flecken, Schwächen identifizieren)           │
└─────────────────┬───────────────────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  AI: Synthese (Executive Summary + Handlungsempfehlung)                │
└─────────────────┬───────────────────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  OUTPUT: Markdown-Dokument → E-Mail mit Anhang                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Voraussetzungen

### 1. SearXNG (Self-hosted Suchmaschine)

```bash
# Docker-Compose für SearXNG
docker run -d \
  --name searxng \
  -p 8080:8080 \
  -v ./searxng:/etc/searxng \
  searxng/searxng:latest
```

Oder mit Docker Compose:

```yaml
# docker-compose.searxng.yml
version: '3.8'
services:
  searxng:
    image: searxng/searxng:latest
    container_name: searxng
    ports:
      - "8080:8080"
    volumes:
      - ./searxng:/etc/searxng
    environment:
      - SEARXNG_BASE_URL=http://localhost:8080
    restart: unless-stopped
```

### 2. Lokales LLM (über CLI-to-API Proxy)

Der Workflow nutzt deinen bestehenden CLI-to-API Proxy:
- **Base URL:** `http://127.0.0.1:8082/v1`
- **Model:** `claude/sonnet` (konfigurierbar)

### 3. SMTP für E-Mail-Versand

Benötigt SMTP-Credentials in n8n (Gmail, Outlook, eigener Server).

## Installation

### 1. Workflow importieren

1. Öffne n8n
2. Klicke auf "..." → "Import from File"
3. Wähle `market-analysis-workflow.json`

### 2. Credentials konfigurieren

#### OpenAI-Compatible API (für lokales LLM)
1. Settings → Credentials → Add Credential
2. Wähle "OpenAI API"
3. Konfiguriere:
   - **API Key:** `sk-cli-proxy-12345` (oder dein Key)
   - **Base URL:** `http://127.0.0.1:8082/v1`

#### SMTP
1. Settings → Credentials → Add Credential
2. Wähle "SMTP"
3. Konfiguriere deinen E-Mail-Server

### 3. Environment Variables setzen

In n8n unter Settings → Environment Variables:

```
SEARXNG_URL=http://localhost:8080
EMAIL_FROM=analyse@eggs.de
```

### 4. Nodes aktualisieren

Ersetze `CONFIGURE_ME` in allen Credential-Referenzen mit deinen echten Credential-IDs.

## Verwendung

1. **Workflow aktivieren** (Toggle oben rechts)
2. **Formular öffnen:** `http://localhost:5678/form/market-analysis-form`
3. **Ausfüllen:**
   - Thema: z.B. "ServiceNow als neues Geschäftsfeld"
   - Kontext: Eure aktuelle Situation beschreiben
   - E-Mail: Wohin das Ergebnis gesendet werden soll
   - Human-in-Loop: Ob Zwischenstände per E-Mail kommen sollen

4. **Warten:** Die Analyse dauert je nach Komplexität 5-15 Minuten
5. **Ergebnis:** Markdown-Dokument per E-Mail

## Output

Das generierte Markdown-Dokument enthält:

1. **Kernfragen** - 3-5 strategische Fragen
2. **Hypothesen** - Für jede Kernfrage 2-3 konkurrierende Hypothesen
3. **Evidenzbewertung** - Fakten mit Quellenqualität
4. **Selbstkritik** - Blinde Flecken und Schwächen
5. **Synthese** - Executive Summary und Handlungsempfehlung

## Confluence-Integration (geplant)

Für die spätere Confluence-Integration:
- Das Markdown-Template ist bereits für Confluence optimiert
- Import via Confluence Markdown-Support
- Empfohlene Ordnerstruktur siehe `ANALYSIS_TEMPLATE.md`

## Troubleshooting

### SearXNG liefert keine Ergebnisse
- Prüfe ob SearXNG läuft: `curl http://localhost:8080/search?q=test&format=json`
- Aktiviere mehr Suchmaschinen in `searxng/settings.yml`

### LLM-Timeout
- Erhöhe Timeout in den HTTP-Request-Nodes
- Prüfe ob der CLI-Proxy läuft: `curl http://127.0.0.1:8082/health`

### E-Mail kommt nicht an
- Prüfe SMTP-Credentials
- Checke Spam-Ordner
- Teste mit einem einfachen E-Mail-Node zuerst

## Anpassungen

### Andere Suchmaschine
Ersetze den SearXNG-Node durch:
- **Tavily API** (1000 Free/Monat)
- **Brave Search API** (kostenpflichtig)
- **DuckDuckGo** (via Scraping, fragil)

### Anderes LLM
Ändere in den OpenAI-Model-Nodes:
- `model`: z.B. `gpt-4o`, `claude/opus`, `kiro/sonnet`
- `baseURL`: Falls du einen anderen Proxy nutzt

### Mehr/Weniger Kernfragen
Passe den Prompt im "AI - Kernfragen generieren" Node an.
