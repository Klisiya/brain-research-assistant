const particleMotionQuery = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
const particlePointerQuery = window.matchMedia
    ? window.matchMedia("(hover: hover) and (pointer: fine)")
    : null;
const enableParticleMouseFollow = (
    (!particleMotionQuery || !particleMotionQuery.matches) &&
    (!particlePointerQuery || particlePointerQuery.matches)
);

if (window.particlesJS) {
particlesJS("particles-js", {
    particles: {
        number: {
            value: 110,
            density: {
                enable: true,
                value_area: 900
            }
        },
        color: {
            value: "#60a5fa"
        },
        shape: {
            type: "circle"
        },
        opacity: {
            value: 0.42,
            random: true
        },
        size: {
            value: 3,
            random: true
        },
        line_linked: {
            enable: true,
            distance: 150,
            color: "#38bdf8",
            opacity: 0.25,
            width: 1
        },
        move: {
            enable: true,
            speed: 1.3,
            direction: "none",
            random: true,
            straight: false,
            out_mode: "out"
        }
    },
    interactivity: {
        detect_on: "window",
        events: {
            onhover: {
                enable: enableParticleMouseFollow,
                mode: ["grab", "bubble"]
            },
            onclick: {
                enable: true,
                mode: "push"
            },
            resize: true
        },
        modes: {
            grab: {
                distance: 175,
                line_linked: {
                    opacity: 0.5
                }
            },
            push: {
                particles_nb: 3
            },
            bubble: {
                distance: 165,
                size: 3.6,
                duration: 1.2,
                opacity: 0.55,
                speed: 2
            }
        }
    },
    retina_detect: true
});
}

const promptButtons = document.querySelectorAll(".ai-quick-prompts button");
const questionInput = document.getElementById("questionInput");
const submitBtn = document.getElementById("submitBtn");
const chatForm = document.querySelector(".ai-composer");
const composerLoading = document.getElementById("composerLoading");
const textareaMaxHeight = 220;

if (composerLoading) {
    composerLoading.hidden = true;
}

function resizeQuestionInput() {
    if (!questionInput) return;

    const computedMinHeight = parseFloat(window.getComputedStyle(questionInput).minHeight);
    const minHeight = Number.isFinite(computedMinHeight) ? computedMinHeight : 96;

    questionInput.style.height = `${minHeight}px`;
    const nextHeight = Math.max(minHeight, Math.min(questionInput.scrollHeight, textareaMaxHeight));

    questionInput.style.height = `${nextHeight}px`;
    questionInput.style.overflowY = questionInput.scrollHeight > textareaMaxHeight ? "auto" : "hidden";
}

function updateSubmitState() {
    if (!questionInput || !submitBtn || questionInput.readOnly) return;

    submitBtn.disabled = !questionInput.value.trim();
}

if (questionInput) {
    resizeQuestionInput();

    questionInput.addEventListener("input", () => {
        resizeQuestionInput();
        updateSubmitState();
    });

    window.addEventListener("resize", resizeQuestionInput);

    questionInput.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();

            if (chatForm && questionInput.value.trim()) {
                chatForm.requestSubmit();
            }
        }
    });
}

promptButtons.forEach(button => {
    button.addEventListener("click", () => {
        if (!questionInput) return;

        questionInput.value = button.dataset.question || "";
        resizeQuestionInput();
        updateSubmitState();
        questionInput.focus();
    });
});

if (chatForm && questionInput && submitBtn) {
    updateSubmitState();

    chatForm.addEventListener("submit", event => {
        if (!questionInput.value.trim()) {
            event.preventDefault();
            updateSubmitState();
            return;
        }

        const chatWindow = document.getElementById("chatWindow");

        submitBtn.innerHTML = '<span class="button-spinner"></span><span>Thinking...</span>';
        submitBtn.disabled = true;
        questionInput.readOnly = true;
        chatForm.classList.add("is-submitting");
        chatForm.setAttribute("aria-busy", "true");

        if (composerLoading) {
            composerLoading.hidden = false;
        }

        if (chatWindow) {
            setTimeout(() => {
                chatWindow.scrollTo({
                    top: chatWindow.scrollHeight,
                    behavior: "smooth"
                });
            }, 80);
        }
    });
}

