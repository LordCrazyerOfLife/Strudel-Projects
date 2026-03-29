(() => {
    const VERSION = "2.0.0";
    const ROOT = typeof window !== "undefined" ? window : globalThis;

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

    const STATE = ROOT.__hydraTextState || (ROOT.__hydraTextState = {
        hydra: null,
        scope: ROOT,
        sourceCtor: null,
        replaceHydraWrapped: false
    });

    function isHydraCandidate(hydra) {
        return Boolean(
            hydra &&
            (
                hydra.regl ||
                hydra.s?.[0] ||
                hydra.synth?.regl ||
                hydra.synth?.s?.[0]
            )
        );
    }

    function normalizeHydra(hydra) {
        if (!hydra) return null;

        const synth = hydra.synth || hydra;
        const canvas = hydra.canvas || synth.canvas || document.querySelector("canvas");

        return Object.assign({}, hydra, {
            synth,
            s: hydra.s || synth.s,
            regl: hydra.regl || synth.regl,
            pb: hydra.pb || synth.pb,
            width: hydra.width || synth.width || canvas?.width || canvas?.clientWidth || 0,
            height: hydra.height || synth.height || canvas?.height || canvas?.clientHeight || 0,
            canvas
        });
    }

    function getHydra() {
        const whereami = ROOT.location?.href?.includes("hydra.ojack.xyz")
            ? "editor"
            : ROOT.atom?.packages
            ? "atom"
            : "idk";

        if (whereami === "editor") {
            return normalizeHydra(ROOT.hydraSynth);
        }

        if (whereami === "atom") {
            return normalizeHydra(
                global.atom.packages.loadedPackages["atom-hydra"]?.mainModule?.main?.hydra
            );
        }

        const hydra = [
            ROOT.hydraSynth,
            ROOT._hydra,
            ROOT.hydra,
            ROOT.h,
            ROOT.H,
            ROOT.hy,
            globalThis.hydraSynth,
            globalThis._hydra,
            globalThis.hydra
        ].find(isHydraCandidate);

        return normalizeHydra(hydra);
    }

    function getHydraScope(hydra) {
        if (!hydra) return ROOT;
        if (hydra.sandbox?.makeGlobal || hydra.makeGlobal) return ROOT;
        if (hydra.synth) return hydra.synth;
        return ROOT;
    }

    function getSourceCtor(hydra) {
        return hydra?.s?.[0]?.constructor || hydra?.synth?.s?.[0]?.constructor || null;
    }

    function ensureDefaults() {
        ROOT.hydraText = Object.assign({}, DEFAULTS, ROOT.hydraText || {});
        return ROOT.hydraText;
    }

    function installSrcRelMask(scope) {
        scope.srcRelMask = function(tex) {
            const { hydra, scope: activeScope } = resolveHydraContext();
            if (!tex?.hasOwnProperty("src")) return activeScope.src(tex);

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

            const cw = () => hydra.canvas.clientWidth / hydra.canvas.clientHeight;
            const ch = () => hydra.canvas.clientHeight / hydra.canvas.clientWidth;

            return activeScope
                .src(tex)
                .mask(activeScope.shape(4, 1, 0))
                .scale(
                    1,
                    () => {
                        const canvasWidthRatio = cw();
                        const sourceWidthRatio = w();
                        return canvasWidthRatio > sourceWidthRatio ? sourceWidthRatio / canvasWidthRatio : 1;
                    },
                    () => {
                        const canvasHeightRatio = ch();
                        const sourceHeightRatio = h();
                        return canvasHeightRatio > sourceHeightRatio ? sourceHeightRatio / canvasHeightRatio : 1;
                    }
                );
        };
    }

    function installHydraText(hydra = getHydra()) {
        const normalized = normalizeHydra(hydra);
        const sourceCtor = getSourceCtor(normalized);

        if (!normalized || !sourceCtor) {
            throw new Error(
                "[hydra-text] Could not find a compatible Hydra instance. Load this after Hydra is initialized."
            );
        }

        const scope = getHydraScope(normalized);

        STATE.hydra = normalized;
        STATE.scope = scope;
        STATE.sourceCtor = sourceCtor;

        ROOT._hydra = normalized;
        ROOT._hydraScope = scope;
        ensureDefaults();
        installSrcRelMask(scope);
        installApi(scope);
        wrapReplaceHydra();

        return normalized;
    }

    function resolveHydraContext() {
        const latest = getHydra();

        if (!latest && STATE.hydra) {
            return STATE;
        }

        const changed =
            latest &&
            (
                STATE.hydra?.canvas !== latest.canvas ||
                STATE.hydra?.regl !== latest.regl ||
                STATE.hydra?.pb !== latest.pb
            );

        if (!STATE.hydra || changed) {
            installHydraText(latest);
        }

        return STATE;
    }

    function isPercentage(value) {
        return String(value).endsWith("%");
    }

    function getPercentage(value) {
        return Number(String(value).slice(0, -1)) / 100;
    }

    function getHydraSize(hydra) {
        const width = hydra.width || hydra.canvas?.width || hydra.canvas?.clientWidth || 0;
        const height = hydra.height || hydra.canvas?.height || hydra.canvas?.clientHeight || 0;
        return { width, height };
    }

    function renderText(ctx, canvas, hydra, str, configInput, fill, stroke, fillAfter) {
        const text = String(str ?? "");
        const lines = text.split("\n");
        const longestLine = lines.reduce((longest, line) => longest.length > line.length ? longest : line, "");

        const baseConfig = typeof configInput === "string" ? { font: configInput } : (configInput || {});
        const config = Object.assign({}, ensureDefaults(), baseConfig);
        const { width } = getHydraSize(hydra);
        const safeWidth = Math.max(width, 1);
        const fontStyle = config.fontStyle;
        const fontName = config.font;
        config.textBaseline = "middle";

        const fontWithSize = (size) => `${fontStyle} ${size} ${fontName}`;

        canvas.width = safeWidth;
        ctx.font = fontWithSize("1px");

        let padding = safeWidth / 20;
        let textWidth = safeWidth - padding;
        let measuredWidth = ctx.measureText(longestLine || " ").width || 1;
        let fontSize = textWidth / measuredWidth;
        canvas.height = fontSize * 1.4 * Math.max(lines.length, 1);

        if (isPercentage(config.fontSize)) {
            fontSize *= getPercentage(config.fontSize);
        } else if (config.fontSize !== "auto") {
            fontSize = Number(String(config.fontSize).replace(/[^0-9.,]+/, "")) || fontSize;
        }

        if (isPercentage(config.lineWidth)) {
            config.lineWidth = fontSize * getPercentage(config.lineWidth);
        }

        fontSize *= config.canvasResize;
        canvas.width *= config.canvasResize;
        canvas.height *= config.canvasResize;
        textWidth *= config.canvasResize;
        padding *= config.canvasResize;
        config.lineWidth *= config.canvasResize;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        config.font = fontWithSize(`${fontSize}px`);
        Object.assign(ctx, config);

        let x = 0;
        if (ctx.textAlign === "center") x = canvas.width / 2;
        else if (ctx.textAlign === "left") x = padding / 2;
        else if (ctx.textAlign === "right") x = canvas.width - padding / 2;

        lines.forEach((line, index) => {
            const y = (canvas.height / (lines.length + 1)) * (index + 1);
            if (fill) ctx.fillText(line, x, y, textWidth);
            if (stroke) ctx.strokeText(line, x, y, textWidth);
            if (fillAfter) ctx.fillText(line, x, y, textWidth);
        });

        return config.interpolation;
    }

    function createSource() {
        const { hydra, sourceCtor } = resolveHydraContext();
        return new sourceCtor({
            regl: hydra.regl,
            pb: hydra.pb,
            width: hydra.width,
            height: hydra.height
        });
    }

    function createTextFactory(fill, stroke, fillAfter) {
        return function(str, config) {
            const { hydra, scope } = resolveHydraContext();
            const source = createSource();
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");

            const interpolation = renderText(ctx, canvas, hydra, str, config, fill, stroke, fillAfter);
            source.init({ src: canvas }, { min: interpolation, mag: interpolation });
            return scope.srcRelMask(source);
        };
    }

    function createDynamicTextSource() {
        const { hydra } = resolveHydraContext();
        const source = createSource();
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        let initialized = false;

        const draw = (text, config, fill, stroke, fillAfter) => {
            const interpolation = renderText(ctx, canvas, hydra, text, config, fill, stroke, fillAfter);

            if (!initialized) {
                source.init({ src: canvas }, { min: interpolation, mag: interpolation });
                source.dynamic = true;
                initialized = true;
            } else {
                source.tex.subimage(canvas);
            }

            return source;
        };

        source.text = (text, config) => draw(text, config, true, false, false);
        source.strokeText = (text, config) => draw(text, config, false, true, false);
        source.fillStrokeText = (text, config) => draw(text, config, true, true, false);
        source.strokeFillText = (text, config) => draw(text, config, false, true, true);

        return source;
    }

    function installApi(scope) {
        scope.createText = function() {
            resolveHydraContext();
            return createDynamicTextSource();
        };

        scope.text = createTextFactory(true, false, false);
        scope.strokeText = createTextFactory(false, true, false);
        scope.fillStrokeText = createTextFactory(true, true, false);
        scope.strokeFillText = createTextFactory(false, true, true);

        ROOT.createText = scope.createText;
        ROOT.text = scope.text;
        ROOT.strokeText = scope.strokeText;
        ROOT.fillStrokeText = scope.fillStrokeText;
        ROOT.strokeFillText = scope.strokeFillText;
        ROOT.installHydraText = installHydraText;
        ROOT.refreshHydraText = () => installHydraText(getHydra());
    }

    function wrapReplaceHydra() {
        if (STATE.replaceHydraWrapped) return;
        if (typeof ROOT.replaceHydra !== "function") return;

        const originalReplaceHydra = ROOT.replaceHydra;
        ROOT.replaceHydra = async function(...args) {
            const hydra = await originalReplaceHydra.apply(this, args);
            installHydraText(hydra);
            return hydra;
        };
        STATE.replaceHydraWrapped = true;
    }

    installHydraText();
    console.log(`[hydra-text] Extension loaded v${VERSION}`);
})();
