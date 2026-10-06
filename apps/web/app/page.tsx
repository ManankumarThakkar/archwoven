import { validateModel, validFullModel } from '@archwoven/model';

// M0 smoke page: proves the shared model contract flows server-side into the app shell.
export default function Home() {
  const result = validateModel(validFullModel);
  return (
    <main style={{ padding: '4rem 2rem', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>
        Arch<span style={{ color: '#5eead4' }}>woven</span>
      </h1>
      <p style={{ color: '#8b98b8' }}>Turn ideas and code into clear architecture.</p>
      <p>
        {result.ok
          ? `System model v${result.model.schemaVersion} validated: ${result.model.nodes.length} nodes, ${result.model.edges.length} edges, ${result.model.views.length} views.`
          : `Model validation FAILED: ${result.errors.join('; ')}`}
      </p>
      <p style={{ color: '#8b98b8', fontSize: '0.875rem' }}>
        M0 scaffold — workspace, canvas, and probes arrive in M1/M2.
      </p>
    </main>
  );
}
