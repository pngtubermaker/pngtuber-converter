/*!
 * PNGTuber Converter — https://github.com/pngtubermaker/pngtuber-converter
 * MIT License. Made by PNGTuber Maker (https://pngtubermaker.net/).
 *
 * Turns the four frames of a PNGTuber (idle, talking, blink, blink-talking,
 * each a PNG file's bytes) into files PNGTuber apps open directly:
 *
 * - PNGTuber Plus: a .save file (JSON, images embedded as base64 PNG).
 * - PNGTuber-Remix: a .pngRemix file (Godot 4 binary Variant, images
 *   embedded as PNG bytes in the per-sprite layout every version from
 *   1.3.5 to 1.4.7 reads).
 * - Anything else: a plain ZIP of the four PNGs.
 *
 * Pure functions on bytes, no DOM, so the tests run them in Node.
 */
(function (root) {
  'use strict';

  /** The four frames, and which mouth and eyes each one shows. */
  var FRAMES = [
    { role: 'idle', file: 'idle.png', mouthOpen: false, eyesOpen: true },
    { role: 'talking', file: 'talking.png', mouthOpen: true, eyesOpen: true },
    { role: 'blink', file: 'blink.png', mouthOpen: false, eyesOpen: false },
    {
      role: 'blinkTalking',
      file: 'blink-talking.png',
      mouthOpen: true,
      eyesOpen: false,
    },
  ];

  /** A random positive 31-bit id, never 0. */
  function randomId(random) {
    return 1 + Math.floor((random || Math.random)() * 0x7ffffffe);
  }

  function base64(bytes) {
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  // --- PNGTuber Plus ---------------------------------------------------------

  /**
   * A PNGTuber Plus avatar (.save). Each frame is one sprite that shows only
   * in its own mouth/eye state: showTalk and showBlink are 0 = always,
   * 1 = only while NOT talking/blinking, 2 = only while talking/blinking.
   *
   * Plus loads an image from `path` first and falls back to `imageData`, so
   * `path` is a user:// path unique to this avatar that nothing else uses.
   * Positions are Godot var_to_str strings inside the JSON, as Plus writes
   * them.
   *
   * pngs: { idle, talking, blink, blinkTalking } as Uint8Array PNG bytes.
   */
  function buildPlusSave(pngs, options) {
    var opts = options || {};
    var folder = 'pngtubermaker-' + randomId(opts.random).toString(36);
    var save = {};
    var index = 0;
    FRAMES.forEach(function (frame) {
      var png = pngs[frame.role];
      if (!png) return;
      save[String(index++)] = {
        type: 'sprite',
        path: 'user://' + folder + '/' + frame.file,
        imageData: base64(png),
        identification: randomId(opts.random),
        parentId: null,
        pos: 'Vector2(0, 0)',
        offset: 'Vector2(0, 0)',
        zindex: 0,
        drag: 0,
        xFrq: 0,
        xAmp: 0,
        yFrq: 0,
        yAmp: 0,
        rotDrag: 0,
        showTalk: frame.mouthOpen ? 2 : 1,
        showBlink: frame.eyesOpen ? 1 : 2,
        rLimitMin: -180,
        rLimitMax: 180,
        costumeLayers: '[1, 1, 1, 1, 1, 1, 1, 1, 1, 1]',
        stretchAmount: 0,
        ignoreBounce: false,
        frames: 1,
        animSpeed: 0,
        clipped: false,
        toggle: 'null',
      };
    });
    return JSON.stringify(save);
  }

  // --- Godot 4 binary Variant -------------------------------------------------
  // The layout of core/io/marshalls.cpp ("Binary serialization API" in the
  // Godot docs): a u32 type id, then the value, everything little-endian and
  // padded to 4 bytes. Only the types a PNGTuber-Remix model uses.

  function GFloat(value) {
    this.value = value;
  }
  function StringName(value) {
    this.value = value;
  }
  function Vector2(x, y) {
    this.x = x;
    this.y = y;
  }
  function Color(r, g, b, a) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a == null ? 1 : a;
  }
  /** A Dictionary whose keys are StringNames, as GDScript `{key = ...}` makes. */
  function NamedDict(entries) {
    this.entries = entries;
  }

  var TYPE = {
    NIL: 0,
    BOOL: 1,
    INT: 2,
    FLOAT: 3,
    STRING: 4,
    VECTOR2: 5,
    COLOR: 20,
    STRING_NAME: 21,
    DICTIONARY: 27,
    ARRAY: 28,
    PACKED_BYTE_ARRAY: 29,
  };
  var ENCODE_64 = 1 << 16;

  function Writer() {
    this.bytes = new Uint8Array(1 << 16);
    this.length = 0;
  }
  Writer.prototype.reserve = function (count) {
    if (this.length + count <= this.bytes.length) return;
    var capacity = this.bytes.length * 2;
    while (capacity < this.length + count) capacity *= 2;
    var next = new Uint8Array(capacity);
    next.set(this.bytes.subarray(0, this.length));
    this.bytes = next;
  };
  Writer.prototype.view = function (count) {
    this.reserve(count);
    var view = new DataView(this.bytes.buffer, this.length, count);
    this.length += count;
    return view;
  };
  Writer.prototype.u32 = function (value) {
    this.view(4).setUint32(0, value >>> 0, true);
  };
  Writer.prototype.i32 = function (value) {
    this.view(4).setInt32(0, value, true);
  };
  Writer.prototype.f32 = function (value) {
    this.view(4).setFloat32(0, value, true);
  };
  Writer.prototype.f64 = function (value) {
    this.view(8).setFloat64(0, value, true);
  };
  Writer.prototype.raw = function (bytes) {
    this.reserve(bytes.length);
    this.bytes.set(bytes, this.length);
    this.length += bytes.length;
  };
  Writer.prototype.pad = function () {
    while (this.length % 4) {
      this.reserve(1);
      this.bytes[this.length++] = 0;
    }
  };
  Writer.prototype.string = function (text) {
    var bytes = new TextEncoder().encode(text);
    this.u32(bytes.length);
    this.raw(bytes);
    this.pad();
  };

  function writeFloat(writer, value) {
    if (Math.fround(value) === value) {
      writer.u32(TYPE.FLOAT);
      writer.f32(value);
    } else {
      writer.u32(TYPE.FLOAT | ENCODE_64);
      writer.f64(value);
    }
  }

  function writeDict(writer, entries, namedKeys) {
    var keys = Object.keys(entries);
    writer.u32(TYPE.DICTIONARY);
    writer.u32(keys.length);
    keys.forEach(function (key) {
      writer.u32(namedKeys ? TYPE.STRING_NAME : TYPE.STRING);
      writer.string(key);
      writeVariant(writer, entries[key]);
    });
  }

  function writeVariant(writer, value) {
    if (value === null || value === undefined) {
      writer.u32(TYPE.NIL);
    } else if (typeof value === 'boolean') {
      writer.u32(TYPE.BOOL);
      writer.u32(value ? 1 : 0);
    } else if (value instanceof GFloat) {
      writeFloat(writer, value.value);
    } else if (typeof value === 'number') {
      if (!Number.isInteger(value)) {
        writeFloat(writer, value);
      } else if (value >= -2147483648 && value <= 2147483647) {
        writer.u32(TYPE.INT);
        writer.i32(value);
      } else {
        throw new Error('64-bit ints are not supported: ' + value);
      }
    } else if (typeof value === 'string') {
      writer.u32(TYPE.STRING);
      writer.string(value);
    } else if (value instanceof StringName) {
      writer.u32(TYPE.STRING_NAME);
      writer.string(value.value);
    } else if (value instanceof Vector2) {
      writer.u32(TYPE.VECTOR2);
      writer.f32(value.x);
      writer.f32(value.y);
    } else if (value instanceof Color) {
      writer.u32(TYPE.COLOR);
      writer.f32(value.r);
      writer.f32(value.g);
      writer.f32(value.b);
      writer.f32(value.a);
    } else if (value instanceof Uint8Array) {
      writer.u32(TYPE.PACKED_BYTE_ARRAY);
      writer.u32(value.length);
      writer.raw(value);
      writer.pad();
    } else if (Array.isArray(value)) {
      writer.u32(TYPE.ARRAY);
      writer.u32(value.length);
      value.forEach(function (item) {
        writeVariant(writer, item);
      });
    } else if (value instanceof NamedDict) {
      writeDict(writer, value.entries, true);
    } else if (typeof value === 'object') {
      writeDict(writer, value, false);
    } else {
      throw new Error('Unsupported value: ' + value);
    }
  }

  /** var_to_bytes(value). */
  function encodeVariant(value) {
    var writer = new Writer();
    writeVariant(writer, value);
    return writer.bytes.slice(0, writer.length);
  }

  /** FileAccess.store_var(value): a u32 length, then var_to_bytes(value). */
  function storeVar(value) {
    var body = encodeVariant(value);
    var out = new Uint8Array(4 + body.length);
    new DataView(out.buffer).setUint32(0, body.length, true);
    out.set(body, 4);
    return out;
  }

  // --- PNGTuber-Remix --------------------------------------------------------

  /**
   * A PNGTuber-Remix model (.pngRemix). One sprite per frame, each shown
   * only in its own state: should_talk + open_mouth (true = shows while
   * speaking) and should_blink + open_eyes (true = shows while the eyes are
   * open). Images go in each sprite's `img`, the layout 1.3.5 reads and
   * 1.4.x still reads. sprite_id must be unique and non-zero, because a
   * parent_id of 0 means "top level".
   */
  function buildRemixModel(pngs) {
    var sprites = [];
    FRAMES.forEach(function (frame, index) {
      var png = pngs[frame.role];
      if (!png) return;
      sprites.push({
        states: [
          new NamedDict({
            should_talk: true,
            open_mouth: frame.mouthOpen,
            should_blink: true,
            open_eyes: frame.eyesOpen,
            position: new Vector2(0, 0),
            offset: new Vector2(0, 0),
            z_index: 0,
          }),
        ],
        sprite_name: frame.file.replace('.png', ''),
        sprite_id: new GFloat(1000 + index),
        parent_id: new GFloat(0),
        sprite_type: 'Sprite2D',
        img: png,
        is_asset: false,
        saved_event: null,
        was_active_before: true,
        should_disappear: false,
        show_only: false,
        saved_disappear: [],
        saved_keys: [],
        hold_to_show: false,
        is_collapsed: false,
        layer_color: new Color(0, 0, 0, 1),
        image_id: 0,
        normal_id: 0,
        rotated: new GFloat(0),
        flipped_h: false,
        flipped_v: false,
        rest_mode: 1,
        ik_target: -1,
        updated_follow_movement: true,
      });
    });
    return storeVar({
      version: '1.4.7',
      sprites_array: sprites,
      settings_dict: new NamedDict({
        states: [
          new NamedDict({
            mouth_closed: 0,
            mouth_open: 3,
            current_mc_anim: 'Idle',
            current_mo_anim: 'One Bounce',
          }),
        ],
        light_states: [new NamedDict({})],
        // Settings merge into the previous session's, so always set the view.
        zoom: new Vector2(0.5, 0.5),
        pan: new Vector2(0, 0),
      }),
      input_array: [],
    });
  }

  // --- ZIP -------------------------------------------------------------------

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * A ZIP of { name, bytes } entries, stored without compression: PNGs are
   * compressed already. Names are UTF-8 (flag bit 11).
   */
  function buildZip(entries) {
    var DOS_TIME = 0; // 00:00:00
    var DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01
    var parts = [];
    var central = [];
    var offset = 0;
    entries.forEach(function (entry) {
      var name = new TextEncoder().encode(entry.name);
      var crc = crc32(entry.bytes);
      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, DOS_TIME, true);
      local.setUint16(12, DOS_DATE, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, entry.bytes.length, true);
      local.setUint32(22, entry.bytes.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), name, entry.bytes);

      var record = new DataView(new ArrayBuffer(46));
      record.setUint32(0, 0x02014b50, true);
      record.setUint16(4, 20, true);
      record.setUint16(6, 20, true);
      record.setUint16(8, 0x0800, true);
      record.setUint16(10, 0, true);
      record.setUint16(12, DOS_TIME, true);
      record.setUint16(14, DOS_DATE, true);
      record.setUint32(16, crc, true);
      record.setUint32(20, entry.bytes.length, true);
      record.setUint32(24, entry.bytes.length, true);
      record.setUint16(28, name.length, true);
      record.setUint32(42, offset, true);
      central.push(new Uint8Array(record.buffer), name);
      offset += 30 + name.length + entry.bytes.length;
    });
    var centralSize = central.reduce(function (sum, part) {
      return sum + part.length;
    }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    var all = parts.concat(central, [new Uint8Array(end.buffer)]);
    var total = all.reduce(function (sum, part) {
      return sum + part.length;
    }, 0);
    var out = new Uint8Array(total);
    var position = 0;
    all.forEach(function (part) {
      out.set(part, position);
      position += part.length;
    });
    return out;
  }

  var api = {
    FRAMES: FRAMES,
    buildPlusSave: buildPlusSave,
    buildRemixModel: buildRemixModel,
    buildZip: buildZip,
    // Lower-level pieces, exported for the tests.
    encodeVariant: encodeVariant,
    storeVar: storeVar,
    crc32: crc32,
    GFloat: GFloat,
    StringName: StringName,
    Vector2: Vector2,
    Color: Color,
    NamedDict: NamedDict,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PNGTuberConverter = api;
})(typeof window !== 'undefined' ? window : globalThis);
