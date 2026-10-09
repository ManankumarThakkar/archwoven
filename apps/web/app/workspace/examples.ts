import type { ViewType } from '@archwoven/model';

export interface Example {
  label: string;
  prompt: string;
  view: ViewType;
}

/** 3–4 example chips per view; clicking prefills the input (never auto-generates). */
export const EXAMPLES: Record<ViewType, Example[]> = {
  architecture: [
    { label: 'E-commerce platform', prompt: 'E-commerce platform with payments and inventory', view: 'architecture' },
    { label: 'Support chatbot', prompt: 'Customer support chatbot with vector search and human escalation', view: 'architecture' },
    { label: 'Multi-tenant SaaS', prompt: 'Multi-tenant SaaS with authentication and billing', view: 'architecture' },
    { label: 'Analytics pipeline', prompt: 'Real-time analytics pipeline with streaming data', view: 'architecture' },
  ],
  sequence: [
    { label: 'OAuth login', prompt: 'User login with OAuth and JWT', view: 'sequence' },
    { label: 'Place an order', prompt: 'Place an order with payment and inventory checks', view: 'sequence' },
    { label: 'RAG query flow', prompt: 'RAG chatbot query flow with vector search', view: 'sequence' },
  ],
  er: [
    { label: 'E-commerce schema', prompt: 'E-commerce database with orders, products, and users', view: 'er' },
    { label: 'Hospital schema', prompt: 'Hospital database with patients, doctors, and appointments', view: 'er' },
  ],
  'component-detail': [
    { label: 'Order service internals', prompt: 'Order service with validation, pricing, and a payment gateway call', view: 'component-detail' },
    { label: 'API gateway', prompt: 'API gateway routing to auth, orders, and search services', view: 'component-detail' },
  ],
};

export interface RepoExample {
  label: string;
  url: string;
  ref: string;
}

/** Public repos with framework coverage (Spring Boot / FastAPI), pinned to a ref. */
export const REPO_EXAMPLES: RepoExample[] = [
  { label: 'Spring PetClinic', url: 'https://github.com/spring-projects/spring-petclinic', ref: 'main' },
  { label: 'FastAPI framework', url: 'https://github.com/tiangolo/fastapi', ref: 'main' },
];
