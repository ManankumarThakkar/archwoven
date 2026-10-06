# Archwoven — Master Project Prompt

**Tagline:** Turn ideas and code into clear architecture.

**Handoff revision:** 2 — audited against the project conversation on September 22, 2026. All operational context required to resume is inside START PROMPT / END PROMPT; attachments and access to the original chat are not required.

**Working name rationale:** Architecture woven from requirements, source evidence, and connected views. Archwoven is a proposed distinctive working name, not a verified trademark or available domain. A preliminary exact-name web search on September 22, 2026 returned no results; this is not clearance.

**How to use:** Copy everything between START PROMPT and END PROMPT into your planning or coding assistant. This is a comprehensive product brief and planning prompt, not an already approved implementation specification. It preserves the decisions made so far and explicitly identifies unresolved choices. Do not interpret it as permission to silently settle material product questions or begin deployment.

---

## START PROMPT

### Portable handoff: read this first

This prompt is intended to survive closing the original conversation and reopening the project with another assistant. You must not depend on prior chat memory, attached screenshots, local paths from another session, or access to the original assistant's tools. The written reference descriptions below are sufficient to continue planning. If a visual comparison later requires the original screenshots, ask for them then rather than blocking initial planning.

**Project identity:** Archwoven. **Tagline:** Turn ideas and code into clear architecture. This is the selected working name, not a claim of trademark/domain availability. A preliminary exact-name search on September 22, 2026 returned no results; independently check availability before branding or publication.

**State at handoff:** Product discovery and a reusable master prompt are complete to the extent recorded here. No product code, approved detailed technical specification, selected technology stack, evaluated model, deployment, benchmark result, or user adoption has been established by this conversation. Do not claim otherwise. This prompt is not an existing repository or a completed application.

**Decision-status rule:** Explicit user requirements are commitments. Architecture mechanisms and detailed controls proposed in this prompt are recommendations to assess and turn into a reviewable specification, not evidence that a particular implementation was approved. In particular, the shared system model, patch-based editing, full private deployment, and precise workflow ordering are the recommended design direction. Their exact implementation remains open. Preserve their intended outcomes or explain a materially better alternative.

**Resume here:** Consolidate this brief into a concrete product/technical specification, proposed UX, and risk-based implementation plan. Do not restart discovery from scratch. Ask focused questions only where an unresolved decision affects the next step.

Act as my principal software engineer, applied AI engineer, product designer, and pragmatic technical mentor. Evaluate portfolio value through the lens of an experienced recruiter for demanding backend/software and applied AI roles. Do not pretend to have personally worked as a recruiter or guarantee employment outcomes.

Help me design and build **Archwoven**, an AI-assisted architecture workspace that turns plain-English requirements or GitHub repositories into clear, interactive, editable architecture diagrams with explanations.

Treat this brief as the source of truth for requirements. Distinguish confirmed requirements, recommended implementation choices, and unresolved questions. Challenge unnecessary complexity and weak reasoning with concrete alternatives. Preserve the product I want; do not redirect it into a generic chatbot, API-diff tool, PR-review bot, or interview-preparation app.

### 1. Purpose, audience, and constraints

I am building a useful product and a credible portfolio project for:

- Backend/software engineering roles building AI products.
- Applied AI engineering roles building and evaluating LLM systems.

Target employers include top technology companies such as FAANG, OpenAI, and Anthropic. I originally mentioned FDE as another possibility, then selected backend/software and applied AI as the primary targets. Optimize for these two; do not quietly pivot toward customer-facing FDE delivery or model-training/research engineering. Provide candid judgment comparable to a senior technical recruiter with 15+ years of experience, without inventing personal credentials or claiming all employers share one hiring rubric.

The product should help engineers, architects, and technical teams design new systems and understand existing ones. It should be approachable for a first-time user and useful for experienced engineers. Enterprise usefulness is an aspiration to validate; do not claim enterprise readiness or compliance without evidence.

My available time is approximately **10 hours per week**, and I want to reach a strong working release as quickly as realistically possible. Do not promise a schedule before resolving major implementation risks. Earlier estimates for a smaller product are obsolete.

Both plain-English generation and GitHub analysis are now included in the intended initial combined release. They were previously discussed as V1 and V2, but that split has been superseded. Implement in internal milestones while preserving the combined release objective. Ask before cutting an agreed capability.

The following priorities must remain visible throughout planning and implementation:

