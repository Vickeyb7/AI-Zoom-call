# Implementation Plan: Contextual AI Sales Copilot

**Document status:** Proposed technical implementation  
**Version:** 0.5  
**Date:** 20 November 2026  
**Companion document:** `PRD.md`  
**Initial platforms:** Windows 10/11 and macOS (cross-platform desktop application from the first release)

---

## 1. Purpose

This document translates the Contextual AI Sales Copilot PRD into a practical engineering plan. It defines the proposed technology stack, architecture, application modules, data flow, API boundaries, storage model, privacy approach, development sequence, and testing strategy.

The implementation should be incremental. The first milestone is a controlled cross-platform prototype for Windows and macOS that proves the core loop:

**Meeting audio → transcription → conversation understanding → contextual recommendation → private Copilot UI.**

Direct integrations with every meeting platform, broad external competitor research, CRM automation, and advanced analytics should not delay validation of that loop.

---

## 2. Technology decisions

### 2.1 Proposed stack

| Layer | Selected technology | Responsibility |
|---|---|---|
| Desktop shell | Electron | Native desktop windowing, display management, packaging, OS integration |
| UI | React + TypeScript | Copilot interface and settings |
| Frontend build tooling | Vite | Fast development and renderer bundling |
| Backend API | Python + FastAPI | AI orchestration, knowledge retrieval, meeting state, API endpoints |
| Real-time transport | WebSockets | Stream transcript events, status, and recommendations |
| Speech-to-text | Deepgram streaming API (initial provider) | Low-latency live transcription |
| LLM | Groq API — `openai/gpt-oss-120b` (initial production model) | Signal extraction, reasoning, recommendation generation |
| Provider abstraction | Internal interfaces/adapters | Permit alternate speech and LLM providers without rewriting product logic |
| Relational database | PostgreSQL | Users, preferences, meeting metadata, knowledge metadata |
| Vector retrieval | pgvector | Semantic search over approved product and competitor knowledge |
| ORM and migrations | SQLAlchemy + Alembic | Database access and schema changes |
| Validation | Pydantic | Typed request, response, and internal data models |
| Packaging | electron-builder | Windows installer and packaged application |
| Source control | Git + GitHub | Version control, pull requests, issue tracking |
| Automated tests | Pytest + Vitest + Playwright | Backend, UI, and end-to-end tests |

### 2.2 Why this stack

- **Electron** gives us a shared Windows/macOS desktop codebase, floating windows, window positioning, multi-monitor behaviour, and platform-specific packaging. Build and test on both operating systems from the first release; do not treat macOS as a later port.
- **Cross-platform does not mean identical audio-capture code.** Keep a shared capture interface and implement platform-specific capture adapters: Windows system-audio loopback (for example, WASAPI) and macOS system-audio capture using supported macOS APIs/frameworks (for example, ScreenCaptureKit where appropriate), alongside microphone capture on both platforms. Validate OS-version support, permissions, device routing, and meeting-app behaviour in dedicated technical spikes.
- **React + TypeScript** are suitable for a stateful, configurable Copilot interface. Vite keeps the renderer build simple and fast.
- **FastAPI** supports asynchronous Python APIs and WebSocket communication. Python also has a strong ecosystem for AI orchestration and retrieval.
- **Deepgram** is the initial speech-to-text candidate because the product needs streaming transcription rather than only post-meeting transcription.
- **Groq API** is the initial reasoning provider. Use `GROQ_API_KEY` and keep the model behind a provider adapter so another model can be tested without changing the application workflow. Use the Groq OpenAI-compatible API base URL `https://api.groq.com/openai/v1`. The initial production model is `openai/gpt-oss-120b`; evaluate `openai/gpt-oss-20b` as a lower-cost/faster option for simpler classification tasks. Confirm model availability and account limits at deployment time rather than hard-coding assumptions about throughput or pricing.
- **PostgreSQL + pgvector** allow structured meeting state and semantic knowledge retrieval to live in one database for the early product.
- **Electron Builder** provides a practical route to a Windows installer.

These are proposed choices, not irreversible commitments. Audio capture, screen-share isolation, transcription quality, latency, pricing, and terms of service must be validated in technical spikes before the stack is treated as final.

### 2.3 LLM and embedding model decisions

**Groq reasoning model**
- Default model: `openai/gpt-oss-120b` through Groq's hosted API. Use it for contextual sales reasoning, objection handling, competitor-mention interpretation, discovery-gap analysis, and final recommendation generation.
- Optional smaller model: `openai/gpt-oss-20b`. Evaluate it for lower-complexity tasks such as intent classification, transcript tagging, and lightweight signal extraction. Do not split traffic across models until the quality/latency benchmark demonstrates a benefit.
- API base URL: `https://api.groq.com/openai/v1`.
- Configuration: `GROQ_API_KEY`, `GROQ_BASE_URL`, `GROQ_MODEL`, and optionally `GROQ_FAST_MODEL`.
- Use Groq's supported structured-output mode where appropriate, but validate every response with Pydantic and retain a safe fallback if the model returns malformed or incomplete data. Streaming and structured-output feature combinations must be checked against the current API documentation.
- The provider adapter must support timeouts, bounded retries, rate-limit handling, request IDs, token/latency telemetry, and configurable reasoning effort where supported. Do not send the full transcript on every turn; send a compact conversation state plus the relevant recent turns and retrieved evidence.

**Hugging Face embedding model**
- Default model: `BAAI/bge-m3`, loaded locally in the Python backend with Sentence Transformers or a compatible Hugging Face implementation.
- Treat this as the selected starting model for the MVP, not a claim that it is universally best. Benchmark it against `intfloat/multilingual-e5-large-instruct` using representative sales queries and the actual knowledge base before production rollout.
- BGE-M3 produces 1,024-dimensional dense vectors. Configure the pgvector column/index dimension to match the selected model. Record the model ID, pinned revision, preprocessing/encoding configuration, and dimension with each indexed corpus version.
- Use the model's documented query/document encoding behaviour consistently. Do not add E5-style instruction prefixes to BGE-M3 unless the chosen model's own instructions require them.
- Run embeddings locally by default; no Hugging Face API key is normally required for public model downloads. `HF_TOKEN` remains optional and should only be configured when model access or a hosted inference option requires it.
- Embedding generation is a separate workload from Groq reasoning. Embed knowledge documents during ingestion and embed search queries only when retrieval is requested. Never call the embedding model for every incoming transcript token.
- A change in model, revision, vector dimension, or preprocessing requires a controlled re-embedding/re-indexing migration. Never compare vectors generated by incompatible embedding configurations.

### 2.4 Important frontend decision

Use **React + TypeScript + Vite inside Electron**, rather than introducing Next.js into the desktop renderer.

Next.js is useful for server-rendered web applications, but the initial product is a desktop application with a local renderer and a separate FastAPI backend. Vite avoids unnecessary SSR and deployment complexity.

A separate Next.js web application can be introduced later if the product needs an admin portal, team dashboard, or web-based knowledge management.

---

### 2.5 Cross-platform and meeting-platform support

The product requirement is a desktop Copilot that runs on **Windows 10/11 and macOS** and can assist during meetings hosted in **Zoom, Google Meet, Microsoft Teams**, and other supported meeting clients. The operating system and meeting provider are separate compatibility dimensions: supporting a meeting provider on Windows does not automatically prove it works on macOS, or vice versa.

