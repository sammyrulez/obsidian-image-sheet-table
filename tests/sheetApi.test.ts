import { buildUrls } from '../src/components/sheetApi';

describe('buildUrls', () => {
  it('returns correct csv and edit URLs for /edit#gid', () => {
    const input = 'https://docs.google.com/spreadsheets/d/abc123/edit#gid=456';
    const { csvUrl, editUrl } = buildUrls(input);
    expect(editUrl).toContain('edit#gid=456');
    expect(csvUrl).toContain('export?format=csv&gid=456');
  });

  it('returns input for non-Google Sheets URL', () => {
    const input = 'https://example.com';
    const { csvUrl, editUrl } = buildUrls(input);
    expect(csvUrl).toBe(input);
    expect(editUrl).toBe(input);
  });
});
