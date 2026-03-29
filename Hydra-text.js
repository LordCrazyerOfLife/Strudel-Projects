const VERSION = "0.1.0";

const DEFAULTS = {
  font: "sans-serif",
  fontStyle: "normal",
  fontSize: "auto",
  textAlign: "center",
  fillStyle: "white",
  strokeStyle: "white",
  lineWidth: "2%",
  lineJoin: "miter",
  canvasResize: 2,
  interpolation: "linear"
};

let installedHydra = null;

function getInstalledSynth() {
  const synth = installedHydra?.synth || installedHydra;
  if (!synth) {
    throw new Error("[hydra-text] Extension is not installed yet. Call install(hydra) first.");
  }
  return synth;
}

function isPercentage(value) {
  return String(value).endsWith("%");
}

function getPercentage(value) {
  return Number(String(value).slice(0, -1)) / 100;
}

function getSourceConstructor(hydra) {
  const source = hydra?.s?.[0];
  if (!source) {
    throw new Error("[hydra-text] Could not find hydra.s[0]. Load this after Hydra is initialized.");
  }
  return source.constructor;
}

function getCanvas(hydra) {
  return hydra.canvas || hydra.synth?.canvas || document.querySelector("canvas");
}

function getDimensions(hydra) {
  const canvas = getCanvas(hydra);
  return {
    width: hydra.width || hydra.synth?.width || canvas?.width || 1280,
    height: hydra.height || hydra.synth?.height || canvas?.height || 720
  };
}

function renderText(ctx, canvas, hydra, str, configInput, fill, stroke, fillAfter) {
  const lines = String(str).split("\n");
  const longestLine = lines.reduce((a, b) => (a.length > b.length ? a : b), "");
  const config =
    typeof configInput === "string"
      ? { ...DEFAULTS, font: configInput }
      : { ...DEFAULTS, ...(configInput || {}) };

  const { width } = getDimensions(hydra);
  const fontWithSize = (size) => `${config.fontStyle} ${size} ${config.font}`;

  canvas.width = width;
  ctx.font = fontWithSize("1px");

  let padding = width / 20;
  let textWidth = width - padding;
  let fontSize = textWidth / Math.max(ctx.measureText(longestLine || " ").width, 1);

  canvas.height = fontSize * 1.4 * Math.max(lines.length, 1);

  if (isPercentage(config.fontSize)) {
    fontSize *= getPercentage(config.fontSize);
  } else if (config.fontSize !== "auto") {
    fontSize = Number(String(config.fontSize).replace(/[^0-9.,]+/, "")) || fontSize;
  }

  const lineWidth = isPercentage(config.lineWidth)
    ? fontSize * getPercentage(config.lineWidth)
    : Number(config.lineWidth) || 0;

  fontSize *= config.canvasResize;
  canvas.width *= config.canvasResize;
  canvas.height *= config.canvasResize;
  textWidth *= config.canvasResize;
  padding *= config.canvasResize;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  Object.assign(ctx, config, {
    font: fontWithSize(`${fontSize}px`),
    textBaseline: "middle",
    lineWidth: lineWidth * config.canvasResize
  });

  let x = 0;
  if (ctx.textAlign === "center") x = canvas.width / 2;
  else if (ctx.textAlign === "left") x = padding / 2;
  else if (ctx.textAlign === "right") x = canvas.width - padding / 2;

  lines.forEach((line, i) => {
    const y = (canvas.height / (lines.length + 1)) * (i + 1);
    if (fill) ctx.fillText(line, x, y, textWidth);
    if (stroke) ctx.strokeText(line, x, y, textWidth);
    if (fillAfter) ctx.fillText(line, x, y, textWidth);
  });

  return config.interpolation;
}

function createSrcRelMask(hydra, synth) {
  return function srcRelMask(tex) {
    if (!Object.prototype.hasOwnProperty.call(tex, "src")) {
      return synth.src(tex);
    }

    const canvas = getCanvas(hydra);
    const canvasWidth = canvas?.clientWidth || canvas?.width || getDimensions(hydra).width;
    const canvasHeight = canvas?.clientHeight || canvas?.height || getDimensions(hydra).height;

    const w = () =>
      tex.src?.width
        ? tex.src.width / tex.src.height
        : tex.src?.videoWidth
          ? tex.src.videoWidth / tex.src.videoHeight
          : 0;

    const h = () =>
      tex.src?.height
        ? tex.src.height / tex.src.width
        : tex.src?.videoHeight
          ? tex.src.videoHeight / tex.src.videoWidth
          : 0;

    const cw = () => canvasWidth / canvasHeight;
    const ch = () => canvasHeight / canvasWidth;

    return synth
      .src(tex)
      .mask(synth.shape(4, 1, 0))
      .scale(
        1,
        () => {
          const canvasRatio = cw();
          const sourceRatio = w();
          return canvasRatio > sourceRatio ? sourceRatio / canvasRatio : 1;
        },
        () => {
          const canvasRatio = ch();
          const sourceRatio = h();
          return canvasRatio > sourceRatio ? sourceRatio / canvasRatio : 1;
        }
      );
  };
}

