import { z } from 'zod';

/** Where a piece of the model came from. Exactly the four categories from SPEC §5. */
export const ProvenanceSchema = z.enum([
  'user-specified',
  'source-supported',
  'inferred',
  'proposed',
]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const EvidenceSchema = z
  .object({
    repo: z.string().nullish(),
    commit: z.string().nullish(),
    path: z.string().nullish(),
    /** [start, end] line range. Plain array (not tuple): Anthropic SDK's JSON-schema
     * transformer rejects z.tuple's prefixItems output (SDK 0.131.0). Length pinned by refine. */
    lines: z.array(z.number().int()).length(2).nullish(),
    note: z.string().nullish(),
  })
  .strict();
export type Evidence = z.infer<typeof EvidenceSchema>;

export const NodeKindSchema = z.enum([
  'actor',
  'service',
  'gateway',
  'datastore',
  'queue',
  'external',
  'entity',
  'component',
]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

/** ER entity field; meaningless on non-entity nodes (usage checked at render, shape here). */
export const FieldSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().nullish(),
    key: z.enum(['pk', 'fk', 'uk']).nullish(),
  })
  .strict();
export type Field = z.infer<typeof FieldSchema>;

export const NodeSchema = z
  .object({
    id: z.string().min(1),
    kind: NodeKindSchema,
    label: z.string().min(1),
    provenance: ProvenanceSchema,
    evidence: z.array(EvidenceSchema).default([]),
    group: z.string().nullish(),
    fields: z.array(FieldSchema).nullish(),
  })
  .strict();
export type Node = z.infer<typeof NodeSchema>;

export const EdgeTypeSchema = z.enum(['sync', 'async', 'data', 'relation', 'control']);
export type EdgeType = z.infer<typeof EdgeTypeSchema>;

export const CardinalitySchema = z.enum(['1:1', '1:N', 'N:M']);
export type Cardinality = z.infer<typeof CardinalitySchema>;

export const EdgeSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    type: EdgeTypeSchema,
    label: z.string().nullish(),
    cardinality: CardinalitySchema.nullish(),
    provenance: ProvenanceSchema,
    evidence: z.array(EvidenceSchema).default([]),
  })
  .strict();
export type Edge = z.infer<typeof EdgeSchema>;

export const MessageKindSchema = z.enum(['call', 'return', 'async']);
export type MessageKind = z.infer<typeof MessageKindSchema>;

export const FragmentSchema = z
  .object({
    type: z.enum(['alt', 'loop', 'opt']),
    covers: z.array(z.number().int()).min(1),
  })
  .strict();
export type Fragment = z.infer<typeof FragmentSchema>;

export const MessageSchema = z
  .object({
    seq: z.number().int().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().min(1),
    kind: MessageKindSchema,
    fragment: FragmentSchema.nullish(),
  })
  .strict();
export type Message = z.infer<typeof MessageSchema>;

export const SequenceMetaSchema = z
  .object({
    participants: z.array(z.string()).min(1),
    messages: z.array(MessageSchema),
  })
  .strict();
export type SequenceMeta = z.infer<typeof SequenceMetaSchema>;

export const ViewTypeSchema = z.enum(['architecture', 'sequence', 'er', 'component-detail']);
export type ViewType = z.infer<typeof ViewTypeSchema>;

export const ViewSchema = z
  .object({
    id: z.string().min(1),
    type: ViewTypeSchema,
    orientation: z.enum(['TB', 'LR']).nullish(),
    nodes: z.array(z.string()),
    edges: z.array(z.string()),
    sequence: SequenceMetaSchema.nullish(),
    focus: z.string().nullish(),
  })
  .strict();
export type View = z.infer<typeof ViewSchema>;

export const RequirementSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    status: z.enum(['stated', 'clarified', 'open']),
  })
  .strict();
export type Requirement = z.infer<typeof RequirementSchema>;

export const OpenQuestionSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    blockedBy: z.string().nullish(),
  })
  .strict();
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;

export const PrivacySchema = z
  .object({
    classification: z.enum(['public', 'private']),
    boundary: z.enum(['external-allowed', 'local-only']),
  })
  .strict();
export type Privacy = z.infer<typeof PrivacySchema>;

export const SystemModelSchema = z
  .object({
    schemaVersion: z.literal('1'),
    revision: z.number().int().min(1),
    parentId: z.number().int().nullish(),
    title: z.string().min(1),
    requirements: z.array(RequirementSchema).default([]),
    openQuestions: z.array(OpenQuestionSchema).default([]),
    nodes: z.array(NodeSchema),
    edges: z.array(EdgeSchema),
    views: z.array(ViewSchema),
    privacy: PrivacySchema,
    layout: z.record(z.string(), z.object({ x: z.number(), y: z.number() }).strict()).nullish(),
  })
  .strict();
export type SystemModel = z.infer<typeof SystemModelSchema>;

export const EditOpSchema = z
  .object({
    op: z.enum(['add', 'remove', 'update', 'move']),
    target: z.string().min(1),
    patch: z.record(z.string(), z.unknown()),
    baseRevision: z.number().int().min(1),
    summary: z.string().min(1),
  })
  .strict();
export type EditOp = z.infer<typeof EditOpSchema>;