**Operating-system support**
- Use one Electron + React + TypeScript application codebase for Windows and macOS.
- Maintain platform-specific modules behind shared interfaces for audio capture, permissions, window management, notifications, startup behaviour, and packaging.
- Build, sign, and test separate Windows and macOS installers. For macOS, plan for code signing, notarisation, microphone/screen-recording permissions, and Apple Silicon support; validate Intel support before committing to it.
- For Windows, validate supported Windows 10/11 versions, audio-device selection, loopback capture, installer/update behaviour, and multi-monitor handling.
- Do not promise identical feature behaviour until the same acceptance tests pass on both operating systems.

**Meeting-platform support**
- The MVP should aim for meeting-app-agnostic audio capture rather than requiring a separate deep integration for every meeting provider.
- Capture meeting output audio through the operating system's supported system-audio/loopback mechanism, subject to user permission and platform restrictions.
- Capture the salesperson's microphone separately where possible, so the system can distinguish the salesperson from other participants.
- Provide a clear device/input selector and visible capture status. Handle muted microphones, device changes, Bluetooth headsets, audio-route changes, and meeting start/end.
- Keep meeting-provider integrations behind optional adapters. Add official Zoom, Google Meet, or Microsoft Teams integrations only where they materially improve meeting detection, participant attribution, metadata, or reliability and are permitted by the provider.
- Do not claim universal compatibility with every browser, meeting client, headset, virtual audio device, or screen-sharing mode. Maintain a tested compatibility matrix and clearly communicate unsupported combinations.

**Audio capture abstraction**

Use a shared interface such as `AudioCaptureProvider` with platform implementations:

```text
desktop/
  audio-capture/
    base.ts
    windows/
      wasapi-loopback.ts
      microphone-capture.ts
    macos/
      screencapturekit.ts
      microphone-capture.ts
    device-manager.ts
    permissions.ts
    audio-mixer.ts
```

The exact implementation boundary may live in Electron's main process or a native helper, depending on the capture library and platform APIs selected. Keep OS-specific code out of the React UI and out of the conversation/recommendation logic.

**Required compatibility test matrix**

| OS | Meeting client | Required checks |
|---|---|---|
| Windows 10/11 | Zoom desktop | System audio, microphone, speaker separation, reconnect |
| Windows 10/11 | Google Meet in supported browser | Tab/system audio capture, permissions, device changes |
| Windows 10/11 | Microsoft Teams desktop/web | System audio, microphone, reconnect |
| macOS | Zoom desktop | Screen/audio permissions, system audio, microphone |
| macOS | Google Meet in supported browser | Browser/system audio capture, permissions, device changes |
| macOS | Microsoft Teams desktop/web | System audio, microphone, reconnect |

Also test multiple monitors, sleep/wake, headset connect/disconnect, meeting app updates, and screen sharing. For each combination, document OS version, meeting-client version, browser version where applicable, capture method, known limitations, and test result.

**Cross-platform release gates**
- Windows and macOS builds install, launch, update, and uninstall successfully.
- Audio capture and transcription work in the supported meeting-client/OS combinations.
- The Copilot overlay can be moved, resized, positioned on multiple monitors, and recovered after display changes on both OSes.
- Required permissions are requested clearly, and the user can see whether capture is active.
- Privacy and screen-share behaviour is tested separately on Windows and macOS; do not promise that the Copilot is invisible in every sharing mode.
- CI runs shared backend/frontend tests on every change, with platform-specific smoke tests on Windows and macOS build agents.

## 3. High-level architecture

```mermaid
flowchart TD
    A[Zoom / Meet / Teams / Test Audio Source] --> B[Electron Desktop App]
    B --> C[Audio Capture Adapter]
    C --> D[Streaming Speech Provider]
    D --> E[Transcript Event Stream]
    E --> F[FastAPI Conversation Service]
    F --> G[Conversation State Manager]
    G --> H[Signal Detection]
    H --> I[Recommendation Orchestrator]
    I --> J[Knowledge Retrieval]
    J --> K[(PostgreSQL + pgvector)]
    I --> L[LLM Provider Adapter]
    L --> M[Recommendation Validator]
    M --> N[WebSocket Events]
    N --> O[React Copilot UI]
    B --> P[Window / Display / Privacy Controller]
    P --> O
```

### 3.1 Architectural principles

1. Keep desktop window management separate from AI reasoning.
2. Keep audio capture separate from transcription provider logic.
3. Keep LLM and speech providers replaceable through adapters.
4. Store structured meeting state separately from raw transcript text.
5. Retrieve evidence before generating factual competitor or product claims.
6. Make the recommendation output structured JSON validated by Pydantic.
7. Do not make the desktop renderer responsible for API secrets or AI orchestration.
8. Keep privacy state visible and independently testable.

---

## 4. Application components

### 4.1 Electron desktop shell

Responsibilities:
- Create the main Copilot window.
- Create a compact/minimised state.
- Support always-on-top behaviour where appropriate.
- Support drag, resize, and user-selected positioning.
- Enumerate connected displays.
- Restore the Copilot to a usable display if a monitor disconnects.
- Manage application lifecycle and updates.
- Coordinate the renderer with the local backend connection.
- Implement supported capture-protection controls and expose their limitations clearly.

Suggested modules:

```text
desktop/
  main/
    main.ts
    window-manager.ts
    display-manager.ts
    privacy-controller.ts
    capture-state.ts
    ipc-handlers.ts
  preload/
    preload.ts
    desktop-api.ts
  renderer/
    ...
```

Use Electron's context isolation and a restrictive preload bridge. Do not expose Node.js APIs directly to the renderer. Validate every IPC message and allow only the minimum required operations.

### 4.2 React Copilot interface

Responsibilities:
- Show the current recommendation.
- Show a concise rationale and relevant supporting evidence.
- Display transcript/capture status.
- Display discovery gaps and meeting context according to selected density.
- Allow dismiss, defer, mark-covered, and alternative-suggestion actions.
- Provide settings for position, monitor, privacy, and density.

Suggested UI components:

```text
src/
  components/
    CopilotWindow/
    RecommendationCard/
    TranscriptStatus/
    DiscoveryChecklist/
    EvidencePanel/
    PrivacyIndicator/
    DensitySelector/
    PositionSettings/
    MeetingControls/
  stores/
    meeting-store.ts
    preferences-store.ts
  services/
    websocket-client.ts
    api-client.ts
  types/
```

Use a small state-management solution such as Zustand if shared UI state becomes difficult to manage with React state alone. Avoid adding a state-management library until the UI requires it.

### 4.3 FastAPI backend

Responsibilities:
- Accept desktop client connections.
- Receive transcript events.
- Maintain meeting context.
- Run signal detection.
- Retrieve relevant knowledge.
- Generate and validate recommendations.
- Persist meeting metadata and user preferences.
- Stream recommendations and status events to the desktop client.

Suggested modules:

```text
backend/
  app/
    main.py
    api/
      routes/
        health.py
        meetings.py
        preferences.py
        knowledge.py
    core/
      config.py
      logging.py
      security.py
    services/
      transcription/
        base.py
        deepgram_adapter.py
      llm/
        base.py
        groq_adapter.py
      conversation/
        state_manager.py
        summarizer.py
      intelligence/
        signal_detector.py
        competitor_detector.py
        objection_detector.py
        discovery_tracker.py
      recommendations/
        orchestrator.py
        ranking.py
        validator.py
      retrieval/
        loaders/
          base.py
          pdf_loader.py
          docx_loader.py
          html_loader.py
          text_loader.py
        normalisation.py
        metadata.py
        chunking.py
        embeddings.py
        indexing.py
        hybrid_search.py
        reranking.py
        citations.py
        ingestion_jobs.py
        search.py
    models/
    schemas/
    repositories/
    websocket/
    tests/
```

---