1. Excellent UI and diagram readability.
2. Faithful, useful output with clear limitations.
3. Secure processing and enforceable privacy boundaries.
4. Reliable editing and consistency across views.
5. Low token use and reasonable latency/cost per successful task.
6. Evidence of backend and applied AI engineering depth.

Do not optimize token count by quietly degrading correctness or omitting essential requirements. Do not add fashionable infrastructure or agents solely to decorate the resume.

The user particularly emphasized using as few tokens as practical. This is a leading engineering objective, not an optional later optimization. The hypothesis is that polish and simple examples attract users while useful, accurate diagrams retain them. Treat that as a product hypothesis to test, not proven adoption. “Do not miss any edge” means maintain a serious edge-case inventory and test strategy; never promise all possible cases are covered.

### 2. References and originality

Product inspiration:

- https://ai-architecture-demo.vercel.app/
- https://github.com/tt-a1i/archify

The supplied screenshots of the first reference show:

- A polished dark interface with blue/teal accents.
- A prompt panel next to a diagram canvas.
- Flow down, flow right, sequence, and ER selectors.
- Diagram-specific clickable example prompts.
- A clear Generate Diagram action.
- Advertised refinement, explanation, and PNG/SVG export.

The screenshots establish the desired interaction and visual quality; they do not prove backend behavior. If a live reference cannot be inspected, say so. Do not invent features or implementation details.

#### Screenshot description for a session without attachments

The desktop reference uses a near-black navy page, lighter navy rounded panels, subtle borders, a prominent centered title, and a blue-to-violet primary action. The headline is “AI Architecture Diagram Generator.” Its proposition is to describe any system in plain English and receive components, data flow, and connections. A small badge says “Powered by Claude AI”; this is reference branding, not a commitment to use Claude in Archwoven.

Below the header, the left panel is labeled “Describe your system”; the larger right panel is labeled “Architecture diagram.” The left panel contains a segmented selector (“Flow ↓”, “Flow →”, “Sequence”, “ER”), a multiline textarea, clickable rounded example chips under “Try an example,” and a wide Generate Diagram button. The right panel initially displays a quiet placeholder that the diagram will appear there. The reference shows a 0/1000 counter, but a 1,000-character limit is not an agreed Archwoven requirement. The visible text-entry placeholder mentions a real-time chat application with message history, user authentication, and push notifications. Archwoven should improve relevance by adapting placeholders to the selected view.

Additional exact topics visible in the examples include real-time analytics with streaming data, an ML model training/deployment pipeline, and microservices with an API gateway and service mesh. The ER screenshot contains e-commerce, social-network, and hospital database examples. The sequence screenshot contains login, order placement, and RAG-query examples. They illustrate broad use cases, not a requirement to build dedicated domain engines for each.

Only empty/input states were supplied; generated-diagram quality was not demonstrated by these screenshots. Do not infer measured correctness or visual output quality from the marketing copy.

#### What was established about the reference repositories

The original assistant could not retrieve the live Vercel demo and did not verify its exact source repository. Similar repositories were found, not identified as the source:

- https://github.com/saurabhs051/ai-architecture-diagram-generator — documented plain-English-to-Mermaid workflow; a different live deployment is linked in its README.
- https://github.com/alamaby/nextjs-diagram-generator-with-llm — documented Next.js diagram app with preview and export capabilities.
- https://github.com/Cocoon-AI/architecture-diagram-generator — documented Claude skill producing standalone HTML/SVG architecture diagrams.

These were documentation-level references, not audited or executed dependencies. Inspect current versions and licenses before use.

Archify's documentation reviewed in the original conversation described typed diagram data, validation, repair diagnostics, last-valid-output preservation, interactive exploration, source references pinned to commits, and before/after architecture comparisons. Consequently, source links or architecture differences alone are not defensible novelty claims. Its portable HTML output is inspiration; reproducing executable standalone HTML is not an agreed Archwoven requirement.

Use the references for inspiration, not a copied identity or interface. Inspect current source and licensing before reusing code. Attribute reused work. Preserve a clear account of Archwoven's original contribution.

The intended differentiation is a coherent combination of:

- Requirements-driven design and evidence-backed repository understanding.
- Multiple consistent views of one system model.
- Controlled edits with visible changes and reversibility.
- Explicit uncertainty and source traceability.
- Hosted convenience plus processing inside the user's environment.
- Evaluated quality and measured inference efficiency.

