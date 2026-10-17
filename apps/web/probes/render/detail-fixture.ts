import { applyExpansion, validFullModel } from '@archwoven/model';

/** A deterministic, validated expansion for export regression tests. */
export function expandedDetailModel() {
  const result = applyExpansion(structuredClone(validFullModel), 'svc.orders', {
    internals: [{ key: 'intake', label: 'Order Intake' }, { key: 'store', label: 'Order Store' }],
    links: [
      { from: 'gateway.api', to: 'intake', type: 'sync', label: 'submit order' },
      { from: 'intake', to: 'store', type: 'data' },
      { from: 'store', to: 'datastore.postgres', type: 'data' },
      { from: 'intake', to: 'external.stripe', type: 'sync', label: 'charge' },
    ],
  });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.model;
}