## 5. Knowledge ingestion and RAG retrieval pipeline

RAG (retrieval-augmented generation) is a first-class product capability. It supplies the Copilot with approved, company-specific sales knowledge at the moment it is needed. The LLM should reason over the current meeting context and retrieved evidence; it must not invent product capabilities, competitor claims, pricing policies, customer results, or approved positioning.

The pipeline has two distinct paths:

1. **Offline / asynchronous ingestion:** documents are loaded, cleaned, split into chunks, enriched with metadata, embedded, and indexed.
2. **Online / real-time retrieval:** a meeting signal is converted into a search query, relevant chunks are retrieved and ranked, and only the best evidence is passed to the recommendation model.

### 5.1 Initial supported knowledge sources

The first release should support deliberate uploads of:
- PDF sales playbooks, battle cards, product guides, pricing/packaging guidance, and case studies.
- DOCX sales scripts, objection-handling guides, and internal enablement documents.
- Markdown and plain-text notes.
- HTML pages or exported web content where the user has permission to ingest the material.

Later integrations may include approved CRM knowledge, sales-enablement platforms, shared drives, and knowledge bases. Do not scrape or ingest third-party material unless its access terms and the organisation's rights permit it.

For the MVP, support file upload and a simple knowledge-source management screen before building external connectors.

### 5.2 Ingestion pipeline stages

```mermaid
flowchart TD
    A[Upload document] --> B[Validate type, size, and access]
    B --> C[Store original + calculate checksum]
    C --> D[Document loader]
    D --> E[Text and layout extraction]
    E --> F[Normalise and clean]
    F --> G[Detect headings, sections, tables]
    G --> H[Chunk by structure and token budget]
    H --> I[Attach metadata and provenance]
    I --> J[Generate embeddings in batches]
    J --> K[Write chunks and vectors to PostgreSQL / pgvector]
    K --> L[Run ingestion quality checks]
    L --> M[Mark document version searchable]
```

Each stage must be independently retryable. A failed embedding request should not require re-parsing the original file. Store stage status and error details against an ingestion job.

### 5.3 Document loading and extraction

Implement a loader interface so formats can be added without changing chunking or retrieval:

```python
class DocumentLoader(Protocol):
    def supports(self, file_name: str, mime_type: str) -> bool: ...
    def load(self, file_path: str) -> list["DocumentPage"]: ...
```

Initial loader choices:
- **PDF:** PyMuPDF (`fitz`) for text extraction and page boundaries. Detect scanned/image-only pages and flag them for optional OCR rather than silently indexing empty text.
- **DOCX:** `python-docx` for paragraphs, heading styles, and tables. Preserve heading hierarchy and table row/column relationships where possible.
- **HTML:** BeautifulSoup or an equivalent parser to remove navigation, scripts, cookie banners, and other boilerplate while retaining headings, lists, and tables.
- **Markdown / TXT:** native text parsing with heading and paragraph boundaries.

Represent extracted content in a common intermediate structure containing:
- `document_id` and `document_version_id`
- `source_file_name` and `source_type`
- `page_number` or source section, where applicable
- `heading_path` (for example `Pricing > Enterprise > Overage`)
- `block_type` (`paragraph`, `heading`, `table`, `list`, `callout`)
- `text`
- extraction warnings and character offsets, when available

Do not flatten an entire file into one unstructured string. Retaining page, heading, and table context is important for useful citations and chunk boundaries.

### 5.4 Normalisation and cleaning

Before chunking:
- Remove repeated headers and footers, page numbers, navigation text, and duplicated boilerplate when reliably identifiable.
- Normalise whitespace, line endings, and Unicode while preserving meaningful punctuation, bullet structure, currency values, product names, and version strings.
- Preserve negation, qualifiers, dates, units, and comparison operators. These can change the meaning of sales guidance.
- Keep tables as coherent row-oriented text or structured table records; do not concatenate cells in an ambiguous order.
- Deduplicate exact repeated blocks within the same document version, but do not merge distinct statements simply because they are similar.
- Flag low-text, malformed, or likely OCR-corrupted pages for review.

Never “clean up” a statement in a way that changes its meaning. Keep the original file as the source of truth.

### 5.5 Chunking strategy and initial parameters

Use **structure-aware recursive chunking**, not fixed character slicing. Split first at document boundaries, then headings/sections, paragraphs, list items, and finally sentence boundaries if a block exceeds the token budget.

Initial MVP defaults (measured in tokens, not characters):

| Parameter | Initial value | Rationale |
|---|---:|---|
| Target chunk size | 500 tokens | Enough context for a complete objection response or product explanation without retrieving an entire page |
| Minimum chunk size | 150 tokens | Avoid tiny fragments with insufficient context |
| Maximum chunk size | 800 tokens | Hard upper bound for ordinary prose chunks |
| Overlap | 75 tokens | Retain continuity when a section must be split |
| Embedding batch size | 64 chunks (configurable) | Practical starting batch; tune to provider limits and throughput |
| Retrieval top-K | 12 candidates | Broad first-pass recall before filtering/reranking |
| Reranked context | 4–6 chunks | Keep final model context focused |
| Query expansion | 2–3 variants when needed | Improve recall for short or ambiguous objections |

These are starting values to validate empirically, not universal optimums. Make them configuration-driven and record them with each ingestion run so a document can be reprocessed reproducibly.

Chunking rules:
1. Prefer one self-contained objection/response, product capability, competitor comparison, or case-study passage per chunk.
2. Keep a heading with the content it governs. Add the full heading path to chunk metadata and, where useful, prepend it to the embedded text.
3. Do not split a table row from its column labels. For large tables, create chunks containing the table title, column headers, and a small group of complete rows.
4. Keep bullet lists together when they form one answer or process. Split very long lists only at item boundaries.
5. If a section is 150–800 tokens, keep it intact even if it is below the target size.
6. If a section exceeds 800 tokens, split at paragraph or sentence boundaries into approximately 500-token chunks with 75-token overlap.
7. If a block is below 150 tokens, merge it with a neighbouring block only when they share the same heading/topic and the merge remains below 800 tokens. Do not merge unrelated content to satisfy a size target.
8. Keep short, high-value atomic facts (for example, a single approved product limitation) as standalone chunks when merging would make the fact harder to retrieve. Mark these as atomic facts.
9. Do not create overlap across unrelated headings, document sections, or separate table rows.
10. Preserve source offsets/page numbers so every retrieved chunk can be traced back to the original document.

Store both the raw extracted text and the final chunk text. This makes it possible to audit chunking decisions and reprocess content when the strategy changes.

### 5.6 Metadata schema and access filtering

Every chunk should carry metadata sufficient for filtering, ranking, security, and citations:

| Field | Purpose |
|---|---|
| `tenant_id` / `workspace_id` | Enforce organisation-level isolation |
| `document_id` | Stable logical document identity |
| `document_version_id` | Identify the exact uploaded version |
| `chunk_id` | Stable chunk identifier |
| `source_name` / `source_type` | Human-readable source and file type |
| `page_start` / `page_end` | PDF or paginated source location |
| `heading_path` | Section context |
| `content_type` | Objection, product, competitor, pricing, case study, methodology, etc. |
| `product` / `competitor` | Entity tags where applicable |
| `industry` / `persona` | Optional applicability filters |
| `region` / `locale` | Regional or language applicability |
| `approval_status` | Draft, approved, expired, rejected |
| `valid_from` / `valid_until` | Validity window for time-sensitive guidance |
| `sensitivity` | Internal, confidential, restricted |
| `source_checksum` | Detect duplicate uploads and unchanged content |
| `ingested_at` / `embedding_model` | Reproducibility and audit |

