import { buildTable } from '../src/components/tableRenderer';

describe('buildTable', () => {
  it('renders a table with headers and rows', () => {
    const rows = [
      ['A', 'B'],
      ['1', '2'],
      ['3', '4']
    ];
    const table = buildTable(rows, 1);
    expect(table.tagName).toBe('TABLE');
    expect(table.querySelectorAll('thead th').length).toBe(2);
    expect(table.querySelectorAll('tbody td').length).toBe(4);
  });
});
