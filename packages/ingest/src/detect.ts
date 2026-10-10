/**
 * Framework detection (§5): Spring Boot vs FastAPI by build-file + source
 * markers, reading only candidate files (bounded). Mixed monorepos are
 * refused with a subdir prompt — one framework per analysis, no guessing.
 */
export type Framework = 'spring-boot' | 'fastapi' | 'mixed' | 'unsupported';

const SPRING_BUILD = /springframework\.boot|org\.springframework/i;
const SPRING_APP = /@SpringBootApplication/;
const FASTAPI_SRC = /from\s+fastapi\s+import|FastAPI\(/;

export function detectFramework(files: string[], read: (rel: string) => string): Framework {
  let spring = false;
  let fastapi = false;

  const buildFiles = files.filter((f) => /^(pom\.xml|build\.gradle(\.kts)?)$/.test(f) || f.endsWith('/pom.xml'));
  for (const b of buildFiles) {
    if (SPRING_BUILD.test(read(b))) { spring = true; break; }
  }
  if (!spring) {
    const javaMains = files.filter((f) => f.endsWith('.java')).slice(0, 200);
    for (const j of javaMains) {
      if (SPRING_APP.test(read(j))) { spring = true; break; }
    }
  }

  const pyFiles = files.filter((f) => f.endsWith('.py')).slice(0, 300);
  for (const p of pyFiles) {
    if (FASTAPI_SRC.test(read(p))) { fastapi = true; break; }
  }

  if (spring && fastapi) return 'mixed';
  if (spring) return 'spring-boot';
  if (fastapi) return 'fastapi';
  return 'unsupported';
}