All retrieval queries must apply tenant/workspace access filters before content is passed to the LLM. The model must never see chunks the current user is not authorised to access.

Only approved, current material should be eligible for authoritative recommendations. Draft or expired documents may be searchable in an admin preview but must not be presented as approved guidance.

### 5.7 Embeddings and indexing

- Use a Hugging Face Sentence Transformers model as the initial embedding provider, preferably running locally in the Python backend for the first prototype. This keeps embedding generation separate from the Groq reasoning API and avoids requiring a separate paid embedding API for every chunk.
- Treat Hugging Face as the model ecosystem, not as one embedding model. Start evaluation with `BAAI/bge-m3` and `intfloat/multilingual-e5-large-instruct`; consider `nomic-ai/nomic-embed-text-v1.5` as an English-focused comparison candidate. Confirm each model's current license, model-card instructions, supported languages, runtime requirements, and output dimensions before adoption.
- Implement a provider adapter with configurable `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, device, batch size, normalisation, and model-specific query/document formatting. Some models require different prefixes or instructions for queries and passages; do not assume every model uses identical encoding calls.
- Store the exact embedding model ID, revision/version, preprocessing configuration, and vector dimensions on every chunk. A model, revision, dimension, or preprocessing change requires a controlled full re-embedding migration; never compare vectors from incompatible embedding spaces.
- Generate embeddings in batches, with bounded concurrency, retry/backoff for transient failures, and a dead-letter/retry state for persistent failures.
- Keep the embedding interface provider-neutral so we can later compare local Hugging Face inference with a hosted Hugging Face Inference Provider or another embedding API without changing ingestion and retrieval logic.
- Keep pgvector as the vector store for the MVP. Hugging Face generates vectors; it does not replace PostgreSQL/pgvector.
- Create pgvector indexes after measuring the dataset and query patterns. Start with exact vector search for a small corpus; evaluate HNSW or IVFFlat as the corpus grows.
- Add PostgreSQL full-text search for keyword matching, product names, competitor names, error codes, and exact phrases.
- Keep document and chunk records even if embedding generation fails so the ingestion job can resume.

#### Embedding model selection and deployment decision

Do not lock the product to a model based on a generic leaderboard score. Build a repeatable benchmark using the same labelled RAG evaluation set described in Section 5.12:

1. Embed the approved document chunks with each candidate model.
2. Embed the 30–50 representative sales queries using the model's prescribed query format.
3. Measure Recall@12, Precision@5 or nDCG@5, and retrieval quality for exact product names, competitor names, pricing terms, objections, and paraphrased questions.
4. Measure embedding throughput, memory use, CPU/GPU requirements, cold-start time, and end-to-end retrieval latency on the actual development/pilot machine.
5. Compare local inference with hosted inference only if local deployment is too slow or operationally burdensome. Hosted inference sends text to an external service and must pass the product's privacy and customer-data review.
6. Select one model for the pilot, record its exact revision and vector dimensions, and re-embed the corpus whenever that configuration changes.

For the first prototype, `BAAI/bge-m3` is the primary candidate because multilingual support may be useful for an India-first product; `intfloat/multilingual-e5-large-instruct` is the comparison candidate. This is a testable starting hypothesis, not a claim that either model will win on our sales-specific evaluation set.

### 5.8 Real-time retrieval flow

When the objection or signal detector identifies a possible objection:

1. Build a retrieval query from the objection label, the prospect's exact statement, relevant preceding turns, detected competitor/product, and current meeting stage.
2. Apply mandatory tenant, workspace, approval-status, validity, and access-control filters.
3. Run hybrid retrieval: vector similarity plus PostgreSQL full-text/keyword search.
4. Merge and deduplicate candidates by chunk/document.
5. Optionally rerank the top 12 candidates using a reranker or a lightweight relevance model.
6. Select approximately 4–6 chunks for the LLM, subject to a context token budget.
7. Include source title, version, page/heading, approval status, and a stable citation ID with each chunk.
8. Ask the LLM to distinguish approved facts from suggested phrasing and to avoid claims not supported by retrieved evidence.
9. Validate that factual claims in the proposed answer have supporting source IDs. If evidence is weak or missing, return a neutral discovery question or explicitly say that no approved answer was found.
10. Display concise evidence references so the salesperson can inspect the source.

Retrieval must be contextual. The query should include the conversation state, not only the latest objection phrase. For example, “too expensive” after a detailed technical evaluation may need different evidence than “too expensive” before the prospect has explained their requirements.

### 5.9 Recommendation output contract

Use a typed response shape similar to:

```json
{
  "objection_type": "pricing",
  "recommended_move": "clarify_value",
  "suggested_question": "Which capabilities are most important in the comparison?",
  "suggested_response": "We can compare the workflows and outcomes that matter to your team before looking at price alone.",
  "evidence": [
    {
      "chunk_id": "chunk_123",
      "document_id": "doc_456",
      "source_title": "Approved Competitive Positioning",
      "page": 4,
      "heading": "Pricing comparison"
    }
  ],
  "evidence_strength": "supported",
  "needs_human_review": false
}
```

The exact schema should be implemented as Pydantic models. The UI should show the suggested question first when discovery is incomplete, and make evidence expandable rather than overwhelming the salesperson.

### 5.10 Ingestion operations, versioning, and deletion

- Treat each upload as a document version. Never silently overwrite the source of a previously cited recommendation.
- Compute a checksum to identify exact duplicate files.
- Re-uploading a changed file creates a new version and a new ingestion job.
- Mark the previous version superseded only after the new version passes extraction, chunking, embedding, and quality checks.
- Support re-indexing when chunking or embedding configuration changes.
- Deleting a document must delete or invalidate its chunks, embeddings, and derived search entries according to retention policy.
- Record who uploaded, approved, superseded, or deleted a document and when.
- Provide ingestion status: queued, extracting, chunking, embedding, indexed, failed, or needs review.

### 5.11 Ingestion quality checks

Before a document becomes searchable, validate:
- Extracted text is non-empty and plausibly complete.
- Page/heading metadata is present where the format supports it.
- Chunk token counts meet the configured limits, except documented atomic-fact exceptions.
- No chunk crosses tenant or document boundaries.
- No duplicate chunk IDs or orphan embeddings exist.
- Every chunk points to a source version and a location in that source.
- Approval and validity metadata are set.
- A sample of chunks is previewable to the uploader/administrator.
- Retrieval smoke tests can find known phrases and expected topics from the document.

For sales-critical knowledge, require an authorised person to approve the source before it is eligible for live recommendations.

### 5.12 RAG evaluation

Create a small labelled evaluation set before tuning retrieval:
- 30–50 representative objection queries for the first product pilot.
- Expected relevant source documents/chunks for each query.
- Queries for exact competitor names, product features, pricing, security, integrations, and vague objections.
- Negative tests where no approved answer exists.

Track:
- Recall@12 for relevant chunks in the first-pass candidate set.
- Precision@5 or nDCG@5 after reranking.
- Citation correctness and source-version correctness.
- Unsupported-claim rate.
- No-answer behaviour when evidence is absent or expired.
- Retrieval latency and embedding/LLM cost.
- Human rating of whether the retrieved guidance fits the conversation context.

Do not optimise only for semantic similarity. A highly similar but expired, unapproved, or wrong-region sales claim must not be used.

### 5.13 Security and prompt-injection handling for RAG

- Treat uploaded files, extracted text, retrieved chunks, and meeting transcripts as untrusted content, not instructions.
- Retrieved text may provide evidence but cannot override system/developer instructions or access controls.
- Do not execute macros, embedded scripts, links, or instructions found in documents.
- Apply file type and size allowlists, malware scanning where available, and safe parser configuration.
- Enforce tenant/workspace filters in the retrieval service and database layer.
- Avoid sending confidential knowledge to external model providers unless the organisation's configuration and agreements permit it.
- Keep secrets server-side; never expose embedding or LLM API keys in Electron renderer code.

---

## 6. Real-time conversation pipeline

### 6.1 Audio capture

The first technical spike should determine how to capture permitted meeting audio on both Windows and macOS, using platform-specific capture adapters behind one shared interface.

Possible approaches:
- A controlled audio-file or microphone input for the earliest prototype.
- Windows loopback/system audio capture for a local desktop proof of concept.
- macOS system-audio capture using supported macOS APIs/frameworks, subject to the required user permissions.
- A supported meeting-platform integration where available and permitted.
- A future capture abstraction that supports multiple input sources.

Do not assume Electron's desktop capture APIs alone provide every audio-routing behaviour required. Test microphone audio, remote participant audio, device selection, echo, interruptions, and audio permissions.

The application must clearly show when it is listening, paused, disconnected, or stopped. Capture must be user-initiated and comply with meeting consent and applicable requirements.

### 6.2 Transcription

Implement a provider interface:

```python
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

