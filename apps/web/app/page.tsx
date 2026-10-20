import { Brand } from './components/Brand';
import { CreatorLinks, SocialIcon } from './components/CreatorLinks';
import { ProductFilm } from './components/ProductFilm';
import { ViewIllustration } from './components/ViewIllustration';
import { site } from './lib/site';
import { landingMetadata, structuredData } from './lib/seo';
import './landing.css';

const views = [
  { kind: 'architecture', title: 'The big picture.', name: 'Architecture', text: 'Components, services and data stores. See the parts and how they connect.' },
  { kind: 'sequence', title: 'The next interaction.', name: 'Sequence', text: 'Follow a request from participant to participant, in the order it happens.' },
  { kind: 'er', title: 'The shape of your data.', name: 'ER / data model', text: 'Entities, fields and relationships. Understand what belongs together.' },
  { kind: 'detail', title: 'One level deeper.', name: 'Component detail', text: 'Open a component and explore the responsibilities inside it.' },
] as const;

export function generateMetadata() { return landingMetadata(); }

export default function Home() {
  const schema = structuredData();
  return <div className="aw-landing">
    {schema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, '\\u003c') }} />}
    <a className="lp-skip" href="#main">Skip to content</a>
    <header className="lp-header">
      <Brand />
      <nav className="lp-navigation" aria-label="Main navigation">
        <a href="#example">The product</a><a href="#how-it-works">How it works</a>
        <a className="lp-nav-github" href={site.repository} target="_blank" rel="noopener noreferrer"><SocialIcon name="github" />GitHub<span className="lp-sr-only"> (opens in a new tab)</span></a>
        <a className="lp-button lp-small-button" href="/workspace">Open workspace <span aria-hidden="true">↗</span></a>
      </nav>
    </header>
    <main id="main">
      <section className="lp-hero" aria-labelledby="hero-title">
        <div className="lp-hero-flourish" aria-hidden="true"><svg viewBox="0 0 360 320" fill="none"><path d="M0 300 140 20q20-40 40 0l140 280M40 220h200q60 0 60-60t-60-60h-60" /></svg></div>
        <div className="lp-hero-heading"><p className="lp-eyebrow"><span className="lp-small-line" aria-hidden="true" /> AI ARCHITECTURE DIAGRAM GENERATOR</p>
        <h1 id="hero-title">From code and ideas<br />to <em>clear architecture.</em></h1></div>
        <div className="lp-hero-summary"><p className="lp-lead">Turn a description or a GitHub repository into architecture diagrams you can explore, question and make your own.</p>
        <div className="lp-actions"><a className="lp-button" href="/workspace">Open workspace <span aria-hidden="true">↗</span></a><a className="lp-text-link" href="#example"><span className="lp-play-icon" aria-hidden="true">▷</span> See it come together</a></div>
        <p className="lp-hero-note">No account needed <span aria-hidden="true">·</span> Free AI within shared usage limits</p></div>
      </section>
      <div className="lp-stage-wrap"><ProductFilm /></div>
      <div className="lp-capabilities" aria-label="Workspace capabilities"><span>4 diagram views</span><span>Commit-pinned evidence</span><span>SVG, PNG &amp; JSON exports</span><span>Local / private deployment</span></div>
      <section id="how-it-works" className="lp-section lp-how" aria-labelledby="how-title">
        <div className="lp-section-heading"><p className="lp-eyebrow">A LITTLE CONTEXT. A LOT MORE CLARITY.</p><h2 id="how-title">Your next system,<br />woven together.</h2><p>Start with what you know. Follow the connections. Leave with something you can explain.</p></div>
        <ol className="lp-steps">
          <li><span className="lp-step-number">01</span><div><h3>Bring the starting point.</h3><p>Describe an idea in plain English, or add a public GitHub repository. Source analysis reads code without executing it.</p><div className="lp-step-sample"><span aria-hidden="true">↳</span> “An order service with payments and inventory…”</div></div></li>
          <li><span className="lp-step-number">02</span><div><h3>Find the thread.</h3><p>Explore components, inspect a relationship or trace a request. See what was described, supported by source or inferred.</p><div className="lp-step-sample lp-sample-route"><span>Customer</span><span aria-hidden="true">→</span><span>API</span><span aria-hidden="true">→</span><span>Database</span></div></div></li>
          <li><span className="lp-step-number">03</span><div><h3>Make it yours. Then share it.</h3><p>Arrange, rename or refine in words. Export a diagram for a README, an architecture review or your next design discussion.</p><div className="lp-step-sample lp-sample-formats"><span>SVG</span><span>PNG</span><span>JSON</span><span aria-hidden="true">↗</span></div></div></li>
        </ol>
      </section>
      <section className="lp-section lp-views-section" aria-labelledby="views-title">
        <div className="lp-section-heading lp-heading-row"><div><p className="lp-eyebrow">ONE SYSTEM. FOUR WAYS IN.</p><h2 id="views-title">A view for every<br />kind of understanding.</h2></div><p>Zoom out to the architecture.<br />Follow a sequence. Look inside.</p></div>
        <div className="lp-views">{views.map(view => <article key={view.kind}><div className={`lp-view-illustration lp-view-${view.kind}`}><ViewIllustration kind={view.kind} /><span>{view.name}</span></div><h3>{view.title}</h3><p>{view.text}</p></article>)}</div>
      </section>
      <section className="lp-evidence-band" aria-labelledby="engineering-title"><div className="lp-section lp-engineering">
        <div className="lp-section-heading"><p className="lp-eyebrow">CLARITY INCLUDES THE UNKNOWNS.</p><h2 id="engineering-title">A picture is useful.<br />Its reasoning matters.</h2><p>Understand where a connection came from and where the picture is incomplete. Archwoven makes room for both.</p><a className="lp-text-link" href={site.repository} target="_blank" rel="noopener noreferrer">Explore the engineering <span aria-hidden="true">↗</span><span className="lp-sr-only"> (opens in a new tab)</span></a></div>
        <div className="lp-evidence-panel"><p className="lp-evidence-title"><span aria-hidden="true">◇</span> READ THE RELATIONSHIP</p><div className="lp-evidence-relationship"><span>Customer</span><span aria-hidden="true">→</span><span>API Gateway</span></div><p>“Customers call an API gateway.”</p><span className="lp-provenance lp-described">Described</span><p className="lp-evidence-small">From the example description. Repository diagrams can also cite source files at the analysed commit.</p><div className="lp-provenance-key"><span>Source-supported</span><span>Inferred</span><span>Proposed</span></div></div>
        <dl className="lp-proof-list"><div><dt>Evidence you can inspect.</dt><dd>Source-supported repository claims link to files and lines at a pinned commit. Coverage limits and unanswered questions stay visible.</dd></div><div><dt>Structure before pixels.</dt><dd>Schema and graph checks validate structured data before rendering. They check the model’s structure; architectural claims still need your judgment.</dd></div><div><dt>A private way to work.</dt><dd>The local deployment uses Ollama and enforces an outbound network boundary. Hosted generation uses an external AI provider.</dd></div></dl>
      </div></section>
      <section className="lp-section lp-faq" aria-labelledby="faq-title"><div className="lp-section-heading"><p className="lp-eyebrow">A FEW USEFUL ANSWERS</p><h2 id="faq-title">Before you<br />start exploring.</h2></div><div>
        <details><summary>Can I generate a diagram from any GitHub repository?</summary><p>Submit a public GitHub repository within the import limits. Spring Boot and FastAPI receive framework-aware extraction; other repositories receive a bounded map of source modules and imports, with gaps disclosed. The local deployment also supports checked-out local clones.</p></details>
        <details><summary>Does watching the film use AI?</summary><p>No. The film uses recorded examples. Opening the workspace also does not start generation. AI is requested when you submit a description, analyse a repository, refine a diagram or expand a component.</p></details>
        <details><summary>What happens when the free AI allowance runs out?</summary><p>New AI calls pause with a message explaining the applicable limit. Available diagrams, examples and browser downloads remain usable. Hosted recovery copies are temporary, so download the files you want to keep.</p></details>
        <details><summary>Can I use Archwoven privately?</summary><p>Yes. Run the local deployment with Ollama to keep inference on your machine. Read the <a href={site.repository + '#run-privately'}>private deployment instructions</a> for setup and limitations.</p></details>
        <details><summary>Can I edit and export the diagrams?</summary><p>Yes. Arrange components, rename elements, refine in words and undo changes. Export SVG or PNG for a document or presentation, or JSON to reopen a model in Archwoven.</p></details>
      </div></section>
      <section className="lp-closing" aria-labelledby="closing-title"><p className="lp-eyebrow">YOUR NEXT SYSTEM IS A STARTING POINT AWAY.</p><h2 id="closing-title">Make the complex<br /><em>clear.</em></h2><a className="lp-button" href="/workspace">Open workspace <span aria-hidden="true">↗</span></a><p>No account needed. Start with an idea or a repository.</p></section>
    </main>
    <footer className="lp-footer"><div><Brand /><p>Architecture, connected.</p></div><CreatorLinks /></footer>
  </div>;
}