function createReusableTextSource(hydra, synth, Source) {
  const source = new Source({
    regl: hydra.regl,
    pb: hydra.pb,
    width: getDimensions(hydra).width,
    height: getDimensions(hydra).height
  });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  let initialized = false;

  const createTextMethod = (fill, stroke, fillAfter) => {
    return function textMethod(str, config) {
      const interpolation = renderText(ctx, canvas, hydra, str, config, fill, stroke, fillAfter);

      if (!initialized) {
        source.init({ src: canvas }, { min: interpolation, mag: interpolation });
        source.dynamic = true;
        initialized = true;
      } else if (source.tex?.subimage) {
        source.tex.subimage(canvas);
      } else {
        source.init({ src: canvas }, { min: interpolation, mag: interpolation });
      }

      return source;
    };
  };

  source.text = createTextMethod(true, false, false);
  source.strokeText = createTextMethod(false, true, false);
  source.fillStrokeText = createTextMethod(true, true, false);
  source.strokeFillText = createTextMethod(false, true, true);

  return source;
}

function createOneShot(hydra, synth, Source, srcRelMask, str, config, fill, stroke, fillAfter) {
  const source = new Source({
    regl: hydra.regl,
    pb: hydra.pb,
    width: getDimensions(hydra).width,
    height: getDimensions(hydra).height
  });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const interpolation = renderText(ctx, canvas, hydra, str, config, fill, stroke, fillAfter);
  source.init({ src: canvas }, { min: interpolation, mag: interpolation });
  return srcRelMask(source);
}

function registerFunctions(hydra, synth) {
  const Source = getSourceConstructor(hydra);
  const srcRelMask = createSrcRelMask(hydra, synth);

  synth.srcRelMask = srcRelMask;
  synth.createText = function createText() {
    return createReusableTextSource(hydra, synth, Source);
  };
  synth.text = function text(str, config) {
    return createOneShot(hydra, synth, Source, srcRelMask, str, config, true, false, false);
  };
  synth.strokeText = function strokeText(str, config) {
    return createOneShot(hydra, synth, Source, srcRelMask, str, config, false, true, false);
  };
  synth.fillStrokeText = function fillStrokeText(str, config) {
    return createOneShot(hydra, synth, Source, srcRelMask, str, config, true, true, false);
  };
  synth.strokeFillText = function strokeFillText(str, config) {
    return createOneShot(hydra, synth, Source, srcRelMask, str, config, false, true, true);
  };

  if (typeof window !== "undefined") {
    window.hydraText = { ...DEFAULTS };
    window.srcRelMask = synth.srcRelMask;
    window.createText = synth.createText;
    window.text = synth.text;
    window.strokeText = synth.strokeText;
    window.fillStrokeText = synth.fillStrokeText;
    window.strokeFillText = synth.strokeFillText;
  }
}

function install(hydra) {
  const resolvedHydra = hydra?.synth ? hydra : hydra;
  const synth = resolvedHydra?.synth || resolvedHydra;

  if (!resolvedHydra || !synth) {
    console.error("[hydra-text] Could not find Hydra or hydra.synth");
    return false;
  }

  if (!resolvedHydra.regl && synth.regl) resolvedHydra.regl = synth.regl;
  if (!resolvedHydra.pb && synth.pb) resolvedHydra.pb = synth.pb;
  if (!resolvedHydra.s && synth.s) resolvedHydra.s = synth.s;
  if (!resolvedHydra.canvas) resolvedHydra.canvas = synth.canvas || document.querySelector("canvas");
  if (!resolvedHydra.width || !resolvedHydra.height) {
    const { width, height } = getDimensions(resolvedHydra);
    resolvedHydra.width = width;
    resolvedHydra.height = height;
  }

  if (!resolvedHydra.regl || !resolvedHydra.s?.[0]) {
    console.error("[hydra-text] Hydra is missing required internals: regl or s[0]");
    return false;
  }

  installedHydra = resolvedHydra;
  registerFunctions(resolvedHydra, synth);
  console.log(`[hydra-text] Installed text extension v${VERSION}`);
  return true;
}

function getInstalledHydra() {
  return installedHydra;
}

function findHydraGlobal() {
  return (
    (typeof window !== "undefined" && (
      window.hydraSynth ||
      window._hydra ||
      window.hydra ||
      window.h ||
      window.H ||
      window.hy
    )) ||
    null
  );
}

function autoInstall() {
  const hydra = findHydraGlobal();
  if (!hydra) {
    console.warn("[hydra-text] No Hydra global found for auto-install");
    return false;
  }
  return install(hydra);
}

function srcRelMask(...args) {
  return getInstalledSynth().srcRelMask(...args);
}

function createText(...args) {
  return getInstalledSynth().createText(...args);
}

function text(...args) {
  return getInstalledSynth().text(...args);
}

function strokeText(...args) {
  return getInstalledSynth().strokeText(...args);
}

function fillStrokeText(...args) {
  return getInstalledSynth().fillStrokeText(...args);
}

function strokeFillText(...args) {
  return getInstalledSynth().strokeFillText(...args);
}

export {
  VERSION,
  install,
  autoInstall,
  getInstalledHydra,
  srcRelMask,
  createText,
  text,
  strokeText,
  fillStrokeText,
  strokeFillText
};
export default install;

if (typeof window !== "undefined") {
  try {
    autoInstall();
  } catch (error) {
    console.warn("[hydra-text] Auto-install failed:", error);
  }
}