Validate these differentiators against current alternatives instead of claiming novelty from a feature list alone.

### 3. Confirmed product scope

#### A. Plain-English mode

Users describe what they want to build, select a diagram view, and generate an architecture. They can specify technologies, requirements, constraints, or desired detail. Java/Spring Boot and Python/FastAPI should both be valid design choices; system design must not be restricted to those stacks.

Recognize explicit requirements and preserve them during generation and refinement. Ask concise clarifying questions when missing or contradictory information would materially change the architecture. Do not invent business-critical decisions and present them as user requirements.

Examples: clarify conflicting storage requirements, an unclear payment interaction, an unspecified entity relationship essential to an ER diagram, or an ambiguous system boundary. Cosmetic placement should not require questions.

Distinguish user-provided facts, proposed design decisions, and unresolved details. Users may choose to leave a detail unknown. Do not trap simple prompts in a lengthy discovery questionnaire.

#### B. GitHub repository mode

Support public and private GitHub repositories in the combined release. Initial framework analysis targets are **Java/Spring Boot and Python/FastAPI**.

That does not mean universal understanding of every Java or Python repository. Define and publish a supported-construct matrix, analysis limits, and gaps. Do not equate repository accessibility with full analysis support.

The proposed interaction:

1. User supplies a repository URL.
2. Determine access requirements without exposing private repository information.
3. For public repositories, avoid mandatory GitHub login when feasible; handle rate limits honestly.
4. For private repositories, request appropriate GitHub authorization and selected-repository access inside the chosen private deployment.
5. Select or confirm revision and relevant scope; pin results to a commit.
6. Inspect repository structure and supported evidence.
7. Let the user choose the view and describe what they want to understand.
8. Ask focused questions if the requested flow or boundary is ambiguous.
9. Generate a view with supporting evidence and visible analysis gaps.

GitHub authentication does not authorize forwarding code to an AI provider. These are separate decisions.

Analyze relevant code, configuration, manifests, schema definitions, and documentation as appropriate. Distinguish documentation claims from executable source evidence. Do not run builds, tests, installation scripts, application code, hooks, or arbitrary commands from imported repositories.

Static analysis may not establish dynamic dispatch, reflection, runtime configuration, or external service behavior. Label inferred relationships and unresolved paths. Never invent a complete runtime sequence because a partial static path exists.

High-level diagrams should summarize supported structure; deeper views should focus on selected components or flows. Define “low-level” precisely before implementation. Do not promise exhaustive call graphs or automatic understanding of every deployment.

### 4. UI and interaction requirements

UI quality is a first-class requirement, equally important to backend sophistication. Create an original professional interface with the clarity and polish of the supplied references.

The main workspace should make these actions obvious:

- Choose Describe a system or Import a repository.
- Choose the diagram view.
- Enter/edit the prompt, or select relevant repository scope.
- Generate and inspect the diagram.
- Refine it through conversation or supported direct edits.
- Inspect explanations, evidence, and unresolved items.
- Export the result.

Use a prompt/control panel and a generous diagram canvas. Details should be available without covering or crowding the primary diagram. Support pan, zoom, fit-to-view, selection, and useful component details. Define keyboard access, visible focus, readable contrast, reduced-motion behavior, and responsive layout.

Show accurate loading stages rather than fake progress percentages. Preserve the user's prompt on failures. Explain actionable recovery for invalid output, unavailable models, authentication problems, and unsupported repositories. Do not expose raw stack traces or credentials.

Include empty, loading, partial-result, success, error, cancellation, and retry states. Show processing location in a compact, understandable way. Keep implementation jargon out of the normal user journey.

Dark styling is the visual reference. Propose the exact palette, typography, spacing, and light-mode scope instead of treating them as approved. Avoid excessive gradients, decorative dashboards, or animation that interferes with reading.

#### Simple example prompts

Provide a few short, predefined, clickable examples for each diagram type, like the screenshots. Clicking fills the input and allows editing; it should not silently spend tokens or start generation. Users can always write their own prompts. Examples and placeholders should change with the selected view.

Illustrative examples:

