import { describe, expect, it } from 'vitest';
import { detectFramework } from './detect';

const readMap = (map: Record<string, string>) => (p: string) => map[p] ?? '';

describe('detectFramework (§5 Spring Boot | FastAPI)', () => {
  it('spring-boot: build file + @SpringBootApplication source', () => {
    const files = ['pom.xml', 'src/main/java/com/shop/App.java'];
    const read = readMap({
      'pom.xml': '<project><groupId>org.springframework.boot</groupId></project>',
      'src/main/java/com/shop/App.java': '@SpringBootApplication\npublic class App {}',
    });
    expect(detectFramework(files, read)).toBe('spring-boot');
  });

  it('spring-boot via build.gradle too', () => {
    const files = ['build.gradle', 'src/main/java/App.java'];
    const read = readMap({
      'build.gradle': "plugins { id 'org.springframework.boot' version '3.3.0' }",
      'src/main/java/App.java': '@SpringBootApplication public class App {}',
    });
    expect(detectFramework(files, read)).toBe('spring-boot');
  });

  it('fastapi: app instantiation in python source', () => {
    const files = ['main.py', 'app/routes.py'];
    const read = readMap({ 'main.py': 'from fastapi import FastAPI\napp = FastAPI()' });
    expect(detectFramework(files, read)).toBe('fastapi');
  });

  it('mixed frameworks → mixed (caller asks for a subdir)', () => {
    const files = ['pom.xml', 'src/main/java/App.java', 'main.py'];
    const read = readMap({
      'pom.xml': '<project><groupId>org.springframework.boot</groupId></project>',
      'src/main/java/App.java': '@SpringBootApplication public class App {}',
      'main.py': 'from fastapi import FastAPI\napp = FastAPI()',
    });
    expect(detectFramework(files, read)).toBe('mixed');
  });

  it('unsupported: no recognizable framework', () => {
    expect(detectFramework(['README.md', 'index.js'], readMap({ 'README.md': '# hi' }))).toBe('unsupported');
  });

  it('empty repository → unsupported', () => {
    expect(detectFramework([], () => '')).toBe('unsupported');
  });

  it('a file named main.py without FastAPI is not fastapi', () => {
    expect(detectFramework(['main.py'], readMap({ 'main.py': 'print(1)' }))).toBe('unsupported');
  });
});