class TranscriptionProvider(ABC):
    @abstractmethod
    async def transcribe_stream(self, audio_stream) -> AsyncIterator[dict]:
        # Yield partial and final transcript events.
        raise NotImplementedError
```

The initial Deepgram adapter should:
- Stream audio in supported chunks.
- Receive partial and final transcripts.
- Include timestamps where available.
- Preserve speaker identifiers when supplied.
- Mark partial transcripts as provisional.
- Handle reconnects and provider errors.
- Avoid treating partial transcript text as a confirmed customer statement.

### 6.3 Transcript event model

Example internal event:

```json
{
  "event_type": "transcript.final",
  "meeting_id": "meeting_123",
  "speaker_id": "speaker_2",
  "text": "We are currently using LambdaTest.",
  "start_ms": 18400,
  "end_ms": 20700,
  "confidence": 0.94,
  "is_final": true
}
```

Use generated IDs in production; this is illustrative.

### 6.4 Conversation state

Maintain a compact structured state rather than sending the entire transcript to the LLM after every utterance.

Proposed state:

```json
{
  "current_vendor": ["LambdaTest"],
  "current_workflow": ["cross-browser testing"],
  "confirmed_pain_points": [],
  "possible_pain_points": [],
  "desired_outcomes": [],
  "objections": [],
  "buying_signals": [],
  "stakeholders": [],
  "budget_status": "unknown",
  "timeline_status": "unknown",
  "decision_process_status": "unknown",
  "discovery_gaps": [],
  "open_questions": [],
  "last_relevant_context": []
}
```

The state manager should:
- Update only fields supported by new evidence.
- Preserve the transcript span or source event behind important facts.
- Distinguish confirmed statements from inferred possibilities.
- Resolve contradictions carefully instead of silently overwriting earlier information.
- Keep the state scoped to the current meeting unless a user explicitly enables an approved longer-term memory feature.

---

## 7. Intelligence and recommendation engine

### 7.1 Processing stages

1. **Transcript normalisation:** Clean and timestamp final transcript segments.
2. **Signal extraction:** Identify competitor mentions, pain points, objections, desired outcomes, buying signals, and discovery information.
3. **State update:** Update the structured conversation state.
4. **Trigger evaluation:** Decide whether the new signal warrants a recommendation.
5. **Evidence retrieval:** Search internal approved knowledge and, in a later phase, permitted external sources.
6. **Recommendation generation:** Ask the LLM for a structured recommendation grounded in the current state and retrieved evidence.
7. **Validation:** Check schema, evidence references, uncertainty, and policy constraints.
8. **Ranking and throttling:** Avoid duplicate, low-value, or distracting prompts.
9. **Delivery:** Send the recommendation to the desktop client.

### 7.2 Recommendation schema

Example:

```json
{
  "recommendation_id": "rec_001",
  "type": "discovery_question",
  "priority": "high",
  "trigger": "competitor_mentioned",
  "suggested_text": "How has your experience been with LambdaTest so far?",
  "rationale": "Understand the prospect's actual experience before positioning an alternative.",
  "objective": "Explore current vendor satisfaction",
  "evidence": [],
  "confidence": 0.91,
  "uncertainty_note": null,
  "created_at": "2026-11-13T12:00:00Z"
}
```

The renderer should not need to interpret free-form LLM output. Validate it against a typed schema before displaying it.

### 7.3 Recommendation types

Initial types:
- `discovery_question`
- `clarifying_question`
- `impact_question`
- `objection_response`
- `competitor_context`
- `product_positioning`
- `discovery_gap`
- `demo_answer`

### 7.4 Trigger and throttling rules

Examples:
- Competitor mention → suggest neutral experience discovery.
- Vague dissatisfaction → suggest clarification.
- Specific pain → suggest frequency/severity/impact exploration.
- Confirmed pain and impact → consider a relevant value proposition.
- Objection → suggest a clarifying response strategy.
- Important discovery gap → surface only when contextually appropriate.
- Demo question → retrieve approved technical/product evidence.

Do not show a new recommendation for every transcript segment. Use a priority threshold, cooldown, duplicate detection, and user feedback.

### 7.5 LLM provider abstraction

Use a provider interface so the product can test models without changing the rest of the pipeline.

```python
from abc import ABC, abstractmethod

class LLMProvider(ABC):
    @abstractmethod
    async def generate_structured(self, *, system_prompt: str,
                                  input_data: dict,
                                  response_schema: dict) -> dict:
        raise NotImplementedError
```

The initial Groq adapter should:
- Use `GROQ_API_KEY` and the base URL `https://api.groq.com/openai/v1`.
- Default to `openai/gpt-oss-120b` for live sales reasoning and recommendation generation.
- Keep the model ID configurable through `GROQ_MODEL`; optionally benchmark `openai/gpt-oss-20b` for lightweight classification or extraction.
- Validate structured-output support and request parameters against the selected model; do not assume every model supports identical features.
- Use structured outputs or schema-constrained responses where supported.
- Apply timeouts and bounded retries.
- Log model, latency, token usage, and validation failures without logging unnecessary sensitive transcript content.
- Keep prompts versioned.
- Use a low-latency model appropriate for short recommendation tasks.
- Never treat retrieved documents or transcript content as executable instructions.

### 7.6 Evidence grounding and retrieval

For internal knowledge:
1. Admin or developer supplies approved documents.
2. Ingestion extracts text and metadata.
3. Text is chunked with source and section metadata.
4. Embeddings are generated.
5. Chunks are stored in PostgreSQL with pgvector.
6. At recommendation time, search retrieves relevant chunks.
7. The LLM receives only relevant evidence and must return source references.

Metadata should include:
- Document title.
- Document type.
- Company/product.
- Competitor, if applicable.
- Source URL or file reference.
- Publication or review date.
- Last verified date.
- Approval status.
- Access scope.

External review retrieval is a later-phase integration. Respect each provider's access rules and terms. Do not scrape restricted sources or represent review themes as universal facts.

---

## 8. Desktop UX implementation

### 8.1 Window types

Use separate Electron windows or clearly isolated window roles for:
- Main Copilot panel.
- Settings.
- Optional compact/minimised control.

Keep the initial design simple. Avoid creating many windows until there is a demonstrated need.

### 8.2 Placement and multi-monitor support

