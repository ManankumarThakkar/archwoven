import { CreatorLinks, SocialIcon } from './components/CreatorLinks';
import { site } from './lib/site';
import { landingMetadata, structuredData } from './lib/seo';
import './landing.css';

const diagramTypes = [
  ['Architecture', 'See the components, services and data stores that make a system work.'],
  ['Sequence', 'Follow a request through the participants, one interaction at a time.'],
  ['ER / data model', 'Understand entities, fields and the relationships between them.'],
  ['Component detail', 'Explore a component and the responsibilities inside it.'],
];

export function generateMetadata() { return landingMetadata(); }

export default function Home() {
  const schema = structuredData();
  return (
    <div className="aw-landing">
      {schema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, '\\u003c') }} />}
      <a className="lp-skip" href="#main">Skip to content</a>
      <header className="lp-header">
        <a className="aw-brand" href="/" aria-label="Archwoven home"><span className="aw-brand-mark" aria-hidden="true">⌘</span>Arch<span>woven</span></a>
        <nav className="lp-navigation" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href={site.repository} target="_blank" rel="noopener noreferrer"><SocialIcon name="github" /><span>GitHub<span className="lp-sr-only"> (opens in a new tab)</span></span></a>
          <a className="lp-button lp-small-button" href="/workspace">Open workspace <span aria-hidden="true">↗</span></a>
        </nav>
      </header>
      <main id="main">
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow"><span aria-hidden="true" /> ARCHITECTURE, CONNECTED.</p>
            <h1 id="hero-title">Your system.<br /><span>A clearer picture.</span></h1>
            <p className="lp-lead">Turn descriptions and GitHub repositories into architecture diagrams you can explore, refine and share.</p>
            <div className="lp-actions"><a className="lp-button" href="/workspace">Open workspace <span aria-hidden="true">↗</span></a><a className="lp-text-link" href="#example">See an example <span aria-hidden="true">↓</span></a></div>
            <p className="lp-hero-note">Free to explore. No account needed.<br />New AI requests are subject to shared usage limits.</p>
            <div className="lp-hero-creator"><CreatorLinks /></div>
          </div>
          <figure id="example" className="lp-preview">
            <div className="lp-preview-heading"><span><span className="lp-status-dot" aria-hidden="true" /> FROM AN IDEA TO A SYSTEM</span><span>01 / Architecture</span></div>
            <div className="lp-example-prompt"><span className="lp-eyebrow">THE DESCRIPTION</span><p>“A catalog app: customers call an API gateway; a catalog service serves items from PostgreSQL.”</p></div>
            <div className="lp-preview-image"><img src="/examples/catalog-architecture.svg" width="781" height="466" fetchPriority="high" alt="Catalog architecture: Customer calls API Gateway, which calls Catalog Service, which queries Catalog DB in PostgreSQL. Each component is marked described." /></div>
            <figcaption><span>Recorded example · arranged for this preview</span><a href="/examples/catalog-architecture.svg" target="_blank" rel="noopener noreferrer">View SVG <span aria-hidden="true">↗</span><span className="lp-sr-only"> (opens in a new tab)</span></a></figcaption>
          </figure>
        </section>
        <div className="lp-capabilities" aria-label="Workspace capabilities"><span>4 diagram types</span><span>Commit-pinned source evidence</span><span>SVG, PNG &amp; JSON exports</span><span>Local / private mode</span></div>
        <section id="how-it-works" className="lp-section" aria-labelledby="how-title">
          <div className="lp-section-heading"><p className="lp-eyebrow">A SHORTER PATH TO UNDERSTANDING</p><h2 id="how-title">Start with what you have.</h2><p>An idea in plain English. A public repository. A system you want to explain.</p></div>
          <ol className="lp-steps">
            <li><span className="lp-step-number">01</span><h3>Describe or import</h3><p>Describe your components and connections, or point to a public GitHub repository. Repository analysis reads source without running its code.</p></li>
            <li><span className="lp-step-number">02</span><h3>Follow the connections</h3><p>Find a component, inspect a relationship or trace a path through the diagram. See what came from your description, source code or an inference.</p></li>
            <li><span className="lp-step-number">03</span><h3>Make it yours</h3><p>Refine the diagram in words. Download an SVG, PNG or JSON file for a design discussion, project handoff or README.</p></li>
          </ol>
        </section>
        <section className="lp-section lp-views-section" aria-labelledby="views-title">
          <div className="lp-section-heading"><p className="lp-eyebrow">ONE SYSTEM. DIFFERENT PERSPECTIVES.</p><h2 id="views-title">The view that fits the question.</h2></div>
          <div className="lp-views">{diagramTypes.map(([title, description], index) => <article key={title}><span className="lp-view-number" aria-hidden="true">0{index + 1}</span><h3>{title}</h3><p>{description}</p></article>)}</div>
        </section>
        <section className="lp-section lp-engineering" aria-labelledby="engineering-title">
          <div className="lp-section-heading"><p className="lp-eyebrow">BUILT TO BE QUESTIONED</p><h2 id="engineering-title">A diagram with reasons<br />behind its connections.</h2><p>Architecture diagrams are useful when you can inspect their assumptions. Archwoven makes those assumptions visible.</p><a className="lp-text-link" href={site.repository} target="_blank" rel="noopener noreferrer">Explore the code and measured results <span aria-hidden="true">↗</span><span className="lp-sr-only"> (opens in a new tab)</span></a></div>
          <dl className="lp-proof-list">
            <div><dt>Evidence, where it exists</dt><dd>Source-supported claims cite files and lines at the analysed commit. Spring Boot and FastAPI have framework extractors; other repositories receive a bounded module and import map.</dd></div>
            <div><dt>Structure before pixels</dt><dd>The model returns structured data. Schema and graph checks validate it before deterministic code renders the diagram. Validation does not prove that every architectural claim is correct.</dd></div>
            <div><dt>Unknowns stay visible</dt><dd>Described, source-supported, inferred and proposed connections are distinguished. Coverage limits and unanswered questions travel with the diagram.</dd></div>
            <div><dt>Choose where processing happens</dt><dd>Hosted generation uses an external AI provider. The local deployment uses Ollama, keeps data on your machine and enforces its outbound network boundary.</dd></div>
          </dl>
        </section>
        <section className="lp-section lp-faq" aria-labelledby="faq-title">
          <div className="lp-section-heading"><p className="lp-eyebrow">BEFORE YOU START</p><h2 id="faq-title">A few useful answers.</h2></div>
          <div>
            <details><summary>Can I generate a diagram from any GitHub repository?</summary><p>You can submit public GitHub repositories within the import limits. Spring Boot and FastAPI get framework-aware extraction. Other repositories get a bounded map of source modules and imports, with gaps disclosed. Private repositories can be analysed from a local clone using the local deployment.</p></details>
            <details><summary>Does exploring this page use AI?</summary><p>No. The example above is a recorded diagram. Opening the workspace also does not start generation. AI is requested when you submit a description, analyse a repository, refine a diagram or expand a component.</p></details>
            <details><summary>What happens when the free AI allowance is used up?</summary><p>New AI calls pause with a message explaining the applicable limit. Viewing and downloading an available diagram do not make another AI call. Download files you want to keep; hosted recovery copies are temporary.</p></details>
            <details><summary>Can I use Archwoven privately?</summary><p>Yes. Run the local deployment with Ollama. Local mode keeps generation on your machine. Setup instructions and limitations are in the <a href={site.repository + '#private-mode'}>repository README</a>.</p></details>
          </div>
        </section>
        <section className="lp-closing" aria-labelledby="closing-title"><p className="lp-eyebrow">YOUR NEXT SYSTEM, MAPPED.</p><h2 id="closing-title">Make the complex clear.</h2><a className="lp-button" href="/workspace">Open workspace <span aria-hidden="true">↗</span></a></section>
      </main>
      <footer className="lp-footer"><span className="lp-footer-brand">Archwoven <span>· Architecture, connected.</span></span><CreatorLinks /></footer>
    </div>
  );
}
