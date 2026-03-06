const SET_WITH_EQUALS_RE = /^set\s+([A-Za-z0-9_.:-]+)\s*=\s*(.+)$/i;
const SET_WITH_SPACE_RE = /^set\s+([A-Za-z0-9_.:-]+)\s+(.+)$/i;
const DELETE_RE = /^(?:del|delete)\s+([A-Za-z0-9_.:-]+)$/i;

function trimWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function encodeSet(key: string, rawValue: string): string {
  return JSON.stringify({
    op: 'set',
    key,
    value: trimWrappingQuotes(rawValue.trim()),
  });
}

export function encodeUserCommand(raw: string): string {
  const command = raw.trim();
  if (!command) {
    throw new Error('Command is empty.');
  }

  if (command.startsWith('{')) {
    try {
      JSON.parse(command);
    } catch {
      throw new Error('Command JSON is invalid.');
    }
    return command;
  }

  const setEquals = SET_WITH_EQUALS_RE.exec(command);
  if (setEquals) {
    return encodeSet(setEquals[1], setEquals[2]);
  }

  const setSpace = SET_WITH_SPACE_RE.exec(command);
  if (setSpace) {
    return encodeSet(setSpace[1], setSpace[2]);
  }

  const del = DELETE_RE.exec(command);
  if (del) {
    return JSON.stringify({
      op: 'delete',
      key: del[1],
    });
  }

  throw new Error('Unsupported command format. Use SET key=value or DELETE key.');
}