Use Electron display APIs to:
- Enumerate displays.
- Read display bounds and work areas.
- Position the Copilot.
- Detect display changes.
- Restore a saved position.
- Move the window to a fallback display when the saved monitor is unavailable.

Persist:
- Display identifier where available.
- Window x/y coordinates.
- Width and height.
- Last selected placement preset.

Do not rely only on a monitor index because display ordering can change after docking or reconnecting hardware.

### 8.3 Density modes

Persist a user preference:

```typescript
type DisplayDensity = "compact" | "standard" | "expanded";

interface CopilotPreferences {
  density: DisplayDensity;
  alwaysOnTop: boolean;
  preferredDisplayId?: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
```

Behaviour:
- **Compact:** Main suggested question/action and essential status.
- **Standard:** Suggested question, rationale, and a small number of supporting points.
- **Expanded:** Conversation context, evidence, discovery checklist, and supporting insights.

Changing density must not change the underlying AI analysis or evidence quality. It changes only how much information the UI presents.

The user can change density during a meeting. Save the choice as the default for future meetings.

### 8.4 Screen-sharing privacy

Privacy is a product-critical engineering risk.

Implementation approach:
- Private by default.
- Use separate, clearly identified Copilot windows.
- Evaluate Electron/OS content-protection or capture-exclusion facilities on the target Windows versions.
- Test actual Zoom/Meet/Teams capture paths, not just local screenshots.
- Provide a pre-meeting sharing test.
- Detect sharing state only where a reliable supported signal exists.
- Display a clear privacy status.
- Never promise universal invisibility.

A screen-share preview can validate supported workflows but cannot prove privacy against every third-party recorder, OS capture API, remote desktop tool, or full-display capture path.

**Release gate:** Do not market a configuration as screen-share-safe until it has passed documented tests on the exact supported OS, meeting client, and share mode.

### 8.5 Electron security

- Set `contextIsolation: true`.
- Keep `nodeIntegration: false` in renderer windows.
- Use a minimal preload bridge.
- Validate IPC arguments and sender origin.
- Apply a restrictive Content Security Policy.
- Do not put API keys in renderer code or packaged frontend assets.
- Store local credentials using an OS-backed secure storage mechanism.
- Keep dependencies updated and audit packaged dependencies.

---

## 9. Backend API design

Initial REST endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/api/v1/meetings` | Create a meeting session |
| GET | `/api/v1/meetings/{meeting_id}` | Read meeting metadata/state |
| POST | `/api/v1/meetings/{meeting_id}/events` | Submit a transcript or user event |
| GET | `/api/v1/preferences` | Read user preferences |
| PUT | `/api/v1/preferences` | Update density and window preferences |
| POST | `/api/v1/recommendations/{id}/feedback` | Dismiss, accept, or mark covered |
| POST | `/api/v1/knowledge/documents` | Add an approved knowledge document |
| GET | `/api/v1/knowledge/search` | Search configured knowledge |

Initial WebSocket:
- `/ws/meetings/{meeting_id}`

Example server events:
- `transcript.partial`
- `transcript.final`
- `meeting.state.updated`
- `recommendation.created`
- `recommendation.updated`
- `capture.status`
- `system.warning`
- `meeting.summary.ready`

Authentication and authorisation must be added before real customer use. Local development may use a temporary local token, but production must use a secure identity flow and short-lived credentials.

---

## 10. Database design

Use PostgreSQL. Enable pgvector for semantic retrieval.

Proposed initial tables:

### `users`
- `id`
- `email`
- `created_at`

### `user_preferences`
- `user_id`
- `display_density`
- `preferred_display_id`
- `window_bounds_json`
- `privacy_mode`
- `updated_at`

### `meetings`
- `id`
- `user_id`
- `started_at`
- `ended_at`
- `capture_status`
- `meeting_platform`
- `retention_status`

### `transcript_segments`
- `id`
- `meeting_id`
- `speaker_id`
- `text`
- `start_ms`
- `end_ms`
- `confidence`
- `is_final`
- `created_at`

### `conversation_facts`
- `id`
- `meeting_id`
- `fact_type`
- `fact_value_json`
- `confidence`
- `evidence_segment_ids`
- `status` (confirmed, inferred, unresolved)
- `updated_at`

### `recommendations`
- `id`
- `meeting_id`
- `type`
- `priority`
- `suggested_text`
- `rationale`
- `evidence_json`
- `confidence`
- `status`
- `created_at`

### `knowledge_documents`
- `id`
- `title`
- `document_type`
- `source_uri`
- `approval_status`
- `published_at`
- `last_verified_at`
- `access_scope`

### `knowledge_chunks`
- `id`
- `document_id`
- `chunk_text`
- `embedding`
- `metadata_json`

### `recommendation_feedback`
- `id`
- `recommendation_id`
- `user_id`
- `action`
- `created_at`

Do not retain full transcripts by default indefinitely. Define configurable retention, deletion, and export behaviour before a production pilot. Store only what is required for the feature the user has enabled.

---

## 11. Security, privacy, and compliance

This product processes sensitive business conversations. Privacy and security must be designed into the MVP.

### Required controls
- Explicit user action to start, pause, and stop capture.
- Clear capture and transcription indicators.
- Consent guidance appropriate to the meeting platform and applicable jurisdiction.
- Encryption in transit using TLS.
- Encryption at rest for persistent data and backups.
- Role-based access for organisation data in later multi-tenant deployment.
- Strict tenant isolation.
- Secret management outside source code.
- Retention and deletion controls.
- Audit logs for access to sensitive meeting records.
- No use of meeting data for model training without explicit and appropriate authorisation.
- Redaction or minimisation of sensitive data in application logs.
- A documented incident response process before production.

### Data minimisation defaults

For early development:
- Use synthetic or role-played conversations.
- Avoid storing raw audio after transcription unless required for a specific test and consented.
- Retain only necessary transcript and meeting state during the prototype.
- Provide a clear way to delete test meetings.
- Do not ingest confidential customer recordings without authorisation.

---

## 12. Repository structure

Suggested monorepo:

```text
contextual-sales-copilot/
  desktop/
    package.json
    electron-builder.yml
    src/
      main/
      preload/
      renderer/
  backend/
    pyproject.toml
    app/
    migrations/
    tests/
  shared/
    schemas/
      events/
      recommendations/
  docs/
    PRD.md
    implementation.md
    architecture-decisions/
  scripts/
  .env.example
  .gitignore
  README.md
```

Use a monorepo initially to keep desktop/backend contracts aligned. The `shared/schemas` folder can contain JSON Schema or documented event contracts. Do not attempt to share runtime code between Python and TypeScript.

---

## 13. Environment and configuration

Example backend `.env.example`:

```dotenv
APP_ENV=development
APP_HOST=127.0.0.1
APP_PORT=8000

DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/sales_copilot

GROQ_API_KEY=
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MODEL=openai/gpt-oss-120b
# Optional evaluation model for lightweight tasks; not the default
GROQ_FAST_MODEL=openai/gpt-oss-20b

# Embeddings: Hugging Face Sentence Transformers (local inference initially)
EMBEDDING_PROVIDER=huggingface_local
EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_DEVICE=cpu
EMBEDDING_BATCH_SIZE=64
EMBEDDING_NORMALIZE=true
# HF_TOKEN is optional for public models; use only when required by the selected model or hosted inference.
HF_TOKEN=

DEEPGRAM_API_KEY=

