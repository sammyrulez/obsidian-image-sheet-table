import { b64url, parseConfig } from '../src/components/utils';

describe('b64url', () => {
  it('should encode buffer to base64url', () => {
    const buf = Buffer.from('test');
    expect(b64url(buf)).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});

describe('parseConfig', () => {
  it('parses key=value pairs', () => {
    const input = 'sheet=https://foo;range=A1:B2;headers=1';
    const result = parseConfig(input);
    expect(result.sheet).toBe('https://foo');
    expect(result.range).toBe('A1:B2');
    expect(result.headers).toBe('1');
  });

  it('parses yaml-like config', () => {
    const input = 'sheet: https://foo\nrange: A1:B2\nheaders: 1';
    const result = parseConfig(input);
    expect(result.sheet).toBe('https://foo');
    expect(result.range).toBe('A1:B2');
    expect(result.headers).toBe('1');
  });
});