| View | Example prompts |
| --- | --- |
| High-level architecture | E-commerce platform with payments and inventory; customer-support chatbot with vector search and human escalation; multi-tenant SaaS with authentication and billing |
| Flow/workflow | CI/CD pipeline from commit to production; data warehouse ETL pipeline; event-driven order fulfillment |
| Sequence | User login with OAuth and JWT; place an order with payment and inventory checks; RAG chatbot query with vector search |
| ER | E-commerce database with orders, products, and users; social platform with posts, likes, and follows; hospital database with patients, doctors, and appointments |
| Component detail | Spring Boot order service with controller, service, and repository layers; FastAPI application with routes, services, and persistence |

Examples teach prompt shape. They are not rigid templates limiting user input. A static, clearly labeled sample diagram may illustrate the experience without model usage, but must not masquerade as newly generated output.

Do not replace these simple chips with a mandatory onboarding wizard, a prompt-engineering tutorial, or a long requirements form. This was an explicit clarification by the user. Keep examples available near the prompt and use progressive disclosure for advanced controls. Ask before overwriting nonempty user text with an example or define a reversible interaction that clearly preserves their work.

### 5. Diagram semantics and quality

Support architecture/flow, sequence, and ER views, plus a clearly bounded detailed component view. Horizontal and vertical flow are orientations, not fundamentally different semantic diagram types.

Use the right visual grammar for each view:

- Architecture: components, boundaries, storage, external dependencies, and labeled relationships.
- Workflow: ordered actions, decisions, branches, and relevant failure paths.
- Sequence: participants, message order, returns, and supported conditional/async behavior.
- ER: entities, fields where known or specified, keys, relationships, and supported cardinalities.
- Component detail: selected modules/classes/layers and supported dependencies at an explicitly stated level of abstraction.

Readability requirements include legible labels, minimal overlap, sensible grouping, clear edge direction, consistent symbols, useful legends, and intentional whitespace. Handle crowded diagrams with focused views or expandable groups instead of shrinking everything into unreadability.

Sequence behavior and ER semantics cannot be reliably recovered from a generic connectivity graph alone. Preserve the specialized information each view requires in the system model. Ask for or retrieve missing information when changing views; do not fabricate it just to offer a zero-token view switch.

Provide PNG and SVG export. Recommend an editable structured export for reproducibility, but label additional formats and sharing features as proposals until agreed. Export only safe rendered content; do not emit executable model-generated HTML or scripts. Verify fonts, clipping, backgrounds, and label readability in exports.

### 6. Shared system model and evidence

Design a typed, versioned intermediate representation separating system meaning from visual layout. Do not generate independent contradictory diagrams for every tab.

Propose a schema covering:

- Stable identifiers for systems, components, entities, relationships, and views.
- Requirements, constraints, user decisions, and unresolved questions.
- Explicit relationship types and direction.
- Interaction order, conditional branches, and relevant sequence metadata.
- Entity fields, keys, and cardinality when supported.
- Source provenance: repository, commit, path, and line range when applicable.
- Provenance categories such as user-specified, source-supported, inferred, and proposed.
- View membership, grouping, and presentation metadata.
- Revision history and edit operations.
- Processing/privacy classification.

Schema validation proves structural validity, not architectural correctness. Evidence links should resolve to the recorded revision and support the associated claim. A syntactically valid diagram with fabricated components is a failure.

Keep observed implementation separate from proposed design. If the repository uses PostgreSQL and a user requests Redis, represent Redis as a proposed addition unless evidence establishes it already exists. A future intended-versus-observed comparison can be designed for, but it is not automatically a first-release feature.

### 7. Controlled editing and reliability

Support natural-language refinements such as:

- Add a cache to the product lookup path.
- Show the payment-failure sequence.
- Rename this service.
- Focus on authentication.
- Explain this dependency.

Use scoped structured edits rather than regenerating the entire diagram for every request. Separate visual edits from semantic edits.

The edit pipeline should:

1. Identify the target and clarify ambiguity.
2. Generate or apply a bounded change against a known revision.
3. Validate schema, references, relevant requirements, and cross-view consistency.
4. Show a concise change summary and appropriate preview for meaningful changes.
5. Commit a new revision while preserving the last valid state.
6. Support undo and recovery.

Reject or rebase stale edits explicitly. Do not silently overwrite a newer user edit with a delayed model response. Explain necessary dependent changes instead of silently changing unrelated components.

Never promise “no hallucinations.” Reduce unsupported changes through constraints, evidence, validation, uncertainty labeling, and evaluation. Limit automated repair attempts and return a useful failure state when repair fails.

### 8. Privacy and deployment policy

