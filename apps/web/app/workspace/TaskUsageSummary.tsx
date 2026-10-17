import type { TaskReport } from '@archwoven/model';

const count = (value: number) => value.toLocaleString('en-US');
const plural = (value: number, single: string, many = `${single}s`) => `${value} ${value === 1 ? single : many}`;

/** This is a provider report, separate from credits and from diagram content. */
export function TaskUsageSummary({ task }: { task: TaskReport }) {
  const total = task.inputTokens + task.cacheWriteTokens + task.cacheReadTokens + task.outputTokens;
  const prefix = task.usageComplete ? '' : '≥ ';
  const cost = task.costBasis === 'local-inference' ? 'Local inference'
    : task.costBasis === 'demo' ? 'Demo'
    : task.estimatedCostUsd === null ? 'Cost unavailable'
    : `${prefix}$${task.estimatedCostUsd.toFixed(4)} API estimate`;
  return <details className="aw-task-usage">
    <summary>Last task · {task.usageComplete ? `${count(total)} tokens` : 'Usage incomplete'} · {cost}</summary>
    <div className="aw-task-usage-details">
      <p>{task.action === 'repo' ? 'Repository' : task.action === 'expand' ? 'Expansion' : task.action === 'refine' ? 'Refinement' : 'Generation'} · {task.outcome === 'failed' ? 'Failed or interrupted' : 'Completed'} · {(task.latencyMs / 1000).toFixed(1)}s</p>
      <p>{task.provider === 'ollama' ? 'Ollama' : task.provider === 'anthropic' ? 'Anthropic' : task.provider === 'demo' ? 'Demo' : 'Unknown provider'} · {task.model}</p>
      <dl>
        <div><dt>Input</dt><dd>{count(task.inputTokens)}</dd></div>
        <div><dt>Output</dt><dd>{count(task.outputTokens)}</dd></div>
        <div><dt>Cache write</dt><dd>{count(task.cacheWriteTokens)}</dd></div>
        <div><dt>Cache read</dt><dd>{count(task.cacheReadTokens)}</dd></div>
      </dl>
      <p>{plural(task.repairs, 'repair')} · {plural(task.transportRetries, 'retry', 'retries')}</p>
      {!task.usageComplete && <p className="aw-usage-incomplete">Usage incomplete. Only reported tokens are shown; the final total may be higher.</p>}
      <p>{task.costBasis === 'local-inference' ? 'No external API charge. Hardware and electricity aren’t measured.'
        : task.costBasis === 'demo' ? 'Sample output. No provider request was made.'
        : task.estimatedCostUsd === null ? 'Cost unavailable for this provider or model.'
        : 'Estimated from reported tokens at standard API rates. Your provider invoice is authoritative.'}</p>
    </div>
  </details>;
}