/* Scroll reveal animation: replay every time */

const revealItems = document.querySelectorAll(".reveal-item");

const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add("show");
        } else {
            entry.target.classList.remove("show");
        }
    });
}, {
    threshold: 0.16,
    rootMargin: "0px 0px -8% 0px"
});

revealItems.forEach(item => {
    revealObserver.observe(item);
});


/* Animated stats counter */

const statNumbers = document.querySelectorAll(".stat-number");
let statsStarted = false;

function animateNumber(element) {
    const target = Number(element.dataset.target);
    let current = 0;
    const duration = 1200;
    const steps = 45;
    const increment = target / steps;
    const intervalTime = duration / steps;

    const counter = setInterval(() => {
        current += increment;

        if (current >= target) {
            element.textContent = target;
            clearInterval(counter);
        } else {
            element.textContent = Math.floor(current);
        }
    }, intervalTime);
}

const statsObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting && !statsStarted) {
            statsStarted = true;
            statNumbers.forEach(number => animateNumber(number));
            statsObserver.disconnect();
        }
    });
}, {
    threshold: 0.4
});

const featureBar = document.querySelector(".feature-bar");

if (featureBar) {
    statsObserver.observe(featureBar);
}

/* Staged 3D brain showcase and model-bound region labels */

const brainShowcaseModel = document.getElementById("brainShowcaseModel");
const brainShowcaseSection = document.getElementById("brain-showcase");
const brainShowcaseStage = document.querySelector(".showcase-brain-stage");
const brainRegionLineLayer = document.querySelector(".brain-region-lines");
const brainRegionLabelLayer = document.querySelector(".brain-region-label-layer");
const showcaseLeftCopy = document.querySelector(".showcase-left");
const showcaseRightCopy = document.querySelector(".showcase-right");
const siteNavbar = document.querySelector(".navbar");

const prefersReducedShowcaseMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

// Model-space anchors for static/models/brain.glb after its node transforms.
// Tweak position/normal here if a region needs final visual calibration.
const brainRegions = [
    {
        id: "frontal-lobe",
        label: "Frontal Lobe",
        position: "-0.413m 0.337m 0.167m",
        normal: "-0.83m 0.45m 0.23m",
        url: "/brain-region/frontal-lobe",
        priority: 1,
        preferredSide: "left"
    },
    {
        id: "parietal-lobe",
        label: "Parietal Lobe",
        position: "0.006m 0.535m 0.118m",
        normal: "0.02m 0.97m 0.22m",
        url: "/brain-region/parietal-lobe",
        priority: 2,
        preferredSide: "right"
    },
    {
        id: "temporal-lobe",
        label: "Temporal Lobe",
        position: "-0.328m -0.066m 0.361m",
        normal: "-0.62m -0.12m 0.78m",
        url: "/brain-region/temporal-lobe",
        priority: 3,
        preferredSide: "left"
    },
    {
        id: "occipital-lobe",
        label: "Occipital Lobe",
        position: "0.533m 0.190m 0.160m",
        normal: "0.94m 0.27m 0.20m",
        url: "/brain-region/occipital-lobe",
        priority: 4,
        preferredSide: "right"
    },
    {
        id: "cerebellum",
        label: "Cerebellum",
        position: "0.247m -0.303m 0.331m",
        normal: "0.41m -0.76m 0.50m",
        url: "/brain-region/cerebellum",
        priority: 5,
        preferredSide: "right"
    },
    {
        id: "brainstem",
        label: "Brainstem",
        position: "0.113m -0.403m 0.138m",
        normal: "0.25m -0.92m 0.30m",
        url: "/brain-region/brainstem",
        priority: 6,
        preferredSide: "left"
    }
];

