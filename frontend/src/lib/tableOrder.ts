const tableCodeCollator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

export function compareTablesByLabel(left: { label: string }, right: { label: string }): number {
  return tableCodeCollator.compare(left.label, right.label) || left.label.localeCompare(right.label, 'pt-BR');
}