LOG_LEVEL=INFO
TRANSCRIPT_RETENTION_DAYS=0
```

Keep `GROQ_API_KEY`, any `HF_TOKEN`, and database credentials only in the backend environment or secret manager. Never place them in Electron renderer code, frontend build-time variables, source control, logs, or packaged client configuration. Public Hugging Face models can often be downloaded without an HF token; do not require one unless the selected model or hosted inference route needs it.

Example desktop configuration:
- Backend base URL.
- Application environment.
- Feature flags for experimental audio capture and privacy controls.
- Default density.
- Development-only debug logging.

Never commit `.env` files, API keys, tokens, or real meeting transcripts to Git.

---

## 14. Development environment

### Recommended tools
- Windows 11 development machine.
- VS Code or Cursor.
- Git and GitHub.
- Python virtual environment.
- Node.js LTS.
- npm.
- PostgreSQL locally or a managed development database.
- API testing through Swagger UI / FastAPI docs and a WebSocket test client.

### Initial setup sequence

1. Create the monorepo and Git repository.
2. Create the Python virtual environment.
3. Install FastAPI, Uvicorn, Pydantic, SQLAlchemy, Alembic, PostgreSQL driver, and test dependencies.
4. Create the React + TypeScript + Vite application.
5. Add Electron main and preload processes.
6. Confirm the desktop app can call the local FastAPI health endpoint.
7. Add WebSocket connectivity.
8. Implement a mock transcript event stream before integrating live audio.
9. Add the transcription provider.
10. Add the intelligence and recommendation pipeline.

Keep dependency versions pinned in lockfiles once the first working environment is established. Use supported stable releases at implementation time rather than assuming version numbers in this planning document.

---

## 15. Implementation phases and deliverables

### Phase 0 — Technical spikes

**Objective:** Resolve the highest-risk unknowns before building the complete product.

Tasks:
- Test Windows microphone and system-audio capture options.
- Test live transcription streaming and partial/final event handling.
- Measure end-to-end transcription latency.
- Test Electron floating-window positioning and multi-monitor recovery.
- Test screen-share capture exclusion on the intended Windows and meeting-client combinations.
- Validate LLM structured output and retrieval quality with sample sales conversations.

Deliverables:
- Audio-capture proof of concept.
- Transcription proof of concept.
- Screen-share privacy test report.
- Architecture decision records for audio capture and privacy.

### Phase 1 — Backend intelligence prototype

**Objective:** Prove that the system can produce useful contextual recommendations.

Tasks:
- Create FastAPI service.
- Define transcript and recommendation schemas.
- Implement mock transcript ingestion.
- Implement conversation state manager.
- Implement competitor, pain, objection, and discovery signal extraction.
- Add small curated knowledge base.
- Add retrieval and evidence-grounded generation.
- Add recommendation ranking and duplicate suppression.

Deliverables:
- Working API.
- Scripted conversation test suite.
- Recommendation evaluation report.

### Phase 2 — Desktop Copilot shell

**Objective:** Build the desktop experience.

Tasks:
- Create Electron shell.
- Create React Copilot UI.
- Connect desktop to FastAPI via WebSocket.
- Implement compact, standard, and expanded density.
- Implement drag, resize, and multi-monitor positioning.
- Persist user preferences.
- Implement private-mode indicators and supported privacy controls.

Deliverables:
- Installable Windows development build.
- UI settings and positioning.
- Screen-share privacy test results.

### Phase 3 — RAG knowledge ingestion and retrieval

**Objective:** Make approved sales knowledge searchable, traceable, and safe to use in live recommendations before connecting real meeting audio.

Tasks:
- Define document, document-version, ingestion-job, and chunk database models.
- Implement PDF, DOCX, HTML, Markdown, and TXT loaders.
- Preserve page, heading, list, and table structure during extraction.
- Implement normalisation and duplicate detection.
- Implement structure-aware chunking using the initial 500-token target, 150-token minimum, 800-token maximum, and 75-token overlap.
- Make chunking settings configurable and versioned.
- Implement metadata enrichment, approval status, validity windows, and tenant/workspace filters.
- Integrate the embedding provider adapter and batch embedding jobs.
- Store vectors in pgvector and add PostgreSQL full-text search.
- Implement hybrid retrieval, candidate deduplication, and optional reranking.
- Add source citations and evidence validation to recommendation outputs.
- Build an ingestion preview/status workflow and retry failed jobs.
- Create a labelled retrieval evaluation set and run relevance/grounding tests.

Deliverables:
- End-to-end document ingestion pipeline.
- Searchable, approved knowledge base with source-level traceability.
- Retrieval API returning ranked chunks and citation metadata.
- Evaluation report covering retrieval quality, unsupported claims, and latency.

**Exit criteria:** A test objection can retrieve the expected approved source passages, cite their document/page/section, and fall back to a neutral discovery question when no reliable evidence exists.

### Phase 4 — Live meeting workflow

**Objective:** Connect real-time audio to recommendations.

Tasks:
- Integrate selected audio capture method.
- Connect streaming transcription.
- Feed transcript events into conversation state.
- Surface recommendations in the Copilot.
- Implement pause, resume, and stop.
- Add demo mode entry/exit and initial demo-aware prompts.

Deliverables:
- End-to-end live prototype.
- Latency and reliability report.
- User test feedback.

### Phase 5 — Pilot hardening

**Objective:** Prepare for a limited, consented pilot.

Tasks:
- Add authentication and secure secret handling.
- Implement retention and deletion controls.
- Improve logging and error reporting.
- Add installer and update strategy.
- Run security and privacy review.
- Test supported OS, display, and meeting configurations.
- Conduct user acceptance testing.

Deliverables:
- Pilot build.
- Supported configuration matrix.
- Privacy and security checklist.
- Pilot evaluation plan.

### Later phases

- External competitor review intelligence.
- Additional meeting platform integrations.
- MEDDPICC/BANT/SPIN configuration.
- Post-meeting summaries.
- Admin knowledge management.
- CRM integrations.
- Team analytics.

---

## 16. Testing strategy

### 16.1 Backend tests
- Loader tests for malformed, scanned, and text-based PDFs; DOCX tables; HTML boilerplate; and UTF-8 text.
- Chunking tests for target/min/max token sizes, overlap, heading preservation, tables, lists, and atomic facts.
- Ingestion retry, checksum, versioning, and deletion tests.
- Embedding batch/retry tests and vector dimension compatibility tests.
- Hybrid retrieval tests for semantic matches, exact product/competitor terms, metadata filters, and tenant isolation.
- Reranking and citation provenance tests.
- No-answer tests for missing, expired, unapproved, and inaccessible knowledge.
- Unit tests for signal extraction and state updates.
- Schema validation tests for all LLM responses.
- Retrieval relevance tests.
- Evidence citation and source metadata tests.
- Duplicate recommendation and cooldown tests.
- WebSocket reconnect and ordering tests.
- Retention and deletion tests.

### 16.2 Desktop tests
- Window positioning on one and multiple displays.
- Display disconnect/reconnect.
- Saved bounds recovery.
- Density switching during a meeting.
- Window resizing and minimised state.
- IPC permission and validation tests.
- Privacy mode and capture-exclusion tests.

### 16.3 End-to-end scenarios
1. Competitor mentioned, prospect satisfied with incumbent.
2. Competitor mentioned, prospect reports a technical issue.
3. Vague objection that needs clarification.
4. Price objection.
5. Prospect says they need internal discussion.
6. Missing budget, decision-maker, or timeline.
7. Prospect asks a technical demo question.
8. User changes density while a recommendation is visible.
9. User moves Copilot to a second monitor.
10. User shares an application window and a full display in each supported configuration.

### 16.4 AI quality evaluation

Use a fixed test set of scripted conversations and evaluate:
- Relevance of next question.
- Whether the system assumes unsupported dissatisfaction.
- Accuracy of extracted facts.
- Correct separation of facts and inferences.
- Evidence quality.
- Recommendation latency.
- Repetition and interruption rate.
- Whether the recommendation advances discovery rather than rushing to pitch.

Human review by experienced salespeople is required. Model confidence alone is not a quality measure.

---

## 17. Observability and operational monitoring

Capture operational metrics such as:
- Audio capture state changes.
- Transcription latency and errors.
- LLM request latency and errors.
- Retrieval latency and no-result rate.
- Recommendation generation and validation failures.
- WebSocket disconnects.
- Desktop renderer crashes.
- User feedback actions.

Avoid logging raw transcript text by default. Use meeting IDs, event IDs, timings, and redacted diagnostic metadata. Any diagnostic transcript capture must be an explicit, controlled development or support action with appropriate consent.

---

## 18. Key technical risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Windows system-audio capture | Capturing both sides of a meeting reliably is not trivial. | Test capture approaches before committing to a platform integration. |
| Screen-share leakage | A private assistant may be captured by full-display sharing or recording tools. | Treat privacy as a tested capability, not a UI toggle; publish a supported matrix. |
| Transcription latency | Slow transcripts make recommendations arrive too late. | Benchmark streaming providers and process finalised segments incrementally. |
| LLM latency and cost | Continuous reasoning can become expensive and slow. | Trigger only on meaningful signals, summarise state, retrieve selectively, and use model tiers appropriately. |
| Hallucinated competitor claims | False claims damage trust and can create legal/reputational risk. | Retrieval grounding, citations, validation, and neutral discovery fallback. |
| Prompt injection in source content | Retrieved documents or meeting speech may contain instructions. | Treat all retrieved and transcribed content as untrusted data; never execute instructions from it. |
| Meeting platform restrictions | APIs and audio access differ across platforms. | Start with one supported environment and add adapters incrementally. |
| Sensitive meeting data | Conversations may contain confidential business or personal information. | Data minimisation, encryption, retention controls, access controls, and consent. |

---

## 19. Initial engineering backlog

### Epic A — Desktop foundation
- [ ] Create Electron + React + TypeScript + Vite monorepo.
- [ ] Create secure preload bridge.
- [ ] Create main Copilot window.
- [ ] Implement drag and resize.
- [ ] Implement display enumeration and monitor movement.
- [ ] Persist window bounds.
- [ ] Implement density selector and persistent preference.

### Epic B — Backend foundation
- [ ] Create FastAPI project.
- [ ] Add health endpoint.
- [ ] Add PostgreSQL connection.
- [ ] Add SQLAlchemy models and Alembic migrations.
- [ ] Add meeting session endpoints.
- [ ] Add WebSocket event stream.
- [ ] Add structured logging and configuration.

### Epic C — Conversation intelligence
- [ ] Define transcript event schema.
- [ ] Implement mock transcript source.
- [ ] Implement conversation state schema.
- [ ] Detect competitor mentions.
- [ ] Detect pain points and objections.
- [ ] Track discovery gaps.
- [ ] Implement recommendation schema and validator.
- [ ] Add recommendation ranking and throttling.
- [ ] Add curated knowledge retrieval.

### Epic D — RAG ingestion and retrieval
- [ ] Define document, version, ingestion-job, and chunk schemas.
- [ ] Implement PDF, DOCX, HTML, Markdown, and TXT loaders.
- [ ] Preserve source page, heading, paragraph, and table structure.
- [ ] Implement text normalisation and duplicate detection.
- [ ] Implement configurable structure-aware chunking (500-token target, 150 minimum, 800 maximum, 75 overlap).
- [ ] Add chunk preview and token-count diagnostics.
- [ ] Add metadata, approval, validity, and tenant/workspace access filters.
- [ ] Implement batched embeddings with retries and resumable jobs.
- [ ] Store vectors in pgvector.
- [ ] Add PostgreSQL full-text search and hybrid retrieval.
- [ ] Add candidate deduplication and reranking.
- [ ] Add source citations and factual-claim evidence validation.
- [ ] Implement document versioning, re-indexing, and deletion.
- [ ] Build a labelled retrieval evaluation set and quality report.

### Epic E — Live audio and AI
- [ ] Complete Windows audio-capture spike.
- [ ] Integrate Deepgram adapter.
- [ ] Establish Windows and macOS builds and CI smoke tests from the first release.
- [ ] Implement Windows and macOS audio-capture adapters behind a shared interface.
- [ ] Validate Zoom, Google Meet, and Microsoft Teams on both operating systems using a documented compatibility matrix.
- [ ] Integrate Groq adapter using GROQ_API_KEY and `openai/gpt-oss-120b`.
- [ ] Integrate the Hugging Face embedding adapter and benchmark candidate models.
- [ ] Stream final transcript segments to FastAPI.
- [ ] Generate contextual recommendations.
- [ ] Measure end-to-end latency.
- [ ] Add error and reconnect handling.

### Epic F — Privacy and pilot readiness
- [ ] Test content protection/capture exclusion.
- [ ] Build sharing preview/test flow.
- [ ] Display capture and privacy status.
- [ ] Add pause and stop controls.
- [ ] Implement retention/deletion controls.
- [ ] Complete supported configuration matrix.
- [ ] Package Windows installer.
- [ ] Conduct consent, security, and privacy review.

---

## 20. Definition of done for the first technical MVP

The first technical MVP is complete when:

1. The desktop application launches on the selected Windows environment.
2. It connects to the FastAPI backend.
3. A mock or supported live audio source produces transcript events.
4. The backend maintains a structured conversation state.
5. A competitor mention can trigger a neutral, contextually relevant discovery question.
6. A prospect response changes the next recommendation.
7. The document ingestion pipeline can load supported files, preserve source structure, and report extraction errors.
8. Chunking follows the configured token limits and retains source page/heading provenance.
9. Only approved, current, authorised knowledge chunks are eligible for live retrieval.
10. Hybrid retrieval returns ranked evidence with source citations, and unsupported claims trigger a safe no-answer/discovery fallback.
11. Recommendations are grounded in a small approved knowledge set when factual claims are made.
12. The Copilot displays recommendations in all three density modes.
13. Users can change density during a meeting.
14. Users can move and resize the Copilot and move it between connected displays.
15. The supported screen-share privacy workflow passes documented tests.
16. The user can pause and stop capture.
17. No API secrets are embedded in the renderer or committed to source control.
18. The system can be tested with synthetic conversations without requiring a real customer meeting.

---

## 21. Recommended first build order

Do not start by building every screen or integrating every platform.

Build in this order:

1. **Mock transcript → AI recommendation:** Prove the intelligence loop using scripted conversations.
2. **Conversation state:** Make recommendations adapt to what the prospect said earlier.
3. **RAG ingestion pipeline:** Load, normalise, chunk, enrich, embed, and index approved sales documents; validate chunk previews and source citations.
4. **Contextual retrieval:** Implement hybrid search, reranking, access filters, evidence validation, and no-answer behaviour.
5. **Desktop shell:** Build the floating Copilot and three density modes.
6. **Window controls:** Add positioning, resizing, and multi-monitor support.
7. **Audio capture spike:** Validate the real Windows audio path.
8. **Live transcription:** Connect the selected streaming provider.
9. **Privacy validation:** Test screen-sharing behaviour before any customer-facing pilot.
10. **Pilot testing:** Evaluate relevance, latency, distraction, and trust with salespeople.

**The first milestone should be a working simulated sales conversation—not a fully integrated Zoom application.**

That allows the product's most important assumption to be tested early: whether contextual recommendations genuinely help a salesperson conduct a better conversation.
