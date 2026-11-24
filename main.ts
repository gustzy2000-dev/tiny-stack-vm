// Tiny stack VM: the kit's ISA, exact. Wrapping 32-bit math, 256-value stack, 64-deep
// call stack, 256 words of memory, input/output, all ten traps with their own exit
// codes. Pure function of program + input bytes. Run as node main.ts.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Opcode table: T[op] encodes (imm, pops, pushes) as (imm*4+pops)*4+pushes + 35;
// '!' marks an unknown opcode. Index 0..0x53.
const T = "#4d')-.2!!!!!!!!,,,,,,,(,,,(,,,!,,,!!!!!!!!!!!!!CGGC#!!!!!!!!!!!(+!!!!!!!!!!!!!!''$'";
// Binary ops by op - 0x10; div-by-zero yields NaN, caught below as trap 4.
const F = [
  (a, b) => (a + b) | 0, (a, b) => (a - b) | 0, Math.imul,
  (a, b) => (b ? ((a / b) | 0) : NaN), (a, b) => (b ? ((a % b) | 0) : NaN),
  (a, b) => (b ? (Math.floor((a >>> 0) / (b >>> 0)) | 0) : NaN),
  (a, b) => (b ? (((a >>> 0) % (b >>> 0)) | 0) : NaN),
  undefined, (a, b) => a & b, (a, b) => a | b, (a, b) => a ^ b, undefined,
  (a, b) => a << (b & 31), (a, b) => a >> (b & 31), (a, b) => (a >>> (b & 31)) | 0, undefined,
  (a, b) => (a === b ? 1 : 0), (a, b) => (a < b ? 1 : 0),
  (a, b) => ((a >>> 0) < (b >>> 0) ? 1 : 0),
];
const enc = new TextEncoder();

function run(p, inp) {
  const D = new Int32Array(256);
  const C = new Int32Array(64);
  const M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let sp = 0, cp = 0, pc = 0, ip = 0, st = 0, ol = 0;
  const end = (code) => ({ out: out.subarray(0, ol), code });
  for (;;) {
    if (st === 1e6) return end(10);
    if (pc < 0 || pc >= p.length) return end(9);
    const op = p[pc];
    const v = T.charCodeAt(op) - 35;
    if (op > 0x53 || v < 0 || v > 79) return end(5);
    const imm = v >> 4, po = (v >> 2) & 3, pu = v & 3;
    if (pc + imm >= p.length) return end(9);
    st++;
    const nx = pc + 1 + imm;
    if (sp < po) return end(2);
    if (sp - po + pu > 256) return end(3);
    pc = nx;
    if (op >= 0x10 && op <= 0x22 && op !== 0x17 && op !== 0x1b) {
      const b = D[sp - 1], a = D[sp - 2];
      const r = F[op - 16](a, b);
      if (r !== r) return end(4);
      sp -= 2;
      D[sp++] = r;
    } else switch (op) {
      case 0x00:
        return end(0);
      case 0x01:
        D[sp++] = (p[nx - 1] << 24) >> 24;
        break;
      case 0x02:
        D[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24);
        break;
      case 0x03:
        sp--;
        break;
      case 0x04:
        D[sp] = D[sp - 1];
        sp++;
        break;
      case 0x05: {
        const w = D[sp - 1];
        D[sp - 1] = D[sp - 2];
        D[sp - 2] = w;
        break;
      }
      case 0x06:
        D[sp] = D[sp - 2];
        sp++;
        break;
      case 0x07: {
        const a = D[sp - 3];
        D[sp - 3] = D[sp - 2];
        D[sp - 2] = D[sp - 1];
        D[sp - 1] = a;
        break;
      }
      case 0x17:
        D[sp - 1] = -D[sp - 1] | 0;
        break;
      case 0x1b:
        D[sp - 1] = ~D[sp - 1];
        break;
      case 0x30: case 0x31: case 0x32: {
        const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) {
          const w = D[--sp];
          take = op === 0x31 ? w === 0 : w !== 0;
        }
        if (take) pc = nx + rel;
        break;
      }
      case 0x33:
        if (cp === 64) return end(7);
        C[cp++] = nx;
        pc = p[nx - 2] | (p[nx - 1] << 8);
        break;
      case 0x34:
        if (cp === 0) return end(8);
        pc = C[--cp];
        break;
      case 0x40: {
        const addr = D[sp - 1];
        if (addr < 0 || addr >= 256) return end(6);
        D[sp - 1] = M[addr];
        break;
      }
      case 0x41: {
        const addr = D[sp - 1];
        const w = D[sp - 2];
        if (addr < 0 || addr >= 256) return end(6);
        sp -= 2;
        M[addr] = w;
        break;
      }
      case 0x50: {
        const b = enc.encode(String(D[sp - 1]));
        if (ol + b.length > 65536) return end(11);
        sp--;
        out.set(b, ol);
        ol += b.length;
        break;
      }
      case 0x51:
        if (ol + 1 > 65536) return end(11);
        out[ol++] = D[--sp] & 255;
        break;
      case 0x52:
        D[sp++] = ip < inp.length ? inp[ip++] : -1;
        break;
      default:
        return end(D[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(readFileSync(join(I, id, 'program.bin')), readFileSync(join(I, id, 'input.bin')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
