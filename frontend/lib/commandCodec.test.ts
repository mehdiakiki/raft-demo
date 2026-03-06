import { describe, expect, it } from 'vitest';
import { encodeUserCommand } from './commandCodec';

describe('encodeUserCommand', () => {
  it('encodes SET key=value syntax into KV JSON', () => {
    const encoded = encodeUserCommand('SET x=1');
    expect(JSON.parse(encoded)).toEqual({ op: 'set', key: 'x', value: '1' });
  });

  it('encodes SET key value syntax into KV JSON', () => {
    const encoded = encodeUserCommand('set foo bar');
    expect(JSON.parse(encoded)).toEqual({ op: 'set', key: 'foo', value: 'bar' });
  });

  it('encodes DELETE syntax into KV JSON', () => {
    const encoded = encodeUserCommand('DELETE x');
    expect(JSON.parse(encoded)).toEqual({ op: 'delete', key: 'x' });
  });

  it('passes through valid JSON commands', () => {
    const raw = '{"op":"set","key":"x","value":"1"}';
    expect(encodeUserCommand(raw)).toBe(raw);
  });

  it('normalizes quoted SET values', () => {
    const encoded = encodeUserCommand(`SET k="hello world"`);
    expect(JSON.parse(encoded)).toEqual({ op: 'set', key: 'k', value: 'hello world' });
  });

  it('rejects invalid JSON command payloads', () => {
    expect(() => encodeUserCommand('{"op":"set"')).toThrow(/Command JSON is invalid/);
  });

  it('rejects unsupported syntax', () => {
    expect(() => encodeUserCommand('INCR x')).toThrow(/Unsupported command format/);
  });

  it('rejects empty input', () => {
    expect(() => encodeUserCommand('   ')).toThrow(/Command is empty/);
  });
});
