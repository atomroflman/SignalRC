// Lexer and parser of the overlay expression language
// (Shared/Overlay/expression/README.md §1, §2). Offsets are UTF-16 code units.

export type Node =
  | { kind: "number"; value: number; start: number }
  | { kind: "text"; value: string; start: number }
  | { kind: "bool"; value: boolean; start: number }
  | { kind: "unary"; op: "-" | "!"; operand: Node; start: number }
  | { kind: "binary"; op: BinaryOp; left: Node; right: Node; start: number }
  | { kind: "call"; name: string; args: Node[]; start: number };

export type BinaryOp = "+" | "-" | "*" | "/" | "&&" | "||" | "==" | "!=" | "<" | "<=" | ">" | ">=";

export class SyntaxError extends Error {
  constructor(readonly offset: number, message: string) {
    super(message);
  }
}

type Token =
  | { type: "number"; value: number; start: number }
  | { type: "text"; value: string; start: number }
  | { type: "ident"; value: string; start: number }
  | { type: "op"; value: string; start: number }
  | { type: "end"; start: number }
  | { type: "error"; start: number; message: string };

const OPERATORS = ["&&", "||", "==", "!=", "<=", ">=", "+", "-", "*", "/", "!", "<", ">", "(", ")", ","];
const NUMBER = /[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;

/**
 * Tokens up to and including the first lexical error, which becomes an error
 * token: the parser reports it only if it gets there, so an earlier syntax
 * error wins (first error in source order).
 */
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (true) {
    while (i < source.length && " \t\r\n".includes(source[i])) i++;
    if (i >= source.length) {
      tokens.push({ type: "end", start: i });
      return tokens;
    }
    const start = i;
    const c = source[i];
    if (c >= "0" && c <= "9") {
      NUMBER.lastIndex = i;
      const text = NUMBER.exec(source)![0];
      const value = Number(text);
      if (!Number.isFinite(value)) {
        tokens.push({ type: "error", start, message: "Zahl ist nicht endlich" });
        return tokens;
      }
      tokens.push({ type: "number", value, start });
      i += text.length;
    } else if (c === '"') {
      let value = "";
      i++;
      while (true) {
        if (i >= source.length || source[i] === "\n" || source[i] === "\r") {
          tokens.push({ type: "error", start, message: "Text nicht abgeschlossen" });
          return tokens;
        }
        if (source[i] === '"') break;
        if (source[i] === "\\") {
          const next = source[i + 1];
          if (next !== '"' && next !== "\\") {
            tokens.push({ type: "error", start: i, message: "nur \\\" und \\\\ sind erlaubt" });
            return tokens;
          }
          value += next;
          i += 2;
        } else {
          value += source[i++];
        }
      }
      i++;
      tokens.push({ type: "text", value, start });
    } else if (/[A-Za-z_]/.test(c)) {
      IDENT.lastIndex = i;
      const text = IDENT.exec(source)![0];
      tokens.push({ type: "ident", value: text, start });
      i += text.length;
    } else {
      const op = OPERATORS.find((o) => source.startsWith(o, i));
      if (!op) {
        tokens.push({ type: "error", start, message: `unerwartetes Zeichen ${c}` });
        return tokens;
      }
      tokens.push({ type: "op", value: op, start });
      i += op.length;
    }
  }
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    const token = this.tokens[this.index];
    if (token.type === "error") throw new SyntaxError(token.start, token.message);
    return token;
  }

  private next(): Token {
    const token = this.peek();
    this.index++;
    return token;
  }

  private isOp(...ops: string[]): boolean {
    const token = this.peek();
    return token.type === "op" && ops.includes(token.value);
  }

  private fail(message: string): never {
    throw new SyntaxError(this.peek().start, message);
  }

  private expectOp(op: string): void {
    if (!this.isOp(op)) this.fail(`${op} erwartet`);
    this.index++;
  }

  parse(): Node {
    const node = this.or();
    if (this.peek().type !== "end") this.fail("unerwartetes Zeichen");
    return node;
  }

  private chain(next: () => Node, ops: BinaryOp[]): Node {
    let left = next();
    while (this.isOp(...ops)) {
      const op = this.next() as { value: BinaryOp };
      left = { kind: "binary", op: op.value, left, right: next(), start: left.start };
    }
    return left;
  }

  private or = (): Node => this.chain(this.and, ["||"]);
  private and = (): Node => this.chain(this.equality, ["&&"]);

  /** Non-associative level: a second operator of the same level is a syntax error. */
  private single(next: () => Node, ops: BinaryOp[]): Node {
    const left = next();
    if (!this.isOp(...ops)) return left;
    const op = this.next() as { value: BinaryOp };
    const node: Node = { kind: "binary", op: op.value, left, right: next(), start: left.start };
    if (this.isOp(...ops)) this.fail("Vergleiche lassen sich nicht verketten");
    return node;
  }

  private equality = (): Node => this.single(this.comparison, ["==", "!="]);
  private comparison = (): Node => this.single(this.additive, ["<", "<=", ">", ">="]);
  private additive = (): Node => this.chain(this.multiplicative, ["+", "-"]);
  private multiplicative = (): Node => this.chain(this.unary, ["*", "/"]);

  private unary = (): Node => {
    if (this.isOp("-", "!")) {
      const op = this.next() as { value: "-" | "!"; start: number };
      return { kind: "unary", op: op.value, operand: this.unary(), start: op.start };
    }
    return this.primary();
  };

  private primary(): Node {
    const token = this.peek();
    switch (token.type) {
      case "number":
        this.index++;
        return { kind: "number", value: token.value, start: token.start };
      case "text":
        this.index++;
        return { kind: "text", value: token.value, start: token.start };
      case "ident": {
        this.index++;
        if (token.value === "true" || token.value === "false") {
          return { kind: "bool", value: token.value === "true", start: token.start };
        }
        // Look at the raw next token: a lexical error after the identifier is
        // later in the source and must not hide this one.
        const next = this.tokens[this.index];
        if (next.type !== "op" || next.value !== "(") throw new SyntaxError(token.start, `${token.value} ist keine Funktion`);
        this.index++;
        const args: Node[] = [];
        if (!this.isOp(")")) {
          args.push(this.or());
          while (this.isOp(",")) {
            this.index++;
            args.push(this.or());
          }
        }
        this.expectOp(")");
        return { kind: "call", name: token.value, args, start: token.start };
      }
      case "op":
        if (token.value === "(") {
          this.index++;
          const inner = this.or();
          this.expectOp(")");
          return inner;
        }
        return this.fail("Ausdruck erwartet");
      default:
        return this.fail("Ausdruck erwartet");
    }
  }
}

export function parse(source: string): Node {
  return new Parser(tokenize(source)).parse();
}

/** AST depth: every operator and call level counts, a literal is 1; parentheses add nothing. */
export function depth(node: Node): number {
  switch (node.kind) {
    case "unary":
      return 1 + depth(node.operand);
    case "binary":
      return 1 + Math.max(depth(node.left), depth(node.right));
    case "call":
      return 1 + Math.max(0, ...node.args.map(depth));
    default:
      return 1;
  }
}
