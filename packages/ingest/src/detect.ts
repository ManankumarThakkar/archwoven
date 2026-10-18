/**
 * Framework detection: Spring Boot vs FastAPI by build-file + source
 * markers, reading only candidate files (bounded). Detection chooses specialized
 * extraction where possible; mixed or other languages use bounded general analysis.
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

/** A recognized backend cannot represent a mixed-language repository by itself. */
export function useGenericAnalysis(files: string[], framework: Framework): boolean {
  if (framework === 'mixed' || framework === 'unsupported') return true;
  const otherSources = framework === 'spring-boot'
    ? /\.(?:[cm]?[jt]sx?|py|go|rs|rb|php|cs|cpp|swift|kt)$/i
    : /\.(?:[cm]?[jt]sx?|java|kt|go|rs|rb|php|cs|cpp|swift)$/i;
  return files.some((path) => otherSources.test(path));
}