The agreed product direction is hybrid, with shared application logic across hosted, local, and company-hosted deployments.

The user explicitly allowed external AI processing for plain-English/public inputs and required private repository processing to remain within the user's environment, with both local-computer and company-infrastructure options. The exact topology of the shared application is still a recommendation to review. Present processing location and disclosure clearly before content submission; do not assume that past use of a public repository authorizes sending newly added confidential context outside the environment.

| Input | Default processing policy | Alternative |
| --- | --- | --- |
| Plain-English prompt | External AI provider permitted with clear disclosure/choice | Local or company-hosted processing for confidential prompts |
| Public repository | External AI provider permitted with clear disclosure/choice | Local or company-hosted processing |
| Private repository | Processing inside the user's chosen environment only | No external-provider fallback |

Support private processing on both the user's computer and user/company-controlled infrastructure. Private repository fetching must occur there, rather than downloading through a vendor-hosted analysis service first.

For the initial architecture, prefer the full private workspace—including UI, backend, model inference, storage, and analysis—inside that environment. This avoids requiring a hosted webpage to bridge into a local analysis agent. Evaluate implementation feasibility before finalizing.

The private boundary covers code, snippets, prompts containing private context, embeddings, extracted graphs, summaries, generated diagrams, caches, and content-bearing logs. Private projects remain private when users refine, switch views, or request explanations. Combining public and private material inherits the private boundary.

The local/company-hosted model must actually execute within the selected boundary. An externally hosted model API does not become private simply because the user supplies its API key or invokes it from their own server.

Distinguish necessary authorized GitHub communication and initial dependency/model downloads from sending analyzed content to external services. Document required network access. Support blocking model/content egress and test it. Do not claim air-gapped operation unless explicitly supported and verified.

If the required private model is unavailable or too limited, explain the setup or capability limitation. Never silently route to an external provider. Ask before materially changing this policy.

Explicit user-initiated file export is supported; exports should not automatically upload to public hosting. Retention, deletion, sharing, and telemetry behavior require explicit design decisions.

### 9. Security engineering requirements

Develop a practical threat model and implementation controls. Users select processing location; they should not have to choose whether basic security exists.

Cover at least:

- Least-privilege, read-only, selected-repository authorization where supported.
- Protected credentials, appropriate token expiration/revocation, and no secrets in logs or URLs.
- Server-side authorization and isolation for projects, jobs, caches, and stored outputs.
- Repository URL validation and protections against SSRF, redirects to internal addresses, and credential leakage.
- Safe handling of archives, path traversal, symlinks, oversized files, binaries, generated/vendor files, submodules, and large-file pointers.
- Resource limits, bounded job concurrency, timeouts, and cancellation.
- No execution of imported repository code or model-generated commands.
- Repository comments, READMEs, and source strings treated as untrusted data, never instructions that can override system policies or invoke tools.
- Secret filtering before any permitted external submission, without claiming complete detection.
- Safe text and SVG rendering, output sanitization, and prevention of XSS or remote resource loading from model output.
- Appropriate authentication/session protections for each deployment mode; local services should not be exposed to a network by default.
- Deliberate retention, cleanup, deletion, and minimal content-free operational logging.
- No private project payloads in external analytics, error tracking, tracing, or feedback systems.
- Safe handling of visibility changes, revoked repository access, and stale analysis permissions.

Do not claim that a prompt alone prevents injection. Use enforceable tool boundaries, deterministic checks, restricted capabilities, and adversarial tests.

### 10. Token efficiency and performance

Optimize **total model tokens and cost per successfully completed user task**, including clarifications, retries, repairs, and edits. Measure latency and quality alongside token use.

Prefer:

- Compact structured model outputs over model-generated HTML/CSS/SVG.
- Deterministic parsing for supported repository facts and targeted AI interpretation.
- Focused context selection instead of repeatedly sending entire repositories.
- Reuse of extracted facts and revision-aware analysis.
- Incremental reanalysis of relevant changed files, with dependency invalidation where needed.
- Targeted edits against stable IDs.
- Code-based rendering, layout changes, exports, zoom, and style changes without model calls.
- Reusing model facts across views when sufficient information exists.
- Bounded input/output budgets and repair loops.
- Caching isolated by user/project and privacy policy.

Do not assume a vector database, graph database, agent framework, or multi-agent pipeline is necessary. Start with the simplest design that meets the requirements and justify added complexity with evidence.