if (brainShowcaseModel && brainShowcaseSection && brainShowcaseStage) {
    const labelStates = new Map();
    let showcaseScrollTicking = false;
    let regionLabelFrame = null;
    let regionLabelsActive = false;
    let currentShowcaseProgress = 0;
    let userAdjustedBrainCamera = false;

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const lerp = (start, end, amount) => start + (end - start) * amount;
    const smoothstep = (start, end, value) => {
        const amount = clamp((value - start) / (end - start), 0, 1);
        return amount * amount * (3 - 2 * amount);
    };

    function getBaseModelSize() {
        const cssBase = Math.min(450, window.innerWidth * 0.32);
        return Math.max(cssBase, Math.min(340, window.innerWidth * 0.72));
    }

    function getExpandedModelSize(baseSize) {
        const heightLimit = window.innerHeight * 0.78;
        const widthLimit = window.innerWidth * (window.innerWidth < 900 ? 0.86 : 0.72);
        return Math.max(baseSize, Math.min(heightLimit, widthLimit, 860));
    }

    function getShowcaseProgress(rect) {
        const scrollableDistance = Math.max(1, rect.height - window.innerHeight);
        return clamp(-rect.top / scrollableDistance, 0, 1);
    }

    function createBrainRegionHotspots() {
        if (!brainRegionLineLayer || !brainRegionLabelLayer) return;

        const svgNamespace = "http://www.w3.org/2000/svg";

        brainRegions.forEach(region => {
            const hotspot = document.createElement("button");
            hotspot.type = "button";
            hotspot.className = "brain-hotspot";
            hotspot.slot = `hotspot-${region.id}`;
            hotspot.dataset.regionId = region.id;
            hotspot.dataset.position = region.position;
            hotspot.dataset.normal = region.normal;
            hotspot.dataset.visibilityAttribute = "visible";
            hotspot.setAttribute("aria-hidden", "true");
            hotspot.tabIndex = -1;

            const dot = document.createElement("span");
            dot.className = "brain-hotspot-dot";
            hotspot.appendChild(dot);

            const line = document.createElementNS(svgNamespace, "line");
            line.classList.add("brain-region-line");
            line.dataset.regionId = region.id;
            brainRegionLineLayer.appendChild(line);

            const label = document.createElement("a");
            label.className = "brain-region-label";
            label.href = region.url;
            label.textContent = region.label;
            label.dataset.regionId = region.id;
            label.dataset.priority = String(region.priority);
            label.setAttribute("aria-label", `Open ${region.label} overview`);
            label.addEventListener("pointerdown", event => event.stopPropagation());

            brainRegionLabelLayer.appendChild(label);
            brainShowcaseModel.appendChild(hotspot);

            labelStates.set(region.id, {
                region,
                hotspot,
                line,
                label,
                x: null,
                y: null,
                opacity: 0
            });
        });
    }

    function hotspotIsVisible(hotspot) {
        return hotspot.hasAttribute("visible") || hotspot.hasAttribute("data-visible");
    }

    function hideRegionLabels() {
        labelStates.forEach(state => {
            state.opacity = 0;
            state.label.style.opacity = "0";
            state.label.style.pointerEvents = "none";
            state.line.style.opacity = "0";
        });
    }

    function resolveLabelColumn(items, minTop, maxTop) {
        const minGap = window.innerWidth < 760 ? 8 : 12;

        items.sort((a, b) => a.targetTop - b.targetTop);

        for (let index = 0; index < items.length; index += 1) {
            const previous = items[index - 1];
            const current = items[index];

            if (previous) {
                current.targetTop = Math.max(
                    current.targetTop,
                    previous.targetTop + previous.height + minGap
                );
            }

            current.targetTop = Math.max(current.targetTop, minTop);
        }

        for (let index = items.length - 1; index >= 0; index -= 1) {
            const next = items[index + 1];
            const current = items[index];

            if (next) {
                current.targetTop = Math.min(
                    current.targetTop,
                    next.targetTop - current.height - minGap
                );
            }

            current.targetTop = Math.min(current.targetTop, maxTop - current.height);
            current.targetTop = Math.max(current.targetTop, minTop);
        }
    }

    function updateRegionLabels() {
        regionLabelFrame = null;

        if (!regionLabelsActive || !brainRegionLineLayer || !brainRegionLabelLayer) {
            return;
        }

        const overlayRect = brainRegionLabelLayer.getBoundingClientRect();
        const modelRect = brainShowcaseModel.getBoundingClientRect();
        const navRect = siteNavbar ? siteNavbar.getBoundingClientRect() : null;
        const labelOpacity = Number(
            brainShowcaseSection.style.getPropertyValue("--brain-label-opacity") || 0
        );
        const isPhone = window.innerWidth < 680;
        const lineLength = window.innerWidth < 760 ? 34 : 64;
        const minLeft = window.innerWidth < 760 ? 10 : 18;
        const maxLeft = overlayRect.width - minLeft;
        const navSafeTop = navRect ? Math.max(18, navRect.bottom - overlayRect.top + 14) : 24;
        const minTop = Math.max(18, navSafeTop);
        const maxTop = Math.max(minTop + 80, overlayRect.height - 24);
        const modelLeft = modelRect.left - overlayRect.left;
        const modelTop = modelRect.top - overlayRect.top;
        const modelWidth = modelRect.width;
        const modelHeight = modelRect.height;
        const modelCenterX = modelLeft + modelWidth / 2;
        const modelInsetX = modelWidth * (isPhone ? 0.06 : 0.08);
        const modelInsetY = modelHeight * (isPhone ? 0.08 : 0.10);
        const brainBounds = {
            left: modelLeft + modelInsetX,
            right: modelLeft + modelWidth - modelInsetX,
            top: modelTop + modelInsetY,
            bottom: modelTop + modelHeight - modelInsetY
        };
        const candidates = {
            left: [],
            right: []
        };

        brainRegionLineLayer.setAttribute("viewBox", `0 0 ${overlayRect.width} ${overlayRect.height}`);
        brainRegionLineLayer.setAttribute("width", String(overlayRect.width));
        brainRegionLineLayer.setAttribute("height", String(overlayRect.height));

        labelStates.forEach(state => {
            const { region, hotspot, label, line } = state;
            const hiddenOnPhone = isPhone && region.priority > 4;
            const visible = !hiddenOnPhone && labelOpacity > 0.02 && hotspotIsVisible(hotspot);

            if (!visible) {
                state.opacity += (0 - state.opacity) * 0.28;
                label.style.opacity = state.opacity.toFixed(3);
                label.style.pointerEvents = "none";
                line.style.opacity = label.style.opacity;
                return;
            }

            const hotspotRect = hotspot.getBoundingClientRect();
            const labelWidth = label.offsetWidth || 148;
            const labelHeight = label.offsetHeight || 42;
            const dotX = hotspotRect.left + hotspotRect.width / 2 - overlayRect.left;
            const dotY = hotspotRect.top + hotspotRect.height / 2 - overlayRect.top;

            if (!Number.isFinite(dotX) || !Number.isFinite(dotY)) {
                return;
            }

            let side = dotX < modelCenterX ? -1 : 1;

            if (Math.abs(dotX - modelCenterX) < modelWidth * 0.08) {
                side = region.preferredSide === "left" ? -1 : 1;
            }

            if (side > 0 && brainBounds.right + lineLength + labelWidth > maxLeft) {
                side = -1;
            } else if (side < 0 && brainBounds.left - lineLength - labelWidth < minLeft) {
                side = 1;
            }

            const targetLeft = clamp(
                side > 0
                    ? Math.max(dotX + lineLength, brainBounds.right + lineLength * 0.55)
                    : Math.min(dotX - lineLength - labelWidth, brainBounds.left - labelWidth - lineLength * 0.55),
                minLeft,
                maxLeft - labelWidth
            );
            const targetTop = clamp(
                dotY - labelHeight / 2,
                Math.max(minTop, brainBounds.top - labelHeight * 0.8),
                Math.min(maxTop - labelHeight, brainBounds.bottom + labelHeight * 0.8)
            );
            const groupName = side < 0 ? "left" : "right";

            candidates[groupName].push({
                state,
                side,
                dotX,
                dotY,
                targetLeft,
                targetTop,
                width: labelWidth,
                height: labelHeight
            });
        });

        resolveLabelColumn(candidates.left, minTop, maxTop);
        resolveLabelColumn(candidates.right, minTop, maxTop);

        [...candidates.left, ...candidates.right].forEach(item => {
            const { state, side, dotX, dotY, targetLeft, targetTop, width, height } = item;
            const ease = prefersReducedShowcaseMotion?.matches ? 1 : 0.22;
            const targetOpacity = labelOpacity;

            state.x = state.x === null ? targetLeft : lerp(state.x, targetLeft, ease);
            state.y = state.y === null ? targetTop : lerp(state.y, targetTop, ease);
            state.opacity = lerp(state.opacity, targetOpacity, ease);

            const labelCenterY = state.y + height / 2;
            const lineEndX = side > 0 ? state.x : state.x + width;

            state.label.style.transform = `translate3d(${state.x}px, ${state.y}px, 0)`;
            state.label.style.opacity = state.opacity.toFixed(3);
            state.label.style.pointerEvents = state.opacity > 0.35 ? "auto" : "none";

            state.line.setAttribute("x1", dotX.toFixed(1));
            state.line.setAttribute("y1", dotY.toFixed(1));
            state.line.setAttribute("x2", lineEndX.toFixed(1));
            state.line.setAttribute("y2", labelCenterY.toFixed(1));
            state.line.style.opacity = state.opacity.toFixed(3);
        });

        if (regionLabelsActive) {
            regionLabelFrame = window.requestAnimationFrame(updateRegionLabels);
        }
    }

    function startRegionLabelLoop() {
        if (!regionLabelFrame) {
            regionLabelFrame = window.requestAnimationFrame(updateRegionLabels);
        }
    }

    function stopRegionLabelLoop() {
        regionLabelsActive = false;

        if (regionLabelFrame) {
            window.cancelAnimationFrame(regionLabelFrame);
            regionLabelFrame = null;
        }

        hideRegionLabels();
    }

    function setRegionLabelsActive(active) {
        if (active === regionLabelsActive) return;

        regionLabelsActive = active;
        brainShowcaseSection.classList.toggle("brain-labels-enabled", active);

        if (active) {
            startRegionLabelLoop();
        } else {
            stopRegionLabelLoop();
        }
    }

    function updateBrainShowcase() {
        showcaseScrollTicking = false;

        const rect = brainShowcaseSection.getBoundingClientRect();
        const sectionVisible = rect.bottom > 0 && rect.top < window.innerHeight;
        const progress = getShowcaseProgress(rect);
        const reduceMotion = prefersReducedShowcaseMotion?.matches;
        const growProgress = smoothstep(0.25, 0.65, progress);
        const exitProgress = smoothstep(0.90, 1, progress);
        const labelProgress = smoothstep(0.62, 0.72, progress) * (1 - smoothstep(0.90, 0.98, progress));
        const textFadeProgress = reduceMotion
            ? smoothstep(0.35, 0.68, progress) * 0.75
            : smoothstep(0.25, 0.65, progress);
        const baseModelSize = getBaseModelSize();
        const expandedModelSize = getExpandedModelSize(baseModelSize);
        const modelSize = lerp(baseModelSize, expandedModelSize, reduceMotion ? growProgress * 0.55 : growProgress)
            * (1 - exitProgress * 0.08);
        const sectionRectForCenter = brainShowcaseSection.getBoundingClientRect();
        const stageCenterInSection = brainShowcaseStage.offsetLeft + brainShowcaseStage.offsetWidth / 2;
        const viewportCenterInSection = window.innerWidth / 2 - sectionRectForCenter.left;
        const stageCenterOffsetX = viewportCenterInSection - stageCenterInSection;
        const stageX = lerp(0, stageCenterOffsetX, growProgress);
        const stageY = lerp(-40, 0, growProgress);
        const copyY = -40;
        const copyOpacity = clamp(1 - textFadeProgress, 0, 1);
        const leftX = lerp(0, -86, textFadeProgress);
        const rightX = lerp(0, 86, textFadeProgress);
        const decorScale = lerp(1, 1.18, growProgress);
        const decorOpacity = clamp(1 - growProgress * 0.45 - exitProgress * 0.35, 0, 1);
        const finalLabelOpacity = clamp(labelProgress, 0, 1);

        currentShowcaseProgress = progress;

        brainShowcaseSection.dataset.showcasePhase = progress < 0.25
            ? "layout"
            : progress < 0.65
                ? "expand"
                : progress < 0.90
                    ? "explore"
                    : "exit";

        brainShowcaseSection.style.setProperty("--showcase-model-size", `${modelSize.toFixed(1)}px`);
        brainShowcaseSection.style.setProperty("--showcase-stage-x", `${stageX.toFixed(1)}px`);
        brainShowcaseSection.style.setProperty("--showcase-stage-y", `${stageY.toFixed(1)}px`);
        brainShowcaseSection.style.setProperty("--showcase-left-x", `${leftX.toFixed(1)}px`);
        brainShowcaseSection.style.setProperty("--showcase-right-x", `${rightX.toFixed(1)}px`);
        brainShowcaseSection.style.setProperty("--showcase-copy-y", `${copyY}px`);
        brainShowcaseSection.style.setProperty("--showcase-text-opacity", copyOpacity.toFixed(3));
        brainShowcaseSection.style.setProperty("--showcase-decor-scale", decorScale.toFixed(3));
        brainShowcaseSection.style.setProperty("--showcase-decor-opacity", decorOpacity.toFixed(3));
        brainShowcaseSection.style.setProperty("--brain-label-opacity", finalLabelOpacity.toFixed(3));

        if (!userAdjustedBrainCamera && progress < 0.65 && !reduceMotion) {
            const orbitAngle = -30 + progress * 120;
            const distance = lerp(3.05, 2.78, growProgress);

            brainShowcaseModel.setAttribute(
                "camera-orbit",
                `${orbitAngle.toFixed(2)}deg 72deg ${distance.toFixed(2)}m`
            );
            brainShowcaseModel.setAttribute("camera-target", "0m 0m 0m");
        }

        setRegionLabelsActive(sectionVisible && finalLabelOpacity > 0.02);

        if (sectionVisible && (showcaseLeftCopy || showcaseRightCopy)) {
            showcaseLeftCopy?.classList.add("show");
            showcaseRightCopy?.classList.add("show");
        }
    }

    function requestBrainShowcaseUpdate() {
        if (!showcaseScrollTicking) {
            window.requestAnimationFrame(updateBrainShowcase);
            showcaseScrollTicking = true;
        }
    }

    createBrainRegionHotspots();

    brainShowcaseModel.addEventListener("pointerdown", () => {
        if (currentShowcaseProgress >= 0.60) {
            userAdjustedBrainCamera = true;
        }

        document.body.classList.add("brain-model-dragging");
    });

    window.addEventListener("pointerup", () => {
        document.body.classList.remove("brain-model-dragging");
    });

    brainShowcaseModel.addEventListener("load", () => {
        requestBrainShowcaseUpdate();
        startRegionLabelLoop();
    });

    brainShowcaseModel.addEventListener("camera-change", () => {
        if (regionLabelsActive) {
            startRegionLabelLoop();
        }
    });

    window.addEventListener("scroll", requestBrainShowcaseUpdate, { passive: true });
    window.addEventListener("resize", requestBrainShowcaseUpdate);

    updateBrainShowcase();
}
