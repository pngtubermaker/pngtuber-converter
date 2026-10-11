// Run with: node --test
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const C = require('../converter.js');

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const PNG_SIGNATURE = '89504e470d0a1a0a';

/** A tiny valid 2x2 RGBA PNG, one per frame, so the tests can tell them apart. */
function png(seed) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(2 * (1 + 8), seed);
  raw[0] = 0;
  raw[9] = 0;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from(PNG_SIGNATURE, 'hex'),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ])
  );
}

const PNGS = { idle: png(1), talking: png(2), blink: png(3), blinkTalking: png(4) };

test('PNGTuber Plus: one sprite per frame, shown only in its own state', () => {
  const save = JSON.parse(C.buildPlusSave(PNGS));
  const sprites = Object.values(save);
  assert.equal(sprites.length, 4);
  const byFile = Object.fromEntries(sprites.map((s) => [s.path.split('/').pop(), s]));
  assert.deepEqual(
    Object.fromEntries(Object.entries(byFile).map(([f, s]) => [f, [s.showTalk, s.showBlink]])),
    { 'idle.png': [1, 1], 'talking.png': [2, 1], 'blink.png': [1, 2], 'blink-talking.png': [2, 2] }
  );
  for (const sprite of sprites) {
    assert.match(sprite.path, /^user:\/\/pngtubermaker-[a-z0-9]+\//);
    assert.equal(Buffer.from(sprite.imageData, 'base64').subarray(0, 8).toString('hex'), PNG_SIGNATURE);
    assert.ok(sprite.identification > 0);
    assert.equal(sprite.costumeLayers, '[1, 1, 1, 1, 1, 1, 1, 1, 1, 1]');
  }
  assert.equal(new Set(sprites.map((s) => s.identification)).size, 4);
  assert.equal(Buffer.from(byFile['talking.png'].imageData, 'base64').equals(Buffer.from(PNGS.talking)), true);
});

test('PNGTuber Plus: a missing frame is left out', () => {
  const save = JSON.parse(C.buildPlusSave({ idle: PNGS.idle, talking: PNGS.talking }));
  assert.equal(Object.keys(save).length, 2);
});

test('Godot variant encoding matches marshalls.cpp', () => {
  assert.equal(hex(C.encodeVariant(null)), '00000000');
  assert.equal(hex(C.encodeVariant(true)), '0100000001000000');
  assert.equal(hex(C.encodeVariant(-1)), '02000000ffffffff');
  assert.equal(hex(C.encodeVariant(new C.GFloat(1))), '030000000000803f');
  assert.equal(hex(C.encodeVariant(0.1)), '030001009a9999999999b93f');
  assert.equal(hex(C.encodeVariant('ab')), '040000000200000061620000');
  assert.equal(hex(C.encodeVariant(new C.StringName('a'))), '150000000100000061000000');
  assert.equal(hex(C.encodeVariant(new C.Vector2(1, 2))), '050000000000803f00000040');
  assert.equal(hex(C.encodeVariant(new Uint8Array([7]))), '1d0000000100000007000000');
  assert.equal(hex(C.encodeVariant([1])), '1c000000010000000200000001000000');
  assert.equal(
    hex(C.encodeVariant({ k: false })),
    '1b00000001000000' + '04000000010000006b000000' + '0100000000000000'
  );
  assert.equal(
    hex(C.encodeVariant(new C.NamedDict({ k: false }))),
    '1b00000001000000' + '15000000010000006b000000' + '0100000000000000'
  );
});

test('PNGTuber-Remix: store_var length prefix and the four sprites', () => {
  const file = C.buildRemixModel(PNGS);
  const view = new DataView(file.buffer);
  assert.equal(view.getUint32(0, true), file.length - 4);
  assert.equal(view.getUint32(4, true), 27, 'top level is a Dictionary');
  const text = Buffer.from(file).toString('latin1');
  for (const name of ['idle', 'talking', 'blink', 'blink-talking']) {
    assert.ok(text.includes(name), name);
  }
  for (const key of ['should_talk', 'open_mouth', 'should_blink', 'open_eyes', 'sprites_array', 'settings_dict', 'input_array']) {
    assert.ok(text.includes(key), key);
  }
  assert.ok(text.includes(Buffer.from(PNGS.blinkTalking).toString('latin1')), 'PNG bytes are embedded');
});

test('crc32 check value', () => {
  assert.equal(C.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip: entries, sizes and the end record line up', () => {
  const entries = [
    { name: 'A/idle.png', bytes: PNGS.idle },
    { name: 'A/README.txt', bytes: new TextEncoder().encode('hi') },
  ];
  const zip = C.buildZip(entries);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  const centralOffset = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(centralOffset, true), 0x02014b50);
  assert.equal(view.getUint32(centralOffset + 16, true), C.crc32(PNGS.idle));
});