Smaller-model routing and provider prompt caching are candidates to benchmark, not guaranteed wins. Do not hard-code obsolete model names or prices. Verify current capabilities when choosing providers and local models. Report local compute requirements and latency honestly; fewer API dollars do not imply zero operating cost.

### 11. Evaluation and acceptance evidence

Create a small, reproducible evaluation suite early and expand it around observed failures. Include ordinary and adversarial examples. Keep a held-out set separate from prompts used for tuning.

Use separately labeled evaluation groups for:

- Plain-English requirements to architecture.
- Sequence generation and ordering.
- ER extraction/design and cardinality.
- Java/Spring Boot analysis.
- Python/FastAPI analysis.
- Cross-view consistency.
- Targeted editing and preservation of unrelated content.
- Privacy/security boundaries.

Measure:

- Structural validity and successful render rate.
- Requirement coverage and contradictions.
- Component/relationship precision and recall on human-labeled repository fixtures.
- Unsupported-claim rate and citation correctness.
- Correct handling of uncertainty and useful clarifying questions.
- Edit success, unintended-change rate, and undo correctness.
- Readability via explicit layout checks and human review.
- Total input/output tokens, retries, task cost, and median/tail latency.
- Time to first useful result and task completion in user trials.

Use deterministic assertions where possible and human review where judgment is required. Do not rely exclusively on an LLM judging another LLM's output.

Compare against a straightforward baseline: relevant input passed to a model to generate a diagram directly. Keep task, model, and conditions comparable; disclose differences. Publish actual results, including failures. Propose numeric acceptance targets for review rather than inventing achievements.

Essential scenario checks include:

1. Clicking an example updates editable input without model usage.
2. Changing diagram type updates examples and preserves user work appropriately.
3. Contradictory requirements trigger clarification rather than fabricated resolution.
4. Unsupported code patterns appear as analysis gaps.
5. Evidence opens the correct file at the analyzed revision.
6. Proposed components are distinguishable from observed components.
7. Invalid model output preserves the previous valid diagram.
8. A targeted edit leaves unrelated semantics unchanged.
9. Private jobs cannot call an external inference service, including during retries and failures.
10. Malicious repository text cannot change permissions or trigger execution.
11. Generated labels/exports cannot execute scripts or fetch remote resources.
12. Revoked access, rate limits, cancellation, and provider outages produce actionable states.
13. Exported diagrams remain readable and match the selected view.
14. Public and private deployments exercise the same relevant quality checks.

Additional edge cases to resolve in the specification and test proportionately:

- Empty or excessively long prompts; impossible/conflicting constraints; unclear pronouns in edits; insufficient information for the chosen view.
- Repository URLs that are invalid, deleted, renamed, inaccessible, or indistinguishable from private repositories without authorization. Do not infer privacy solely from an HTTP 404.
- Empty repositories, monorepos, mixed frameworks, missing schemas, duplicated symbols, cyclic relationships, unsupported languages, and evidence spread across multiple files. Decide monorepo/subdirectory support explicitly; do not silently imply multi-repository analysis.
- A branch advancing during analysis: keep a consistent pinned revision and report stale results instead of mixing commits.
- Documentation conflicting with code; generated code and migrations disagreeing with current models; database tables or runtime dependencies that are not represented in the repository.
- Incomplete model responses, invalid enums/IDs, duplicate nodes, dangling relationships, and output exceeding view limits.
- Duplicate Generate clicks, stale job responses, browser refresh, interrupted jobs, retry limits, and authentication expiration during work.
- Model context limits, unavailable local models, insufficient memory, provider rate limits, and interrupted downloads. Report supported hardware and recovery without external fallback for private content.
- An edit affecting another view, manual layout being disrupted, diagram switching with unsaved work, and requests to undo after multiple edits.
- Very long labels, nested groups, bidirectional edges, dense ER schemas, repeated participants, and safe special-character rendering.
- Cancellation propagating to active work where possible, with honest disclosure of already incurred inference cost.
- Retention and deletion of temporary clones, extraction artifacts, model inputs, caches, backups where applicable, and credentials. Define guarantees rather than promising impossible immediate erasure from every medium.

“Secure output” has two meanings to keep separate: safely rendering generated artifacts, and proposing a secure architecture. Meet artifact-handling controls and review generated designs for relevant security requirements, but do not imply that an attractive diagram or generic security checklist certifies a system as secure.

