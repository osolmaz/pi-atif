export interface ExportArguments {
  session?: string;
  leaf?: string;
  output?: string;
  force: boolean;
  format: "human" | "json";
  allSessions: boolean;
  limit?: number;
  cwd?: string;
  redactionProfile: string;
}

export class ArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgumentError";
  }
}

// Quoting and escaping form one small state machine.
// eslint-disable-next-line complexity
export function tokenizeArguments(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (const character of input) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (escaped) current += "\\";
  if (quote) throw new ArgumentError("Unterminated quoted argument");
  if (current) tokens.push(current);
  return tokens;
}

function takeValue(tokens: readonly string[], index: number, flag: string): string {
  const value = tokens[index + 1];
  if (!value || value.startsWith("--")) throw new ArgumentError(`${flag} requires a value`);
  return value;
}

// Each documented flag has one explicit parsing branch.
// eslint-disable-next-line complexity
export function parseExportArguments(tokens: readonly string[]): ExportArguments {
  const parsed: ExportArguments = {
    force: false,
    format: "human",
    allSessions: false,
    redactionProfile: "raw-v1",
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    switch (token) {
      case "--session":
        parsed.session = takeValue(tokens, index, token);
        index += 1;
        break;
      case "--leaf":
        parsed.leaf = takeValue(tokens, index, token);
        index += 1;
        break;
      case "--all-leaves":
        parsed.leaf = "all";
        break;
      case "--output":
        parsed.output = takeValue(tokens, index, token);
        index += 1;
        break;
      case "--force":
        parsed.force = true;
        break;
      case "--format": {
        const format = takeValue(tokens, index, token);
        if (format !== "human" && format !== "json") {
          throw new ArgumentError("--format must be human or json");
        }
        parsed.format = format;
        index += 1;
        break;
      }
      case "--all":
        parsed.allSessions = true;
        break;
      case "--limit": {
        const raw = takeValue(tokens, index, token);
        const limit = Number(raw);
        if (!Number.isSafeInteger(limit) || limit < 1) {
          throw new ArgumentError("--limit must be a positive integer");
        }
        parsed.limit = limit;
        index += 1;
        break;
      }
      case "--cwd":
        parsed.cwd = takeValue(tokens, index, token);
        index += 1;
        break;
      case "--redaction-profile":
        parsed.redactionProfile = takeValue(tokens, index, token);
        index += 1;
        break;
      default:
        throw new ArgumentError(`Unknown option: ${token}`);
    }
  }
  if (parsed.redactionProfile !== "raw-v1") {
    throw new ArgumentError(`Unknown redaction profile: ${parsed.redactionProfile}`);
  }
  return parsed;
}
