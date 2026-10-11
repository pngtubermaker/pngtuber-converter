/*
 * The converter page: collect four frames, then build a PNGTuber Plus
 * .save, a PNGTuber-Remix .pngRemix or a ZIP of PNGs from them. Everything
 * happens in this tab; no image leaves the computer.
 */
(function () {
  'use strict';

  var C = window.PNGTuberConverter;
  var ROLES = ['idle', 'talking', 'blink', 'blinkTalking'];
  var LABELS = {
    idle: 'Idle',
    talking: 'Talking',
    blink: 'Blink',
    blinkTalking: 'Blink + talking',
  };
  /** The free characters live on the OBS player's site, same origin. */
  var SAMPLES = '../pngtuber-obs-player/';
  var MAX_SIDE = 1024;

  var frames = {}; // role -> { image, url, width, height }
  var activeSample = null;

  function $(id) {
    return document.getElementById(id);
  }

  // --- Frames ----------------------------------------------------------------

  /** Which frame a file name describes, or null if it doesn't say. */
  function roleFromName(fileName) {
    var name = fileName
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, '')
      .replace(/[\s_]+/g, '-');
    var blink = /blink|eyes?-closed|closed-eyes?/.test(name);
    var talk = /talk|speak|scream|mouth-open|open-mouth/.test(name);
    if (blink && talk) return 'blinkTalking';
    if (blink) return 'blink';
    if (talk) return 'talking';
    if (/idle|neutral|quiet|default|rest/.test(name)) return 'idle';
    return null;
  }

  function loadImage(src) {
    var image = new Image();
    image.src = src;
    return image.decode().then(function () {
      return {
        image: image,
        url: src,
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
    });
  }

  function addFiles(fileList, forcedRole) {
    var files = Array.prototype.slice.call(fileList).filter(function (file) {
      return /^image\//.test(file.type);
    });
    if (!files.length) return;
    var taken = {};
    var plan = files.map(function (file) {
      var role = forcedRole || roleFromName(file.name);
      if (role && taken[role]) role = null;
      if (role) taken[role] = true;
      return { file: file, role: role };
    });
    plan.forEach(function (item) {
      if (item.role) return;
      for (var i = 0; i < ROLES.length; i++) {
        if (!taken[ROLES[i]]) {
          item.role = ROLES[i];
          taken[ROLES[i]] = true;
          return;
        }
      }
    });
    setSample(null);
    Promise.all(
      plan
        .filter(function (item) {
          return item.role;
        })
        .map(function (item) {
          return loadImage(URL.createObjectURL(item.file)).then(function (frame) {
            if (frames[item.role]) URL.revokeObjectURL(frames[item.role].url);
            frames[item.role] = frame;
          });
        })
    ).then(refresh);
  }

  function setSample(slug) {
    activeSample = slug;
    var buttons = document.querySelectorAll('.sample');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute(
        'aria-pressed',
        String(buttons[i].dataset.slug === slug)
      );
    }
  }

  function loadSample(sample) {
    setSample(sample.slug);
    var name = $('name');
    if (!name.value || name.dataset.fromSample === 'true') {
      name.value = sample.name;
      name.dataset.fromSample = 'true';
    }
    Promise.all(
      ROLES.map(function (role) {
        return loadImage(SAMPLES + sample.frames[role]).then(function (frame) {
          return { role: role, frame: frame };
        });
      })
    ).then(function (loaded) {
      if (activeSample !== sample.slug) return;
      frames = {};
      loaded.forEach(function (item) {
        frames[item.role] = item.frame;
      });
      refresh();
    });
  }

  /** A frame as PNG bytes, scaled so its long side is at most maxSide. */
  function pngBytes(frame, maxSide) {
    var scale = Math.min(1, maxSide / Math.max(frame.width, frame.height));
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(frame.width * scale);
    canvas.height = Math.round(frame.height * scale);
    canvas.getContext('2d').drawImage(frame.image, 0, 0, canvas.width, canvas.height);
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        blob.arrayBuffer().then(function (buffer) {
          resolve(new Uint8Array(buffer));
        });
      }, 'image/png');
    });
  }

  /** All present frames as { role: PNG bytes }. */
  function allPngs(maxSide) {
    var present = ROLES.filter(function (role) {
      return frames[role];
    });
    return Promise.all(
      present.map(function (role) {
        return pngBytes(frames[role], maxSide);
      })
    ).then(function (list) {
      var out = {};
      present.forEach(function (role, index) {
        out[role] = list[index];
      });
      return out;
    });
  }

  // --- Rendering the page ----------------------------------------------------

  function renderSlots() {
    var slots = $('slots');
    slots.textContent = '';
    ROLES.forEach(function (role) {
      var slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'slot';
      slot.title = 'Choose the ' + LABELS[role].toLowerCase() + ' frame';
      var picture;
      if (frames[role]) {
        picture = document.createElement('img');
        picture.src = frames[role].url;
        picture.alt = '';
      } else {
        picture = document.createElement('span');
        picture.className = 'blank';
      }
      slot.appendChild(picture);
      slot.appendChild(document.createTextNode(LABELS[role]));
      slot.onclick = function () {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/webp,image/jpeg';
        input.onchange = function () {
          addFiles(input.files, role);
        };
        input.click();
      };
      slot.ondragover = function (event) {
        event.preventDefault();
      };
      slot.ondrop = function (event) {
        event.preventDefault();
        addFiles(event.dataTransfer.files, role);
      };
      slots.appendChild(slot);
    });
  }

  function refresh() {
    renderSlots();
    var idle = frames.idle;
    var mismatch =
      idle &&
      ROLES.some(function (role) {
        var frame = frames[role];
        return frame && (frame.width !== idle.width || frame.height !== idle.height);
      });
    var warning = $('size-warning');
    warning.hidden = !mismatch;
    warning.textContent = mismatch
      ? "These frames aren't all the same size, so your character may jump when it talks."
      : '';
    ['get-plus', 'get-remix', 'get-zip'].forEach(function (id) {
      $(id).disabled = !idle;
    });
    var missing = ROLES.filter(function (role) {
      return !frames[role];
    }).map(function (role) {
      return LABELS[role].toLowerCase();
    });
    $('download-note').textContent = !idle
      ? 'Add your frames first.'
      : missing.length
        ? 'Missing: ' + missing.join(', ') + '. The files will have only the frames you added.'
        : '';
  }

  // --- Downloads -------------------------------------------------------------

  function slug(text) {
    return (
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'my-pngtuber'
    );
  }

  function characterName() {
    return $('name').value.trim() || 'My PNGTuber';
  }

  function save(bytes, fileName, type) {
    var link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([bytes], { type: type }));
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(link.href);
    }, 10000);
  }

  function busy(button, promise) {
    var label = button.textContent;
    button.disabled = true;
    button.textContent = 'Building…';
    return promise.then(function () {
      button.textContent = label;
      button.disabled = false;
    });
  }

  $('get-plus').onclick = function () {
    var size = Number($('plus-size').value);
    busy(
      $('get-plus'),
      allPngs(size).then(function (pngs) {
        save(C.buildPlusSave(pngs), slug(characterName()) + '.save', 'application/json');
      })
    );
  };

  $('get-remix').onclick = function () {
    busy(
      $('get-remix'),
      allPngs(MAX_SIDE).then(function (pngs) {
        save(C.buildRemixModel(pngs), slug(characterName()) + '.pngRemix', 'application/octet-stream');
      })
    );
  };

  $('get-zip').onclick = function () {
    var name = characterName();
    var folder = slug(name);
    busy(
      $('get-zip'),
      allPngs(MAX_SIDE).then(function (pngs) {
        var entries = C.FRAMES.filter(function (frame) {
          return pngs[frame.role];
        }).map(function (frame) {
          return { name: folder + '/' + frame.file, bytes: pngs[frame.role] };
        });
        entries.push({
          name: folder + '/README.txt',
          bytes: new TextEncoder().encode(
            name + '\n\n' +
              'idle.png           mouth closed, eyes open\n' +
              'talking.png        mouth open, eyes open\n' +
              'blink.png          mouth closed, eyes closed\n' +
              'blink-talking.png  mouth open, eyes closed\n\n' +
              'veadotube mini: neutral face = idle.png, screaming face = talking.png,\n' +
              'closed-eye face = blink.png, closed-eye screaming face = blink-talking.png.\n\n' +
              'Made with PNGTuber Converter: https://pngtubermaker.github.io/pngtuber-converter/\n'
          ),
        });
        save(C.buildZip(entries), folder + '.zip', 'application/zip');
      })
    );
  };

  // --- Wiring ----------------------------------------------------------------

  var drop = $('drop');
  $('files').onchange = function () {
    addFiles($('files').files);
    $('files').value = '';
  };
  drop.ondragover = function (event) {
    event.preventDefault();
    drop.classList.add('over');
  };
  drop.ondragleave = function () {
    drop.classList.remove('over');
  };
  drop.ondrop = function (event) {
    event.preventDefault();
    drop.classList.remove('over');
    addFiles(event.dataTransfer.files);
  };
  $('name').oninput = function () {
    $('name').dataset.fromSample = 'false';
  };

  fetch(SAMPLES + 'samples/samples.json')
    .then(function (response) {
      return response.json();
    })
    .then(function (samples) {
      var row = $('samples');
      samples.forEach(function (sample) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'sample';
        button.dataset.slug = sample.slug;
        button.setAttribute('aria-pressed', 'false');
        var face = document.createElement('img');
        face.src = SAMPLES + sample.frames.idle;
        face.alt = '';
        button.appendChild(face);
        button.appendChild(document.createTextNode(sample.name));
        button.onclick = function () {
          loadSample(sample);
        };
        row.appendChild(button);
      });
    })
    .catch(function () {});

  refresh();
})();