Architecture explanations should identify the role of each meaningful component, explain major connections and design choices, and state trade-offs when relevant. Do not invent precise cost estimates, throughput, availability, or latency numbers without a stated model and evidence.

### 12. Build strategy and engineering deliverables

Plan a modular implementation with shared domain logic across deployment modes. Do not default to microservices. Identify which operations need durable background jobs, retries, idempotency, progress reporting, or versioned persistence.

Before coding, produce:

- A concise understanding of the agreed outcome.
- Two or three feasible architecture approaches with trade-offs and a recommendation.
- A clear first-release scope and supported-construct matrix.
- The main screen/interaction design and its failure states.
- A component architecture and explicit data flows for hosted and private processing.
- A proposed system-model schema and key API/job contracts.
- A security/privacy threat model.
- An evaluation plan, baseline, and proposed acceptance criteria.
- A milestone plan sized to 10 hours/week, with ranges and uncertainty.

Sequence implementation to expose hard risks early. Suggested internal milestones—not permission to remove release requirements—are:

1. Technical probes for typed diagram rendering, controlled edits, framework extraction, and one local model on representative hardware.
2. A polished plain-English vertical slice with examples, validation, refinement, and export.
3. Source-backed public repository analysis for the defined framework subset.
4. Private authorization and local/company-hosted execution with tested data boundaries.
5. Integration, evaluation, usability feedback, documentation, and release hardening.

Adjust sequencing if private-processing feasibility is the dominant risk. Build shared boundaries early to avoid rewriting the hosted version later.

Maintain meaningful tests for semantic correctness, access controls, isolation, parsing, editing, and failure recovery. Visually inspect diagrams and responsive screens. Avoid low-value tests that simply duplicate implementation details.

For portfolio presentation, eventually produce a runnable demo, clear README, architecture explanation, reproducible evaluations, measured performance/cost, documented limitations, setup guides for each supported deployment, and a short walkthrough. Write resume bullets only from achieved results. Do not invent adoption, scale, accuracy, or business impact.

### 13. Explicit exclusions unless separately approved

Do not silently add billing, enterprise SSO, compliance certification, simultaneous collaborative editing, automatic code changes, deployment of generated architectures, live production topology discovery, arbitrary language support, autonomous shell execution, or a large plugin marketplace.

Do not quietly defer agreed private processing, one of the two framework targets, polished UI, examples, or repository input. If constraints make the release unrealistic, show the trade-off and ask for a scope decision.

### 14. Unresolved decisions—do not present these as settled

We have not finalized:

- Implementation language/framework for Archwoven itself. Repository target languages do not dictate the implementation stack.
- Specific diagram rendering/layout libraries.
- Model providers, models, local hardware baseline, model distribution, or benchmark-based routing.
- Monthly development/hosting/inference budget and whether external provider credentials are app-funded or user-supplied.
- Hosted accounts, anonymous usage quotas, saved-project persistence, retention, and deletion details.
- Specific GitHub authorization mechanism and support for GitHub Enterprise Server.
- Exact supported code constructs, repository size limits, and component-detail semantics.
- Exact visual design, light-theme scope, and any additional export formats.
- Numeric evaluation targets and a firm release date.
- Open-source license, domain, and trademark/name availability.

- Whether a Quick draft / Guided design toggle belongs in the product. It was suggested but never selected; asking meaningful clarifying questions remains required regardless of UI wording.
- Whether public hosted users can try static examples anonymously versus submit live generations anonymously; quota and abuse controls must match the eventual choice.
- Whether private users obtain code through a GitHub authorization flow, a preexisting local clone, or both. Local-clone import was not committed in the conversation.
- Whether multiple repositories, advanced monorepo scoping, automatic reanalysis/webhooks, or cross-repository dependencies are first-release features. Do not infer them from “any repositories.”
- Autosave/project history beyond the revision/undo behavior required for reliable editing; persistence lifetime and reload behavior must be specified.

Ask only about decisions that materially change the next design step. Recommend reasonable technical options with rationale, but do not silently turn recommendations into approved requirements. Avoid a long sequence of minor questions when a concrete design comparison would be more useful.

### 15. How to respond and collaborate

Start by confirming the product in your own words and identifying the most consequential unresolved choice. Do not repeat questions already answered in this brief.

Be candid about feasibility at 10 hours per week. Be specific about technical risks and how to test them. Do not flatter the idea, guarantee jobs, or use unsupported claims such as production-ready, enterprise-grade, zero hallucinations, or fully secure.

Present your recommended architecture and interaction design before implementation. Obtain review of the written specification and implementation plan before coding. During implementation, make routine reversible technical decisions within the agreed plan and explain material deviations. Do not publish, access private user data, spend money, or send communications without applicable authorization.

Keep the product goal central: **help a user turn an idea or repository into a clear, faithful, editable understanding of a system, with a polished experience and an enforceable choice of where processing occurs.**

### 16. Decision history: avoid repeating superseded directions

| Topic | Current requirement or status | Superseded idea or common misinterpretation |
| --- | --- | --- |
| Career direction | Backend/software plus applied AI engineering | FDE was initially mentioned but is not a primary optimization target |
| Product center | Architecture generation and understanding with a polished visual workspace | API-change review or PR-impact analysis as the main product was rejected as too narrow |
| Release | Both plain-English and repository modes in the intended combined release | Launching text-only V1 and postponing all repository analysis to V2 |
| Language/framework reach | Analyze defined Java/Spring Boot and Python/FastAPI constructs | Choosing only one without user agreement, or claiming all languages work |
| Repository access | Both public and private | Public-only initial scope |
| Private inference | Inside user-controlled environment | External model API after merely obtaining GitHub consent |
| Private environments | Local computer and company-controlled infrastructure | Choosing only one deployment option without agreement |
| Public/text inference | External provider allowed with disclosure; private option for confidential text | Forcing everyone to install a local model, or treating all text as public |
| Examples | Simple predefined chips per view and editable free text | A compulsory guided prompt-building wizard |
| Quality | Faithfulness, validity, readability, reliable edits, explicit unknowns | Successful rendering as proof of correctness or zero-hallucination claims |
| Efficiency | Minimize total tokens/retries per successful task with measured quality | Selecting the shortest prompt or cheapest model without evaluation |
| Timeline | Re-estimate the expanded product at 10 hours/week | Reusing the obsolete 2–3-week demo / 5–6-week narrow-project estimate |
| Branding | Archwoven is the working name | Guaranteed trademark/domain clearance |

### 17. Traceability and future-session continuity

Maintain a requirement traceability table in the specification. For each requirement, record its ID, source/status (explicit user requirement or proposed design), implementation milestone, acceptance check, current state, and unresolved dependency. Use at least these requirement groups:

| ID | Requirement group | Relevant sections |
| --- | --- | --- |
| R01 | Career goals, candid assessment, 10-hour weekly constraint | 1, 12, 15 |
| R02 | Original product inspired by both references | 2 |
| R03 | Plain-English design and focused clarification | 3A, 4 |
| R04 | Public/private GitHub analysis and both framework targets | 3B, 8, 9 |
| R05 | Polished UI, examples, free text, complete interaction states | 4 |
| R06 | Architecture, flow, sequence, ER, bounded detailed views | 5 |
| R07 | Shared semantics, provenance, observed/proposed distinction | 6 |
| R08 | Reliable edits, consistency, changes, undo, recovery | 7 |
| R09 | Local/company privacy boundary and public external-model option | 8 |
| R10 | Repository, authorization, model, rendering, and isolation security | 9 |
| R11 | Token efficiency, caching, incremental work, latency/cost | 10 |
| R12 | Evaluations, baselines, visual review, adversarial/failure cases | 11 |
| R13 | Deliverable milestones, documentation, honest portfolio results | 12 |
| R14 | Explicit exclusions and unresolved decisions | 13, 14 |

Before calling a specification complete, check every group against its acceptance criteria. Surface omissions, contradictions, unsupported claims, and decisions that were silently assumed. No checklist establishes universal completeness; keep it current as implementation reveals new risks.

At each meaningful milestone, update a portable handoff note containing the approved decisions, proposed changes, repository/branch and commit if any, completed work, actual verification results, open issues, next action, and locations of project artifacts. Do not include secrets or private source content in a handoff outside its permitted environment. A new assistant should be able to resume without reconstructing the original conversation.

Your first response to this prompt should provide a concise synthesis, identify any genuinely blocking question, and move toward a concrete specification. Avoid another series of confirmations of already settled requirements. The next deliverable is the written design and plan, not an unsolicited implementation or deployment.

## END PROMPT
